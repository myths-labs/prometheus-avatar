import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AudioHostCacheStore } from './audio-host-cache-store.js';
import { AudioHostCacheError, digest, preparation, preparedRow, preparedScope, uuid, verifiedSpeech, type PreparedRow } from './audio-host-preparation.js';
import { wireObject } from './audio-host-wire.js';
import type { LocalAudioHostTransport } from './audio-host-transport.js';

interface Options { directory: string; transport: LocalAudioHostTransport; capacity?: number; requestCapacity?: number; maxAudioBytes?: number; maxBytes?: number }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const manifest = (id: string) => `audio-${id}.json`, binary = (id: string) => `audio-${id}.bin`;
const bounded = (value: number, low: number, high: number) => Number.isSafeInteger(value) && value >= low && value <= high;

/** Stable synthesis intent/cache. No provider or network call is made by this class. */
export class AudioHostCache {
    readonly directory: string;
    private readonly store: AudioHostCacheStore;
    private readonly rows = new Map<string, PreparedRow>();
    private readonly requests = new Map<string, string>();
    private readonly fingerprints = new Map<string, string>();
    private readonly recovered = new Set<string>();
    private readonly capacity: number;
    private readonly requestCapacity: number;
    private readonly maxAudioBytes: number;
    private readonly maxBytes: number;
    private dataBytes = 0;

    constructor(options: Options) {
        this.capacity = options.capacity ?? 1000; this.requestCapacity = options.requestCapacity ?? 10000;
        this.maxAudioBytes = options.maxAudioBytes ?? 32 * 1024 * 1024; this.maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
        if (!bounded(this.capacity, 1, 100000) || !bounded(this.requestCapacity, this.capacity, 100000)
            || !bounded(this.maxAudioBytes, 48, 32 * 1024 * 1024) || !bounded(this.maxBytes, this.maxAudioBytes, 1024 * 1024 * 1024)) throw new AudioHostCacheError('invalid_cache_capacity');
        this.store = new AudioHostCacheStore(options.directory, options.transport); this.directory = this.store.directory;
        try {
            const entries = this.store.entries();
            if (entries.length > 4 * (this.capacity + this.requestCapacity)) throw new AudioHostCacheError('cache_capacity');
            for (const name of entries) {
                if (!/^(?:audio-[0-9a-f-]{36}\.(?:json|bin)|request-[0-9a-f-]{36}\.json|\.pending-(?:body|meta)-[0-9a-f-]{36})$/.test(name)) throw new AudioHostCacheError('cache_corrupt');
                const size = this.store.size(name);
                if (name.endsWith('.bin') || name.startsWith('.pending-body-')) { this.dataBytes += size; if (size > this.maxAudioBytes) throw new AudioHostCacheError('cache_corrupt'); }
                if (name.startsWith('.pending-meta-') && size > 16384) throw new AudioHostCacheError('cache_corrupt');
            }
            if (this.dataBytes > this.maxBytes) throw new AudioHostCacheError('cache_byte_capacity');
            for (const name of entries.filter(name => name.startsWith('audio-') && name.endsWith('.json'))) {
                const row = preparedRow(JSON.parse(this.store.read(name, 16384).toString('utf8')), this.maxAudioBytes);
                if (name !== manifest(row.audioId) || this.rows.size >= this.capacity || this.rows.has(row.audioId)
                    || this.fingerprints.has(row.fingerprint) || this.requests.has(row.requestId)) throw new AudioHostCacheError('cache_corrupt');
                this.rows.set(row.audioId, row); this.requests.set(row.requestId, row.audioId); this.fingerprints.set(row.fingerprint, row.audioId);
                this.recovered.add(row.audioId);
                if (row.state === 'ready') {
                    const bytes = this.bytes(row); verifiedSpeech({ ...row.response, audio: bytes.toString('base64') }, row, this.maxAudioBytes);
                }
            }
            for (const name of entries.filter(name => name.startsWith('request-'))) {
                const alias = wireObject(JSON.parse(this.store.read(name, 1024).toString('utf8')), ['schema', 'requestId', 'audioId', 'fingerprint']);
                const id = uuid(alias.requestId), audioId = uuid(alias.audioId), row = this.rows.get(audioId);
                if (alias.schema !== 1 || name !== `request-${id}.json` || !row || alias.fingerprint !== row.fingerprint || this.requests.has(id)) throw new AudioHostCacheError('cache_corrupt');
                this.requests.set(id, audioId);
            }
            if (this.requests.size > this.requestCapacity) throw new AudioHostCacheError('cache_capacity');
            for (const name of entries.filter(name => name.endsWith('.bin'))) if (!this.rows.has(name.slice(6, -4))) throw new AudioHostCacheError('cache_corrupt');
        } catch { this.store.close(); throw new AudioHostCacheError('cache_corrupt'); }
    }

    reserve(value: unknown) {
        this.store.writable(); const intent = preparation(value), previousId = this.requests.get(intent.requestId);
        if (previousId) {
            const row = this.rows.get(previousId)!;
            if (row.fingerprint !== intent.fingerprint) throw new AudioHostCacheError('preparation_conflict');
            return { created: false, row: this.get(row.audioId, intent.scope) };
        }
        if (this.requests.size >= this.requestCapacity) throw new AudioHostCacheError('cache_capacity');
        const same = this.fingerprints.get(intent.fingerprint);
        if (same) {
            const alias = { schema: 1, requestId: intent.requestId, audioId: same, fingerprint: intent.fingerprint };
            this.store.write(`request-${intent.requestId}.json`, JSON.stringify(alias) + '\n', true);
            this.requests.set(intent.requestId, same); return { created: false, row: this.get(same, intent.scope) };
        }
        if (this.rows.size >= this.capacity) throw new AudioHostCacheError('cache_capacity');
        const pending = [...this.rows.values()].filter(row => row.state === 'pending' && !this.recovered.has(row.audioId)).length;
        if (this.dataBytes + (pending + 1) * this.maxAudioBytes > this.maxBytes) throw new AudioHostCacheError('cache_byte_capacity');
        const row: PreparedRow = { schema: 1, audioId: randomUUID(), ...intent, createdAt: Date.now(), state: 'pending' };
        this.persist(row, true); this.requests.set(row.requestId, row.audioId); this.fingerprints.set(row.fingerprint, row.audioId);
        return { created: true, row: this.get(row.audioId, row.scope) };
    }

    complete(audioId: string, response: unknown) {
        this.store.writable(); const row = this.pending(audioId), verified = verifiedSpeech(response, row, this.maxAudioBytes);
        if (this.dataBytes + verified.bytes.length > this.maxBytes) throw new AudioHostCacheError('cache_byte_capacity');
        this.store.write(binary(row.audioId), verified.bytes, true); this.dataBytes += verified.bytes.length;
        this.persist({ ...row, state: 'ready', audio: verified.audio, response: verified.response }, false);
    }

    uncertain(audioId: string) {
        const row = this.pending(audioId);
        try { this.store.writable(); this.persist({ ...row, state: 'uncertain' }, false); }
        finally { this.recovered.add(row.audioId); }
    }

    get(audioId: string, scope: unknown) {
        this.store.open(); const row = this.owned(audioId, scope);
        return copy({ ...row, status: row.state === 'pending' && this.recovered.has(row.audioId) ? 'uncertain' : row.state });
    }

    read(audioId: string, scope: unknown) {
        this.store.open(); const row = this.owned(audioId, scope);
        if (row.state !== 'ready') throw new AudioHostCacheError('preparation_not_ready');
        return { data: this.bytes(row).toString('base64'), mimeType: row.audio!.mimeType, sha256: row.audio!.sha256 };
    }

    request(requestId: string, principal: string) {
        this.store.open(); const id = this.requests.get(uuid(requestId));
        if (!id) throw new AudioHostCacheError('unknown_preparation');
        return this.reference(id, principal);
    }

    reference(audioId: string, principal: string) {
        this.store.open(); const id = uuid(audioId), row = this.rows.get(id);
        if (!row) throw new AudioHostCacheError('unknown_audio');
        if (row.scope.principal !== principal) throw new AudioHostCacheError('preparation_scope_mismatch');
        return this.get(id, row.scope);
    }

    close() { this.store.close(); }
    private owned(audioId: string, scope: unknown) {
        const row = this.rows.get(uuid(audioId)); if (!row) throw new AudioHostCacheError('unknown_audio');
        if (!isDeepStrictEqual(row.scope, preparedScope(scope))) throw new AudioHostCacheError('preparation_scope_mismatch'); return row;
    }
    private pending(audioId: string) {
        const row = this.rows.get(uuid(audioId)); if (!row) throw new AudioHostCacheError('unknown_audio');
        if (row.state !== 'pending' || this.recovered.has(row.audioId)) throw new AudioHostCacheError('preparation_not_pending'); return row;
    }
    private bytes(row: PreparedRow) {
        try {
            const bytes = this.store.read(binary(row.audioId), this.maxAudioBytes);
            if (bytes.length !== row.audio!.bytes || digest(bytes) !== row.audio!.sha256) throw Error(); return bytes;
        } catch { throw new AudioHostCacheError('cache_corrupt'); }
    }
    private persist(row: PreparedRow, create: boolean) {
        const content = JSON.stringify(row) + '\n'; if (Buffer.byteLength(content) > 16384) throw new AudioHostCacheError('cache_capacity');
        this.store.write(manifest(row.audioId), content, create); this.rows.set(row.audioId, row);
    }
}
