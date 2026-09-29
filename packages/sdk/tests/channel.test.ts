import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SellerChannelApi, SellerChannelError, channelClientHeader } from '../src/channel';
import { AssetCreator } from '../src/creator';
// @ts-expect-error plain JS test double
import { startFakeSellerServer } from './helpers/fakeSellerServer.mjs';

const OC = { client: { name: 'prometheus-openclaw-plugin', version: '0.11.0' }, runtime: { name: 'openclaw' as const, version: '2026.9.6' } };
const HERMES = { client: { name: 'prometheus-mcp-server', version: '0.4.0' }, runtime: { name: 'hermes' as const } };
const EVIDENCE = { env_channel: 'hermes', ancestor: 'hermes', ancestor_depth: 3, mcp_client: { name: 'hermes-agent', version: '0.9.0' }, sampling_declared: true };

let server: Awaited<ReturnType<typeof startFakeSellerServer>>;
beforeEach(async () => { server = await startFakeSellerServer({ intervalSec: 0.05 }); });
afterEach(async () => { await server.close(); });

const api = (o = OC) => new SellerChannelApi({ ...o, baseUrl: server.url });

describe('channelClientHeader', () => {
    it('writes the OpenClaw runtime version and omits it for Hermes', () => {
        expect(channelClientHeader(OC.client, OC.runtime)).toBe('prometheus-openclaw-plugin/0.11.0 (openclaw 2026.9.6)');
        expect(channelClientHeader(HERMES.client, HERMES.runtime)).toBe('prometheus-mcp-server/0.4.0 (hermes)');
    });
});

describe('SellerChannelApi base URL guard', () => {
    it('refuses plain http to a non-loopback host, accepts https and loopback http', () => {
        expect(() => new SellerChannelApi({ ...OC, baseUrl: 'http://prometheus.mythslabs.ai' })).toThrow(/https/);
        expect(() => new SellerChannelApi({ ...OC, baseUrl: 'https://prometheus.mythslabs.ai' })).not.toThrow();
        expect(() => new SellerChannelApi({ ...OC, baseUrl: 'http://127.0.0.1:3000' })).not.toThrow();
    });
});

describe('device flow', () => {
    it('OpenClaw: start sends the header, matching body and no browser headers; approve yields the key exactly once', async () => {
        const start = await api().startLink();
        expect(start.user_code).toBe('KQ7M-4TZP');
        const req = server.state.requests[0];
        expect(req.headers['x-prometheus-client']).toBe('prometheus-openclaw-plugin/0.11.0 (openclaw 2026.9.6)');
        expect(req.headers.origin).toBeUndefined();
        expect(req.headers['sec-fetch-site']).toBeUndefined();
        expect(req.body).toEqual({ channel: 'openclaw', client: OC.client, runtime: { name: 'openclaw', version: '2026.9.6' } });

        expect((await api().pollToken(start.device_code)).status).toBe('pending');
        await new Promise((r) => setTimeout(r, 80));
        server.approve();
        const got = await api().pollToken(start.device_code);
        expect(got.status).toBe('approved');
        if (got.status === 'approved') {
            expect(got.key.key).toMatch(/^pch_[0-9a-f]{32}$/);
            expect(got.key.account_hint).toBe('a***@example.com');
        }
        expect((await api().pollToken(start.device_code)).status).toBe('invalid');
    });

    it('polling too fast is slow_down with the new interval', async () => {
        const start = await api().startLink();
        await api().pollToken(start.device_code);
        const fast = await api().pollToken(start.device_code);
        expect(fast).toEqual({ status: 'slow_down', interval: 5.05 });
    });

    it('denied and expired are reported as stop states', async () => {
        const a = await api().startLink();
        server.deny();
        expect((await api().pollToken(a.device_code)).status).toBe('denied');
        const b = await api().startLink();
        server.expire();
        expect((await api().pollToken(b.device_code)).status).toBe('expired');
    });

    it('Hermes: start sends evidence; a wrong ancestor is CHANNEL_HOST_MISMATCH', async () => {
        const ok = await api(HERMES).startLink(EVIDENCE);
        expect(ok.device_code).toBeTruthy();
        expect(server.state.requests.at(-1)!.body).toEqual({ channel: 'hermes', client: HERMES.client, runtime: { name: 'hermes' }, evidence: EVIDENCE });
        await expect(api(HERMES).startLink({ ...EVIDENCE, ancestor: 'bash' })).rejects.toMatchObject({ code: 'CHANNEL_HOST_MISMATCH', status: 403 });
    });

    it('server errors carry code, message, https fix_url and Retry-After', async () => {
        for (let i = 0; i < server.state.startLimit; i++) await api().startLink();
        const e = await api().startLink().catch((x) => x);
        expect(e).toBeInstanceOf(SellerChannelError);
        expect(e).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterSec: 120 });
    });

    it('an old client version is refused by the server with the update command', async () => {
        const old = new SellerChannelApi({ client: { name: 'prometheus-openclaw-plugin', version: '0.10.2' }, runtime: OC.runtime, baseUrl: server.url });
        await expect(old.startLink()).rejects.toMatchObject({ code: 'CHANNEL_CLIENT_UNSUPPORTED' });
    });

    it('a route that is not live (404 with no error code) is CHANNEL_UNAVAILABLE, in plain words', async () => {
        const gone = new SellerChannelApi({ ...OC, baseUrl: server.url, fetchImpl: (async () => new Response('<html>Not Found</html>', { status: 404 })) as typeof fetch });
        const e = await gone.startLink().catch((x) => x);
        expect(e).toMatchObject({ code: 'CHANNEL_UNAVAILABLE', status: 404 });
        expect(e.message).toMatch(/not available right now.*try again later/);
    });

    it('a 404 that carries an error code (channel switched off) keeps the server\'s own message', async () => {
        const off = new SellerChannelApi({ ...OC, baseUrl: server.url, fetchImpl: (async () => new Response(JSON.stringify({ error: 'NOT_ENABLED', message: 'Seller channels are not open yet.', fix_url: null }), { status: 404 })) as typeof fetch });
        const e = await off.startLink().catch((x) => x);
        expect(e).toMatchObject({ code: 'NOT_ENABLED', status: 404, message: 'Seller channels are not open yet.', fixUrl: null });
    });

    it('a network failure is CHANNEL_NETWORK, not a crash', async () => {
        const dead = new SellerChannelApi({ ...OC, baseUrl: 'http://127.0.0.1:9' });
        await expect(dead.startLink()).rejects.toMatchObject({ code: 'CHANNEL_NETWORK' });
    });
});

async function connect(): Promise<string> {
    const start = await api().startLink();
    server.approve();
    for (let i = 0; i < 5; i++) {
        const p = await api().pollToken(start.device_code);
        if (p.status === 'approved') return p.key.key;
        await new Promise((r) => setTimeout(r, 120));
    }
    throw new Error('not approved');
}

describe('after connecting', () => {
    it('whoami, publish, unlink-self', async () => {
        const key = await connect();
        const who = await api().whoami(key);
        expect(who).toMatchObject({ channel: 'openclaw', account: { fee: { platform: 0.12, member: 0.06 } }, x_link: { linked: true } });
        const pub = await api().publish(key, { name: 'Cat', category: 'skins' });
        expect(pub).toMatchObject({ success: true, creator_type: 'openclaw', bonus_hold_days: 3 });
        expect(await api().unlinkSelf(key)).toMatchObject({ ok: true, channel: 'openclaw' });
        await expect(api().whoami(key)).rejects.toMatchObject({ code: 'CHANNEL_KEY_INACTIVE', status: 401 });
    });

    it('a key used with another client name is CHANNEL_CLIENT_MISMATCH', async () => {
        const key = await connect();
        const other = new SellerChannelApi({ client: { name: 'prometheus-mcp-server', version: '0.4.0' }, runtime: { name: 'openclaw', version: '2026.9.6' }, baseUrl: server.url });
        await expect(other.whoami(key)).rejects.toMatchObject({ code: 'CHANNEL_CLIENT_MISMATCH' });
    });

    it('CHANNEL_X_REQUIRED exposes its fix_url', async () => {
        const key = await connect();
        server.state.xLinked = false;
        const e = await api().publish(key, { name: 'Cat', category: 'skins' }).catch((x) => x);
        expect(e).toMatchObject({ code: 'CHANNEL_X_REQUIRED', fixUrl: 'https://prometheus.mythslabs.ai/dashboard#openclaw' });
    });
});

describe('AssetCreator.publishViaChannel', () => {
    it('sends the deploy fields, no creator_type or creator_id, and the bearer key; a draft id goes as draft_asset_id', async () => {
        const key = await connect();
        const creator = new AssetCreator('https://prometheus.mythslabs.ai', 'pak_should_not_be_used');
        const opts = { channelKey: key, ...OC, baseUrl: server.url };
        const r = await creator.publishViaChannel(
            { name: 'Cat', category: 'skins', description: 'd', price: 5, tags: ['a'], creator_id: 'me', price_points: 100 },
            'https://cdn.example/x.zip', 'data:image/png;base64,AAAA', opts,
        );
        expect(r.asset_id).toBe('asset_1');
        const req = server.state.requests.at(-1)!;
        expect(req.headers.authorization).toBe(`Bearer ${key}`);
        expect(req.headers.authorization).not.toContain('pak_');
        expect(server.state.published[0]).toEqual({ name: 'Cat', category: 'skins', description: 'd', price: 5, tags: ['a'], price_points: 100, file_url: 'https://cdn.example/x.zip', thumbnail_base64: 'data:image/png;base64,AAAA' });
        await creator.publishDraftViaChannel('draft-9', opts);
        expect(server.state.published[1]).toEqual({ draft_asset_id: 'draft-9' });
    });
});
