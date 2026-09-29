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
        const out = execFileSync("ps", ["-o", "ppid=,args=", "-p", String(pid)], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
        const m = /^(\d+)\s+(.*)$/s.exec(out);
        return m ? { ppid: Number(m[1]), args: m[2] } : null;
    } catch {
        return null;
    }
};

/** Walks up to `maxDepth` parents (parent = depth 1) looking for a Hermes process. Returns only token and depth. */
export function findHermesAncestor(startPid: number, ps: PsRunner = defaultPs, maxDepth = 8): { ancestor: "hermes"; depth: number } | null {
    let pid = startPid;
    for (let depth = 1; depth <= maxDepth; depth++) {
        if (!pid || pid <= 1) return null;
        const row = ps(pid);
        if (!row) return null;
        if (HERMES_RE.test(row.args)) return { ancestor: "hermes", depth };
        pid = row.ppid;
    }
    return null;
}

// ─── HTTP client ───────────────────────────────────────────────────

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

export interface ChannelKeyResponse { key: string; key_prefix: string; channel: string; identity_type: string | null; x_linked: boolean; next_url: string }
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
        const text = await res.text();
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
        throw new ChannelError(
            typeof data?.error === "string" ? data.error : `HTTP_${status}`,
            typeof data?.message === "string" && data.message ? data.message : `Prometheus answered HTTP ${status}.`,
            { status, fixUrl: typeof data?.fix_url === "string" && data.fix_url.startsWith("https://") ? data.fix_url : null, until: data?.until, permanent: data?.permanent, retryAfterSec: retryAfter },
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
        return r.data as { ok: true; hidden: number };
    }
}

// ─── Key file ──────────────────────────────────────────────────────

export interface StoredChannel { key: string; key_prefix: string; channel: "hermes"; linked_at: string; client_version: string }

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
        await fs.writeFile(tmp, JSON.stringify(v), { mode: 0o600 });
        await fs.chmod(tmp, 0o600);
        await fs.rename(tmp, this.file);
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

const fee = (n: number) => `${Math.round(n * 1000) / 10}%`;

export class SellerConnection {
    private pending?: Pending;
    private polling = false;
    private lastApproved?: { x_linked: boolean; next_url: string };
    private api?: ChannelApi;

    constructor(private readonly d: ConnectionDeps) {}

    private now() { return (this.d.now ?? Date.now)(); }
    private client() { return (this.api ??= new ChannelApi({ baseUrl: this.d.baseUrl, version: this.d.version, fetchImpl: this.d.fetchImpl })); }

    private failure(err: unknown, what: string): Outcome {
        if (err instanceof ChannelError) {
            const bits = [`${what}: ${err.message}`];
            if (err.extra.fixUrl) bits.push(`Fix it here: ${err.extra.fixUrl}`);
            if (err.extra.permanent) bits.push("This suspension is permanent.");
            else if (err.extra.until) bits.push(`Suspended until ${err.extra.until}.`);
            if (err.extra.retryAfterSec) bits.push(`Try again in about ${Math.ceil(err.extra.retryAfterSec / 60)} minute(s).`);
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
            return { refusal: "This MCP server is not set up as a Hermes seller channel. In ~/.hermes/config.yaml, add PROMETHEUS_CHANNEL: hermes under this server's env, restart Hermes, and try again. Used from another app, or with only an API key, it sells at the AI agent rate." };
        }
        const found = findHermesAncestor(process.ppid, this.d.ps);
        if (!found) return { refusal: "I could not find Hermes Agent above this MCP server, so I will not connect. Run this from inside Hermes (mcp_servers in ~/.hermes/config.yaml)." };
        const c = this.d.getClient();
        if (!c) return { refusal: "The MCP client has not introduced itself yet; try again in a moment." };
        return {
            evidence: {
                env_channel: "hermes", ancestor: found.ancestor, ancestor_depth: found.depth,
                mcp_client: { name: c.name, ...(c.version ? { version: c.version } : {}) }, sampling_declared: c.sampling,
            },
        };
    }

    async connect(relink = false): Promise<Outcome> {
        const stored = await this.d.keyFile.get();
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
            const t = this.now();
            this.pending = { device_code: s.device_code, user_code: s.user_code, verification_uri: s.verification_uri, expiresAt: t + s.expires_in * 1000, interval: s.interval, nextPollAt: t + s.interval * 1000, state: "waiting" };
            this.schedule();
            return this.waitingText(this.pending);
        } catch (err) {
            return this.failure(err, "Could not start the connection");
        }
    }

    private waitingText(p: Pending): Outcome {
        const mins = Math.max(1, Math.ceil((p.expiresAt - this.now()) / 60000));
        return { ok: true, text: `To connect, open ${p.verification_uri} and approve code ${p.user_code} within ${mins} minutes. Sign in to Prometheus first if the page asks. I will finish the connection as soon as you approve; you can also ask me for the connection status.` };
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
            switch (r.status) {
                case "approved":
                    await this.d.keyFile.set({ key: r.key.key, key_prefix: r.key.key_prefix, channel: "hermes", linked_at: new Date(this.now()).toISOString(), client_version: this.d.version });
                    this.lastApproved = { x_linked: r.key.x_linked, next_url: r.key.next_url };
                    this.pending = undefined;
                    this.d.log?.(`Prometheus seller channel connected (key ${r.key.key_prefix}...; stored at ${this.d.keyFile.location()}).`);
                    return;
                case "pending": p.nextPollAt = this.now() + p.interval * 1000; break;
                case "slow_down": p.interval = r.interval ?? p.interval + 5; p.nextPollAt = this.now() + p.interval * 1000; break;
                case "denied": p.state = "denied"; break;
                case "expired": p.state = "expired"; break;
                case "invalid": p.state = "invalid"; break;
            }
        } catch (err) {
            if (err instanceof ChannelError && err.code === "CHANNEL_NETWORK") p.nextPollAt = this.now() + p.interval * 1000;
            else { p.state = "failed"; p.failure = this.failure(err, "Connecting failed").text; }
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
        const stored = await this.d.keyFile.get();
        if (!stored) return { ok: false, text: 'Not connected to a Prometheus seller account. Ask me to "Connect my Prometheus seller account" to start.' };
        try {
            const w = await this.client().whoami(stored.key);
            const lines = [`Connected as a Hermes Agent seller (key ${w.key_prefix}...). Platform fee ${fee(w.account.fee.platform)}, ${fee(w.account.fee.member)} for members.`];
            if (w.suspension) lines.push(w.suspension.permanent ? "This connection is suspended permanently." : `This connection is suspended until ${w.suspension.until}.`);
            if (w.x_link.linked) lines.push(`X account linked (${w.x_link.handle}).`);
            else lines.push(`X account not linked yet: tier publishes need it. Link it at ${w.next_url}${w.x_link.eligible_on ? ` (eligible from ${w.x_link.eligible_on})` : ""}.`);
            lines.push(`Publishes today: ${w.today.used} of ${w.today.cap}. Listings: ${w.listings.active} active, ${w.listings.hidden} hidden.`);
            if (this.lastApproved && !this.lastApproved.x_linked && !w.x_link.linked) lines.push("Next: finish the X link, then publish.");
            return { ok: true, text: lines.join("\n") };
        } catch (err) {
            if (err instanceof ChannelError && err.code === "CHANNEL_KEY_INACTIVE") {
                await this.d.keyFile.clear();
                return { ok: false, text: "The saved connection is no longer active (it was revoked or replaced). Ask me to connect again." };
            }
            return this.failure(err, "Could not check the connection");
        }
    }

    async publish(args: PublishArgs): Promise<Outcome> {
        const stored = await this.d.keyFile.get();
        if (!stored) return { ok: false, text: 'Not connected to a Prometheus seller account, so this cannot be published at the Hermes Agent rate. Ask me to "Connect my Prometheus seller account" first. (generate_asset with auto_deploy sells at the AI agent rate.)' };
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
            return { ok: true, text: `Published to Prometheus Marketplace: ${r.url}\nListed at the ${r.creator_type} rate: platform fee ${fee(r.fee.platform)}, ${fee(r.fee.member)} for members.${held}` };
        } catch (err) {
            if (err instanceof ChannelError && err.code === "CHANNEL_KEY_INACTIVE") await this.d.keyFile.clear();
            return this.failure(err, "Publish failed");
        }
    }

    async disconnect(hide = false): Promise<Outcome> {
        const stored = await this.d.keyFile.get();
        this.pending = undefined;
        if (!stored) return { ok: true, text: "Already disconnected." };
        try {
            const r = await this.client().unlinkSelf(stored.key, hide);
            await this.d.keyFile.clear();
            return { ok: true, text: `Disconnected. ${r.hidden ? `${r.hidden} listing(s) hidden. ` : ""}Listings already published keep their rate. To sell at the Hermes Agent rate again, connect again.` };
        } catch (err) {
            if (err instanceof ChannelError && err.code === "CHANNEL_KEY_INACTIVE") {
                await this.d.keyFile.clear();
                return { ok: true, text: "The connection was already inactive; the saved key is removed." };
            }
            return this.failure(err, "Could not disconnect");
        }
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
        "Connect this Hermes Agent to your Prometheus seller account, so listings you publish get the Hermes Agent seller rate. Returns a link and a short code for the user to approve in the browser (10 minutes). Use when the user says \"Connect my Prometheus seller account\". Only works when the server runs inside Hermes with PROMETHEUS_CHANNEL=hermes.",
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
        "Publish an asset to Prometheus Marketplace through the connected seller account, at the Hermes Agent seller rate. Needs a connection (connect_seller). Use when the user says \"Publish this to Prometheus Marketplace\". To sell something generated with generate_asset at this rate, generate with auto_deploy=false and pass its id as draft_asset_id. It never publishes at another rate: if a check fails (for example the X account is not linked), it says why and how to fix it.",
        {
            name: z.string().optional(),
            category: z.enum(["skins", "voices", "effects", "motions", "accessories", "scenes", "personas", "expressions", "bundles"]).optional(),
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
        "Revoke this Hermes Agent's Prometheus seller connection immediately. Published listings keep their rate. Only call when the user asks to disconnect, and pass confirm=true.",
        { confirm: z.boolean().describe("Must be true."), hide_listings: z.boolean().optional().describe("Also hide the listings published through this connection.") },
        async ({ confirm, hide_listings }: { confirm: boolean; hide_listings?: boolean }) =>
            confirm === true ? reply(await conn.disconnect(hide_listings === true)) : reply({ ok: false, text: "Not disconnected: confirm=true is required." }),
    );
}
