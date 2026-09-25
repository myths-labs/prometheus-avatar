import fs from 'node:fs';
import readline from 'node:readline';
import { randomBytes } from 'node:crypto';
import { LocalAudioHostTransport } from '../../.test-host/audio-host-transport.js';
import { AudioHostLedger } from '../../.test-host/audio-host-ledger.js';

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!['record', 'recover'].includes(input.mode)) throw Error('Invalid fixture operation');
const transport = new LocalAudioHostTransport({ port: input.port ?? 0, allowedOrigin: 'http://127.0.0.1:3000',
  pairingKey: randomBytes(32).toString('base64url'), onFrame() {} });
await transport.start();
const ledger = new AudioHostLedger({ directory: input.directory, transport });
const reserved = ledger.reserve(input.command);
if (input.mode === 'record') {
  ledger.markSent(input.command.commandId);
  for (const [i, status] of ['accepted', 'started'].entries()) ledger.accept(input.command.target, {
    version: 1, type: 'prometheus.audio.receipt', target: input.command.target,
    commandId: input.command.commandId, playbackId: input.command.playbackId,
    audioSha256: input.command.audioSha256, sequence: i + 1, status, at: 100 + i,
  });
}
console.log(JSON.stringify({ pid: process.pid, port: Number(new URL(transport.url).port), created: reserved.created,
  directory: ledger.directory, row: ledger.get(input.command.commandId) }));
const commands = readline.createInterface({ input: process.stdin });
try {
  for await (const line of commands) { if (JSON.parse(line).action !== 'close') throw Error('Unknown fixture command'); break; }
} finally {
  commands.close(); ledger.close(); await transport.close();
  console.log(JSON.stringify({ cleanup: transport.state() }));
}
