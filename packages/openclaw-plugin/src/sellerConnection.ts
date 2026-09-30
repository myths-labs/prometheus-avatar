import type {
    SellerChannelApi, SellerChannelError, SellerChannelWhoami, SellerChannelPublishResult, AssetDeployConfig, AssetCreator,
} from '@prometheusavatar/core';
import type { KeyStore, StoredChannel } from './keyStore';
import type { PluginLogger } from './types';
import { DEFAULT_BASE, safeOrigin } from './hostRules';

/** The pieces of @prometheusavatar/core this file needs, loaded lazily so registering the plugin stays instant. */
export interface CoreModule {
    SellerChannelApi: typeof SellerChannelApi;
    AssetCreator: typeof AssetCreator;
}

/** Duck-typed on purpose: an `instanceof` check would miss an error thrown by a second copy of the core package. */
function isChannelError(err: unknown): err is SellerChannelError {
    return !!err && (err as Error).name === 'SellerChannelError' && typeof (err as SellerChannelError).code === 'string';
}

export const CLIENT_NAME = 'prometheus-openclaw-plugin';

export interface ConnectionOptions {
    loadCore: () => Promise<CoreModule>;
    store: KeyStore;
    log: PluginLogger;
    /** This plugin's own version (goes into the client header and the key record). */
    pluginVersion: string;
    /** `api.runtime.version` verbatim. */
    runtimeVersion: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
    /** Injected in tests. */
    setTimer?: (fn: () => void, ms: number) => { unref?: () => void } | undefined;
}

type PendingState = 'waiting' | 'denied' | 'expired' | 'invalid' | 'failed';

interface Pending {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expiresAt: number;
    interval: number;          // seconds; grows on slow_down
    nextPollAt: number;
    state: PendingState;
    failure?: string;
}

/** A result the tools turn into text. `ok:false` results carry the server's own message and fix_url. */
export interface Outcome {
    ok: boolean;
    text: string;
    details: Record<string, unknown>;
}

/** The masked account email from the server, cleaned for display (short, no control characters). */
function safeHint(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const t = v.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').trim();     // control and format characters (bidi overrides, zero-width, tags)
    return t && t.length <= 80 ? t : undefined;
}

/** What the server's registration_note means for the user. */
function noteText(note: string, seller: string): string {
    if (note === 'ACCOUNT_HAS_SELLER_HISTORY') return `This account will not become ${seller}: it already has sales or listings.`;
    if (note === 'IDENTITY_LOCKED') return `This account will not become ${seller}: its account type is already set.`;
    return `This account will not become ${seller} (${note.replace(/[^A-Za-z0-9_ .-]/g, '').slice(0, 64)}).`;
}

const fee = (n: number) => `${Math.round(n * 1000) / 10}%`;

const DEFAULT_ORIGIN = new URL(DEFAULT_BASE).origin;

/** A number from the server, held inside sane bounds; the fallback when it is missing or not a number. */
const num = (v: unknown, fallback: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** A failure worth waiting out while the device flow is open: the approval may still come. */
function isTransient(err: unknown): boolean {
    if (!isChannelError(err)) return false;
    return ['CHANNEL_NETWORK', 'CHANNEL_UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'RATE_LIMITED'].includes(err.code) || err.status === 429 || err.status >= 500;
}

/**
 * The request may have reached the server before it failed, so a publish may already exist: a dropped connection, a cut-off
 * answer, a gateway timeout, an internal error. A missing route (404) or "unavailable" (503) was not processed.
 */
function isAmbiguous(err: unknown): boolean {
    return isChannelError(err) && (err.code === 'CHANNEL_NETWORK' || err.status === 500 || err.status === 502 || err.status === 504);
}

function waitText(sec: number): string {
    if (sec < 120) return `${Math.max(1, Math.ceil(sec))} seconds`;
    if (sec < 7200) return `${Math.ceil(sec / 60)} minutes`;
    return `${Math.ceil(sec / 3600)} hours`;
}

/** A short word from the server (an account type), reduced to plain characters before it is shown. */
const word = (v: unknown) => String(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);

/** Other short values the server sends for display (an X handle, a date, an id): plain characters only, short. */
const plain = (v: unknown, max = 40) => String(v ?? '').replace(/[^A-Za-z0-9@._:+\- ]/g, '').slice(0, max);

/** A count from the server, shown as a number whatever it arrives as. */
const count = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** An address from the server that is shown to the user only when a key could safely go there (https, or http on this machine), on one line and not absurdly long. */
const shownLink = (u: unknown) => (typeof u === 'string' && u.length <= 300 && !/[\s\p{Cc}\p{Cf}]/u.test(u) && safeOrigin(u) ? u : undefined);

export class SellerConnection {
    private pending?: Pending;
    private polling = false;
    private timer?: { unref?: () => void };
    private lastApproved?: { x_linked: boolean; next_url: string; next_step: string | null };
    private hint?: string;
    private cached?: SellerChannelApi;
    private starting?: Promise<Outcome>;

    constructor(private readonly o: ConnectionOptions) {}

    private now() { return (this.o.now ?? Date.now)(); }

    private async api(): Promise<SellerChannelApi> {
        if (!this.cached) {
            const core = await this.o.loadCore();
            this.cached = new core.SellerChannelApi({
                client: { name: CLIENT_NAME, version: this.o.pluginVersion },
                runtime: { name: 'openclaw', version: this.o.runtimeVersion },
                baseUrl: this.o.baseUrl,
                fetchImpl: this.o.fetchImpl,
            });
        }
        return this.cached;
    }

    /** Turn a failed channel call into text for the user: the server's message and its fix_url, unchanged. */
    failure(err: unknown, what: string): Outcome {
        if (isChannelError(err)) {
            const bits = [`${what}: ${err.message}`];
            if (err.fixUrl) bits.push(`Fix it here: ${err.fixUrl}`);
            if (err.permanent) bits.push('This suspension is permanent.');
            else if (err.until) bits.push(`Suspended until ${err.until}.`);
            if (err.retryAfterSec) bits.push(`Try again in about ${waitText(err.retryAfterSec)}.`);
            bits.push(`[${err.code}]`);
            return { ok: false, text: bits.join(' '), details: { ok: false, code: err.code, fix_url: err.fixUrl } };
        }
        return { ok: false, text: `${what}: ${(err as Error)?.message ?? String(err)}`, details: { ok: false, code: 'UNEXPECTED' } };
    }

    private origin(): string { return safeOrigin(this.o.baseUrl) ?? DEFAULT_ORIGIN; }

    /** The saved connection, and whether it was made against another Prometheus address than this plugin uses now. */
    private async saved(): Promise<{ stored: StoredChannel | null; mismatch: boolean }> {
        const stored = await this.o.store.get();
        if (!stored) return { stored: null, mismatch: false };
        return { stored, mismatch: (stored.base_url ?? DEFAULT_ORIGIN) !== this.origin() };
    }

    private mismatchOutcome(stored: StoredChannel): Outcome {
        return {
            ok: false,
            text: `The saved connection was made with ${stored.base_url ?? DEFAULT_ORIGIN}, but this plugin now talks to ${this.origin()}, so nothing was sent. Connect again for this address (relink=true), or point the plugin back.`,
            details: { ok: false, state: 'other_host' },
        };
    }

    /** Drop the saved key only if it is still the one that just failed (a new connection may have replaced it meanwhile). */
    private async clearIfSame(key: string): Promise<void> {
        const cur = await this.o.store.get();
        if (cur && cur.key === key) await this.o.store.clear();
    }

    /** 'none': no key saved. 'usable': a key for this address. 'other_host': a key that belongs to another address. No network. */
    async keyState(): Promise<'none' | 'usable' | 'other_host'> {
        const { stored, mismatch } = await this.saved();
        return !stored ? 'none' : mismatch ? 'other_host' : 'usable';
    }

    /** The "waiting for approval" answer while a code is open, else null. */
    pendingOutcome(): Outcome | null {
        const p = this.pending;
        return p && p.state === 'waiting' && this.now() < p.expiresAt ? this.waitingText(p) : null;
    }

    /** Start (or repeat) the device flow. The reply tells the user where to approve. */
    connect(relink = false): Promise<Outcome> {
        // Two calls at once (a model can issue them in one turn) share one start: one code, one request to the server.
        this.starting ??= this.startConnect(relink).finally(() => { this.starting = undefined; });
        return this.starting;
    }

    private async startConnect(relink: boolean): Promise<Outcome> {
        const { stored } = await this.saved();
        if (stored && !relink) {
            const st = await this.status();
            return { ...st, text: `${st.text}\nTo connect a different account, call this tool again with relink=true.` };
        }
        const p = this.pending;
        if (p && p.state === 'waiting' && this.now() < p.expiresAt) return this.waitingText(p);   // same code, no new start (the server rate-limits starts)
        try {
            const s = await (await this.api()).startLink();
            const link = shownLink(s.verification_uri);
            const code = typeof s.user_code === 'string' ? s.user_code.replace(/[^A-Za-z0-9-]/g, '').slice(0, 16) : '';
            if (!link || !code || typeof s.device_code !== 'string' || !s.device_code) {
                return { ok: false, text: 'Could not start the connection: Prometheus sent an approval link or code I do not trust (a link must be https, or http on this computer). Nothing was started; try again later.', details: { ok: false, code: 'BAD_APPROVAL_LINK' } };
            }
            const t = this.now();
            const interval = num(s.interval, 5, 1, 60);
            this.pending = {
                device_code: s.device_code, user_code: code, verification_uri: link,
                expiresAt: t + num(s.expires_in, 600, 30, 1800) * 1000, interval, nextPollAt: t + interval * 1000, state: 'waiting',
            };
            this.schedule();
            return this.waitingText(this.pending);
        } catch (err) {
            return this.failure(err, 'Could not start the connection');
        }
    }

    private waitingText(p: Pending): Outcome {
        const mins = Math.max(1, Math.ceil((p.expiresAt - this.now()) / 60000));
        return {
            ok: true,
            text: `To connect, open ${p.verification_uri} and approve code ${p.user_code} within ${mins} minutes. Sign in to Prometheus first if the page asks. I will finish the connection as soon as you approve (keep this gateway running until then: a pending approval is lost when it restarts); you can also ask me for the connection status.`,
            details: { ok: true, state: 'waiting', user_code: p.user_code, verification_uri: p.verification_uri, expires_in_min: mins },
        };
    }

    private schedule() {
        const p = this.pending;
        if (!p || p.state !== 'waiting') return;
        const set = this.o.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as { unref?: () => void });
        this.timer = set(() => { void this.pollOnce(); }, Math.max(0, p.nextPollAt - this.now()));
        this.timer?.unref?.();
    }

    /** One poll of the token endpoint; never faster than the interval the server set. */
    async pollOnce(): Promise<void> {
        const p = this.pending;
        if (this.polling || !p || p.state !== 'waiting') return;
        if (this.now() >= p.expiresAt) { p.state = 'expired'; return; }
        if (this.now() < p.nextPollAt) { this.schedule(); return; }
        this.polling = true;
        try {
            const r = await (await this.api()).pollToken(p.device_code);
            if (this.pending !== p) {              // disconnected, or a new connection started, while this poll was out
                if (r.status === 'approved') this.o.log.warn(`A connection (key ${r.key.key_prefix}...) was approved just as the connection was cancelled, so it is not saved. Revoke it under Dashboard > Seller types if it should not stay active.`);
                return;
            }
            switch (r.status) {
                case 'approved': {
                    const stored: StoredChannel = {
                        key: r.key.key, key_prefix: r.key.key_prefix, channel: 'openclaw',
                        linked_at: new Date(this.now()).toISOString(), client_version: this.o.pluginVersion,
                        base_url: this.origin(),
                        ...(safeHint(r.key.account_hint) ? { account_hint: safeHint(r.key.account_hint) } : {}),
                        ...(typeof r.key.registration_note === 'string' && r.key.registration_note ? { registration_note: r.key.registration_note.slice(0, 64) } : {}),
                    };
                    await this.o.store.set(stored);
                    this.lastApproved = { x_linked: r.key.x_linked, next_url: r.key.next_url, next_step: r.key.next_step ?? null };
                    this.hint = safeHint(r.key.account_hint);
                    this.pending = undefined;
                    this.o.log.info(`Prometheus seller channel connected (key ${r.key.key_prefix}...; stored at: ${this.o.store.location()}).`);
                    return;
                }
                case 'pending': p.nextPollAt = this.now() + p.interval * 1000; break;
                case 'slow_down': p.interval = num(r.interval, p.interval + 5, 1, 120); p.nextPollAt = this.now() + p.interval * 1000; break;
                case 'denied': p.state = 'denied'; break;
                case 'expired': p.state = 'expired'; break;
                case 'invalid': p.state = 'invalid'; break;
            }
        } catch (err) {
            if (this.pending !== p) return;
            if (isTransient(err)) {
                // A network drop, a 5xx or a rate limit while waiting: the approval may still come, so keep waiting until the code expires.
                const wait = Math.min(120, Math.max(p.interval, isChannelError(err) ? err.retryAfterSec ?? 0 : 0));
                p.nextPollAt = this.now() + wait * 1000;
            } else {
                p.state = 'failed';
                p.failure = this.failure(err, 'Connecting failed').text;
            }
        } finally {
            this.polling = false;
            this.schedule();
        }
    }

    /** Connected (asks the server who this key is), waiting for approval, or not connected. */
    async status(): Promise<Outcome> {
        if (this.pending) {
            await this.pollOnce();
            const p = this.pending;
            if (p) {
                switch (p.state) {
                    case 'waiting': return this.waitingText(p);
                    case 'denied': this.pending = undefined; return { ok: false, text: 'The connection was declined on the approval page. Ask me to connect again if that was a mistake.', details: { ok: false, state: 'denied' } };
                    case 'expired': this.pending = undefined; return { ok: false, text: 'The approval code expired (10 minutes). Ask me to connect again for a new code.', details: { ok: false, state: 'expired' } };
                    case 'invalid': this.pending = undefined; return { ok: false, text: 'That approval code is no longer valid. Ask me to connect again.', details: { ok: false, state: 'invalid' } };
                    case 'failed': this.pending = undefined; return { ok: false, text: p.failure ?? 'Connecting failed.', details: { ok: false, state: 'failed' } };
                }
            }
        }
        const { stored, mismatch } = await this.saved();
        if (!stored) {
            return { ok: false, text: 'Not connected to a Prometheus seller account. Ask me to "Connect my Prometheus seller account" to start. (An approval that was still pending when this gateway restarted is lost: connect again for a new code.)', details: { ok: false, state: 'not_connected' } };
        }
        if (mismatch) return this.mismatchOutcome(stored);
        try {
            const w = await (await this.api()).whoami(stored.key);
            return this.connectedText(w, safeHint(stored.account_hint) ?? this.hint, stored.registration_note);
        } catch (err) {
            if (isChannelError(err) && err.code === 'CHANNEL_KEY_INACTIVE') {
                await this.clearIfSame(stored.key);
                return { ok: false, text: 'The saved connection is no longer active (it was revoked or replaced). Ask me to connect again.', details: { ok: false, state: 'key_inactive' } };
            }
            const f = this.failure(err, 'Could not check the connection');
            if (this.lastApproved) f.text = `${this.approvalText(stored.account_hint, stored.registration_note)}\n${f.text}`;
            return f;
        }
    }

    /** What the user should hear right after approving: which account, and the next step or why there is none. */
    private approvalText(hintRaw?: string, note?: string): string {
        const hint = safeHint(hintRaw) ?? this.hint;
        const lines = [`Approved${hint ? ` by the Prometheus account ${hint}` : ''}; the key is saved.`];
        const next = shownLink(this.lastApproved?.next_url);
        if (this.lastApproved?.next_step === 'link_x') lines.push(`Next: link your X account on the Prometheus dashboard${next ? ` (${next})` : ''}. The account becomes an OpenClaw seller only once X is linked.`);
        if (note) lines.push(noteText(note, 'an OpenClaw seller'));
        return lines.join('\n');
    }

    /**
     * The tier is decided on the server, and only once several things are true at the same time, and then it is set once,
     * so the status says what the server says the account is (whoami.account.identity_type), never more.
     */
    private connectedText(w: SellerChannelWhoami, hint?: string, noteSaved?: string): Outcome {
        const type = w.account.identity_type;
        const seller = type === 'openclaw';
        const otherSeller = type === 'hermes';                          // another channel got the tier first
        const note = seller ? undefined : noteSaved;                    // the saved note is a snapshot from the approval; the server's account type is the truth
        const who = hint ? ` to the Prometheus account ${hint}` : '';
        const key = `key ${plain(w.key_prefix, 16)}...`;
        const rate = `Platform fee ${fee(w.account.fee.platform)}, ${fee(w.account.fee.member)} for members.`;
        const lines = [seller
            ? `Connected as an OpenClaw seller${who} (${key}). ${rate}`
            : otherSeller
                ? `Connected${who} with an OpenClaw key (${key}), but the account is a Hermes Agent seller, so it will not become an OpenClaw seller (an account's seller type is set once). Listings are sold at the account's rate. ${rate}`
                : `Connected${who} with an OpenClaw key (${key}), but the account is not an OpenClaw seller${note ? '' : ' yet'}${type ? ` (account type: ${word(type)})` : ''}. Listings are sold at the account's current rate. ${rate}`];
        if (note) lines.push(noteText(note, 'an OpenClaw seller'));
        else if (!seller && !otherSeller) lines.push(`The account becomes an OpenClaw seller once all of these are true: it chose OpenClaw as its registration type (open ${this.origin()}/join?type=openclaw, sign in and press Register), it has no earlier sales or listings, and an X account at least 30 days old is linked.`);
        if (w.suspension) lines.push(w.suspension.permanent ? 'This connection is suspended permanently.' : `This connection is suspended until ${plain(w.suspension.until)}.`);
        const next = shownLink(w.next_url);
        const eligible = w.x_link.eligible_on ? ` (eligible from ${plain(w.x_link.eligible_on)})` : '';
        if (w.x_link.linked) lines.push(`X account linked (${plain(w.x_link.handle)}).`);
        else if (seller) lines.push(`X account not linked yet: publishing at your seller rate needs it.${next ? ` Link it at ${next}` : ''}${eligible}.`);
        else if (!note && !otherSeller) lines.push(`X account not linked yet.${next ? ` Link it at ${next}` : ''}${eligible}.`);
        lines.push(`Publishes today: ${count(w.today.used)} of ${count(w.today.cap)}. Listings: ${count(w.listings.active)} active, ${count(w.listings.hidden)} hidden.`);
        return { ok: true, text: lines.join('\n'), details: { ok: true, state: 'connected', is_seller: seller, account_type: type ? word(type) : null, key_prefix: plain(w.key_prefix, 16), ...(hint ? { account_hint: hint } : {}), fee: w.account.fee, x_linked: w.x_link.linked, today: w.today, listings: w.listings, suspension: w.suspension } };
    }

    /** Publish through the channel. Never falls back to another tier or to an API key. */
    async publish(args: PublishArgs): Promise<Outcome> {
        const { stored, mismatch } = await this.saved();
        if (!stored) {
            return { ok: false, text: 'Not connected to a Prometheus seller account, so this cannot be published through the channel. Ask me to "Connect my Prometheus seller account" first.', details: { ok: false, state: 'not_connected' } };
        }
        if (mismatch) return this.mismatchOutcome(stored);
        const creator = new (await this.o.loadCore()).AssetCreator(this.o.baseUrl);
        const opts = {
            channelKey: stored.key, client: { name: CLIENT_NAME, version: this.o.pluginVersion },
            runtime: { name: 'openclaw' as const, version: this.o.runtimeVersion },
            baseUrl: this.o.baseUrl, fetchImpl: this.o.fetchImpl,
        };
        try {
            let r: SellerChannelPublishResult;
            if (args.draft_asset_id) {
                r = await creator.publishDraftViaChannel(args.draft_asset_id, opts);
            } else {
                if (!args.name || !args.category) return { ok: false, text: 'Publishing needs a name and a category (or a draft_asset_id).', details: { ok: false, code: 'VALIDATION_ERROR' } };
                const file = args.fileData ?? args.file_url;
                if (!file) return { ok: false, text: 'Publishing needs the asset file (fileData: a URL or base64) or a draft_asset_id.', details: { ok: false, code: 'VALIDATION_ERROR' } };
                const { fileData: _f, file_url: _u, thumbnailData, draft_asset_id: _d, ...config } = args;
                r = await creator.publishViaChannel(config as AssetDeployConfig, file, thumbnailData, opts);
            }
            const held = r.bonus_hold_days > 0 ? ` On points sales, the extra points above the normal creator rate are held for ${r.bonus_hold_days} days.` : '';
            return {
                ok: true,
                text: `Published to Prometheus Marketplace: ${shownLink(r.url) ?? r.asset_id}\nSold at your account's ${word(r.creator_type)} rate: platform fee ${fee(r.fee.platform)}, ${fee(r.fee.member)} for members.${held}`,
                details: { ok: true, asset_id: r.asset_id, url: r.url, creator_type: r.creator_type, fee: r.fee, bonus_hold_days: r.bonus_hold_days },
            };
        } catch (err) {
            if (isChannelError(err) && err.code === 'CHANNEL_KEY_INACTIVE') {
                await this.clearIfSame(stored.key);
                const o = this.failure(err, 'Publish failed');
                return { ...o, text: `${o.text}\nThe saved connection is gone. Ask the user to connect again (prometheus_connect_seller); do not publish another way without asking them first.` };
            }
            if (isAmbiguous(err)) {
                // A publish is public and not idempotent: after a timeout, a cut-off answer or a gateway error the listing may already exist.
                const e = err as SellerChannelError;
                const doubt = 'The request may already have gone through, so the listing may exist. Before publishing again, check the marketplace or the listing counts in the connection status, so the same listing is not published twice.';
                if (e.code === 'CHANNEL_NETWORK') {
                    return { ok: false, text: `Publish did not finish: Prometheus could not be reached, or did not answer in time. ${doubt} [${e.code}]`, details: { ok: false, code: e.code, maybe_published: true } };
                }
                const f = this.failure(err, 'Publish failed');
                return { ...f, text: `${f.text}\n${doubt}`, details: { ...f.details, maybe_published: true } };
            }
            return this.failure(err, 'Publish failed');
        }
    }

    /** Revoke this connection at once (already published listings keep their rate). */
    async disconnect(hideListings = false): Promise<Outcome> {
        this.pending = undefined;
        const { stored, mismatch } = await this.saved();
        if (!stored) return { ok: true, text: 'Already disconnected.', details: { ok: true, state: 'not_connected' } };
        if (mismatch) {
            await this.o.store.clear();
            return { ok: true, text: `The saved connection belongs to ${stored.base_url ?? DEFAULT_ORIGIN}, not to the address this plugin uses now, so I did not contact anyone; it is removed from this computer. To revoke that key, disconnect from a plugin set to that address, or use the Prometheus dashboard.`, details: { ok: true, state: 'not_connected', revoked: false } };
        }
        // Only listings that carry this channel's tier are hidden. To explain a "nothing hidden" answer, ask what the account is first.
        let accountType: string | null | undefined;              // undefined: could not be read
        if (hideListings) {
            try { accountType = (await (await this.api()).whoami(stored.key)).account.identity_type; } catch { accountType = undefined; }
        }
        let r: { hidden: number; kept?: number };
        try {
            r = await (await this.api()).unlinkSelf(stored.key, hideListings);
        } catch (err) {
            if (isChannelError(err) && err.code === 'CHANNEL_KEY_INACTIVE') {
                await this.clearIfSame(stored.key);
                const unhidden = hideListings ? ' No listing was hidden, because the key was already inactive: hide them from the dashboard (Seller types) if you want them withdrawn.' : '';
                return { ok: true, text: `The connection was already inactive; the saved key is removed.${unhidden}`, details: { ok: true, state: 'not_connected', hidden: 0 } };
            }
            return this.failure(err, 'Could not disconnect');
        }
        try {
            await this.o.store.clear();
        } catch (err) {
            return { ok: false, text: `Disconnected on Prometheus: the key is revoked. But I could not delete the saved copy (${(err as Error).message}); delete ${this.o.store.location()} yourself.`, details: { ok: false, revoked: true, code: 'KEY_FILE_NOT_REMOVED' } };
        }
        const hidden = count(r.hidden);
        const kept = count(r.kept);
        const none = !(hideListings && !hidden && !kept) || accountType === 'openclaw' ? ''      // a seller of this channel with nothing to hide needs no explanation
            : accountType === undefined ? 'The server hid no listing (you can withdraw listings from the Prometheus dashboard). '
            : "This account is not an OpenClaw seller, so the listings it published are not OpenClaw listings and disconnecting does not touch them. Withdraw them from the Prometheus dashboard if you want them off the marketplace. ";
        return {
            ok: true,
            text: `Disconnected. ${hidden ? `${hidden} listing(s) hidden. ` : ''}${kept ? `${kept} listing(s) that already have buyers stay visible. ` : ''}${none}${hideListings ? "Your account's rate is unchanged." : "Your account's rate and the listings already published are unchanged."} To publish through the channel again, connect again.`,
            details: { ok: true, hidden, kept },
        };
    }
}

export interface PublishArgs {
    name?: string;
    category?: AssetDeployConfig['category'];
    description?: string;
    price?: number;
    price_points?: number;
    price_currency?: string;
    tags?: string[];
    license?: AssetDeployConfig['license'];
    persona_config?: Record<string, unknown>;
    bundle_items?: unknown[];
    fileData?: string;
    file_url?: string;
    thumbnailData?: string;
    draft_asset_id?: string;
}
