/**
 * Hermes Agent seller channel for the Prometheus MCP server.
 *
 * Connect this MCP server (running inside Hermes Agent) to a Prometheus seller account through an RFC 8628
 * device flow, then publish listings at the Hermes Agent rate. Contract: the Prometheus seller-channel API contract v1.1.
 *
 * The server must show it is really running under Hermes, because an MCP server is not a plugin host:
 *   - PROMETHEUS_CHANNEL=hermes in its environment;
 *   - a Hermes process among its ancestors (only the matched token and the depth are sent, never a command line);
 *   - the MCP client name from `initialize`, and whether the client declared sampling.
 * The channel key (pch_...) is kept in ~/.prometheus/channel-hermes.json (mode 0600), never in the Hermes config.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const CLIENT_NAME = "prometheus-mcp-server";
const DEFAULT_BASE = "https://prometheus.mythslabs.ai";
const HERMES_RE = /(^|[\/\s])hermes(-agent)?(\s|$)|hermes_cli/;

// ─── Hermes evidence ───────────────────────────────────────────────

export interface PsRow { ppid: number; args: string }
export type PsRunner = (pid: number) => PsRow | null;

/** `ps -o ppid=,args= -p <pid>`; null when the process is gone or ps is unavailable. */
export const defaultPs: PsRunner = (pid) => {
    try {
        const out = execFileSync("ps", ["-o", "ppid=,args=", "-p", String(pid)], { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).trim();
        const m = /^(\d+)\s+(.*)$/s.exec(out);
        return m ? { ppid: Number(m[1]), args: m[2] } : null;
    } catch {
        return null;
    }
};

/** Walks up to `maxDepth` parents (parent = depth 1) looking for a Hermes process. Returns only token and depth. */
export function findHermesAncestor(startPid: number, ps: PsRunner = defaultPs, maxDepth = 8): { ancestor: "hermes"; depth: number } | null {
    let pid = startPid;
    const deadline = Date.now() + 4000;          // ps runs synchronously inside the stdio server: a hard total budget, and room for a busy machine
    for (let depth = 1; depth <= maxDepth; depth++) {
        if (!pid || pid <= 1 || Date.now() > deadline) return null;
        const row = ps(pid);
        if (!row) return null;
        if (HERMES_RE.test(row.args)) return { ancestor: "hermes", depth };
        pid = row.ppid;
    }
    return null;
}

// ─── HTTP client ───────────────────────────────────────────────────

/** Text that came from the server and may end up in a tool result a model reads: no control characters, capped. */
function cleanText(v: string, max = 300): string {
    const t = v.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** A link from the server that may be shown to a user: https, one line, no control or format characters, not absurdly long. */
function safeHttpsUrl(v: unknown): string | null {
    if (typeof v !== "string" || v.length > 300 || !v.startsWith("https://") || /[\s\p{Cc}\p{Cf}]/u.test(v)) return null;
    try { new URL(v); } catch { return null; }
    return v;
}

export class ChannelError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly extra: { status?: number; fixUrl?: string | null; until?: string | null; permanent?: boolean; retryAfterSec?: number } = {},
    ) {
        super(message);
        this.name = "ChannelError";
    }
}

export interface ChannelKeyResponse { key: string; key_prefix: string; channel: string; identity_type: string | null; x_linked: boolean; next_url: string; account_hint?: string; next_step?: "link_x" | null; registration_note?: string | null }
export interface Whoami {
    channel: string; client_name: string; key_prefix: string; linked_at: string;
    account: { identity_type: string | null; is_member: boolean; fee: { platform: number; member: number } };
    x_link: { linked: boolean; handle: string | null; eligible_on: string | null };
    today: { used: number; cap: number }; listings: { active: number; hidden: number };
    suspension: { until: string | null; permanent: boolean } | null; next_url: string;
}
export interface PublishResult { asset_id: string; url: string; creator_type: string; fee: { platform: number; member: number }; bonus_hold_days: number }

type Poll =
    | { status: "approved"; key: ChannelKeyResponse }
    | { status: "pending" } | { status: "slow_down"; interval?: number } | { status: "denied" } | { status: "expired" } | { status: "invalid" };

export class ChannelApi {
    private readonly base: string;
    private readonly header: string;

    constructor(private readonly o: { baseUrl?: string; version: string; fetchImpl?: typeof fetch }) {
        const raw = (o.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
        const url = new URL(raw);
        const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if (url.protocol !== "https:" && !loopback) throw new Error("PROMETHEUS_API_URL must be https (or http on localhost): a channel key is never sent over plain HTTP.");
        this.base = raw;
        this.header = `${CLIENT_NAME}/${o.version} (hermes)`;
    }

    private async call(p: string, init: { method: "GET" | "POST"; key?: string; body?: unknown; timeoutMs?: number }) {
        const headers: Record<string, string> = { "X-Prometheus-Client": this.header, Accept: "application/json" };
        if (init.body !== undefined) headers["Content-Type"] = "application/json";
        if (init.key) headers.Authorization = `Bearer ${init.key}`;
        let res: Response;
        try {
            res = await (this.o.fetchImpl ?? fetch)(`${this.base}${p}`, {
                method: init.method, headers,
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
                signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
            });
        } catch (err) {
            throw new ChannelError("CHANNEL_NETWORK", `Could not reach Prometheus (${err instanceof Error ? err.message : String(err)}). Check the network and try again.`);
        }
        let text: string;
        try {
            text = await res.text();
        } catch (err) {
            // The status line arrived but the body did not: for a publish the server has probably acted already.
            throw new ChannelError("CHANNEL_NETWORK", `Prometheus answered, but the answer was cut off (${err instanceof Error ? err.message : String(err)}).`);
        }
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        const ra = Number(res.headers.get("retry-after"));
        return { status: res.status, data, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined };
    }

    private fail(status: number, data: any, retryAfter?: number): never {
        // A missing route or a gateway error carries no `error` code: the channel is not (yet) live on this server.
        if (typeof data?.error !== "string" && (status === 404 || status === 502 || status === 503 || status === 504)) {
            throw new ChannelError("CHANNEL_UNAVAILABLE", `The Prometheus seller channel is not available right now (HTTP ${status}). It may not have launched yet; try again later.`, { status, retryAfterSec: retryAfter });
        }
        // The wait is in the Retry-After header and, in the contract, also in the body as `retry_after` (seconds).
        const bodyWait = Number(data?.retry_after);
        const wait = retryAfter ?? (Number.isFinite(bodyWait) && bodyWait > 0 ? bodyWait : undefined);
        throw new ChannelError(
            typeof data?.error === "string" ? cleanText(data.error, 64) : `HTTP_${status}`,
            typeof data?.message === "string" && data.message ? cleanText(data.message) : `Prometheus answered HTTP ${status}.`,
            { status, fixUrl: safeHttpsUrl(data?.fix_url), until: typeof data?.until === "string" ? cleanText(data.until, 40) : null, permanent: data?.permanent === true, retryAfterSec: wait },
        );
    }

    async startLink(evidence: Record<string, unknown>) {
        const r = await this.call("/api/channels/link/start", {
            method: "POST",
            body: { channel: "hermes", client: { name: CLIENT_NAME, version: this.o.version }, runtime: { name: "hermes" }, evidence },
        });
        if (r.status !== 200 || !r.data?.device_code) this.fail(r.status, r.data, r.retryAfter);
        return r.data as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
    }

    async pollToken(deviceCode: string): Promise<Poll> {
        const r = await this.call("/api/channels/link/token", { method: "POST", body: { device_code: deviceCode } });
        if (r.status === 200 && typeof r.data?.key === "string") return { status: "approved", key: r.data };
        switch (r.data?.error) {
            case "authorization_pending": return { status: "pending" };
            case "slow_down": return { status: "slow_down", interval: typeof r.data.interval === "number" ? r.data.interval : undefined };
            case "access_denied": return { status: "denied" };
            case "expired_token": return { status: "expired" };
            case "invalid_grant": return { status: "invalid" };
            default: this.fail(r.status, r.data, r.retryAfter);
        }
    }

    async whoami(key: string): Promise<Whoami> {
        const r = await this.call("/api/channels/whoami", { method: "GET", key });
        if (r.status !== 200 || !r.data?.channel) this.fail(r.status, r.data, r.retryAfter);
        return r.data;
    }

    async publish(key: string, payload: Record<string, unknown>): Promise<PublishResult> {
        const r = await this.call("/api/channels/publish", { method: "POST", key, body: payload, timeoutMs: 120_000 });
        if (r.status !== 200 || !r.data?.asset_id) this.fail(r.status, r.data, r.retryAfter);
        return r.data;
    }

    async unlinkSelf(key: string, hide: boolean) {
        const r = await this.call("/api/channels/unlink-self", { method: "POST", key, body: { hide_listings: hide } });
        if (r.status !== 200 || r.data?.ok !== true) this.fail(r.status, r.data, r.retryAfter);
        return r.data as { ok: true; hidden: number; kept?: number };
    }
}

// ─── Key file ──────────────────────────────────────────────────────

export interface StoredChannel { key: string; key_prefix: string; channel: "hermes"; linked_at: string; client_version: string; account_hint?: string; registration_note?: string; base_url?: string }

export class KeyFile {
    constructor(private readonly file: string) {}
    location() { return this.file; }
    async get(): Promise<StoredChannel | null> {
        try {
            const v = JSON.parse(await fs.readFile(this.file, "utf8"));
            return v && typeof v.key === "string" && v.key.startsWith("pch_") ? v : null;
        } catch { return null; }
    }
    async set(v: StoredChannel) {
        await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const tmp = `${this.file}.${process.pid}.tmp`;
        try {
            await fs.writeFile(tmp, JSON.stringify(v), { mode: 0o600 });
            await fs.chmod(tmp, 0o600);
            await fs.rename(tmp, this.file);
        } catch (err) {
            await fs.rm(tmp, { force: true }).catch(() => undefined);      // never leave a half-written copy of the key behind
            throw err;
        }
    }
    async clear() { await fs.rm(this.file, { force: true }); }
}

export const defaultKeyFile = () => path.join(os.homedir(), ".prometheus", "channel-hermes.json");

// ─── Connection ────────────────────────────────────────────────────

export interface Outcome { ok: boolean; text: string }

export interface ConnectionDeps {
    version: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    keyFile: KeyFile;
    env?: Record<string, string | undefined>;
    ps?: PsRunner;
    /** Client name/version from the MCP `initialize` handshake, and whether it declared sampling. */
    getClient: () => { name: string; version?: string; sampling: boolean } | null;
    now?: () => number;
    log?: (m: string) => void;
}

type PendingState = "waiting" | "denied" | "expired" | "invalid" | "failed";
interface Pending { device_code: string; user_code: string; verification_uri: string; expiresAt: number; interval: number; nextPollAt: number; state: PendingState; failure?: string }

/** The masked account email from the server, cleaned for display (short, no control characters). */
function safeHint(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const t = v.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "").trim();     // control and format characters (bidi overrides, zero-width, tags)
    return t && t.length <= 80 ? t : undefined;
}

/** What the server's registration_note means for the user. */
function noteText(note: string, seller: string): string {
    if (note === "ACCOUNT_HAS_SELLER_HISTORY") return `This account will not become ${seller}: it already has sales or listings.`;
    if (note === "IDENTITY_LOCKED") return `This account will not become ${seller}: its account type is already set.`;
    return `This account will not become ${seller} (${note.replace(/[^A-Za-z0-9_ .-]/g, "").slice(0, 64)}).`;
}

const fee = (n: number) => `${Math.round(n * 1000) / 10}%`;

const DEFAULT_ORIGIN = new URL(DEFAULT_BASE).origin;

/** The origin an address points at, or null when a key may not be sent there (https, or http on this machine). */
function safeOrigin(raw?: string): string | null {
    try {
        const u = new URL(raw || DEFAULT_BASE);
        const loopback = u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
        return u.protocol === "https:" || loopback ? u.origin : null;
    } catch {
        return null;
    }
}

/** A number from the server, held inside sane bounds; the fallback when it is missing or not a number. */
const num = (v: unknown, fallback: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** A failure worth waiting out while the device flow is open: the approval may still come. */
function isTransient(err: unknown): boolean {
    if (!(err instanceof ChannelError)) return false;
    const st = err.extra.status ?? 0;
    return ["CHANNEL_NETWORK", "CHANNEL_UNAVAILABLE", "TEMPORARILY_UNAVAILABLE", "RATE_LIMITED"].includes(err.code) || st === 429 || st >= 500;
}

/**
 * The request may have reached the server before it failed, so a publish may already exist: a dropped connection, a cut-off
 * answer, a gateway timeout, an internal error. A missing route (404) or "unavailable" (503) was not processed.
 */
function isAmbiguous(err: unknown): boolean {
    const st = err instanceof ChannelError ? err.extra.status ?? 0 : 0;
    return err instanceof ChannelError && (err.code === "CHANNEL_NETWORK" || st === 500 || st === 502 || st === 504);
}

function waitText(sec: number): string {
    if (sec < 120) return `${Math.max(1, Math.ceil(sec))} seconds`;
    if (sec < 7200) return `${Math.ceil(sec / 60)} minutes`;
    return `${Math.ceil(sec / 3600)} hours`;
}

/** A short word from the server (an account type), reduced to plain characters before it is shown. */
const word = (v: unknown) => String(v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);

/** Other short values the server sends for display (an X handle, a date, an id): plain characters only, short. */
const plain = (v: unknown, max = 40) => String(v ?? "").replace(/[^A-Za-z0-9@._:+\- ]/g, "").slice(0, max);

/** A count from the server, shown as a number whatever it arrives as. */
const count = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** An address from the server that is shown to the user only when a key could safely go there. */
const shownLink = (u: unknown) => (typeof u === "string" && u.length <= 300 && !/[\s\p{Cc}\p{Cf}]/u.test(u) && safeOrigin(u) ? u : undefined);

export class SellerConnection {
    private pending?: Pending;
    private polling = false;
    private lastApproved?: { x_linked: boolean; next_url: string; next_step: string | null };
    private hint?: string;
    private api?: ChannelApi;
    private starting?: Promise<Outcome>;

    constructor(private readonly d: ConnectionDeps) {}

    private now() { return (this.d.now ?? Date.now)(); }
    private client() { return (this.api ??= new ChannelApi({ baseUrl: this.d.baseUrl, version: this.d.version, fetchImpl: this.d.fetchImpl })); }

    private failure(err: unknown, what: string): Outcome {
        if (err instanceof ChannelError) {
            const bits = [`${what}: ${err.message}`];
            if (err.extra.fixUrl) bits.push(`Fix it here: ${err.extra.fixUrl}`);
            if (err.extra.permanent) bits.push("This suspension is permanent.");
            else if (err.extra.until) bits.push(`Suspended until ${err.extra.until}.`);
            if (err.extra.retryAfterSec) bits.push(`Try again in about ${waitText(err.extra.retryAfterSec)}.`);
            bits.push(`[${err.code}]`);
            return { ok: false, text: bits.join(" ") };
        }
        return { ok: false, text: `${what}: ${err instanceof Error ? err.message : String(err)}` };
    }

    /** What the server wants to see before it believes this is Hermes. Returns text when it cannot be produced. */
    private evidence(): { evidence: Record<string, unknown> } | { refusal: string } {
        const env = this.d.env ?? process.env;
        if (process.platform === "win32") return { refusal: "Native Windows cannot connect Hermes Agent; run Hermes in WSL." };
        if (env.PROMETHEUS_CHANNEL !== "hermes") {
            return { refusal: "This MCP server is not set up as a Hermes seller channel. In ~/.hermes/config.yaml, add PROMETHEUS_CHANNEL: hermes under this server's env, restart Hermes, and try again. Used from another app, or with only an API key, this server cannot verify the account through Hermes Agent." };
        }
        const found = findHermesAncestor(process.ppid, this.d.ps);
        if (!found) return { refusal: "I could not find Hermes Agent above this MCP server (or could not read the process list), so I will not connect. Run this from inside Hermes (mcp_servers in ~/.hermes/config.yaml)." };
        const c = this.d.getClient();
        if (!c) return { refusal: "The MCP client has not introduced itself yet; try again in a moment." };
        return {
            evidence: {
                env_channel: "hermes", ancestor: found.ancestor, ancestor_depth: found.depth,
                mcp_client: { name: c.name, ...(c.version ? { version: c.version } : {}) }, sampling_declared: c.sampling,
            },
        };
    }

    private origin(): string { return safeOrigin(this.d.baseUrl) ?? DEFAULT_ORIGIN; }

    /** The saved connection, and whether it was made against another Prometheus address than this server uses now. */
    private async saved(): Promise<{ stored: StoredChannel | null; mismatch: boolean }> {
        const stored = await this.d.keyFile.get();
        if (!stored) return { stored: null, mismatch: false };
        return { stored, mismatch: (stored.base_url ?? DEFAULT_ORIGIN) !== this.origin() };
    }

    private mismatchOutcome(stored: StoredChannel): Outcome {
        return { ok: false, text: `The saved connection was made with ${stored.base_url ?? DEFAULT_ORIGIN}, but this server now talks to ${this.origin()}, so nothing was sent. Connect again for this address (relink=true), or point PROMETHEUS_API_URL back.` };
    }

    /** Drop the saved key only if it is still the one that just failed (a new connection may have replaced it meanwhile). */
    private async clearIfSame(key: string): Promise<void> {
        const cur = await this.d.keyFile.get();
        if (cur && cur.key === key) await this.d.keyFile.clear();
    }

    connect(relink = false): Promise<Outcome> {
        // Two calls at once (a model can issue them in one turn) share one start: one code, one request to the server.
        this.starting ??= this.startConnect(relink).finally(() => { this.starting = undefined; });
        return this.starting;
    }

    private async startConnect(relink: boolean): Promise<Outcome> {
        const { stored } = await this.saved();
        if (stored && !relink) {
            const st = await this.status();
            return { ...st, text: `${st.text}\nTo connect a different account, call connect_seller again with relink=true.` };
        }
        const p = this.pending;
        if (p && p.state === "waiting" && this.now() < p.expiresAt) return this.waitingText(p);
        const ev = this.evidence();
        if ("refusal" in ev) return { ok: false, text: ev.refusal };
        try {
            const s = await this.client().startLink(ev.evidence);
            const link = shownLink(s.verification_uri);
            const code = typeof s.user_code === "string" ? s.user_code.replace(/[^A-Za-z0-9-]/g, "").slice(0, 16) : "";
            if (!link || !code || typeof s.device_code !== "string" || !s.device_code) {
                return { ok: false, text: "Could not start the connection: Prometheus sent an approval link or code I do not trust (a link must be https, or http on this computer). Nothing was started; try again later." };
            }
            const t = this.now();
            const interval = num(s.interval, 5, 1, 60);
            this.pending = { device_code: s.device_code, user_code: code, verification_uri: link, expiresAt: t + num(s.expires_in, 600, 30, 1800) * 1000, interval, nextPollAt: t + interval * 1000, state: "waiting" };
            this.schedule();
            return this.waitingText(this.pending);
        } catch (err) {
            return this.failure(err, "Could not start the connection");
        }
    }

    private waitingText(p: Pending): Outcome {
        const mins = Math.max(1, Math.ceil((p.expiresAt - this.now()) / 60000));
        return { ok: true, text: `To connect, open ${p.verification_uri} and approve code ${p.user_code} within ${mins} minutes. Sign in to Prometheus first if the page asks. I will finish the connection as soon as you approve (keep Hermes running until then: a pending approval is lost when it restarts); you can also ask me for the connection status.` };
    }

    private schedule() {
        const p = this.pending;
        if (!p || p.state !== "waiting") return;
        const t = setTimeout(() => { void this.pollOnce(); }, Math.max(0, p.nextPollAt - this.now()));
        t.unref?.();
    }

    async pollOnce(): Promise<void> {
        const p = this.pending;
        if (this.polling || !p || p.state !== "waiting") return;
        if (this.now() >= p.expiresAt) { p.state = "expired"; return; }
        if (this.now() < p.nextPollAt) { this.schedule(); return; }
        this.polling = true;
        try {
            const r = await this.client().pollToken(p.device_code);
            if (this.pending !== p) {              // disconnected, or a new connection started, while this poll was out
                if (r.status === "approved") this.d.log?.(`A connection (key ${r.key.key_prefix}...) was approved just as the connection was cancelled, so it is not saved. Revoke it under Dashboard > Seller types if it should not stay active.`);
                return;
            }
            switch (r.status) {
                case "approved":
                    await this.d.keyFile.set({ key: r.key.key, key_prefix: r.key.key_prefix, channel: "hermes", linked_at: new Date(this.now()).toISOString(), client_version: this.d.version, base_url: this.origin(), ...(safeHint(r.key.account_hint) ? { account_hint: safeHint(r.key.account_hint) } : {}), ...(typeof r.key.registration_note === "string" && r.key.registration_note ? { registration_note: r.key.registration_note.slice(0, 64) } : {}) });
                    this.lastApproved = { x_linked: r.key.x_linked, next_url: r.key.next_url, next_step: r.key.next_step ?? null };
                    this.hint = safeHint(r.key.account_hint);
                    this.pending = undefined;
                    this.d.log?.(`Prometheus seller channel connected (key ${r.key.key_prefix}...; stored at ${this.d.keyFile.location()}).`);
                    return;
                case "pending": p.nextPollAt = this.now() + p.interval * 1000; break;
                case "slow_down": p.interval = num(r.interval, p.interval + 5, 1, 120); p.nextPollAt = this.now() + p.interval * 1000; break;
                case "denied": p.state = "denied"; break;
                case "expired": p.state = "expired"; break;
                case "invalid": p.state = "invalid"; break;
            }
        } catch (err) {
            if (this.pending !== p) return;
            if (isTransient(err)) {
                // A network drop, a 5xx or a rate limit while waiting: the approval may still come, so keep waiting until the code expires.
                const wait = Math.min(120, Math.max(p.interval, err instanceof ChannelError ? err.extra.retryAfterSec ?? 0 : 0));
                p.nextPollAt = this.now() + wait * 1000;
            } else {
                p.state = "failed";
                p.failure = this.failure(err, "Connecting failed").text;
            }
        } finally {
            this.polling = false;
            this.schedule();
        }
    }

    async status(): Promise<Outcome> {
        if (this.pending) {
            await this.pollOnce();
            const p = this.pending;
            if (p) {
                switch (p.state) {
                    case "waiting": return this.waitingText(p);
                    case "denied": this.pending = undefined; return { ok: false, text: "The connection was declined on the approval page. Ask me to connect again if that was a mistake." };
                    case "expired": this.pending = undefined; return { ok: false, text: "The approval code expired (10 minutes). Ask me to connect again for a new code." };
                    case "invalid": this.pending = undefined; return { ok: false, text: "That approval code is no longer valid. Ask me to connect again." };
                    case "failed": this.pending = undefined; return { ok: false, text: p.failure ?? "Connecting failed." };
                }
            }
        }
        const { stored, mismatch } = await this.saved();
        if (!stored) return { ok: false, text: 'Not connected to a Prometheus seller account. Ask me to "Connect my Prometheus seller account" to start. (An approval that was still pending when this server restarted is lost: connect again for a new code.)' };
        if (mismatch) return this.mismatchOutcome(stored);
        try {
            const w = await this.client().whoami(stored.key);
            return this.connectedText(w, safeHint(stored.account_hint) ?? this.hint, stored.registration_note);
        } catch (err) {
            if (err instanceof ChannelError && err.code === "CHANNEL_KEY_INACTIVE") {
                await this.clearIfSame(stored.key);
                return { ok: false, text: "The saved connection is no longer active (it was revoked or replaced). Ask me to connect again." };
            }
            const f = this.failure(err, "Could not check the connection");
            if (this.lastApproved) f.text = `${this.approvalText(stored.account_hint, stored.registration_note)}\n${f.text}`;
            return f;
        }
    }

    /** What the user should hear right after approving: which account, and the next step or why there is none. */
    private approvalText(hintRaw?: string, note?: string): string {
        const hint = safeHint(hintRaw) ?? this.hint;
        const lines = [`Approved${hint ? ` by the Prometheus account ${hint}` : ""}; the key is saved.`];
        const next = shownLink(this.lastApproved?.next_url);
        if (this.lastApproved?.next_step === "link_x") lines.push(`Next: link your X account on the Prometheus dashboard${next ? ` (${next})` : ""}. The account becomes a Hermes Agent seller only once X is linked.`);
        if (note) lines.push(noteText(note, "a Hermes Agent seller"));
        return lines.join("\n");
    }

    /**
     * The tier is decided on the server, and only once several things are true at the same time, and then it is set once,
     * so the status says what the server says the account is (whoami.account.identity_type), never more.
     */
    private connectedText(w: Whoami, hint?: string, noteSaved?: string): Outcome {
        const type = w.account.identity_type;
        const seller = type === "hermes";
        const otherSeller = type === "openclaw";                        // another channel got the tier first
        const note = seller ? undefined : noteSaved;                    // the saved note is a snapshot from the approval; the server's account type is the truth
        const who = hint ? ` to the Prometheus account ${hint}` : "";
        const key = `key ${plain(w.key_prefix, 16)}...`;
        const rate = `Platform fee ${fee(w.account.fee.platform)}, ${fee(w.account.fee.member)} for members.`;
        const lines = [seller
            ? `Connected as a Hermes Agent seller${who} (${key}). ${rate}`
            : otherSeller
                ? `Connected${who} with a Hermes Agent key (${key}), but the account is an OpenClaw seller, so it will not become a Hermes Agent seller (an account's seller type is set once). Listings are sold at the account's rate. ${rate}`
                : `Connected${who} with a Hermes Agent key (${key}), but the account is not a Hermes Agent seller${note ? "" : " yet"}${type ? ` (account type: ${word(type)})` : ""}. Listings are sold at the account's current rate. ${rate}`];
        if (note) lines.push(noteText(note, "a Hermes Agent seller"));
        else if (!seller && !otherSeller) lines.push(`The account becomes a Hermes Agent seller once all of these are true: it chose Hermes Agent as its registration type (open ${this.origin()}/join?type=hermes, sign in and press Register), it has no earlier sales or listings, and an X account at least 30 days old is linked.`);
        if (w.suspension) lines.push(w.suspension.permanent ? "This connection is suspended permanently." : `This connection is suspended until ${plain(w.suspension.until)}.`);
        const next = shownLink(w.next_url);
        const eligible = w.x_link.eligible_on ? ` (eligible from ${plain(w.x_link.eligible_on)})` : "";
        if (w.x_link.linked) lines.push(`X account linked (${plain(w.x_link.handle)}).`);
        else if (seller) lines.push(`X account not linked yet: publishing at your seller rate needs it.${next ? ` Link it at ${next}` : ""}${eligible}.`);
        else if (!note && !otherSeller) lines.push(`X account not linked yet.${next ? ` Link it at ${next}` : ""}${eligible}.`);
        lines.push(`Publishes today: ${count(w.today.used)} of ${count(w.today.cap)}. Listings: ${count(w.listings.active)} active, ${count(w.listings.hidden)} hidden.`);
        return { ok: true, text: lines.join("\n") };
    }

    async publish(args: PublishArgs): Promise<Outcome> {
        const { stored, mismatch } = await this.saved();
        if (!stored) return { ok: false, text: 'Not connected to a Prometheus seller account, so this cannot be published through the channel. Ask me to "Connect my Prometheus seller account" first.' };
        if (mismatch) return this.mismatchOutcome(stored);
        let payload: Record<string, unknown>;
        if (args.draft_asset_id) payload = { draft_asset_id: args.draft_asset_id };
        else {
            if (!args.name || !args.category) return { ok: false, text: "Publishing needs a name and a category (or a draft_asset_id)." };
            const file = args.file_data;
            if (!file) return { ok: false, text: "Publishing needs the asset file (file_data: a URL or base64) or a draft_asset_id." };
            const thumb = args.thumbnail_data;
            const { file_data: _f, thumbnail_data: _t, draft_asset_id: _d, ...fields } = args;
            payload = {
                ...fields,
                file_url: file.startsWith("http") ? file : undefined,
                file_base64: file.startsWith("http") ? undefined : file,
                thumbnail_url: thumb?.startsWith("http") ? thumb : undefined,
                thumbnail_base64: thumb && !thumb.startsWith("http") ? thumb : undefined,
            };
        }
        try {
            const r = await this.client().publish(stored.key, payload);
            const held = r.bonus_hold_days > 0 ? ` On points sales, the extra points above the normal creator rate are held for ${r.bonus_hold_days} days.` : "";
            return { ok: true, text: `Published to Prometheus Marketplace: ${shownLink(r.url) ?? r.asset_id}\nSold at your account's ${word(r.creator_type)} rate: platform fee ${fee(r.fee.platform)}, ${fee(r.fee.member)} for members.${held}` };
        } catch (err) {
            if (err instanceof ChannelError && err.code === "CHANNEL_KEY_INACTIVE") {
                await this.clearIfSame(stored.key);
                const o = this.failure(err, "Publish failed");
                return { ...o, text: `${o.text}\nThe saved connection is gone. Ask the user to connect again (connect_seller); do not publish another way without asking them first.` };
            }
            if (isAmbiguous(err)) {
                // A publish is public and not idempotent: after a timeout, a cut-off answer or a gateway error the listing may already exist.
                const e = err as ChannelError;
                const doubt = "The request may already have gone through, so the listing may exist. Before publishing again, check the marketplace or the listing counts in the connection status, so the same listing is not published twice.";
                if (e.code === "CHANNEL_NETWORK") return { ok: false, text: `Publish did not finish: Prometheus could not be reached, or did not answer in time. ${doubt} [${e.code}]` };
                const f = this.failure(err, "Publish failed");
                return { ...f, text: `${f.text}
${doubt}` };
            }
            return this.failure(err, "Publish failed");
        }
    }

    async disconnect(hide = false): Promise<Outcome> {
        this.pending = undefined;
        const { stored, mismatch } = await this.saved();
        if (!stored) return { ok: true, text: "Already disconnected." };
        if (mismatch) {
            await this.d.keyFile.clear();
            return { ok: true, text: `The saved connection belongs to ${stored.base_url ?? DEFAULT_ORIGIN}, not to the address this server uses now, so I did not contact anyone; it is removed from this computer. To revoke that key, disconnect from a server set to that address, or use the Prometheus dashboard.` };
        }
        let r: { hidden: number; kept?: number };
        try {
            r = await this.client().unlinkSelf(stored.key, hide);
        } catch (err) {
            if (err instanceof ChannelError && err.code === "CHANNEL_KEY_INACTIVE") {
                await this.clearIfSame(stored.key);
                const unhidden = hide ? " No listing was hidden, because the key was already inactive: hide them from the dashboard (Seller types) if you want them withdrawn." : "";
                return { ok: true, text: `The connection was already inactive; the saved key is removed.${unhidden}` };
            }
            return this.failure(err, "Could not disconnect");
        }
        try {
            await this.d.keyFile.clear();
        } catch (err) {
            return { ok: false, text: `Disconnected on Prometheus: the key is revoked. But I could not delete the saved copy (${err instanceof Error ? err.message : String(err)}); delete ${this.d.keyFile.location()} yourself.` };
        }
        const hidden = count(r.hidden);
        const kept = count(r.kept);
        const none = hide && !hidden && !kept ? "The server hid no listing (you can withdraw listings from the Prometheus dashboard). " : "";
        return { ok: true, text: `Disconnected. ${hidden ? `${hidden} listing(s) hidden. ` : ""}${kept ? `${kept} listing(s) that already have buyers stay visible. ` : ""}${none}${hide ? "Your account's rate is unchanged." : "Your account's rate and the listings already published are unchanged."} To publish through the channel again, connect again.` };
    }
}

export interface PublishArgs {
    name?: string; category?: string; description?: string; price?: number; price_points?: number; price_currency?: string;
    tags?: string[]; license?: string; persona_config?: Record<string, unknown>; bundle_items?: unknown[];
    file_data?: string; thumbnail_data?: string; draft_asset_id?: string;
}

// ─── MCP tools ─────────────────────────────────────────────────────

const reply = (o: Outcome) => ({ content: [{ type: "text" as const, text: o.text }], ...(o.ok ? {} : { isError: true }) });

/** Registers connect_seller, seller_connection_status, publish_listing and disconnect_seller. */
export function registerSellerTools(
    registerTool: (...args: any[]) => unknown,
    conn: SellerConnection,
): void {
    registerTool(
        "connect_seller",
        "Connect this Hermes Agent to your Prometheus seller account. Once the account is verified through Hermes Agent, all of the account's listings are sold at the Hermes Agent seller rate (the rate follows the account, not each listing). Returns a link and a short code for the user to approve in the browser (10 minutes). Use when the user says \"Connect my Prometheus seller account\". Only works when the server runs inside Hermes with PROMETHEUS_CHANNEL=hermes.",
        { relink: z.boolean().optional().describe("Connect a different account even though one is already connected.") },
        async ({ relink }: { relink?: boolean }) => reply(await conn.connect(relink === true)),
    );
    registerTool(
        "seller_connection_status",
        "Check the Prometheus seller connection: waiting for approval, connected (fee rates, X link, today's publish count), or not connected. Also finishes a pending connection once the user has approved it.",
        {},
        async () => reply(await conn.status()),
    );
    registerTool(
        "publish_listing",
        "Publish an asset (launch categories: skins, motions, expressions, personas; voices are published in the Voice Creator on the site and are refused here; accessories and effects are coming soon) to Prometheus Marketplace through the connected seller account; the listing is sold at the account's rate. Needs a connection (connect_seller). Use when the user says \"Publish this to Prometheus Marketplace\". To publish something made with generate_asset through the channel, generate it with auto_deploy=false and pass its id as draft_asset_id. The listing becomes public and cannot be withdrawn from the agent loop, so confirm with the user first. If a check fails (for example the X account is not linked), nothing is published and it says why and how to fix it.",
        {
            name: z.string().optional(),
            category: z.enum(["skins", "voices", "effects", "motions", "accessories", "scenes", "personas", "expressions", "bundles"]).optional().describe("Launch categories: skins, motions, expressions, personas. voices are published in the Voice Creator on the site, so a voice is refused here. accessories and effects are coming soon."),
            description: z.string().optional().describe("Required for personas."),
            price: z.number().optional().describe("Price in USD."),
            price_points: z.number().optional().describe("Price in platform points."),
            price_currency: z.string().optional(),
            tags: z.array(z.string()).optional(),
            license: z.enum(["personal", "commercial", "cc-by"]).optional(),
            persona_config: z.record(z.string(), z.unknown()).optional().describe("Required for personas."),
            bundle_items: z.array(z.unknown()).optional().describe("Required for bundles."),
            file_data: z.string().optional().describe("URL or Base64 string of the asset file."),
            thumbnail_data: z.string().optional().describe("URL or Base64 string of the thumbnail."),
            draft_asset_id: z.string().optional().describe("Publish a draft the account already holds instead of sending the fields above."),
        },
        async (args: PublishArgs) => reply(await conn.publish(args)),
    );
    registerTool(
        "disconnect_seller",
        "Revoke this Hermes Agent's Prometheus seller connection immediately. The account's rate and the listings already published are unchanged. Only call when the user asks to disconnect, and pass confirm=true.",
        { confirm: z.boolean().describe("Must be true."), hide_listings: z.boolean().optional().describe("Also hide the listings published through this connection.") },
        async ({ confirm, hide_listings }: { confirm: boolean; hide_listings?: boolean }) =>
            confirm === true ? reply(await conn.disconnect(hide_listings === true)) : reply({ ok: false, text: "Not disconnected: confirm=true is required." }),
    );
}
