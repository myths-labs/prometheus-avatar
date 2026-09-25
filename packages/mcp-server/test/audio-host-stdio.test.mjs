import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const records = [], origin = 'http://127.0.0.1:54883';
const hash = value => createHash('sha256').update(value).digest('hex');
const voice = { kind: 'builtin', voiceId: 'saturn_zh_female_tiexinnvyou_tob' };
const target = () => ({ accountId: 'controlled-account', avatarId: 'retained-avatar', hostSessionId: randomUUID(), selectionId: randomUUID() });
const decode = result => { const block = result.content.find(row => row.type === 'text'); assert.ok(block); return JSON.parse(block.text); };
const until = async predicate => { for (let n = 0; n < 300; n++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('Timed out waiting for controlled protocol state.'); };

async function fixture(t, enabled = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-stdio-host-')), pairingKey = randomBytes(32).toString('base64url');
  const mp3 = fs.readFileSync(new URL('./audio/mpeg2.mp3', import.meta.url));
  const f = { requests: [], frames: [], receipts: [], clients: [], sockets: [], directory, responseMode: 'ready', mp3 };
  const apiSockets = new Set();
  const api = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw);
    f.requests.push({ path: req.url, method: req.method, body, authorized: req.headers.authorization === 'Bearer pak_controlled_stdio' });
    if (f.responseMode === 'drop') { req.socket.destroy(); return; }
    if (f.responseMode === 'hold') { res.once('close', () => { f.heldClosed = true; }); return; }
    if (f.responseMode === 'redirect') { res.writeHead(307, { Location: '/must-not-follow' }); res.end(); return; }
    if (f.responseMode === 'large') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '50000000' }); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ audio: mp3.toString('base64'), mimeType: 'audio/mpeg', engine: 'volcengine-v3',
      voice: null, voiceAssetId: null, builtinVoiceId: body.builtinVoiceId, textLength: body.text.length }));
  });
  api.on('connection', socket => { apiSockets.add(socket); socket.on('close', () => apiSockets.delete(socket)); });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${api.address().port}`;
  f.start = async (port, apiKey = 'pak_controlled_stdio') => {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], cwd: process.cwd(), stderr: 'pipe',
      env: { PROMETHEUS_API_URL: apiUrl, PROMETHEUS_API_KEY: apiKey, ...(enabled ? {
        PROMETHEUS_AUDIO_HOST_ORIGIN: origin, PROMETHEUS_AUDIO_HOST_KEY: pairingKey,
        PROMETHEUS_AUDIO_HOST_PORT: String(port ?? 0), PROMETHEUS_AUDIO_HOST_DATA_DIR: directory,
      } : {}) } });
    const client = new Client({ name: 'controlled-host-protocol', version: '1.0.0' }), record = { client, transport, stderr: '', pid: null }; f.clients.push(record);
    transport.stderr?.on('data', data => { record.stderr += data; }); await client.connect(transport); record.pid = transport.pid; f.client = client; return client;
  };
  f.call = async (name, args = {}, options) => f.client.callTool({ name: 'prometheus_' + name, arguments: args }, undefined, options);
  f.pair = async (host = target(), selected = voice) => {
    const listing = decode(await f.call('list_audio_hosts')); assert.equal(listing.enabled, true); f.url = listing.endpoint;
    const ws = new WebSocket(f.url, { origin }); f.sockets.push(ws); await once(ws, 'open'); const received = once(ws, 'message');
    ws.send(JSON.stringify({ version: 1, type: 'prometheus.audio.authorize', key: pairingKey, target: host, voice: selected }));
    assert.deepEqual(JSON.parse((await received)[0].toString()).voice, selected);
    ws.on('message', bytes => f.frames.push(JSON.parse(bytes.toString()))); f.ws = ws; f.host = host; return host;
  };
  f.receipt = (command, sequence, status, ws = f.ws) => {
    const frame = { version: 1, type: 'prometheus.audio.receipt', target: command.target,
      commandId: command.commandId, playbackId: command.playbackId, audioSha256: command.audio.sha256, sequence, status, at: 100 + sequence };
    f.receipts.push(frame); ws.send(JSON.stringify(frame));
  };
  t.after(async () => {
    for (const ws of f.sockets) ws.terminate(); for (const row of f.clients) await row.client.close();
    for (const socket of apiSockets) socket.destroy(); await new Promise(resolve => api.close(resolve));
    for (const row of f.clients) {
      assert.equal(row.stderr.includes(pairingKey), false);
      if (row.pid) assert.throws(() => process.kill(row.pid, 0), error => error.code === 'ESRCH');
    }
    records.push({ directory, requests: f.requests, receipts: f.receipts, frames: f.frames.map(({ audio, ...frame }) => ({ ...frame,
      ...(audio ? { audio: { sha256: audio.sha256, mimeType: audio.mimeType, bytes: Buffer.from(audio.data, 'base64').length } } : {}) })),
      stdioClosed: f.clients.map(row => ({ pid: row.pid, exited: true })), socketsClosed: f.sockets.every(ws => ws.readyState === WebSocket.CLOSED), apiClosed: !api.listening });
  });
  await f.start(); return f;
}

test('host tools are discoverable while the listener stays off without explicit configuration', async t => {
  const f = await fixture(t, false), tools = await f.client.listTools();
  for (const name of ['list_audio_hosts', 'prepare_speech', 'get_prepared_speech', 'play_prepared_speech', 'stop_speech', 'get_speech_playback']) {
    assert.ok(tools.tools.some(tool => tool.name === 'prometheus_' + name));
  }
  assert.equal(decode(await f.call('list_audio_hosts')).enabled, false); assert.equal(f.requests.length, 0);
});

test('actual stdio prepares exact selected speech once and delivers original bytes with durable receipts', async t => {
  const f = await fixture(t), host = await f.pair(), requestId = randomUUID(), args = { request_id: requestId, target: host, text: 'Controlled retained speech.' };
  const prepared = decode(await f.call('prepare_speech', args)); assert.equal(prepared.status, 'ready'); assert.equal(prepared.created, true);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.builtinVoiceId, voice.voiceId); assert.equal(f.requests[0].authorized, true);
  assert.equal(decode(await f.call('prepare_speech', args)).created, false);
  assert.equal(decode(await f.call('prepare_speech', { ...args, text: 'Conflicting request text.' })).error, 'preparation_conflict');
  assert.equal(decode(await f.call('prepare_speech', { ...args, request_id: randomUUID() })).audio_id, prepared.audio_id); assert.equal(f.requests.length, 1);
  const play = { audio_id: prepared.audio_id, target: host, command_id: randomUUID(), playback_id: randomUUID() };
  await f.call('play_prepared_speech', play); await until(() => f.frames.length === 1); const command = f.frames[0];
  assert.equal(command.audio.data, f.mp3.toString('base64')); assert.equal(command.audio.sha256, hash(f.mp3));
  f.receipt(command, 1, 'accepted'); f.receipt(command, 2, 'started'); f.receipt(command, 3, 'completed');
  let row; for (let n = 0; n < 100; n++) { row = decode(await f.call('get_speech_playback', { command_id: play.command_id })); if (row.status === 'completed') break; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(row.status, 'completed'); assert.deepEqual(row.receipts.map(r => r.status), ['accepted', 'started', 'completed']);
  const duplicate = decode(await f.call('play_prepared_speech', play)); assert.deepEqual(duplicate.receipts, row.receipts); assert.equal(f.frames.filter(c => c.type === 'prometheus.audio.play').length, 1);
  assert.equal((await f.call('play_prepared_speech', { ...play, playback_id: randomUUID() })).isError, true); assert.equal(f.requests.length, 1);
});

test('network failure leaves uncertain intent; retry with any request id cannot generate again', async t => {
  const f = await fixture(t), host = await f.pair(); f.responseMode = 'drop';
  const args = { request_id: randomUUID(), target: host, text: 'Network-loss preparation.' };
  const result = decode(await f.call('prepare_speech', args)); assert.equal(result.status, 'uncertain'); assert.equal(f.requests.length, 1);
  f.responseMode = 'ready'; const duplicate = decode(await f.call('prepare_speech', { ...args, request_id: randomUUID() }));
  assert.equal(duplicate.status, 'uncertain'); assert.equal(f.requests.length, 1);
  const query = decode(await f.call('get_prepared_speech', { request_id: args.request_id })); assert.equal(query.audio_id, result.audio_id); assert.equal(query.status, 'uncertain');
});

test('Stop and receipt refresh target one original command without another synthesis or unrelated playback', async t => {
  const f = await fixture(t), first = await f.pair(), firstSocket = f.ws;
  const prepared = decode(await f.call('prepare_speech', { request_id: randomUUID(), target: first, text: 'Window scoped Stop.' }));
  const second = await f.pair(), secondSocket = f.ws;
  const commands = [];
  for (const host of [first, second]) {
    const args = { audio_id: prepared.audio_id, target: host, command_id: randomUUID(), playback_id: randomUUID() };
    await f.call('play_prepared_speech', args); await until(() => f.frames.some(row => row.commandId === args.command_id));
    const command = f.frames.find(row => row.commandId === args.command_id); commands.push(command);
    const ws = host === first ? firstSocket : secondSocket; f.receipt(command, 1, 'accepted', ws); f.receipt(command, 2, 'started', ws);
  }
  await f.call('stop_speech', { command_id: commands[0].commandId });
  await until(() => f.frames.some(row => row.type === 'prometheus.audio.stop'));
  const stop = f.frames.find(row => row.type === 'prometheus.audio.stop'); assert.deepEqual(stop.target, first); assert.equal(stop.commandId, commands[0].commandId);
  f.receipt(commands[0], 3, 'interrupted', firstSocket); await f.call('get_speech_playback', { command_id: commands[0].commandId, refresh: true });
  await until(() => f.frames.some(row => row.type === 'prometheus.audio.query'));
  for (const [idx, state] of ['accepted', 'started', 'interrupted'].entries()) f.receipt(commands[0], idx + 1, state, firstSocket);
  const original = decode(await f.call('get_speech_playback', { command_id: commands[0].commandId }));
  assert.equal(original.status, 'interrupted'); assert.equal(original.receipts.length, 3);
  const other = decode(await f.call('get_speech_playback', { command_id: commands[1].commandId })); assert.equal(other.status, 'started');
  assert.equal(f.requests.length, 1); assert.equal(f.frames.filter(row => row.type === 'prometheus.audio.play').length, 2);
});

test('MCP cancellation aborts the original HTTP request and identical content remains uncertain', async t => {
  const f = await fixture(t), host = await f.pair(); f.responseMode = 'hold'; const controller = new AbortController();
  const args = { request_id: randomUUID(), target: host, text: 'Interrupted preparation.' };
  const pending = f.call('prepare_speech', args, { signal: controller.signal }); pending.catch(() => {});
  await until(() => f.requests.length === 1);
  assert.equal(decode(await f.call('prepare_speech', { ...args, request_id: randomUUID() })).status, 'pending');
  controller.abort(); await assert.rejects(pending); await until(() => f.heldClosed);
  let status;
  for (let i = 0; i < 100; i++) { status = decode(await f.call('get_prepared_speech', { request_id: args.request_id })); if (status.status === 'uncertain') break; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(status.status, 'uncertain'); f.responseMode = 'ready';
  assert.equal(decode(await f.call('prepare_speech', { ...args, request_id: randomUUID() })).status, 'uncertain'); assert.equal(f.requests.length, 1);
});

test('closing stdio aborts an in-flight request and restart preserves its uncertain intent', async t => {
  const f = await fixture(t), host = await f.pair(); f.responseMode = 'hold';
  const args = { request_id: randomUUID(), target: host, text: 'Shutdown during preparation.' };
  const pending = f.call('prepare_speech', args).then(value => ({ value }), error => ({ error })); await until(() => f.requests.length === 1);
  const port = Number(new URL(f.url).port); await f.client.close(); const outcome = await pending;
  if (outcome.value) { assert.equal(outcome.value.isError, true); assert.equal(decode(outcome.value).status, 'uncertain'); }
  else assert.ok(outcome.error);
  await until(() => f.heldClosed);
  await f.start(port); const original = decode(await f.call('get_prepared_speech', { request_id: args.request_id })); assert.equal(original.status, 'uncertain');
  const fresh = await f.pair(); f.responseMode = 'ready';
  assert.equal(decode(await f.call('prepare_speech', { ...args, target: fresh, request_id: randomUUID() })).status, 'uncertain'); assert.equal(f.requests.length, 1);
});

test('actual stdio restart recovers cached audio and original history but never replays a cold target', async t => {
  const f = await fixture(t), host = await f.pair(), request = { request_id: randomUUID(), target: host, text: 'Cold process recovery.' };
  const prepared = decode(await f.call('prepare_speech', request));
  const play = { audio_id: prepared.audio_id, target: host, command_id: randomUUID(), playback_id: randomUUID() };
  await f.call('play_prepared_speech', play); await until(() => f.frames.length === 1); const command = f.frames[0];
  f.receipt(command, 1, 'accepted'); f.receipt(command, 2, 'started');
  let before; for (let n = 0; n < 100; n++) { before = decode(await f.call('get_speech_playback', { command_id: play.command_id })); if (before.status === 'started') break; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(before.status, 'started'); const port = Number(new URL(f.url).port), old = f.clients.at(-1); await old.client.close();
  await until(() => f.ws.readyState === WebSocket.CLOSED); await f.start(port);
  assert.deepEqual(decode(await f.call('list_audio_hosts')).hosts, []);
  const restored = decode(await f.call('get_prepared_speech', { request_id: request.request_id })); assert.equal(restored.status, 'ready'); assert.equal(restored.audio_id, prepared.audio_id);
  const history = decode(await f.call('get_speech_playback', { command_id: play.command_id })); assert.equal(history.status, 'unknown'); assert.deepEqual(history.receipts, before.receipts);
  assert.equal(decode(await f.call('play_prepared_speech', play)).status, 'unknown'); assert.equal(f.frames.length, 1);
  const fresh = await f.pair(); await f.call('play_prepared_speech', { ...play, target: fresh, command_id: randomUUID(), playback_id: randomUUID() });
  await until(() => f.frames.length === 2); assert.deepEqual(f.frames[1].target, fresh); assert.equal(f.frames[1].audio.data, command.audio.data);
  assert.equal(f.requests.length, 1);
});

test('changed current voice rejects retained audio before a new delivery is recorded', async t => {
  const f = await fixture(t), first = await f.pair();
  const prepared = decode(await f.call('prepare_speech', { request_id: randomUUID(), target: first, text: 'Exact current voice.' }));
  const changed = await f.pair(target(), { kind: 'builtin', voiceId: 'saturn_zh_female_keainvsheng_tob' }), commandId = randomUUID();
  const result = await f.call('play_prepared_speech', { audio_id: prepared.audio_id, target: changed, command_id: commandId, playback_id: randomUUID() });
  assert.equal(result.isError, true); assert.equal(decode(result).error, 'preparation_scope_mismatch');
  assert.equal(decode(await f.call('get_speech_playback', { command_id: commandId })).error, 'unknown_command'); assert.equal(f.frames.length, 0); assert.equal(f.requests.length, 1);
});

for (const mode of ['redirect', 'large']) test(`speech ${mode} response is rejected without retry or redirect`, async t => {
  const f = await fixture(t), host = await f.pair(); f.responseMode = mode;
  const args = { request_id: randomUUID(), target: host, text: 'Rejected response ' + mode };
  assert.equal(decode(await f.call('prepare_speech', args)).status, 'uncertain'); assert.equal(f.requests.length, 1);
  assert.equal(decode(await f.call('prepare_speech', args)).created, false); assert.equal(f.requests.length, 1);
});

test('a different agent principal cannot query, stop or reuse another principal delivery', async t => {
  const f = await fixture(t), host = await f.pair(), request = { request_id: randomUUID(), target: host, text: 'Principal-owned speech.' };
  const prepared = decode(await f.call('prepare_speech', request)), play = { audio_id: prepared.audio_id, target: host, command_id: randomUUID(), playback_id: randomUUID() };
  await f.call('play_prepared_speech', play); const port = Number(new URL(f.url).port); await f.client.close();
  await f.start(port, 'pak_other_principal');
  for (const [name, args] of [['get_prepared_speech', { request_id: request.request_id }], ['get_speech_playback', { command_id: play.command_id }],
    ['stop_speech', { command_id: play.command_id }], ['play_prepared_speech', play]]) {
    const result = await f.call(name, args); assert.equal(result.isError, true); assert.equal(decode(result).error, 'preparation_scope_mismatch');
  }
  assert.equal(f.requests.length, 1);
});

test('a fabricated completion without accepted/started cannot become playback success', async t => {
  const f = await fixture(t), host = await f.pair();
  const prepared = decode(await f.call('prepare_speech', { request_id: randomUUID(), target: host, text: 'Receipt ordering.' }));
  const play = { audio_id: prepared.audio_id, target: host, command_id: randomUUID(), playback_id: randomUUID() };
  await f.call('play_prepared_speech', play); await until(() => f.frames.length === 1); f.receipt(f.frames[0], 1, 'completed');
  let listing; for (let n = 0; n < 100; n++) { listing = decode(await f.call('list_audio_hosts')); if (listing.error) break; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(listing.error, 'receipt_not_recorded');
  const row = decode(await f.call('get_speech_playback', { command_id: play.command_id })); assert.deepEqual(row.receipts, []); assert.notEqual(row.status, 'completed');
  await f.call('stop_speech', { command_id: play.command_id }); await until(() => f.frames.some(row => row.type === 'prometheus.audio.stop'));
  assert.equal((await f.call('prepare_speech', { request_id: randomUUID(), target: host, text: 'Must not generate.' })).isError, true); assert.equal(f.requests.length, 1);
});

after(() => {
  if (process.env.PROMETHEUS_AUDIO_STDIO_EVIDENCE_PATH) fs.writeFileSync(process.env.PROMETHEUS_AUDIO_STDIO_EVIDENCE_PATH,
    JSON.stringify({ records, providerCalls: 0, boundary: 'Actual MCP stdio, local HTTP, native WS and storage. Controlled speech responses and host receipts; physical player not exercised here.' }, null, 2), { flag: 'wx' });
});
