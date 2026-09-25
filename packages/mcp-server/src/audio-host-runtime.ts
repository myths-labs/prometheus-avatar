import path from 'node:path';
import { AudioHostCache } from './audio-host-cache.js';
import { AudioHostLedger, AudioHostLedgerError } from './audio-host-ledger.js';
import { LocalAudioHostTransport } from './audio-host-transport.js';
import { audioSpeechApi } from './audio-host-api.js';
import { sameWireTarget, wireTarget, type AudioHostTarget } from './audio-host-wire.js';
import { uuid, AudioHostCacheError } from './audio-host-preparation.js';

interface Options { origin: string; key: string; port: number; directory: string; apiBase: string; apiKey: string; version: string }
type Prepared = ReturnType<AudioHostCache['get']>;
function publicPrepared(row: Prepared) {
    return { audio_id: row.audioId, request_id: row.requestId, status: row.status,
        account_id: row.scope.accountId, avatar_id: row.scope.avatarId, voice: row.scope.voice,
        created_at: row.createdAt, ...(row.audio ? { audio: row.audio, response: row.response } : {}) };
}
const ended = (status: string) => ['completed', 'interrupted', 'failed', 'rejected'].includes(status);

export class AudioHostRuntime {
    private readonly transport: LocalAudioHostTransport;
    private readonly api: ReturnType<typeof audioSpeechApi>;
    private ledger?: AudioHostLedger;
    private cache?: AudioHostCache;
    private failure?: string;
    private closing?: Promise<void>;
    private readonly pending = new Map<AbortController, Promise<unknown>>();
    private constructor(options: Options) {
        this.api = audioSpeechApi(options.apiBase, options.apiKey, options.version);
        this.transport = new LocalAudioHostTransport({ port: options.port, allowedOrigin: options.origin, pairingKey: options.key,
            onFrame: (target, frame) => { try { this.ledger?.accept(target, frame); } catch { this.failure = 'receipt_not_recorded'; } },
            onDisconnect: target => { try { this.ledger?.disconnected(target); } catch { this.failure = 'disconnect_not_recorded'; } },
        });
    }
    static async start(options: Options) {
        const runtime = new AudioHostRuntime(options);
        try {
            await runtime.transport.start();
            runtime.ledger = new AudioHostLedger({ directory: path.join(options.directory, 'deliveries'), transport: runtime.transport });
            runtime.cache = new AudioHostCache({ directory: path.join(options.directory, 'audio'), transport: runtime.transport });
            return runtime;
        } catch (error) { await runtime.close(); throw error; }
    }
    hosts() { return { enabled: true, endpoint: this.transport.url, hosts: this.transport.hosts(), ...(this.failure ? { error: this.failure } : {}) }; }
    preparation(requestId: string) { return publicPrepared(this.cache!.request(requestId, this.api.principal)); }

    async prepare(requestId: string, target: unknown, text: string, signal: AbortSignal) {
        this.healthy(); this.api.requireKey(); if (signal.aborted) throw new AudioHostCacheError('cancelled');
        const peer = this.host(target), scope = this.scope(peer), reserved = this.cache!.reserve({ requestId, scope, text });
        if (!reserved.created) return { created: false, ...publicPrepared(reserved.row) };
        const controller = new AbortController(), abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        const work = (async () => {
            try {
                const response = await this.api.generate(text, scope.voice, controller.signal);
                this.cache!.complete(reserved.row.audioId, response);
                return { created: true, ...publicPrepared(this.cache!.get(reserved.row.audioId, scope)) };
            } catch {
                try { this.cache!.uncertain(reserved.row.audioId); } catch { /* Durable pending intent remains non-retryable on storage failure. */ }
                return { created: true, ...publicPrepared(this.cache!.get(reserved.row.audioId, scope)), error: 'preparation_outcome_uncertain' };
            }
        })();
        this.pending.set(controller, work);
        try { return await work; } finally { signal.removeEventListener('abort', abort); this.pending.delete(controller); }
    }

    async play(audioId: string, commandId: string, playbackId: string, target: unknown) {
        const current = wireTarget(target), command = uuid(commandId), playback = uuid(playbackId), audio = uuid(audioId);
        let original;
        try { original = this.ledger!.get(command); } catch (error) { if (!(error instanceof AudioHostLedgerError) || error.code !== 'unknown_command') throw error; }
        if (original) {
            this.cache!.reference(original.command.audioId, this.api.principal);
            return this.ledger!.reserve({ target: current, commandId: command, playbackId: playback, audioId: audio, audioSha256: original.command.audioSha256 }).row;
        }
        this.healthy(); const peer = this.host(current), bytes = this.cache!.read(audio, this.scope(peer));
        this.ledger!.reserve({ target: current, commandId: command, playbackId: playback, audioId: audio, audioSha256: bytes.sha256 });
        try {
            await this.transport.send(current.hostSessionId, { version: 1, type: 'prometheus.audio.play', target: current,
                commandId: command, playbackId: playback, audio: bytes });
            this.ledger!.markSent(command);
        } catch { this.ledger!.disconnected(current); }
        return this.ledger!.get(command);
    }

    async stop(commandId: string) {
        const row = this.ownedCommand(commandId);
        if (!ended(row.status) && this.connected(row.command.target)) {
            try { await this.transport.send(row.command.target.hostSessionId, { version: 1, type: 'prometheus.audio.stop',
                target: row.command.target, commandId: row.command.commandId, playbackId: row.command.playbackId }); }
            catch { this.ledger!.disconnected(row.command.target); }
        }
        return this.ledger!.get(row.command.commandId);
    }
    async playback(commandId: string, refresh = false) {
        const row = this.ownedCommand(commandId);
        if (refresh && this.connected(row.command.target)) {
            try { await this.transport.send(row.command.target.hostSessionId, { version: 1, type: 'prometheus.audio.query',
                target: row.command.target, commandId: row.command.commandId, playbackId: row.command.playbackId }); }
            catch { this.ledger!.disconnected(row.command.target); }
        }
        return this.ledger!.get(row.command.commandId);
    }

    close(): Promise<void> {
        if (!this.closing) this.closing = Promise.resolve().then(async () => {
            for (const controller of this.pending.keys()) controller.abort();
            await Promise.allSettled(this.pending.values());
            try { await this.transport.close(); } finally { this.ledger?.close(); this.cache?.close(); }
        });
        return this.closing;
    }
    private healthy() { if (this.closing || this.failure || !this.transport.state().listening) throw new AudioHostCacheError(this.failure ?? 'audio_host_closed'); }
    private ownedCommand(commandId: string) {
        const row = this.ledger!.get(uuid(commandId)); this.cache!.reference(row.command.audioId, this.api.principal); return row;
    }
    private connected(target: AudioHostTarget) { return this.transport.hosts().find(peer => sameWireTarget(peer.target, target)); }
    private host(value: unknown) {
        const peer = this.connected(wireTarget(value)); if (!peer) throw new AudioHostCacheError('host_unavailable');
        if (!peer.voice) throw new AudioHostCacheError('host_voice_unavailable'); return peer;
    }
    private scope(peer: ReturnType<AudioHostRuntime['host']>) {
        return { principal: this.api.principal, accountId: peer.target.accountId, avatarId: peer.target.avatarId, voice: peer.voice! };
    }
}
