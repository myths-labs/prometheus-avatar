import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LocalAudioHostTransport } from '../.test-host/audio-host-transport.js';
import { AudioHostCache } from '../.test-host/audio-host-cache.js';

const roots = [], cleanup = [], crashProcesses = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const scope = () => ({ principal: hash('controlled-agent-principal'), accountId: 'controlled-account', avatarId: 'retained-avatar',
  voice: { kind: 'builtin', voiceId: 'saturn_zh_female_tiexinnvyou_tob' } });
const input = () => ({ requestId: randomUUID(), scope: scope(), text: 'Retained speech.' });
function response(i, extra = {}) {
  const bytes = Buffer.alloc(48); bytes.write('RIFF'); bytes.writeUInt32LE(40, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(4, 40); bytes.writeInt16LE(2400, 44);
  return { audio: bytes.toString('base64'), mimeType: 'audio/wav', engine: 'volcengine-v3', voice: null,
    voiceAssetId: null, builtinVoiceId: i.scope.voice.voiceId, textLength: i.text.trim().length, ...extra };
}
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-audio-cache-')); roots.push(root);
  const transport = new LocalAudioHostTransport({ port: 0, allowedOrigin: 'http://127.0.0.1:54883', pairingKey: randomBytes(32).toString('base64url') });
  await transport.start(); const f = { root, transport, cache: new AudioHostCache({ directory: root, transport, ...options }) };
  f.reopen = () => { f.cache.close(); f.cache = new AudioHostCache({ directory: root, transport, ...options }); };
  t.after(async () => { f.cache.close(); await transport.close(); cleanup.push(transport.state()); }); return f;
}

test('intent is durable before synthesis, and duplicate ids or content never create a second intent', async t => {
  const f = await fixture(t), i = input(), a = f.cache.reserve(i);
  assert.equal(a.created, true); assert.equal(a.row.status, 'pending');
  const saved = JSON.parse(fs.readFileSync(path.join(f.cache.directory, `audio-${a.row.audioId}.json`)));
  assert.equal(saved.requestId, i.requestId); assert.equal(saved.state, 'pending');
  assert.equal(JSON.stringify(saved).includes(i.text), false);
  assert.equal(f.cache.reserve(i).created, false);
  const alias = { ...i, requestId: randomUUID() };
  assert.equal(f.cache.reserve(alias).row.audioId, a.row.audioId);
  assert.throws(() => f.cache.reserve({ ...i, text: 'Different intent.' }), /preparation_conflict/);
  assert.throws(() => f.cache.reserve({ ...alias, text: 'Changed alias.' }), /preparation_conflict/);
  f.reopen(); assert.equal(f.cache.reserve(i).row.status, 'uncertain'); assert.equal(f.cache.reserve(alias).created, false);
});

test('ready bytes and original voice acknowledgment survive reopen without generation', async t => {
  const f = await fixture(t), i = input(), a = f.cache.reserve(i), original = response(i);
  f.cache.complete(a.row.audioId, original); const before = f.cache.get(a.row.audioId, i.scope);
  assert.equal(before.status, 'ready'); assert.equal(before.audio.sha256, hash(Buffer.from(original.audio, 'base64')));
  f.reopen(); assert.deepEqual(f.cache.get(a.row.audioId, i.scope), before);
  assert.deepEqual(f.cache.read(a.row.audioId, i.scope), { data: original.audio, mimeType: original.mimeType, sha256: before.audio.sha256 });
  assert.equal(f.cache.reserve({ ...i, requestId: randomUUID() }).created, false);
  assert.deepEqual(f.cache.request(i.requestId, i.scope.principal), before);
  assert.throws(() => f.cache.request(i.requestId, hash('another principal')), /preparation_scope_mismatch/);
});

test('original retained MCP MP3 and voice WAV persist byte-for-byte with no synthesis', {
  skip: (!process.env.FORGE_DELIVERED_MCP_REPLAY_PATH || !process.env.FORGE_RETAINED_WAV_PATH) && 'Requires the explicitly selected retained source files.',
}, async t => {
  const f = await fixture(t), envelope = JSON.parse(fs.readFileSync(process.env.FORGE_DELIVERED_MCP_REPLAY_PATH));
  const mp3 = envelope.exchanges[0].mcpResult.content.find(row => row.type === 'audio');
  assert.equal(hash(Buffer.from(mp3.data, 'base64')), '0317eefa8584cb8a080aaecc636872c2a72d7751d6956bf6f699d9c03a6bc485');
  const wav = fs.readFileSync(process.env.FORGE_RETAINED_WAV_PATH);
  assert.equal(hash(wav), '8de8f93676737c868f6a9d9b119357ef4a26302a9933d79363d95c614023ecdc');
  for (const audio of [mp3, { data: wav.toString('base64'), mimeType: 'audio/wav' }]) {
    const i = { ...input(), text: `Retained source storage test for ${audio.mimeType}` }, a = f.cache.reserve(i);
    f.cache.complete(a.row.audioId, response(i, { audio: audio.data, mimeType: audio.mimeType })); f.reopen();
    assert.equal(f.cache.read(a.row.audioId, i.scope).data, audio.data);
    assert.equal(f.cache.reserve({ ...i, requestId: randomUUID() }).row.audioId, a.row.audioId);
  }
});

test('changed principal, account, Avatar or voice cannot read a retained audio reference', async t => {
  const f = await fixture(t), i = input(), a = f.cache.reserve(i); f.cache.complete(a.row.audioId, response(i));
  for (const change of [{ principal: hash('other agent') }, { accountId: 'other-account' }, { avatarId: 'other-avatar' },
    { voice: { kind: 'builtin', voiceId: 'saturn_zh_female_keainvsheng_tob' } }]) {
    const changed = { ...i.scope, ...change };
    assert.throws(() => f.cache.read(a.row.audioId, changed), /preparation_scope_mismatch/);
    assert.throws(() => f.cache.get(a.row.audioId, changed), /preparation_scope_mismatch/);
  }
});

test('uncertain provider outcomes cannot be rearmed by a new request id or cache reopen', async t => {
  const f = await fixture(t), i = input(), a = f.cache.reserve(i); f.cache.uncertain(a.row.audioId);
  for (const reopen of [false, true]) {
    if (reopen) f.reopen(); const duplicate = f.cache.reserve({ ...i, requestId: randomUUID() });
    assert.equal(duplicate.created, false); assert.equal(duplicate.row.status, 'uncertain');
    assert.throws(() => f.cache.complete(a.row.audioId, response(i)), /preparation_not_pending/);
  }
});

test('wrong voice acknowledgment, malformed audio and text length cannot become playable', async t => {
  const f = await fixture(t);
  for (const extra of [{ builtinVoiceId: 'saturn_zh_female_keainvsheng_tob' }, { voiceAssetId: randomUUID() },
    { engine: 'gemini' }, { textLength: 2 }, { audio: 'not-base64' }, { mimeType: 'audio/unknown' },
    { privateSpeakerId: 'S_private' }]) {
    const i = { ...input(), text: `Retained speech ${randomUUID()}` }, a = f.cache.reserve(i);
    assert.throws(() => f.cache.complete(a.row.audioId, response(i, extra)));
    assert.throws(() => f.cache.read(a.row.audioId, i.scope), /preparation_not_ready/); f.cache.uncertain(a.row.audioId);
  }
});

test('row and byte budgets reject before another intent and preserve all previous data', async t => {
  const f = await fixture(t, { capacity: 1, maxAudioBytes: 128, maxBytes: 256 }), i = input(), a = f.cache.reserve(i);
  assert.throws(() => f.cache.reserve({ ...input(), text: 'different' }), /cache_capacity/);
  f.cache.complete(a.row.audioId, response(i)); f.reopen(); assert.equal(f.cache.get(a.row.audioId, i.scope).status, 'ready');
  const g = await fixture(t, { maxAudioBytes: 128, maxBytes: 128 }); g.cache.reserve(i);
  assert.throws(() => g.cache.reserve({ ...input(), text: 'different' }), /cache_byte_capacity/);
});

test('returned metadata cannot mutate stored source identity or manifest', async t => {
  const f = await fixture(t), i = input(), a = f.cache.reserve(i); f.cache.complete(a.row.audioId, response(i));
  const row = f.cache.get(a.row.audioId, i.scope); row.scope.voice.voiceId = 'changed'; row.audio.sha256 = 'b'.repeat(64);
  assert.equal(f.cache.get(a.row.audioId, i.scope).scope.voice.voiceId, i.scope.voice.voiceId);
  assert.notEqual(f.cache.get(a.row.audioId, i.scope).audio.sha256, row.audio.sha256);
});

test('corrupted cached bytes are rejected both before reuse and at startup without replacing originals', async t => {
  const f = await fixture(t), i = input(), a = f.cache.reserve(i); f.cache.complete(a.row.audioId, response(i));
  const file = path.join(f.cache.directory, `audio-${a.row.audioId}.bin`), changed = fs.readFileSync(file); changed[44] ^= 1; fs.writeFileSync(file, changed);
  assert.throws(() => f.cache.read(a.row.audioId, i.scope), /cache_corrupt/);
  assert.throws(() => f.reopen(), /cache_corrupt/); assert.deepEqual(fs.readFileSync(file), changed);
});

test('private filesystem permissions and a unique active listener lease are required', async t => {
  const f = await fixture(t); assert.throws(() => new AudioHostCache({ directory: f.root, transport: f.transport }), /cache_in_use/);
  f.cache.close(); fs.chmodSync(f.cache.directory, 0o755);
  assert.throws(() => new AudioHostCache({ directory: f.root, transport: f.transport }), /cache_storage_not_private/);
});

test('legacy and saved asset preparation keep exact endpoint acknowledgment', async t => {
  const f = await fixture(t);
  for (const voice of [{ kind: 'legacy', voice: 'Aoede' }, { kind: 'asset', assetId: randomUUID() }]) {
    const i = { ...input(), scope: { ...scope(), voice } }, a = f.cache.reserve(i);
    const original = response(i, { engine: voice.kind === 'legacy' ? 'gemini-tts-fixed' : 'volcengine-v3',
      voice: voice.kind === 'legacy' ? voice.voice : null, voiceAssetId: voice.kind === 'asset' ? voice.assetId : null, builtinVoiceId: undefined });
    f.cache.complete(a.row.audioId, original); f.reopen();
    assert.deepEqual(f.cache.get(a.row.audioId, i.scope).scope.voice, voice);
    assert.equal(f.cache.read(a.row.audioId, i.scope).data, original.audio);
  }
});

test('malformed ready/pending metadata and symlinked audio fail recovery without repair', async t => {
  for (const mutate of [row => { row.state = 'ready'; }, row => { row.audio = null; },
    row => { row.fingerprint = 'a'.repeat(64); }, row => { row.scope.voice.voiceId = 'S_private'; },
    row => { row.requestId = 'invalid'; }, row => { row.text = 'unrequested raw text'; }]) {
    const f = await fixture(t), i = input(), a = f.cache.reserve(i), file = path.join(f.cache.directory, `audio-${a.row.audioId}.json`);
    f.cache.close(); const original = JSON.parse(fs.readFileSync(file)); mutate(original); const changed = JSON.stringify(original); fs.writeFileSync(file, changed);
    assert.throws(() => f.reopen(), /cache_corrupt/); assert.equal(fs.readFileSync(file, 'utf8'), changed);
  }
  const f = await fixture(t), i = input(), a = f.cache.reserve(i); f.cache.complete(a.row.audioId, response(i));
  const file = path.join(f.cache.directory, `audio-${a.row.audioId}.bin`), moved = path.join(f.root, 'original-audio.bin');
  f.cache.close(); fs.renameSync(file, moved); fs.symlinkSync(moved, file);
  assert.throws(() => f.reopen(), /cache_corrupt/); assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
});

test('a directory fsync failure prevents a provider-authorizing success and recovers as uncertain', async t => {
  const f = await fixture(t), i = input(), original = fs.fsyncSync;
  fs.fsyncSync = function (fd) { if (fs.fstatSync(fd).isDirectory()) throw Error('controlled durability failure'); return original.call(fs, fd); };
  try { assert.throws(() => f.cache.reserve(i), /cache_storage/); } finally { fs.fsyncSync = original; }
  assert.throws(() => f.cache.reserve(i), /cache_storage/); f.reopen();
  const retained = f.cache.reserve(i); assert.equal(retained.created, false); assert.equal(retained.row.status, 'uncertain');
});

test('a post-response storage failure reports uncertainty while retaining the pending intent', async t => {
  const f = await fixture(t), i = input(), a = f.cache.reserve(i), original = fs.renameSync;
  fs.renameSync = () => { throw Error('controlled metadata publication failure'); };
  try { assert.throws(() => f.cache.complete(a.row.audioId, response(i)), /cache_storage/); } finally { fs.renameSync = original; }
  assert.throws(() => f.cache.uncertain(a.row.audioId), /cache_storage/);
  assert.equal(f.cache.request(i.requestId, i.scope.principal).status, 'uncertain'); f.reopen();
  assert.equal(f.cache.reserve(i).created, false); assert.equal(f.cache.request(i.requestId, i.scope.principal).status, 'uncertain');
});

for (const mode of ['pending', 'torn']) test(`killed ${mode} preparation preserves original intent across a new process and same-port rebind`, { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-cache-crash-')); roots.push(root); const children = [], i = input();
  const start = (mode, port) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/audio-host-cache-process.mjs', import.meta.url)), mode, root, String(port), JSON.stringify(i)], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(child, 'exit'), lines = readline.createInterface({ input: child.stdout }); let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    const h = { child, exited, lines, first: once(lines, 'line').then(([line]) => JSON.parse(line)), stderr: () => stderr }; children.push(h); return h;
  };
  t.after(async () => { for (const h of children) { if (h.child.exitCode === null && h.child.signalCode === null) h.child.kill('SIGKILL'); await h.exited; h.lines.close(); } });
  const first = start(mode, 0), before = await first.first;
  assert.equal(before.created, true); assert.equal(before.row.status, 'pending');
  if (mode === 'pending') first.child.kill('SIGKILL');
  assert.deepEqual(await first.exited, [null, 'SIGKILL']); assert.equal(first.stderr(), '');
  const second = start('recover', before.port), recovered = await second.first;
  assert.notEqual(recovered.pid, before.pid); assert.equal(recovered.created, false); assert.equal(recovered.aliasCreated, false);
  assert.equal(recovered.row.status, 'uncertain'); assert.equal(recovered.row.audioId, before.row.audioId);
  assert.equal(recovered.aliasAudioId, before.row.audioId); assert.equal(recovered.manifestSha256, before.manifestSha256);
  if (mode === 'torn') {
    assert.equal(before.phase, 'body_fsynced_before_ready_manifest');
    assert.equal(fs.statSync(path.join(recovered.directory, `audio-${before.row.audioId}.bin`)).size, 48);
    assert.ok(fs.readdirSync(recovered.directory).some(name => name.startsWith('.pending-meta-')));
  }
  const closed = once(second.lines, 'line'); second.child.stdin.end('close\n'); const result = JSON.parse((await closed)[0]);
  assert.deepEqual(await second.exited, [0, null]); assert.equal(result.closed, true); assert.ok(Object.values(result.cleanup).every(value => !value)); assert.equal(second.stderr(), '');
  crashProcesses.push({ mode, before, recovered, cleanup: result.cleanup, originalSignal: 'SIGKILL', recoveredExitCode: 0 });
});

after(() => {
  assert.ok(cleanup.every(row => Object.values(row).every(value => !value)));
  if (process.env.PROMETHEUS_AUDIO_CACHE_EVIDENCE_PATH) fs.writeFileSync(process.env.PROMETHEUS_AUDIO_CACHE_EVIDENCE_PATH,
    JSON.stringify({ roots, cleanup, crashProcesses, providerCalls: 0, boundary: 'Real local storage, writer lease and owned process crash/recovery; controlled synthesis responses.' }, null, 2), { flag: 'wx' });
});
