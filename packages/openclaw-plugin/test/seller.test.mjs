import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import plugin from '../dist/index.js';
import { startFakeSellerServer } from './helpers/fakeSellerServer.mjs';
import { makeApi, call, sleep, until } from './helpers/fakeApi.mjs';

const require = createRequire(import.meta.url);
const manifest = require('../openclaw.plugin.json');
const pkg = require('../package.json');

let server;
beforeEach(async () => { delete process.env.PROMETHEUS_API_KEY; server = await startFakeSellerServer({ intervalSec: 1 }); });   // an API key in the caller's environment must not change what these tests see
afterEach(async () => { await server.close(); delete process.env.PROMETHEUS_API_KEY; });

function boot(opts = {}) {
    const h = makeApi({ ...opts, pluginConfig: { channelBaseUrl: server.url, ...(opts.pluginConfig ?? {}) } });
    const ret = plugin.register(h.api);
    return { ...h, ret };
}

async function connectAndApprove(h) {
    const c = await call(h.tools, 'prometheus_connect_seller');
    server.approve();
    // The key is on disk a moment before the plugin has cleared its pending state; the log line comes after both.
    await until(() => (fs.existsSync(h.keyFile) || h.kv.has('openclaw')) && h.logs.some(([, m]) => /seller channel connected/.test(m)));
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
    assert.match(st.text, /to the Prometheus account a\*\*\*@example\.com/, 'the user is told which account approved');
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
    assert.match(r.text, /Sold at your account's openclaw rate: platform fee 12%, 6% for members/);
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

test('not connected: publish refuses, alias without any credential explains both ways, alias with a pak_ key deploys with it', async () => {
    const h = boot();
    const p = await call(h.tools, 'prometheus_publish_listing', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' });
    assert.equal(p.details.state, 'not_connected');
    assert.equal(server.state.requests.filter((r) => r.path === '/api/channels/publish').length, 0);
    const a = await call(h.tools, 'prometheus_deploy_asset', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' });
    assert.equal(a.details.code, 'NO_CREDENTIALS');

    const h2 = boot({ pluginConfig: { apiKey: 'pak_abc123' } });
    const b = await call(h2.tools, 'prometheus_deploy_asset', { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' });
    assert.match(b.text, /Deployed to Prometheus Marketplace/);
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
    const settled = (want) => until(async () => (await call(h.tools, 'prometheus_connection_status')).details.state === want, 15000);   // the next poll is one interval away
    await call(h.tools, 'prometheus_connect_seller');
    server.deny();
    await settled('denied');
    await call(h.tools, 'prometheus_connect_seller');
    assert.equal(server.state.startCount, 2);
    server.expire();
    await settled('expired');
});

test('polling stays at the interval the server set (no slow_down)', async () => {
    const h = boot();
    await call(h.tools, 'prometheus_connect_seller');
    await sleep(3500);
    const polls = server.state.requests.filter((r) => r.path === '/api/channels/link/token').length;
    assert.ok(polls >= 2 && polls <= 4, `polls in 3.5 s at a 1 s interval: ${polls}`);
    const codes = [...server.state.codes.values()];
    assert.equal(codes[0].interval, 1, 'the server never had to raise the interval');
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

test('the masked account is remembered across a restart (it is in the saved record, not only in memory)', async () => {
    const h = boot();
    await connectAndApprove(h);
    assert.equal(JSON.parse(fs.readFileSync(h.keyFile, 'utf8')).account_hint, 'a***@example.com');
    const h2 = makeApi({ stateDir: h.dir, pluginConfig: { channelBaseUrl: server.url } });     // a new process, same state directory
    plugin.register(h2.api);
    const st = await call(h2.tools, 'prometheus_connection_status');
    assert.match(st.text, /a\*\*\*@example\.com/);
});

test('next_step link_x: after approval the user hears which account approved and that X must be linked first (also when whoami cannot answer yet)', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, xLinked: false, whoamiMissing: true });
    const h = boot();
    await connectAndApprove(h);
    const st = await call(h.tools, 'prometheus_connection_status');
    assert.match(st.text, /^Approved by the Prometheus account a\*\*\*@example\.com; the key is saved\./);
    assert.match(st.text, /Next: link your X account on the Prometheus dashboard \(https:\/\/prometheus\.mythslabs\.ai\/dashboard#openclaw\)/);
    assert.match(st.text, /becomes an OpenClaw seller only once X is linked/);
    assert.match(st.text, /not available right now/);
    server.state.xLinked = false;
});

test('next_step link_x with whoami available: the status line says the account becomes a seller only once X is linked', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, xLinked: false });
    const h = boot();
    await connectAndApprove(h);
    const st = await call(h.tools, 'prometheus_connection_status');
    assert.match(st.text, /X account not linked yet/);
    assert.match(st.text, /not an OpenClaw seller yet \(account type: human\)/);
    assert.match(st.text, /becomes an OpenClaw seller once all of these are true/);
    assert.ok(st.text.includes(`${server.url}/join?type=openclaw`), 'says where the registration type is chosen');
});

test('registration_note: the user is told the account will not become an OpenClaw seller, and it is remembered across a restart', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, registrationNote: 'ACCOUNT_HAS_SELLER_HISTORY' });
    const h = boot();
    await connectAndApprove(h);
    const st = await call(h.tools, 'prometheus_connection_status');
    assert.match(st.text, /This account will not become an OpenClaw seller: it already has sales or listings\./);
    assert.equal(JSON.parse(fs.readFileSync(h.keyFile, 'utf8')).registration_note, 'ACCOUNT_HAS_SELLER_HISTORY');
    const h2 = makeApi({ stateDir: h.dir, pluginConfig: { channelBaseUrl: server.url } });
    plugin.register(h2.api);
    assert.match((await call(h2.tools, 'prometheus_connection_status')).text, /will not become an OpenClaw seller/);
    // and the other reason, plus an unknown one is shown without inventing a meaning
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, registrationNote: 'IDENTITY_LOCKED' });
    const h3 = boot();
    await connectAndApprove(h3);
    assert.match((await call(h3.tools, 'prometheus_connection_status')).text, /its account type is already set/);
});

const PUB = { name: 'Cat', category: 'skins', fileData: 'https://cdn.example/a.zip' };
const keyOf = (h) => JSON.parse(fs.readFileSync(h.keyFile, 'utf8')).key;

test('the account is not called an OpenClaw seller until the server says so: without the registration type the status says what is missing, then follows the server', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, noIntent: true });
    const h = boot();
    await connectAndApprove(h);
    const st = await call(h.tools, 'prometheus_connection_status');
    assert.equal(st.details.is_seller, false);
    assert.equal(st.details.account_type, 'human');
    assert.doesNotMatch(st.text, /Connected as an OpenClaw seller/);
    assert.match(st.text, /not an OpenClaw seller yet \(account type: human\)/);
    assert.match(st.text, /Platform fee 25%, 15% for members/, "the account's own rate, as the server reports it");
    assert.ok(st.text.includes(`${server.url}/join?type=openclaw`), 'says where the registration type is chosen');
    assert.match(st.text, /X account at least 30 days old/);
    server.state.noIntent = false;                                    // the server now sets the tier
    const after = await call(h.tools, 'prometheus_connection_status');
    assert.equal(after.details.is_seller, true);
    assert.match(after.text, /^Connected as an OpenClaw seller/);
    assert.match(after.text, /Platform fee 12%/);
});

test('a hiccup while waiting (a 5xx, a rate limit, a gateway page) does not end the attempt: the approval is still picked up', async () => {
    const h = boot();
    await call(h.tools, 'prometheus_connect_seller');
    server.inject('token', { status: 503 }, { status: 429, body: { error: 'RATE_LIMITED', message: 'Slow down.', fix_url: null }, headers: { 'Retry-After': '1' } }, { status: 502, text: '<html>Bad gateway</html>' });
    server.approve();
    await until(() => fs.existsSync(h.keyFile), 25000);
    assert.equal((await call(h.tools, 'prometheus_connection_status')).details.state, 'connected');
});

test('a refusal that will not go away while waiting ends the attempt with the server message', async () => {
    const h = boot();
    await call(h.tools, 'prometheus_connect_seller');
    server.inject('token', { status: 400, body: { error: 'CHANNEL_CLIENT_UNSUPPORTED', message: 'Update the plugin.', fix_url: null } });
    const st = await until(async () => { const s = await call(h.tools, 'prometheus_connection_status'); return s.details.state === 'failed' ? s : null; }, 15000);
    assert.match(st.text, /Connecting failed: Update the plugin\./);
});

test('an interval of zero from the server cannot turn the wait into a busy loop', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 0 });
    const h = boot();
    await call(h.tools, 'prometheus_connect_seller');
    await sleep(2500);
    const polls = server.state.requests.filter((r) => r.path === '/api/channels/link/token').length;
    assert.ok(polls >= 1 && polls <= 4, `polls in 2.5 s: ${polls}`);
});

test('two connect calls at once share one start and one code', async () => {
    const h = boot();
    const [a, b] = await Promise.all([call(h.tools, 'prometheus_connect_seller'), call(h.tools, 'prometheus_connect_seller')]);
    assert.equal(server.state.startCount, 1);
    assert.equal(a.text, b.text);
});

test('disconnecting while a poll is out drops that approval: nothing is saved, and the log says so without the key', async () => {
    const h = boot();
    await call(h.tools, 'prometheus_connect_seller');
    server.approve();
    server.inject('token', { delayMs: 1500, passThrough: true });      // the first poll is held on the server, then answered with the key
    await sleep(1300);                                                 // the poll is out now
    const d = await call(h.tools, 'prometheus_disconnect_seller', { confirm: true });
    assert.equal(d.details.ok, true);
    await sleep(2500);
    assert.equal(fs.existsSync(h.keyFile), false, 'the key of a cancelled connection is not saved');
    const warn = h.logs.find(([l, m]) => l === 'warn' && /approved just as the connection was cancelled/.test(m));
    assert.ok(warn, JSON.stringify(h.logs));
    assert.ok(!/pch_[0-9a-f]{16}/.test(JSON.stringify(h.logs)), 'only the short prefix is logged');
});

test('a key is only sent back to the address that issued it', async () => {
    const h = boot();
    await connectAndApprove(h);
    assert.equal(JSON.parse(fs.readFileSync(h.keyFile, 'utf8')).base_url, server.url);
    const other = await startFakeSellerServer({ intervalSec: 1 });
    try {
        const h2 = makeApi({ stateDir: h.dir, pluginConfig: { channelBaseUrl: other.url, apiKey: 'pak_abc123' } });
        plugin.register(h2.api);
        const st = await call(h2.tools, 'prometheus_connection_status');
        assert.equal(st.details.state, 'other_host');
        assert.match(st.text, /made with http:\/\/127\.0\.0\.1:\d+, but this plugin now talks to http:\/\/127\.0\.0\.1:\d+, so nothing was sent/);
        assert.equal((await call(h2.tools, 'prometheus_publish_listing', PUB)).details.state, 'other_host');
        assert.equal((await call(h2.tools, 'prometheus_deploy_asset', PUB)).details.state, 'other_host', 'the old-name tool does not slip to the API key either');
        assert.equal(other.state.requests.length, 0, 'the other server saw no request at all');
        const gone = await call(h2.tools, 'prometheus_disconnect_seller', { confirm: true });
        assert.equal(gone.details.revoked, false);
        assert.equal(other.state.requests.length, 0);
        assert.equal(fs.existsSync(h.keyFile), false, 'the local copy is removed');
    } finally {
        await other.close();
    }
});

test('a publish that may have gone through is not offered as a plain "try again" (that could list it twice)', async () => {
    const h = boot();
    await connectAndApprove(h);
    server.inject('publish', { drop: true });                          // the server creates the listing, then the connection is cut
    const r = await call(h.tools, 'prometheus_publish_listing', PUB);
    assert.equal(r.details.ok, false);
    assert.equal(r.details.maybe_published, true);
    assert.match(r.text, /may already have gone through/);
    assert.doesNotMatch(r.text, /try again/i);
    assert.equal(server.state.published.length, 1, 'the server did create the listing');
});

test('a voice is refused by the server with its own explanation, and nothing is published; a daily cap tells how long to wait', async () => {
    const h = boot();
    await connectAndApprove(h);
    const v = await call(h.tools, 'prometheus_publish_listing', { ...PUB, category: 'voices' });
    assert.equal(v.details.code, 'VOICE_CANONICAL_PUBLICATION_REQUIRED');
    assert.match(v.text, /Voice Creator/);
    assert.equal(server.state.published.length, 0);
    server.state.dailyCap = 0;
    const cap = await call(h.tools, 'prometheus_publish_listing', PUB);
    assert.equal(cap.details.code, 'CHANNEL_DAILY_CAP');
    assert.match(cap.text, /Try again in about 3 hours/, 'the wait comes from the body when there is no Retry-After header');
});

test('the old-name deploy never quietly switches to the API key: not while a connection waits for approval, not after a failed publish', async () => {
    const h = boot({ pluginConfig: { apiKey: 'pak_abc123' } });
    await call(h.tools, 'prometheus_connect_seller');
    const waiting = await call(h.tools, 'prometheus_deploy_asset', PUB);
    assert.equal(waiting.details.ok, false);
    assert.match(waiting.text, /waiting for approval/);
    assert.equal(server.state.deployed.length, 0);
    server.approve();
    await until(() => fs.existsSync(h.keyFile));
    server.inject('whoami', { status: 503 });                          // a status check that fails must not look like "not connected"
    server.inject('publish', { status: 503, body: { error: 'TEMPORARILY_UNAVAILABLE', message: 'Try again in a moment.', fix_url: null } });
    const failed = await call(h.tools, 'prometheus_deploy_asset', PUB);
    assert.equal(failed.details.ok, false);
    assert.equal(server.state.deployed.length, 0, 'a failed channel publish must not become an API-key deploy');
    assert.equal(server.state.published.length, 0);
});

test('an API key from the environment is never sent to an address other than the production host', async () => {
    process.env.PROMETHEUS_API_KEY = 'pak_fromenv';
    const h = boot();                                                  // channelBaseUrl is the local double
    const a = await call(h.tools, 'prometheus_deploy_asset', PUB);
    assert.equal(a.details.code, 'NO_CREDENTIALS');
    assert.equal(server.state.deployed.length, 0);
    assert.ok(!server.state.requests.some((r) => String(r.headers.authorization || '').includes('pak_fromenv')));
});

test('a stale "key inactive" answer does not delete a newer connection', async () => {
    const h = boot();
    await connectAndApprove(h);
    const keyA = keyOf(h);
    server.inject('publish', { status: 401, body: { error: 'CHANNEL_KEY_INACTIVE', message: 'This key is no longer active.', fix_url: null }, delayMs: 3500 });
    const slow = call(h.tools, 'prometheus_publish_listing', PUB);     // uses key A, answered "inactive" much later
    await sleep(200);
    await call(h.tools, 'prometheus_connect_seller', { relink: true });
    server.approve();
    await until(() => fs.existsSync(h.keyFile) && keyOf(h) !== keyA, 15000);
    const r = await slow;
    assert.equal(r.details.code, 'CHANNEL_KEY_INACTIVE');
    assert.equal(fs.existsSync(h.keyFile), true, 'the newer key stays');
    assert.notEqual(keyOf(h), keyA);
});

test('an approval link that is not https (or http on this computer) is not shown and nothing is started', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, verificationUri: 'http://evil.example/steal' });
    const h = boot();
    const r = await call(h.tools, 'prometheus_connect_seller');
    assert.equal(r.details.code, 'BAD_APPROVAL_LINK');
    assert.ok(!r.text.includes('evil.example'));
    assert.equal((await call(h.tools, 'prometheus_connection_status')).details.state, 'not_connected');
});

test('when the key cannot be written no half-written copy is left behind, and the user is told', async () => {
    const h = boot();
    fs.mkdirSync(h.keyFile, { recursive: true });                      // a directory where the file should go: the rename must fail
    await call(h.tools, 'prometheus_connect_seller');
    server.approve();
    const st = await until(async () => { const s = await call(h.tools, 'prometheus_connection_status'); return s.details.state === 'failed' ? s : null; }, 15000);
    assert.match(st.text, /Connecting failed/);
    assert.deepEqual(fs.readdirSync(path.dirname(h.keyFile)).filter((n) => n.endsWith('.tmp')), []);
});

test('the status of a gateway that lost a pending approval in a restart says so', async () => {
    const h = boot();
    const st = await call(h.tools, 'prometheus_connection_status');
    assert.equal(st.details.state, 'not_connected');
    assert.match(st.text, /still pending when this gateway restarted is lost/);
});

test('the three copies of the seller-channel test double are identical (they are copied by hand)', () => {
    const here = new URL('./helpers/fakeSellerServer.mjs', import.meta.url);
    const sdk = new URL('../../sdk/tests/helpers/fakeSellerServer.mjs', import.meta.url);
    const mcp = new URL('../../mcp-server/test/helpers/fakeSellerServer.mjs', import.meta.url);
    assert.equal(fs.readFileSync(here, 'utf8'), fs.readFileSync(sdk, 'utf8'));
    assert.equal(fs.readFileSync(here, 'utf8'), fs.readFileSync(mcp, 'utf8'));
});

test('slow_down: the next poll waits the interval the server names', async () => {
    const h = boot();
    await call(h.tools, 'prometheus_connect_seller');
    server.inject('token', { status: 400, body: { error: 'slow_down', message: 'Polling too fast.', fix_url: null, interval: 2.5 } });
    await until(() => server.state.requests.filter((r) => r.path === '/api/channels/link/token').length >= 2, 15000);
    const [a, b] = server.state.requests.filter((r) => r.path === '/api/channels/link/token');
    assert.ok(b.at - a.at >= 2300, `the second poll came ${b.at - a.at} ms after the slow_down (the server asked for 2500)`);
});

test('a disconnect the server could not carry out keeps the saved key and says so; trying again works', async () => {
    const h = boot();
    await connectAndApprove(h);
    server.inject('unlink', { status: 503 });
    const r = await call(h.tools, 'prometheus_disconnect_seller', { confirm: true });
    assert.equal(r.details.ok, false);
    assert.match(r.text, /Could not disconnect/);
    assert.equal(fs.existsSync(h.keyFile), true, 'the key is still needed to try again');
    assert.equal((await call(h.tools, 'prometheus_disconnect_seller', { confirm: true })).details.ok, true);
    assert.equal(fs.existsSync(h.keyFile), false);
});

test('disconnect can hide the listings published through the connection, and says how many', async () => {
    const h = boot();
    await connectAndApprove(h);
    await call(h.tools, 'prometheus_publish_listing', PUB);
    await call(h.tools, 'prometheus_publish_listing', { ...PUB, name: 'Dog' });
    const r = await call(h.tools, 'prometheus_disconnect_seller', { confirm: true, hide_listings: true });
    assert.match(r.text, /2 listing\(s\) hidden/);
    const req = server.state.requests.find((x) => x.path === '/api/channels/unlink-self');
    assert.equal(req.body.hide_listings, true);
});

test('a damaged key file counts as not connected instead of crashing, and connecting again replaces it', async () => {
    const h = boot();
    fs.mkdirSync(path.dirname(h.keyFile), { recursive: true });
    fs.writeFileSync(h.keyFile, '{not json');
    assert.equal((await call(h.tools, 'prometheus_connection_status')).details.state, 'not_connected');
    await connectAndApprove(h);
    assert.equal((await call(h.tools, 'prometheus_connection_status')).details.state, 'connected');
});

test('right after approval, even when the status cannot be read, the user hears why the account will not become a seller', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, whoamiMissing: true, registrationNote: 'ACCOUNT_HAS_SELLER_HISTORY' });
    const h = boot();
    await connectAndApprove(h);
    const st = await call(h.tools, 'prometheus_connection_status');
    assert.match(st.text, /^Approved by the Prometheus account a\*\*\*@example\.com; the key is saved\./);
    assert.match(st.text, /will not become an OpenClaw seller: it already has sales or listings\./);
});

test('a base64 file and a thumbnail URL go into their own fields', async () => {
    const h = boot();
    await connectAndApprove(h);
    await call(h.tools, 'prometheus_publish_listing', { name: 'Cat', category: 'skins', fileData: 'QUJD', thumbnailData: 'https://cdn.example/t.png' });
    assert.deepEqual(server.state.published[0], { name: 'Cat', category: 'skins', file_base64: 'QUJD', thumbnail_url: 'https://cdn.example/t.png' });
});
