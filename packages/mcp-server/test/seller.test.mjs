// Runs the real built MCP server over stdio with a real MCP client, against the seller-channel test double.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFakeSellerServer } from './helpers/fakeSellerServer.mjs';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(25); } }

let server, home, clients;
beforeEach(async () => { server = await startFakeSellerServer({ intervalSec: 0.05 }); home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-home-')); clients = []; });
afterEach(async () => { for (const c of clients) await c.close().catch(() => {}); await server.close(); fs.rmSync(home, { recursive: true, force: true }); });

/**
 * Start the server.
 * - underHermes: launch it through a script called `hermes`, so a real Hermes-named process is its parent.
 * - psRow: instead, put a fake `ps` first on the server's PATH that reports one parent with these args (pid 1 above it).
 *   The real process table depends on how the tests were launched (a shell command that merely mentions hermes would
 *   match), so the "no Hermes above it" case must not use it.
 */
async function start({ underHermes = false, psRow = null, channelEnv = 'hermes', sampling = true } = {}) {
    let command = process.execPath, args = [dist];
    let PATH = process.env.PATH;
    const bin = path.join(home, 'bin'); fs.mkdirSync(bin, { recursive: true });
    if (underHermes) {
        fs.writeFileSync(path.join(bin, 'hermes'), `#!/bin/sh\n"${process.execPath}" "$@"\n`, { mode: 0o755 });
        command = '/bin/sh'; args = [path.join(bin, 'hermes'), dist];
    } else if (psRow !== null) {
        fs.writeFileSync(path.join(bin, 'ps'), `#!/bin/sh\necho "1 ${psRow}"\n`, { mode: 0o755 });
        PATH = `${bin}:${PATH}`;
    }
    const env = { PATH, HOME: home, PROMETHEUS_API_URL: server.url, ...(channelEnv ? { PROMETHEUS_CHANNEL: channelEnv } : {}) };
    const client = new Client({ name: 'test-hermes-client', version: '1.2.3' }, { capabilities: sampling ? { sampling: {} } : {} });
    await client.connect(new StdioClientTransport({ command, args, env, stderr: 'pipe' }));
    clients.push(client);
    const call = async (name, a = {}) => {
        const r = await client.callTool({ name, arguments: a });
        return { text: r.content.map((c) => c.text).join('\n'), isError: r.isError === true };
    };
    return { client, call, keyFile: path.join(home, '.prometheus', 'channel-hermes.json') };
}

test('the four seller tools are listed', async () => {
    const { client } = await start({ underHermes: true });
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ['connect_seller', 'seller_connection_status', 'publish_listing', 'disconnect_seller']) assert.ok(names.includes(n), n);
});

test('connect sends the Hermes evidence from the MCP handshake and the real process tree; approval finishes it in the background', async () => {
    const h = await start({ underHermes: true, sampling: true });
    const c = await h.call('connect_seller');
    assert.equal(c.isError, false, c.text);
    assert.match(c.text, /https:\/\/prometheus\.mythslabs\.ai\/link\?code=KQ7M-4TZP/);
    const req = server.state.requests.find((r) => r.path === '/api/channels/link/start');
    assert.equal(req.headers['x-prometheus-client'], `prometheus-mcp-server/${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version} (hermes)`);
    assert.deepEqual(req.body.evidence, { env_channel: 'hermes', ancestor: 'hermes', ancestor_depth: 1, mcp_client: { name: 'test-hermes-client', version: '1.2.3' }, sampling_declared: true });
    assert.deepEqual(req.body.runtime, { name: 'hermes' });
    assert.equal(req.body.evidence.ancestor_depth <= 8, true);
    assert.ok(!JSON.stringify(req.body).includes('/bin/sh'), 'no command line may be sent');

    server.approve();
    await until(() => fs.existsSync(h.keyFile));
    const st = await h.call('seller_connection_status');
    assert.equal(st.isError, false);
    assert.match(st.text, /Connected as a Hermes Agent seller to the Prometheus account a\*\*\*@example\.com/);
    assert.equal(JSON.parse(fs.readFileSync(h.keyFile, 'utf8')).account_hint, 'a***@example.com');
    assert.equal(fs.statSync(h.keyFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(h.keyFile)).mode & 0o777, 0o700);
    const key = JSON.parse(fs.readFileSync(h.keyFile, 'utf8')).key;
    assert.match(key, /^pch_/);
    assert.ok(!(c.text + st.text).includes(key));
});

test('sampling_declared follows what the client declared', async () => {
    const h = await start({ psRow: '/usr/local/bin/hermes chat', sampling: false });
    await h.call('connect_seller');
    const req = server.state.requests.find((r) => r.path === '/api/channels/link/start');
    assert.equal(req.body.evidence.sampling_declared, false);
});

test('refuses to connect outside Hermes: no channel env, or no Hermes process above it (and never calls the server)', async () => {
    const noEnv = await start({ psRow: '/usr/local/bin/hermes chat', channelEnv: null });
    const a = await noEnv.call('connect_seller');
    assert.equal(a.isError, true);
    assert.match(a.text, /PROMETHEUS_CHANNEL: hermes/);
    const noAncestor = await start({ psRow: '/bin/zsh -l' });
    const b = await noAncestor.call('connect_seller');
    assert.equal(b.isError, true);
    assert.match(b.text, /could not find Hermes Agent/);
    assert.equal(server.state.requests.filter((r) => r.path === '/api/channels/link/start').length, 0);
});

test('publish: fields go through with the bearer key; a draft id is sent alone; a failed check says how to fix it and publishes nothing', async () => {
    const h = await start({ psRow: '/usr/local/bin/hermes chat' });
    await h.call('connect_seller');
    server.approve();
    await until(() => fs.existsSync(h.keyFile));
    const p = await h.call('publish_listing', { name: 'Cat', category: 'skins', file_data: 'https://cdn.example/a.zip', thumbnail_data: 'data:image/png;base64,AAAA', price: 5 });
    assert.equal(p.isError, false, p.text);
    assert.match(p.text, /marketplace\?asset=asset_1/);
    assert.match(p.text, /seller rate: platform fee 12%, 6% for members/);
    assert.deepEqual(server.state.published[0], { name: 'Cat', category: 'skins', price: 5, file_url: 'https://cdn.example/a.zip', thumbnail_base64: 'data:image/png;base64,AAAA' });
    const req = server.state.requests.filter((r) => r.path === '/api/channels/publish').at(-1);
    assert.match(req.headers.authorization, /^Bearer pch_/);
    await h.call('publish_listing', { draft_asset_id: 'draft-3' });
    assert.deepEqual(server.state.published[1], { draft_asset_id: 'draft-3' });
    server.state.xLinked = false;
    const bad = await h.call('publish_listing', { name: 'Dog', category: 'skins', file_data: 'https://cdn.example/b.zip' });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /Link your X account first\./);
    assert.match(bad.text, /Fix it here: https:\/\/prometheus\.mythslabs\.ai\/dashboard#openclaw/);
    assert.equal(server.state.published.length, 2);
});

test('publish when not connected refuses without calling the server', async () => {
    const h = await start({ psRow: '/usr/local/bin/hermes chat' });
    const r = await h.call('publish_listing', { name: 'Cat', category: 'skins', file_data: 'https://cdn.example/a.zip' });
    assert.equal(r.isError, true);
    assert.match(r.text, /Not connected/);
    assert.equal(server.state.requests.filter((x) => x.path === '/api/channels/publish').length, 0);
});

test('a revoked key is noticed and removed; disconnect needs confirm=true and revokes at the server', async () => {
    const h = await start({ psRow: '/usr/local/bin/hermes chat' });
    await h.call('connect_seller');
    server.approve();
    await until(() => fs.existsSync(h.keyFile));
    assert.equal((await h.call('disconnect_seller', {})).isError, true);
    assert.equal(fs.existsSync(h.keyFile), true);
    const d = await h.call('disconnect_seller', { confirm: true });
    assert.equal(d.isError, false);
    assert.equal(fs.existsSync(h.keyFile), false);
    assert.ok([...server.state.keys.values()].every((k) => !k.active));

    await h.call('connect_seller');
    server.approve();
    await until(() => fs.existsSync(h.keyFile));
    server.revokeKeys();
    const st = await h.call('seller_connection_status');
    assert.equal(st.isError, true);
    assert.match(st.text, /no longer active/);
    assert.equal(fs.existsSync(h.keyFile), false);
});

test('a plain-http PROMETHEUS_API_URL to another host is refused so the key never travels unencrypted', async () => {
    const { ChannelApi } = await import('../dist/sellerChannel.js');
    assert.throws(() => new ChannelApi({ baseUrl: 'http://prometheus.mythslabs.ai', version: '0.4.0' }), /https/);
    assert.doesNotThrow(() => new ChannelApi({ baseUrl: 'http://127.0.0.1:1', version: '0.4.0' }));
});

test('next_step link_x and registration_note are told to the user (Hermes wording), also when whoami cannot answer yet', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 0.05, xLinked: false, whoamiMissing: true });
    const h = await start({ psRow: '/usr/local/bin/hermes chat' });
    await h.call('connect_seller');
    server.approve();
    await until(() => fs.existsSync(h.keyFile));
    const st = await h.call('seller_connection_status');
    assert.match(st.text, /^Approved by the Prometheus account a\*\*\*@example\.com; the key is saved\./);
    assert.match(st.text, /becomes a Hermes Agent seller only once X is linked/);

    await server.close();
    server = await startFakeSellerServer({ intervalSec: 0.05, registrationNote: 'ACCOUNT_HAS_SELLER_HISTORY' });
    fs.rmSync(home, { recursive: true, force: true });                    // a fresh home, so there is no saved key from the first half
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-home-'));
    const h2 = await start({ psRow: '/usr/local/bin/hermes chat' });
    await h2.call('connect_seller');
    server.approve();
    await until(() => fs.existsSync(h2.keyFile));
    const st2 = await h2.call('seller_connection_status');
    assert.match(st2.text, /This account will not become a Hermes Agent seller: it already has sales or listings\./);
    assert.equal(JSON.parse(fs.readFileSync(h2.keyFile, 'utf8')).registration_note, 'ACCOUNT_HAS_SELLER_HISTORY');
});
