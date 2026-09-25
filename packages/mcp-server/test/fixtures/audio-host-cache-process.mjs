import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import { LocalAudioHostTransport } from '../../.test-host/audio-host-transport.js';
import { AudioHostCache } from '../../.test-host/audio-host-cache.js';

const [mode, directory, port, encoded] = process.argv.slice(2), input = JSON.parse(encoded);
const transport = new LocalAudioHostTransport({ port: Number(port), allowedOrigin: 'http://127.0.0.1:54883', pairingKey: 'controlled_process_pairing_key_not_for_production' });
await transport.start(); const cache = new AudioHostCache({ directory, transport });
const reserved = cache.reserve(input), filename = path.join(cache.directory, `audio-${reserved.row.audioId}.json`);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = () => ({ mode, pid: process.pid, port: Number(new URL(transport.url).port), directory: cache.directory,
  created: reserved.created, row: reserved.row, manifestSha256: hash(filename) });
if (mode === 'torn') {
  const original = fs.renameSync;
  fs.renameSync = function (source, destination) {
    if (destination === filename) { fs.writeSync(1, JSON.stringify({ ...report(), phase: 'body_fsynced_before_ready_manifest' }) + '\n'); process.kill(process.pid, 'SIGKILL'); }
    return original.call(fs, source, destination);
  };
  const bytes = Buffer.alloc(48); bytes.write('RIFF'); bytes.writeUInt32LE(40, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(4, 40); bytes.writeInt16LE(2400, 44);
  cache.complete(reserved.row.audioId, { audio: bytes.toString('base64'), mimeType: 'audio/wav', engine: 'volcengine-v3',
    voice: null, voiceAssetId: null, builtinVoiceId: input.scope.voice.voiceId, textLength: input.text.trim().length });
  throw Error('Fault injection did not terminate at the metadata publication boundary.');
} else if (mode === 'recover') {
  const alias = cache.reserve({ ...input, requestId: randomUUID() });
  console.log(JSON.stringify({ ...report(), aliasCreated: alias.created, aliasAudioId: alias.row.audioId }));
} else console.log(JSON.stringify(report()));
for await (const command of readline.createInterface({ input: process.stdin })) {
  if (command !== 'close') throw Error('Unknown fixture command');
  cache.close(); await transport.close(); console.log(JSON.stringify({ closed: true, cleanup: transport.state() })); break;
}
