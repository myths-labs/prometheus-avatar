/**
 * prometheus-avatar/core/channel
 *
 * HTTP client for the Prometheus seller channels (OpenClaw and Hermes Agent).
 * A channel key (`pch_...`) is issued once through an RFC 8628 device flow and
 * lets a listing get the channel's tier at publish time.
 *
 * Contract: the Prometheus seller-channel API contract v1.1 (link/start, link/token,
 * publish, whoami, unlink-self). The key is a bearer secret: it is only ever
 * sent to the Prometheus host and never logged.
 */

const DEFAULT_BASE_URL = 'https://prometheus.mythslabs.ai';

export type SellerChannelName = 'openclaw' | 'hermes';

export interface SellerChannelClient {
    /** e.g. "prometheus-openclaw-plugin" */
    name: string;
    version: string;
}

export interface SellerChannelRuntime {
    name: SellerChannelName;
    /** OpenClaw: `api.runtime.version` verbatim. Hermes has no runtime version. */
    version?: string;
}

/** Extra proof the server asks Hermes for, because Hermes is not a plugin host. */
export interface SellerChannelEvidence {
    env_channel?: string;
    ancestor?: string;
    ancestor_depth?: number;
    mcp_client?: { name: string; version?: string };
    sampling_declared?: boolean;
}

export interface SellerLinkStart {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}

export interface SellerChannelKey {
    key: string;
    key_prefix: string;
    channel: SellerChannelName;
    identity_type: string | null;
    x_linked: boolean;
    next_url: string;
    /** Masked email of the account that approved the connection, e.g. "a***@example.com". Show it to the user. */
    account_hint?: string;
}

export type SellerLinkPoll =
    | { status: 'approved'; key: SellerChannelKey }
    | { status: 'pending' }
    | { status: 'slow_down'; interval?: number }
    | { status: 'denied' }
    | { status: 'expired' }
    | { status: 'invalid' };

export interface SellerChannelWhoami {
    channel: SellerChannelName;
    client_name: string;
    key_prefix: string;
    linked_at: string;
    account: { identity_type: string | null; is_member: boolean; fee: { platform: number; member: number } };
    x_link: { linked: boolean; handle: string | null; eligible_on: string | null };
    today: { used: number; cap: number };
    listings: { active: number; hidden: number };
    suspension: { until: string | null; permanent: boolean } | null;
    next_url: string;
}

export interface SellerChannelPublishResult {
    success: true;
    asset_id: string;
    url: string;
    creator_type: SellerChannelName;
    fee: { platform: number; member: number };
    bonus_hold_days: number;
}

/** A failed channel call. `code` is the server's `error` string (CHANNEL_X_REQUIRED, RATE_LIMITED, ...). */
export class SellerChannelError extends Error {
    readonly code: string;
    readonly status: number;
    /** Always a full https URL or null (the server never sends a site-relative path). */
    readonly fixUrl: string | null;
    readonly until?: string | null;
    readonly permanent?: boolean;
    readonly retryAfterSec?: number;

    constructor(code: string, message: string, extra: {
        status?: number; fixUrl?: string | null; until?: string | null; permanent?: boolean; retryAfterSec?: number;
    } = {}) {
        super(message);
        this.name = 'SellerChannelError';
        this.code = code;
        this.status = extra.status ?? 0;
        this.fixUrl = extra.fixUrl ?? null;
        this.until = extra.until;
        this.permanent = extra.permanent;
        this.retryAfterSec = extra.retryAfterSec;
    }
}

/** `X-Prometheus-Client` value: "<name>/<version> (<runtime> [<runtime version>])". */
export function channelClientHeader(client: SellerChannelClient, runtime: SellerChannelRuntime): string {
    const rt = runtime.version ? `${runtime.name} ${runtime.version}` : runtime.name;
    return `${client.name}/${client.version} (${rt})`;
}

function isLoopbackHttp(url: URL): boolean {
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

export interface SellerChannelApiOptions {
    client: SellerChannelClient;
    runtime: SellerChannelRuntime;
    /** Default production host. Anything else must be https, or http on loopback (local integration runs). */
    baseUrl?: string;
    /** Injected in tests. */
    fetchImpl?: typeof fetch;
    /** Per-request timeout in ms (default 30 s). */
    timeoutMs?: number;
}

export class SellerChannelApi {
    private readonly base: string;
    private readonly opts: SellerChannelApiOptions;
    private readonly header: string;

    constructor(opts: SellerChannelApiOptions) {
        const raw = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
        const url = new URL(raw);
        if (url.protocol !== 'https:' && !isLoopbackHttp(url)) {
            throw new Error('SellerChannelApi: baseUrl must be https (or http on localhost); a channel key is never sent over plain HTTP.');
        }
        this.base = raw;
        this.opts = opts;
        this.header = channelClientHeader(opts.client, opts.runtime);
    }

    private async call(path: string, init: { method: 'GET' | 'POST'; key?: string; body?: unknown; timeoutMs?: number }): Promise<{ status: number; data: any; retryAfter?: number }> {
        const f = this.opts.fetchImpl ?? fetch;
        const headers: Record<string, string> = { 'X-Prometheus-Client': this.header, Accept: 'application/json' };
        if (init.body !== undefined) headers['Content-Type'] = 'application/json';
        if (init.key) headers.Authorization = `Bearer ${init.key}`;
        let res: Response;
        try {
            res = await f(`${this.base}${path}`, {
                method: init.method,
                headers,
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
                signal: AbortSignal.timeout(init.timeoutMs ?? this.opts.timeoutMs ?? 30_000),
            });
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            throw new SellerChannelError('CHANNEL_NETWORK', `Could not reach Prometheus (${reason}). Check the network and try again.`);
        }
        let data: any = null;
        const text = await res.text();
        if (text) {
            try { data = JSON.parse(text); } catch { data = null; }
        }
        const ra = Number(res.headers.get('retry-after'));
        return { status: res.status, data, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined };
    }

    private fail(status: number, data: any, retryAfter?: number): never {
        // A missing route or a gateway error carries no `error` code: the channel is not (yet) live on this server.
        if (typeof data?.error !== 'string' && (status === 404 || status === 502 || status === 503 || status === 504)) {
            throw new SellerChannelError('CHANNEL_UNAVAILABLE', `The Prometheus seller channel is not available right now (HTTP ${status}). It may not have launched yet; try again later.`, { status, retryAfterSec: retryAfter });
        }
        const fix = typeof data?.fix_url === 'string' && data.fix_url.startsWith('https://') ? data.fix_url : null;
        throw new SellerChannelError(
            typeof data?.error === 'string' ? data.error : `HTTP_${status}`,
            typeof data?.message === 'string' && data.message ? data.message : `Prometheus answered HTTP ${status}.`,
            { status, fixUrl: fix, until: data?.until, permanent: data?.permanent, retryAfterSec: retryAfter },
        );
    }

    /** Step 1 of the device flow. No auth; the server rate-limits per IP. */
    async startLink(evidence?: SellerChannelEvidence): Promise<SellerLinkStart> {
        const { runtime, client } = this.opts;
        const body: Record<string, unknown> = {
            channel: runtime.name,
            client: { name: client.name, version: client.version },
            runtime: runtime.version ? { name: runtime.name, version: runtime.version } : { name: runtime.name },
        };
        if (evidence) body.evidence = evidence;
        const r = await this.call('/api/channels/link/start', { method: 'POST', body });
        if (r.status !== 200 || !r.data?.device_code) this.fail(r.status, r.data, r.retryAfter);
        return r.data as SellerLinkStart;
    }

    /** Step 2: one poll. Returns a status instead of throwing for the RFC 8628 "keep going" and "stop" answers. */
    async pollToken(deviceCode: string): Promise<SellerLinkPoll> {
        const r = await this.call('/api/channels/link/token', { method: 'POST', body: { device_code: deviceCode } });
        if (r.status === 200 && typeof r.data?.key === 'string') {
            return { status: 'approved', key: r.data as SellerChannelKey };
        }
        switch (r.data?.error) {
            case 'authorization_pending': return { status: 'pending' };
            case 'slow_down': return { status: 'slow_down', interval: typeof r.data.interval === 'number' ? r.data.interval : undefined };
            case 'access_denied': return { status: 'denied' };
            case 'expired_token': return { status: 'expired' };
            case 'invalid_grant': return { status: 'invalid' };
            default: this.fail(r.status, r.data, r.retryAfter);
        }
    }

    async whoami(key: string): Promise<SellerChannelWhoami> {
        const r = await this.call('/api/channels/whoami', { method: 'GET', key });
        if (r.status !== 200 || !r.data?.channel) this.fail(r.status, r.data, r.retryAfter);
        return r.data as SellerChannelWhoami;
    }

    /** `payload` is the deploy fields, or `{ draft_asset_id }`. */
    async publish(key: string, payload: Record<string, unknown>): Promise<SellerChannelPublishResult> {
        const r = await this.call('/api/channels/publish', { method: 'POST', key, body: payload, timeoutMs: 120_000 });
        if (r.status !== 200 || !r.data?.asset_id) this.fail(r.status, r.data, r.retryAfter);
        return { ...r.data, success: true } as SellerChannelPublishResult;
    }

    /** Revokes this key at once. Published listings keep their tier. */
    async unlinkSelf(key: string, hideListings = false): Promise<{ ok: true; channel: SellerChannelName; hidden: number }> {
        const r = await this.call('/api/channels/unlink-self', { method: 'POST', key, body: { hide_listings: hideListings } });
        if (r.status !== 200 || r.data?.ok !== true) this.fail(r.status, r.data, r.retryAfter);
        return r.data;
    }
}
