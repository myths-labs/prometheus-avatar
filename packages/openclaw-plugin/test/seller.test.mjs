import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import plugin from '../dist/index.js';
import { startFakeSellerServer } from './helpers/fakeSellerServer.mjs';
import { makeApi, call, sleep, until } from './helpers/fakeApi.mjs';

const require = createRequire(import.meta.url);
const manifest = require('../openclaw.plugin.json');
const pkg = require('../package.json');

let server;
beforeEach(async () => { server = await startFakeSellerServer({ intervalSec: 0.05 }); });
afterEach(async () => { await server.close(); });

function boot(opts = {}) {
    const h = makeApi({ ...opts, pluginConfig: { channelBaseUrl: server.url, ...(opts.pluginConfig ?? {}) } });
    const ret = plugin.register(h.api);
    return { ...h, ret };
}

async function connectAndApprove(h) {
    const c = await call(h.tools, 'prometheus_connect_seller');
    server.approve();
    await until(() => fs.existsSync(h.keyFile) || h.kv.has('openclaw'));
    return c;
}

test('register is synchronous, and the tools match the manifest contract and the package version', () => {
    const h = boot();
    assert.equal(h.ret, undefined, 'register must return nothing (OpenClaw rejects an async register)');
    assert.deepEqual([...h.tools.keys()].sort(), [...manifest.contracts.tools].sort());
    assert.equal(pkg.version, '0.11.0');
    assert.equal(manifest.id, plugin.id);
    for (const t of h.tools.values()) assert.equal(t.parameters.type, 'object');
});

test('connect returns the approval link and code; a second connect repeats it without a new start', async () => {
    const h = boot();
    const a = await call(h.tools, 'prometheus_connect_seller');
    assert.match(a.text, /https:\/\/prometheus\.mythslabs\.ai\/link\?code=KQ7M-4TZP/);
    assert.match(a.text, /approve code KQ7M-4TZP within 10 minutes/);
    const b = await call(h.tools, 'prometheus_connect_seller');
    assert.match(b.text, /KQ7M-4TZP/);
    assert.equal(server.state.startCount, 1);
    const st = await call(h.tools, 'prometheus_connection_status');
    assert.equal(st.details.state, 'waiting');
});

test('the start request carries the client header for this OpenClaw version and no browser headers', async () => {
    const h = boot({ version: '2026.9.6' });
    await call(h.tools, 'prometheus_connect_seller');
    const req = server.state.requests.find((r) => r.path === '/api/channels/link/start');
    assert.equal(req.headers['x-prometheus-client'], 'prometheus-openclaw-plugin/0.11.0 (openclaw 2026.9.6)');
    assert.equal(req.headers.origin, undefined);
    assert.equal(req.headers['sec-fetch-site'], undefined);
    assert.deepEqual(req.body, { channel: 'openclaw', client: { name: 'prometheus-openclaw-plugin', version: '0.11.0' }, runtime: { name: 'openclaw', version: '2026.9.6' } });
});

test('after approval the plugin finishes on its own; the key sits in a 0600 file when OpenClaw state is refused', async () => {
    const h = boot({ trusted: false });
    await connectAndApprove(h);
    const st = await call(h.tools, 'prometheus_connection_status');
    assert.equal(st.details.state, 'connected');
    assert.match(st.text, /Connected as an OpenClaw seller/);
    assert.match(st.text, /Platform fee 12%, 6% for members/);
    assert.equal(fs.statSync(h.keyFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(h.keyFile.replace(/[^/]+$/, '')).mode & 0o777, 0o700);
    const saved = JSON.parse(fs.readFileSync(h.keyFile, 'utf8'));
    assert.match(saved.key, /^pch_[0-9a-f]{32}$/);
    assert.equal(saved.channel, 'openclaw');
});

test('the key never appears in a tool result or a log line', async () => {
    const h = boot();
    const seen = [];
    seen.push((await connectAndApprove(h)).text);
    seen.push(JSON.stringify((await call(h.tools, 'prometheus_connection_status')).raw));
    seen.push(JSON.stringify((await call(h.tools, 'prometheus_publish_listing', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' })).raw));
    const key = JSON.parse(fs.readFileSync(h.keyFile, 'utf8')).key;
    const hay = seen.join('\n') + JSON.stringify(h.logs);
    assert.ok(!hay.includes(key), 'full key leaked');
    assert.ok(!/pch_[0-9a-f]{32}/.test(hay), 'a full-looking key leaked');
});

test('when OpenClaw state is open to the plugin the key goes there and no file is written', async () => {
    const h = boot({ trusted: true });
    await call(h.tools, 'prometheus_connect_seller');
    server.approve();
    await until(() => h.kv.has('openclaw'));
    assert.equal(fs.existsSync(h.keyFile), false);
    assert.match(h.kv.get('openclaw').key, /^pch_/);
});

test('publish sends the deploy fields with the bearer key and no creator_type; alias deploy uses the channel when connected', async () => {
    const h = boot();
    await connectAndApprove(h);
    const r = await call(h.tools, 'prometheus_publish_listing', { name: 'Cat', category: 'skins', description: 'd', price: 5, tags: ['a'], fileData: 'https://cdn.example/a.zip', thumbnailData: 'data:image/png;base64,AAAA' });
    assert.equal(r.details.ok, true);
    assert.match(r.text, /Published to Prometheus Marketplace: https:\/\/prometheus\.mythslabs\.ai\/marketplace\?asset=asset_1/);
    assert.match(r.text, /openclaw rate: platform fee 12%, 6% for members/);
    assert.match(r.text, /held for 3 days/);
    assert.deepEqual(server.state.published[0], { name: 'Cat', category: 'skins', description: 'd', price: 5, tags: ['a'], file_url: 'https://cdn.example/a.zip', thumbnail_base64: 'data:image/png;base64,AAAA' });
    const req = server.state.requests.filter((x) => x.path === '/api/channels/publish').at(-1);
    assert.match(req.headers.authorization, /^Bearer pch_/);
    assert.equal(req.headers['x-prometheus-client'], 'prometheus-openclaw-plugin/0.11.0 (openclaw 2026.9.6)');

    const alias = await call(h.tools, 'prometheus_deploy_asset', { name: 'Dog', category: 'skins', fileData: 'https://cdn.example/b.zip' });
    assert.equal(alias.details.ok, true);
    assert.equal(server.state.published.length, 2);
    assert.equal(server.state.deployed.length, 0);

    const draft = await call(h.tools, 'prometheus_publish_listing', { draft_asset_id: 'draft-7' });
    assert.equal(draft.details.ok, true);
    assert.deepEqual(server.state.published[2], { draft_asset_id: 'draft-7' });
});

test('a failed check says why and how to fix it, and never publishes at another rate', async () => {
    const h = boot();
    await connectAndApprove(h);
    server.state.xLinked = false;
    const r = await call(h.tools, 'prometheus_publish_listing', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' });
    assert.equal(r.details.ok, false);
    assert.equal(r.details.code, 'CHANNEL_X_REQUIRED');
    assert.match(r.text, /Link your X account first\./);
    assert.match(r.text, /Fix it here: https:\/\/prometheus\.mythslabs\.ai\/dashboard#openclaw/);
    assert.equal(server.state.published.length, 0);
    assert.equal(server.state.deployed.length, 0);
    const alias = await call(h.tools, 'prometheus_deploy_asset', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' });
    assert.equal(alias.details.code, 'CHANNEL_X_REQUIRED');
    assert.equal(server.state.deployed.length, 0, 'the alias must not fall back to a pak_ deploy after a channel failure');
});

test('not connected: publish refuses, alias without any credential explains both ways, alias with a pak_ key deploys at the AI agent rate', async () => {
    const h = boot();
    const p = await call(h.tools, 'prometheus_publish_listing', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' });
    assert.equal(p.details.state, 'not_connected');
    assert.equal(server.state.requests.filter((r) => r.path === '/api/channels/publish').length, 0);
    const a = await call(h.tools, 'prometheus_deploy_asset', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' });
    assert.equal(a.details.code, 'NO_CREDENTIALS');

    const h2 = boot({ pluginConfig: { apiKey: 'pak_abc123' } });
    const b = await call(h2.tools, 'prometheus_deploy_asset', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' });
    assert.match(b.text, /AI agent rate/);
    assert.equal(server.state.deployed.length, 1);
});

test('a revoked key is noticed, removed, and reported', async () => {
    const h = boot();
    await connectAndApprove(h);
    server.revokeKeys();
    const st = await call(h.tools, 'prometheus_connection_status');
    assert.equal(st.details.state, 'key_inactive');
    assert.equal(fs.existsSync(h.keyFile), false);
    const p = await call(h.tools, 'prometheus_publish_listing', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' });
    assert.equal(p.details.state, 'not_connected');
});

test('declined and expired approvals are reported and clear the pending state', async () => {
    const h = boot();
    await call(h.tools, 'prometheus_connect_seller');
    server.deny();
    await sleep(120);
    assert.equal((await call(h.tools, 'prometheus_connection_status')).details.state, 'denied');
    await call(h.tools, 'prometheus_connect_seller');
    assert.equal(server.state.startCount, 2);
    server.expire();
    await sleep(120);
    assert.equal((await call(h.tools, 'prometheus_connection_status')).details.state, 'expired');
});

test('polling stays at the interval the server set (no slow_down)', async () => {
    const h = boot();
    await call(h.tools, 'prometheus_connect_seller');
    await sleep(600);
    const polls = server.state.requests.filter((r) => r.path === '/api/channels/link/token').length;
    assert.ok(polls >= 3 && polls <= 12, `polls in 600 ms: ${polls}`);
    const codes = [...server.state.codes.values()];
    assert.equal(codes[0].interval, 0.05, 'the server never had to raise the interval');
});

test('connect when already connected reports status; relink starts a new flow', async () => {
    const h = boot();
    await connectAndApprove(h);
    const again = await call(h.tools, 'prometheus_connect_seller');
    assert.match(again.text, /Connected as an OpenClaw seller/);
    assert.match(again.text, /relink=true/);
    assert.equal(server.state.startCount, 1);
    const re = await call(h.tools, 'prometheus_connect_seller', { relink: true });
    assert.match(re.text, /KQ7M-4TZP/);
    assert.equal(server.state.startCount, 2);
});

test('disconnect needs confirm=true, revokes the key at the server, and removes the saved key', async () => {
    const h = boot();
    await connectAndApprove(h);
    const no = await call(h.tools, 'prometheus_disconnect_seller', {});
    assert.equal(no.details.code, 'CONFIRM_REQUIRED');
    assert.equal(fs.existsSync(h.keyFile), true);
    const yes = await call(h.tools, 'prometheus_disconnect_seller', { confirm: true });
    assert.equal(yes.details.ok, true);
    assert.equal(fs.existsSync(h.keyFile), false);
    assert.ok([...server.state.keys.values()].every((k) => k.active === false));
    assert.equal((await call(h.tools, 'prometheus_connection_status')).details.state, 'not_connected');
});

test('server refusals on connect are relayed with their message', async () => {
    const h = boot({ version: '' });
    const r = await call(h.tools, 'prometheus_connect_seller');
    assert.equal(r.details.ok, false);
    assert.equal(r.details.code, 'CHANNEL_RUNTIME_UNKNOWN');
    assert.match(r.text, /Could not start the connection: /);
});

test('the avatar bridge stays out of the way without a page element, and hooks up when there is one', () => {
    const headless = boot();
    assert.equal(headless.hooks.length, 0);
    assert.ok(headless.logs.some(([, m]) => /Avatar rendering skipped/.test(m)));

    globalThis.document = { querySelector: () => ({}) };
    try {
        const paged = boot({ pluginConfig: { containerSelector: '#avatar' } });
        assert.deepEqual(paged.hooks.map(([n]) => n).sort(), ['message_sent', 'model_call_ended', 'model_call_started']);
    } finally {
        delete globalThis.document;
    }
});

test('when the seller channel is not live on the server the user gets a plain sentence, not an HTTP code dump', async () => {
    const h = boot({ pluginConfig: { channelBaseUrl: 'http://127.0.0.1:1' } });   // nothing listens: network failure
    const net = await call(h.tools, 'prometheus_connect_seller');
    assert.equal(net.details.code, 'CHANNEL_NETWORK');
    assert.match(net.text, /Could not reach Prometheus/);
});
