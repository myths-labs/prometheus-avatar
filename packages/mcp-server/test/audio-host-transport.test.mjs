import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import WebSocket from 'ws';

const fixtures = [], origin = 'http://127.0.0.1:54883';
const target = () => ({ accountId: 'controlled-account', avatarId: 'controlled-avatar', hostSessionId: crypto.randomUUID(), selectionId: crypto.randomUUID() });
async function fixture(options = {}) {
  const { LocalAudioHostTransport } = await import('../.test-host/audio-host-transport.js');
  const h = { key: crypto.randomBytes(32).toString('base64url'), frames: [], disconnected: [], clients: [] };
  h.server = new LocalAudioHostTransport({ port: 0, allowedOrigin: origin, pairingKey: h.key,
    onFrame: (host, frame) => h.frames.push({ host, frame }), onDisconnect: host => h.disconnected.push(host), ...options });
  fixtures.push(h); await h.server.start();
  h.connect = async (headers = {}) => {
    const ws = new WebSocket(h.server.url, { headers: { Origin: origin, ...headers } }); h.clients.push(ws);
    await once(ws, 'open'); return ws;
  };
  h.authorize = async (ws, host = target(), key = h.key) => {
    const received = once(ws, 'message');
    ws.send(JSON.stringify({ version: 1, type: 'prometheus.audio.authorize', key, target: host }));
    return JSON.parse((await received)[0].toString());
  };
  return h;
}
const until = async predicate => { for (let i = 0; i < 50 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(predicate()); };

test('only a paired exact-origin client is listed, and keys never enter host metadata', async () => {
  const h = await fixture(), ws = await h.connect(), host = target();
  assert.deepEqual(h.server.hosts(), []);
  const ack = await h.authorize(ws, host);
  assert.equal(ack.type, 'prometheus.audio.authorized'); assert.deepEqual(ack.target, host);
  assert.deepEqual(h.server.hosts().map(h => h.target), [host]);
  assert.equal(JSON.stringify([ack, h.server.hosts()]).includes(h.key), false);
});

test('wrong or absent Origin and a rebinding Host header fail the HTTP upgrade', async () => {
  const h = await fixture();
  for (const headers of [{ Origin: 'https://untrusted.example' }, { Origin: '' }, { Host: 'untrusted.example' }]) {
    await assert.rejects(h.connect(headers), /403/);
  }
  assert.deepEqual(h.server.hosts(), []);
});

test('pairing acknowledges the exact public builtin, legacy or asset voice', async () => {
  const h = await fixture();
  for (const voice of [
    { kind: 'builtin', voiceId: 'saturn_zh_female_tiexinnvyou_tob' },
    { kind: 'legacy', voice: 'Aoede' },
    { kind: 'asset', assetId: crypto.randomUUID() },
  ]) {
    const ws = await h.connect(), host = target(), received = once(ws, 'message');
    ws.send(JSON.stringify({ version: 1, type: 'prometheus.audio.authorize', key: h.key, target: host, voice }));
    const ack = JSON.parse((await received)[0].toString());
    assert.deepEqual(ack, { version: 1, type: 'prometheus.audio.authorized', target: host, voice });
    assert.deepEqual(h.server.hosts().find(row => row.target.hostSessionId === host.hostSessionId).voice, voice);
  }
});

test('private speaker ids, unknown voices and extra voice fields cannot register a host', async () => {
  const h = await fixture();
  for (const voice of [null, { kind: 'builtin', voiceId: 'S_private' },
    { kind: 'builtin', voiceId: 'saturn_unlisted' }, { kind: 'legacy', voice: 'Unknown' },
    { kind: 'asset', assetId: 'invalid' }, { kind: 'asset', assetId: crypto.randomUUID(), speakerId: 'S_private' }]) {
    const ws = await h.connect(), closed = once(ws, 'close');
    ws.send(JSON.stringify({ version: 1, type: 'prometheus.audio.authorize', key: h.key, target: target(), voice }));
    assert.equal((await closed)[0], 1008);
  }
  assert.deepEqual(h.server.hosts(), []); assert.deepEqual(h.frames, []);
});

test('wrong key closes without registration or forwarding a frame', async () => {
  const h = await fixture(), ws = await h.connect(), closed = once(ws, 'close');
  ws.send(JSON.stringify({ version: 1, type: 'prometheus.audio.authorize', key: 'wrong-key', target: target() }));
  assert.equal((await closed)[0], 1008); assert.deepEqual(h.server.hosts(), []); assert.deepEqual(h.frames, []);
});

test('unpaired clients cannot submit receipts and idle authentication expires', async () => {
  const h = await fixture({ authTimeoutMs: 30 });
  for (const send of [true, false]) {
    const ws = await h.connect(), closed = once(ws, 'close');
    if (send) ws.send(JSON.stringify({ version: 1, type: 'prometheus.audio.receipt', target: target() }));
    assert.equal((await closed)[0], 1008);
  }
  assert.deepEqual(h.frames, []); assert.deepEqual(h.server.hosts(), []);
});

test('duplicate host session registration cannot replace an existing authenticated peer', async () => {
  const h = await fixture(), first = await h.connect(), host = target(); await h.authorize(first, host);
  const second = await h.connect(), closed = once(second, 'close');
  second.send(JSON.stringify({ version: 1, type: 'prometheus.audio.authorize', key: h.key, target: { ...host, selectionId: crypto.randomUUID() } }));
  assert.equal((await closed)[0], 1008);
  assert.deepEqual(h.server.hosts().map(h => h.target), [host]);
  assert.equal(first.readyState, WebSocket.OPEN);
});

test('sending targets exactly one paired host and never broadcasts', async () => {
  const h = await fixture(), first = await h.connect(), second = await h.connect(), a = target(), b = target();
  await h.authorize(first, a); await h.authorize(second, b);
  const other = []; second.on('message', data => other.push(data.toString()));
  const received = once(first, 'message'), command = { type: 'prometheus.audio.play', target: a, commandId: crypto.randomUUID() };
  await h.server.send(a.hostSessionId, command);
  assert.deepEqual(JSON.parse((await received)[0].toString()), command); assert.deepEqual(other, []);
  await assert.rejects(h.server.send(crypto.randomUUID(), command), /host_unavailable/);
});

test('authenticated incoming receipt is bound to that peer and excludes extra fields', async () => {
  const h = await fixture(), ws = await h.connect(), host = target(); await h.authorize(ws, host);
  const receipt = { version: 1, type: 'prometheus.audio.receipt', target: host, commandId: crypto.randomUUID(), playbackId: crypto.randomUUID(),
    audioSha256: '1'.repeat(64), sequence: 1, status: 'accepted', at: Date.now() };
  ws.send(JSON.stringify(receipt)); await until(() => h.frames.length === 1);
  assert.deepEqual(h.frames[0], { host, frame: receipt });
  const closed = once(ws, 'close'); ws.send(JSON.stringify({ ...receipt, key: h.key }));
  assert.equal((await closed)[0], 1008); assert.equal(h.frames.length, 1);
  assert.equal(JSON.stringify(h.frames).includes(h.key), false);
});

test('cross-target and binary frames close the sender without forwarding', async () => {
  const h = await fixture();
  for (const binary of [false, true]) {
    const ws = await h.connect(), host = target(); await h.authorize(ws, host); const closed = once(ws, 'close');
    ws.send(binary ? Buffer.from('binary') : JSON.stringify({ version: 1, type: 'prometheus.audio.receipt', target: target(),
      commandId: crypto.randomUUID(), playbackId: crypto.randomUUID(), audioSha256: '1'.repeat(64), sequence: 1, status: 'accepted', at: Date.now() }));
    assert.equal((await closed)[0], 1008);
  }
  assert.deepEqual(h.frames, []);
});

test('oversized inbound messages are rejected before application parsing', async () => {
  const h = await fixture(), ws = await h.connect(); await h.authorize(ws); const closed = once(ws, 'close');
  ws.send('x'.repeat(9000)); assert.equal((await closed)[0], 1009); assert.deepEqual(h.frames, []);
});

test('disconnect removes only its peer and shutdown closes sockets and authentication timers', async () => {
  const h = await fixture(), first = await h.connect(), host = target(); await h.authorize(first, host);
  const closed = once(first, 'close'); first.close(); await closed;
  await until(() => h.server.hosts().length === 0);
  assert.deepEqual(h.disconnected, [host]);
  const idle = await h.connect(), idleClosed = once(idle, 'close'); await h.server.close(); await idleClosed;
  assert.deepEqual(h.server.state(), { listening: false, clients: 0, hosts: 0, authTimers: 0 });
});

test('concurrent shutdown callers await the same completed cleanup', async () => {
  const h = await fixture(), ws = await h.connect(); await h.authorize(ws);
  const first = h.server.close(), second = h.server.close();
  assert.equal(first, second); await second;
  assert.deepEqual(h.server.state(), { listening: false, clients: 0, hosts: 0, authTimers: 0 });
  await assert.rejects(h.server.start(), /host_already_started/);
});

after(async () => {
  const cleanup = [];
  for (const h of fixtures) {
    for (const ws of h.clients) ws.terminate(); await h.server.close();
    const state = h.server.state();
    assert.deepEqual(state, { listening: false, clients: 0, hosts: 0, authTimers: 0 });
    cleanup.push({ address: h.server.url, state, forwardedFrameCount: h.frames.length, disconnectedHosts: h.disconnected.length });
  }
  if (process.env.PROMETHEUS_AUDIO_HOST_EVIDENCE_PATH) fs.writeFileSync(process.env.PROMETHEUS_AUDIO_HOST_EVIDENCE_PATH,
    JSON.stringify({ cleanup, boundary: 'Real loopback WebSocket transport pairing/validation tests. No browser, ledger, synthesis or provider invocation.' }, null, 2), { flag: 'wx' });
});
