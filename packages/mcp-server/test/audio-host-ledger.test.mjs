import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { LocalAudioHostTransport } from '../.test-host/audio-host-transport.js';
import { AudioHostLedger } from '../.test-host/audio-host-ledger.js';

const roots = [], cleanups = [], crashProcesses = [];
const target = () => ({ accountId: 'controlled-account', avatarId: 'retained-avatar', hostSessionId: randomUUID(), selectionId: randomUUID() });
const command = () => ({ target: target(), commandId: randomUUID(), playbackId: randomUUID(), audioId: randomUUID(), audioSha256: 'a'.repeat(64) });
const receipt = (c, sequence, status) => ({ version: 1, type: 'prometheus.audio.receipt', target: c.target,
  commandId: c.commandId, playbackId: c.playbackId, audioSha256: c.audioSha256, sequence, status, at: sequence * 100 });
async function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-ledger-')); roots.push(directory);
  let transport = new LocalAudioHostTransport({ port: 0, allowedOrigin: 'http://127.0.0.1:3000', pairingKey: randomBytes(32).toString('base64url'), onFrame() {} });
  await transport.start(); let ledger = new AudioHostLedger({ directory, transport, ...options });
  t.after(async () => { ledger.close(); await transport.close(); cleanups.push(transport.state()); });
  return { directory, get ledger() { return ledger; }, get transport() { return transport; },
    restart: async () => {
      const port = Number(new URL(transport.url).port); ledger.close(); await transport.close(); cleanups.push(transport.state());
      transport = new LocalAudioHostTransport({ port, allowedOrigin: 'http://127.0.0.1:3000', pairingKey: randomBytes(32).toString('base64url'), onFrame() {} });
      await transport.start(); ledger = new AudioHostLedger({ directory, transport, ...options });
    } };
}
test('durable delivery reservation deduplicates exact identities and rejects conflicts', async t => {
  const f = await setup(t), c = command();
  assert.equal(f.ledger.reserve(c).created, true); assert.equal(f.ledger.reserve(c).created, false);
  assert.throws(() => f.ledger.reserve({ ...c, audioId: randomUUID() }), /command_conflict/);
  assert.throws(() => f.ledger.reserve({ ...c, commandId: randomUUID() }), /playback_conflict/);
  assert.equal(f.ledger.get(c.commandId).status, 'delivery_pending');
  const files = fs.readdirSync(f.ledger.directory).filter(p => p.endsWith('.json'));
  assert.equal(files.length, 1); assert.equal(fs.statSync(path.join(f.ledger.directory, files[0])).mode & 0o777, 0o600);
});
test('original receipt order persists and repeated frames remain unchanged', async t => {
  const f = await setup(t), c = command(); f.ledger.reserve(c); f.ledger.markSent(c.commandId);
  const frames = [receipt(c, 1, 'accepted'), receipt(c, 2, 'started'), receipt(c, 3, 'completed')];
  for (const frame of frames) assert.equal(f.ledger.accept(c.target, frame), true);
  assert.equal(f.ledger.accept(c.target, { ...frames[1] }), false);
  await f.restart(); const row = f.ledger.get(c.commandId);
  assert.equal(row.status, 'completed'); assert.deepEqual(row.receipts, frames); assert.equal(f.ledger.reserve(c).created, false);
});
test('unknown, cross-target, skipped and contradictory receipts cannot change the ledger', async t => {
  const f = await setup(t), c = command(); f.ledger.reserve(c);
  assert.throws(() => f.ledger.accept(c.target, receipt(command(), 1, 'accepted')), /unknown_command/);
  assert.throws(() => f.ledger.accept({ ...c.target, selectionId: randomUUID() }, receipt(c, 1, 'accepted')), /invalid_host_frame/);
  assert.throws(() => f.ledger.accept(c.target, receipt(c, 1, 'completed')), /receipt_order/);
  f.ledger.accept(c.target, receipt(c, 1, 'accepted'));
  assert.throws(() => f.ledger.accept(c.target, receipt(c, 2, 'completed')), /receipt_order/);
  assert.throws(() => f.ledger.accept(c.target, { ...receipt(c, 1, 'accepted'), at: 101 }), /receipt_conflict/);
  assert.throws(() => f.ledger.accept(c.target, { ...receipt(c, 2, 'started'), audioSha256: 'b'.repeat(64) }), /receipt_conflict/);
  assert.equal(f.ledger.get(c.commandId).receipts.length, 1);
});
test('interruption or failure before native start does not invent a started receipt', async t => {
  const f = await setup(t);
  for (const status of ['interrupted', 'failed']) {
    const c = command(); f.ledger.reserve(c); f.ledger.accept(c.target, receipt(c, 1, 'accepted'));
    f.ledger.accept(c.target, receipt(c, 2, status)); assert.equal(f.ledger.get(c.commandId).status, status);
    assert.throws(() => f.ledger.accept(c.target, receipt(c, 3, 'started')), /receipt_order/);
  }
});
test('paired rejection is preserved separately from physical playback receipts', async t => {
  const f = await setup(t), c = command(); f.ledger.reserve(c);
  const refused = { version: 1, type: 'prometheus.audio.rejected', target: c.target, commandId: c.commandId, playbackId: c.playbackId, code: 'audio_hash_mismatch' };
  assert.equal(f.ledger.accept(c.target, refused), true); assert.equal(f.ledger.accept(c.target, refused), false);
  const row = f.ledger.get(c.commandId); assert.equal(row.status, 'rejected'); assert.deepEqual(row.receipts, []); assert.deepEqual(row.rejection, refused);
  assert.throws(() => f.ledger.accept(c.target, receipt(c, 1, 'accepted')), /receipt_order/); await f.restart(); assert.equal(f.ledger.get(c.commandId).status, 'rejected');
});
test('socket loss and cold restart preserve unknown terminal state and all original receipts', async t => {
  const f = await setup(t), c = command(); f.ledger.reserve(c); f.ledger.markSent(c.commandId);
  f.ledger.accept(c.target, receipt(c, 1, 'accepted')); f.ledger.accept(c.target, receipt(c, 2, 'started'));
  f.ledger.disconnected(c.target); assert.equal(f.ledger.get(c.commandId).status, 'unknown');
  await f.restart(); const row = f.ledger.get(c.commandId); assert.equal(row.status, 'unknown'); assert.equal(row.receipts.length, 2);
  assert.equal(f.ledger.reserve(c).created, false); assert.equal(f.ledger.get(c.commandId).status, 'unknown');
});
test('cold reservation without any receipt is unknown and cannot become a fresh command', async t => {
  const f = await setup(t), c = command(); f.ledger.reserve(c); await f.restart();
  assert.equal(f.ledger.get(c.commandId).status, 'unknown'); assert.equal(f.ledger.reserve(c).created, false);
});
test('terminal result wins over disconnect and later send bookkeeping', async t => {
  const f = await setup(t), c = command(); f.ledger.reserve(c);
  for (const [i, s] of ['accepted', 'started', 'completed'].entries()) f.ledger.accept(c.target, receipt(c, i + 1, s));
  f.ledger.disconnected(c.target); f.ledger.markSent(c.commandId); assert.equal(f.ledger.get(c.commandId).status, 'completed');
});
test('returned copies cannot mutate stored identities or raw receipt history', async t => {
  const f = await setup(t), c = command(); f.ledger.reserve(c); f.ledger.accept(c.target, receipt(c, 1, 'accepted'));
  const row = f.ledger.get(c.commandId); row.command.target.accountId = 'changed'; row.receipts[0].status = 'completed';
  assert.equal(f.ledger.get(c.commandId).command.target.accountId, c.target.accountId); assert.equal(f.ledger.get(c.commandId).receipts[0].status, 'accepted');
});
test('capacity preserves old commands and rejects new commands without evicting history', async t => {
  const f = await setup(t, { capacity: 1 }), c = command(); f.ledger.reserve(c);
  assert.throws(() => f.ledger.reserve(command()), /ledger_capacity/); await f.restart();
  assert.equal(f.ledger.reserve(c).created, false); assert.throws(() => f.ledger.reserve(command()), /ledger_capacity/);
});
test('exclusive loopback listener and in-process ledger ownership prevent concurrent writers', async t => {
  const f = await setup(t); assert.throws(() => new AudioHostLedger({ directory: f.directory, transport: f.transport }), /ledger_in_use/);
  const other = new LocalAudioHostTransport({ port: Number(new URL(f.transport.url).port), allowedOrigin: 'http://127.0.0.1:3000', pairingKey: randomBytes(32).toString('base64url'), onFrame() {} });
  await assert.rejects(other.start(), /EADDRINUSE/); await other.close();
});
test('corrupt persistent data fails closed and remains intact', async t => {
  const f = await setup(t), c = command(); f.ledger.reserve(c); const dir = f.ledger.directory;
  f.ledger.close(); const file = path.join(dir, `delivery-${c.commandId}.json`); fs.writeFileSync(file, '{truncated');
  assert.throws(() => new AudioHostLedger({ directory: f.directory, transport: f.transport }), /ledger_corrupt/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{truncated');
});
test('storage failure cannot publish a new in-memory command or allow further delivery writes', async t => {
  const f = await setup(t), c = command(), moved = f.ledger.directory + '-offline';
  fs.renameSync(f.ledger.directory, moved);
  assert.throws(() => f.ledger.reserve(c), /ledger_storage/); assert.throws(() => f.ledger.reserve(command()), /ledger_storage/);
  assert.throws(() => f.ledger.get(c.commandId), /unknown_command/); fs.renameSync(moved, f.ledger.directory);
});
for (const kind of ['receipt', 'false', 'null']) test(`persisted rejection refuses ${kind} masquerading as a rejection frame`, async t => {
  const f = await setup(t), c = command(); f.ledger.reserve(c);
  const file = path.join(f.ledger.directory, `delivery-${c.commandId}.json`), row = JSON.parse(fs.readFileSync(file, 'utf8'));
  f.ledger.close(); row.rejection = kind === 'receipt' ? receipt(c, 1, 'accepted') : kind === 'false' ? false : null;
  fs.writeFileSync(file, JSON.stringify(row)); let loaded;
  try { assert.throws(() => { loaded = new AudioHostLedger({ directory: f.directory, transport: f.transport }); }, /ledger_corrupt/); }
  finally { loaded?.close(); }
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), row);
});
test('an actual killed process recovers exact receipts as unknown without another reservation', { timeout: 15000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-ledger-crash-')); roots.push(directory);
  const c = command(), children = [];
  t.after(async () => { for (const item of children) { if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill('SIGKILL'); await item.exited; item.lines.close(); } });
  const launch = async (mode, port) => {
    const input = path.join(directory, mode + '.json'); fs.writeFileSync(input, JSON.stringify({ mode, directory, command: c, port }), { flag: 'wx', mode: 0o600 });
    const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/audio-host-ledger-process.mjs', import.meta.url)), input], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const lines = readline.createInterface({ input: child.stdout }), item = { child, exited, lines }; children.push(item);
    child.stderr.on('data', () => {});
    const line = await Promise.race([new Promise((resolve, reject) => { lines.once('line', resolve); child.once('error', reject); }), exited.then(value => { throw Error('Fixture ended before ready: ' + JSON.stringify(value)); })]);
    return { ...item, first: JSON.parse(line) };
  };
  const before = await launch('record'); assert.equal(before.first.created, true); assert.equal(before.first.row.status, 'started');
  const recordFile = path.join(before.first.directory, `delivery-${c.commandId}.json`), original = fs.readFileSync(recordFile);
  before.child.kill('SIGKILL'); assert.deepEqual(await before.exited, { code: null, signal: 'SIGKILL' });
  const after = await launch('recover', before.first.port); assert.equal(after.first.created, false); assert.equal(after.first.row.status, 'unknown');
  assert.deepEqual(after.first.row.receipts, before.first.row.receipts); assert.deepEqual(fs.readFileSync(recordFile), original);
  const cleanup = new Promise(resolve => after.lines.once('line', line => resolve(JSON.parse(line).cleanup)));
  after.child.stdin.end('{"action":"close"}\n'); assert.deepEqual(await after.exited, { code: 0, signal: null }); cleanups.push(await cleanup);
  crashProcesses.push({ originalPid: before.first.pid, recoveredPid: after.first.pid, originalKilled: true, reboundSamePort: after.first.port === before.first.port,
    originalReceiptsUnchanged: true, duplicateCreated: after.first.created, recoveredStatus: after.first.row.status, recoveredClosed: true });
});
test.after(() => {
  assert.ok(cleanups.every(s => !s.listening && !s.clients && !s.hosts && !s.authTimers));
  const evidence = process.env.PROMETHEUS_AUDIO_LEDGER_EVIDENCE_PATH;
  if (evidence) fs.writeFileSync(evidence, JSON.stringify({ roots, cleanups, crashProcesses, realProviderCalls: 0 }, null, 2) + '\n', { flag: 'wx' });
});
