import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelApi, ChannelError } from '../dist/sellerChannel.js';

const api = (fetchImpl) => new ChannelApi({ baseUrl: 'http://127.0.0.1:1', version: '0.4.0', fetchImpl });

test('a route that is not live (404 or 503 without an error code) is CHANNEL_UNAVAILABLE in plain words', async () => {
    for (const status of [404, 503]) {
        const e = await api(async () => new Response('<html>nope</html>', { status })).startLink({}).catch((x) => x);
        assert.ok(e instanceof ChannelError);
        assert.equal(e.code, 'CHANNEL_UNAVAILABLE');
        assert.match(e.message, /not available right now.*try again later/);
    }
});

test('a real server error keeps its own code, message and https fix_url; a non-https fix_url is dropped', async () => {
    const body = (fix) => new Response(JSON.stringify({ error: 'CHANNEL_X_REQUIRED', message: 'Link X first.', fix_url: fix }), { status: 403 });
    const ok = await api(async () => body('https://prometheus.mythslabs.ai/dashboard#hermes')).publish('pch_x', {}).catch((x) => x);
    assert.deepEqual([ok.code, ok.message, ok.extra.fixUrl], ['CHANNEL_X_REQUIRED', 'Link X first.', 'https://prometheus.mythslabs.ai/dashboard#hermes']);
    const bad = await api(async () => body('http://evil.example/x')).publish('pch_x', {}).catch((x) => x);
    assert.equal(bad.extra.fixUrl, null);
});

test('the client header is name/version (hermes) and the key only goes in Authorization', async () => {
    let seen;
    await api(async (url, init) => { seen = { url, headers: init.headers }; return new Response(JSON.stringify({ ok: true, hidden: 0 }), { status: 200 }); }).unlinkSelf('pch_abc', false);
    assert.equal(seen.headers['X-Prometheus-Client'], 'prometheus-mcp-server/0.4.0 (hermes)');
    assert.equal(seen.headers.Authorization, 'Bearer pch_abc');
    assert.ok(!seen.url.includes('pch_abc'));
});
