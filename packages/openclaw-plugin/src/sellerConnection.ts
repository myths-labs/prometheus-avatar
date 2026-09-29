import type {
    SellerChannelApi, SellerChannelError, SellerChannelWhoami, SellerChannelPublishResult, AssetDeployConfig, AssetCreator,
} from '@prometheusavatar/core';
import type { KeyStore, StoredChannel } from './keyStore';
import type { PluginLogger } from './types';

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
    const t = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return t && t.length <= 80 ? t : undefined;
}

/** What the server's registration_note means for the user. */
function noteText(note: string, seller: string): string {
    if (note === 'ACCOUNT_HAS_SELLER_HISTORY') return `This account will not become ${seller}: it already has sales or listings.`;
    if (note === 'IDENTITY_LOCKED') return `This account will not become ${seller}: its account type is already set.`;
    return `This account will not become ${seller} (${note.replace(/[^A-Za-z0-9_ .-]/g, '').slice(0, 64)}).`;
}

const fee = (n: number) => `${Math.round(n * 1000) / 10}%`;

export class SellerConnection {
    private pending?: Pending;
    private polling = false;
    private timer?: { unref?: () => void };
    private lastApproved?: { x_linked: boolean; next_url: string; next_step: string | null };
    private hint?: string;
    private cached?: SellerChannelApi;

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
            if (err.retryAfterSec) bits.push(`Try again in about ${Math.ceil(err.retryAfterSec / 60)} minute(s).`);
            bits.push(`[${err.code}]`);
            return { ok: false, text: bits.join(' '), details: { ok: false, code: err.code, fix_url: err.fixUrl } };
        }
        return { ok: false, text: `${what}: ${(err as Error)?.message ?? String(err)}`, details: { ok: false, code: 'UNEXPECTED' } };
    }

    /** Start (or repeat) the device flow. The reply tells the user where to approve. */
    async connect(relink = false): Promise<Outcome> {
        const stored = await this.o.store.get();
        if (stored && !relink) {
            const st = await this.status();
            return { ...st, text: `${st.text}\nTo connect a different account, call this tool again with relink=true.` };
        }
        const p = this.pending;
        if (p && p.state === 'waiting' && this.now() < p.expiresAt) return this.waitingText(p);   // same code, no new start (the server rate-limits starts)
        try {
            const s = await (await this.api()).startLink();
            const t = this.now();
            this.pending = {
                device_code: s.device_code, user_code: s.user_code, verification_uri: s.verification_uri,
                expiresAt: t + s.expires_in * 1000, interval: s.interval, nextPollAt: t + s.interval * 1000, state: 'waiting',
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
            text: `To connect, open ${p.verification_uri} and approve code ${p.user_code} within ${mins} minutes. Sign in to Prometheus first if the page asks. I will finish the connection as soon as you approve; you can also ask me for the connection status.`,
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
            switch (r.status) {
                case 'approved': {
                    const stored: StoredChannel = {
                        key: r.key.key, key_prefix: r.key.key_prefix, channel: 'openclaw',
                        linked_at: new Date(this.now()).toISOString(), client_version: this.o.pluginVersion,
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
                case 'slow_down': p.interval = r.interval ?? p.interval + 5; p.nextPollAt = this.now() + p.interval * 1000; break;
                case 'denied': p.state = 'denied'; break;
                case 'expired': p.state = 'expired'; break;
                case 'invalid': p.state = 'invalid'; break;
            }
        } catch (err) {
            if (isChannelError(err) && err.code === 'CHANNEL_NETWORK') p.nextPollAt = this.now() + p.interval * 1000;   // transient: keep waiting
            else { p.state = 'failed'; p.failure = this.failure(err, 'Connecting failed').text; }
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
        const stored = await this.o.store.get();
        if (!stored) {
            return { ok: false, text: 'Not connected to a Prometheus seller account. Ask me to "Connect my Prometheus seller account" to start.', details: { ok: false, state: 'not_connected' } };
        }
        try {
            const w = await (await this.api()).whoami(stored.key);
            return this.connectedText(w, safeHint(stored.account_hint) ?? this.hint, stored.registration_note);
        } catch (err) {
            if (isChannelError(err) && err.code === 'CHANNEL_KEY_INACTIVE') {
                await this.o.store.clear();
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
        if (this.lastApproved?.next_step === 'link_x') lines.push(`Next: link your X account on the Prometheus dashboard (${this.lastApproved.next_url}). The account becomes an OpenClaw seller only once X is linked.`);
        if (note) lines.push(noteText(note, 'an OpenClaw seller'));
        return lines.join('\n');
    }

    private connectedText(w: SellerChannelWhoami, hint?: string, note?: string): Outcome {
        const lines = [`Connected as an OpenClaw seller${hint ? ` to the Prometheus account ${hint}` : ''} (key ${w.key_prefix}...). Platform fee ${fee(w.account.fee.platform)}, ${fee(w.account.fee.member)} for members.`];
        if (note) lines.push(noteText(note, 'an OpenClaw seller'));
        if (w.suspension) lines.push(w.suspension.permanent ? 'This connection is suspended permanently.' : `This connection is suspended until ${w.suspension.until}.`);
        if (w.x_link.linked) lines.push(`X account linked (${w.x_link.handle}).`);
        else lines.push(`X account not linked yet: tier publishes need it. Link it at ${w.next_url}${w.x_link.eligible_on ? ` (eligible from ${w.x_link.eligible_on})` : ''}.`);
        lines.push(`Publishes today: ${w.today.used} of ${w.today.cap}. Listings: ${w.listings.active} active, ${w.listings.hidden} hidden.`);
        if (this.lastApproved?.next_step === 'link_x' && !w.x_link.linked) lines.push('The account becomes an OpenClaw seller only once the X account is linked; finish that, then publish.');
        return { ok: true, text: lines.join('\n'), details: { ok: true, state: 'connected', key_prefix: w.key_prefix, ...(hint ? { account_hint: hint } : {}), fee: w.account.fee, x_linked: w.x_link.linked, today: w.today, listings: w.listings, suspension: w.suspension } };
    }

    /** Publish through the channel. Never falls back to another tier or to an API key. */
    async publish(args: PublishArgs): Promise<Outcome> {
        const stored = await this.o.store.get();
        if (!stored) {
            return { ok: false, text: 'Not connected to a Prometheus seller account, so this cannot be published through the channel. Ask me to "Connect my Prometheus seller account" first.', details: { ok: false, state: 'not_connected' } };
        }
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
                text: `Published to Prometheus Marketplace: ${r.url}\nSold at your account's ${r.creator_type} seller rate: platform fee ${fee(r.fee.platform)}, ${fee(r.fee.member)} for members.${held}`,
                details: { ok: true, asset_id: r.asset_id, url: r.url, creator_type: r.creator_type, fee: r.fee, bonus_hold_days: r.bonus_hold_days },
            };
        } catch (err) {
            if (isChannelError(err) && err.code === 'CHANNEL_KEY_INACTIVE') await this.o.store.clear();
            return this.failure(err, 'Publish failed');
        }
    }

    /** Revoke this connection at once (already published listings keep their rate). */
    async disconnect(hideListings = false): Promise<Outcome> {
        const stored = await this.o.store.get();
        this.pending = undefined;
        if (!stored) return { ok: true, text: 'Already disconnected.', details: { ok: true, state: 'not_connected' } };
        try {
            const r = await (await this.api()).unlinkSelf(stored.key, hideListings);
            await this.o.store.clear();
            return { ok: true, text: `Disconnected. ${r.hidden ? `${r.hidden} listing(s) hidden. ` : ''}Your account's rate and the listings already published are unchanged. To publish through the channel again, connect again.`, details: { ok: true, hidden: r.hidden } };
        } catch (err) {
            if (isChannelError(err) && err.code === 'CHANNEL_KEY_INACTIVE') {
                await this.o.store.clear();
                return { ok: true, text: 'The connection was already inactive; the saved key is removed.', details: { ok: true, state: 'not_connected' } };
            }
            return this.failure(err, 'Could not disconnect');
        }
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
