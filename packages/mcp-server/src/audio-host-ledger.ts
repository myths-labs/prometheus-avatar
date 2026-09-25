import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseHostFrame, wireObject, wireTarget, sameWireTarget, type AudioHostTarget, type AudioHostFrame } from './audio-host-wire.js';
import type { LocalAudioHostTransport } from './audio-host-transport.js';

export interface AudioHostDelivery {
    target: AudioHostTarget;
    commandId: string;
    playbackId: string;
    audioId: string;
    audioSha256: string;
}
interface Row {
    schema: 1;
    command: AudioHostDelivery;
    createdAt: number;
    sent: boolean;
    disconnected: boolean;
    receipts: AudioHostFrame[];
    rejection?: AudioHostFrame;
}
interface Options { directory: string; transport: LocalAudioHostTransport; capacity?: number }
export class AudioHostLedgerError extends Error {
    constructor(readonly code: string) { super(code); this.name = 'AudioHostLedgerError'; }
}
const leases = new Set<string>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terminal = (row: Row) => row.rejection || ['completed', 'interrupted', 'failed'].includes(row.receipts.at(-1)?.status as string);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function delivery(value: unknown): AudioHostDelivery {
    const raw = wireObject(value, ['target', 'commandId', 'playbackId', 'audioId', 'audioSha256']);
    const ids: Record<string, string> = {};
    for (const name of ['commandId', 'playbackId', 'audioId']) {
        if (typeof raw[name] !== 'string' || !UUID.test(raw[name] as string)) throw new AudioHostLedgerError('invalid_delivery');
        ids[name] = (raw[name] as string).toLowerCase();
    }
    if (typeof raw.audioSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.audioSha256)) throw new AudioHostLedgerError('invalid_delivery');
    return { target: wireTarget(raw.target), commandId: ids.commandId, playbackId: ids.playbackId, audioId: ids.audioId, audioSha256: raw.audioSha256 };
}
function appendFrame(row: Row, frame: AudioHostFrame): Row | null {
    if (!sameWireTarget(frame.target, row.command.target) || frame.commandId !== row.command.commandId
        || frame.playbackId !== row.command.playbackId) throw new AudioHostLedgerError('receipt_conflict');
    if (frame.type === 'prometheus.audio.rejected') {
        if (row.rejection && isDeepStrictEqual(row.rejection, frame)) return null;
        if (row.receipts.length || row.rejection) throw new AudioHostLedgerError('receipt_order');
        return { ...row, rejection: frame };
    }
    if (frame.audioSha256 !== row.command.audioSha256) throw new AudioHostLedgerError('receipt_conflict');
    const sequence = frame.sequence as number;
    if (sequence <= row.receipts.length) {
        if (isDeepStrictEqual(row.receipts[sequence - 1], frame)) return null;
        throw new AudioHostLedgerError('receipt_conflict');
    }
    const previous = row.receipts.at(-1)?.status;
    if (terminal(row) || sequence !== row.receipts.length + 1
        || (!previous && frame.status !== 'accepted')
        || (previous === 'accepted' && !['started', 'interrupted', 'failed'].includes(frame.status as string))
        || (previous === 'started' && !['completed', 'interrupted', 'failed'].includes(frame.status as string))) {
        throw new AudioHostLedgerError('receipt_order');
    }
    return { ...row, receipts: [...row.receipts, frame] };
}

/**
 * Reserve before network send; never generate or resend from this ledger.
 * The bound loopback TCP port is the cross-process writer lease. Storage is
 * partitioned by that port, while an in-process lease prevents duplicate objects.
 * Complete per-command files are published atomically after fsync. Orphan pending
 * files remain as recovery evidence; they can never authorize another send.
 */
export class AudioHostLedger {
    readonly directory: string;
    private readonly rows = new Map<string, Row>();
    private readonly playbackIds = new Map<string, string>();
    private readonly recovered = new Set<string>();
    private readonly endpoint: string;
    private readonly capacity: number;
    private closed = false;
    private failed = false;

    constructor(private readonly options: Options) {
        this.capacity = options.capacity ?? 10000;
        if (!Number.isSafeInteger(this.capacity) || this.capacity < 1 || this.capacity > 100000) throw new AudioHostLedgerError('invalid_ledger_capacity');
        this.endpoint = options.transport.url;
        if (!/^ws:\/\/127\.0\.0\.1:[1-9][0-9]*\/audio$/.test(this.endpoint) || !options.transport.state().listening) {
            throw new AudioHostLedgerError('ledger_listener_required');
        }
        if (!path.isAbsolute(options.directory)) throw new AudioHostLedgerError('invalid_ledger_directory');
        fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 });
        this.directory = path.join(fs.realpathSync(options.directory), `host-${new URL(this.endpoint).port}`);
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        const stat = fs.lstatSync(this.directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
            || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new AudioHostLedgerError('ledger_storage_not_private');
        if (leases.has(this.directory)) throw new AudioHostLedgerError('ledger_in_use');
        leases.add(this.directory);
        try {
            const entries = fs.readdirSync(this.directory);
            if (entries.length > this.capacity * 2) throw new AudioHostLedgerError('ledger_capacity');
            for (const name of entries) {
                if (/^\.pending-[0-9a-f-]{36}$/.test(name)) continue;
                if (!/^delivery-[0-9a-f-]{36}\.json$/.test(name)) throw new AudioHostLedgerError('ledger_corrupt');
                const file = path.join(this.directory, name), stat = fs.lstatSync(file);
                if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384 || stat.size === 0 || (stat.mode & 0o077) !== 0) throw new AudioHostLedgerError('ledger_corrupt');
                const raw = wireObject(JSON.parse(fs.readFileSync(file, 'utf8')), ['schema', 'command', 'createdAt', 'sent', 'disconnected', 'receipts', 'rejection']);
                if (raw.schema !== 1 || !Number.isSafeInteger(raw.createdAt) || (raw.createdAt as number) < 0
                    || typeof raw.sent !== 'boolean' || typeof raw.disconnected !== 'boolean'
                    || !Array.isArray(raw.receipts) || raw.receipts.length > 3) throw new AudioHostLedgerError('ledger_corrupt');
                let row: Row = { schema: 1, command: delivery(raw.command), createdAt: raw.createdAt as number, sent: raw.sent, disconnected: raw.disconnected, receipts: [] };
                if (name !== `delivery-${row.command.commandId}.json` || this.rows.has(row.command.commandId)
                    || this.playbackIds.has(row.command.playbackId) || this.rows.size >= this.capacity) throw new AudioHostLedgerError('ledger_corrupt');
                for (const frame of raw.receipts) {
                    const next = appendFrame(row, parseHostFrame(frame, row.command.target));
                    if (!next) throw new AudioHostLedgerError('ledger_corrupt'); row = next;
                }
                if (raw.rejection !== undefined) {
                    const rejected = parseHostFrame(raw.rejection, row.command.target);
                    if (rejected.type !== 'prometheus.audio.rejected') throw new AudioHostLedgerError('ledger_corrupt');
                    row = appendFrame(row, rejected)!;
                }
                this.rows.set(row.command.commandId, row); this.playbackIds.set(row.command.playbackId, row.command.commandId); this.recovered.add(row.command.commandId);
            }
        } catch {
            leases.delete(this.directory); throw new AudioHostLedgerError('ledger_corrupt');
        }
    }

    reserve(input: unknown) {
        this.writable(); const command = delivery(input), previous = this.rows.get(command.commandId);
        if (previous) {
            if (!isDeepStrictEqual(previous.command, command)) throw new AudioHostLedgerError('command_conflict');
            return { created: false, row: this.get(command.commandId) };
        }
        if (this.playbackIds.has(command.playbackId)) throw new AudioHostLedgerError('playback_conflict');
        if (this.rows.size >= this.capacity) throw new AudioHostLedgerError('ledger_capacity');
        const row: Row = { schema: 1, command, createdAt: Date.now(), sent: false, disconnected: false, receipts: [] };
        this.persist(row, true); this.playbackIds.set(command.playbackId, command.commandId);
        return { created: true, row: this.get(command.commandId) };
    }

    get(commandId: string) {
        if (this.closed) throw new AudioHostLedgerError('ledger_closed');
        const row = this.rows.get(commandId.toLowerCase()); if (!row) throw new AudioHostLedgerError('unknown_command');
        const last = row.receipts.at(-1)?.status as string | undefined;
        const status = row.rejection ? 'rejected' : terminal(row) ? last!
            : this.failed || row.disconnected || this.recovered.has(commandId.toLowerCase()) ? 'unknown' : last ?? 'delivery_pending';
        return copy({ ...row, status });
    }

    markSent(commandId: string): void {
        this.writable(); const { status: _, ...row } = this.get(commandId);
        if (!row.sent) this.persist({ ...row, sent: true });
    }

    accept(target: AudioHostTarget, value: unknown): boolean {
        this.writable();
        // Unknown command identity is checked before peer-bound frame validation.
        const id = value && typeof value === 'object' ? (value as Record<string, unknown>).commandId : undefined;
        if (typeof id !== 'string' || !this.rows.has(id)) throw new AudioHostLedgerError('unknown_command');
        const frame = parseHostFrame(value, target), row = this.rows.get(id)!;
        const next = appendFrame(row, frame); if (!next) return false;
        this.persist(next); return true;
    }

    disconnected(target: AudioHostTarget): void {
        this.writable();
        for (const row of this.rows.values()) if (sameWireTarget(row.command.target, target) && !terminal(row) && !row.disconnected) this.persist({ ...row, disconnected: true });
    }

    close(): void { if (!this.closed) { this.closed = true; leases.delete(this.directory); } }

    private writable(): void {
        if (this.closed) throw new AudioHostLedgerError('ledger_closed');
        if (this.failed) throw new AudioHostLedgerError('ledger_storage');
        if (!this.options.transport.state().listening || this.options.transport.url !== this.endpoint) throw new AudioHostLedgerError('ledger_listener_required');
    }

    private persist(row: Row, create = false): void {
        const pending = path.join(this.directory, `.pending-${randomUUID()}`), destination = path.join(this.directory, `delivery-${row.command.commandId}.json`);
        let fd: number | undefined, dir: number | undefined;
        try {
            const content = JSON.stringify(row) + '\n'; if (Buffer.byteLength(content) > 16384) throw Error();
            fd = fs.openSync(pending, 'wx', 0o600); fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
            if (create) { fs.linkSync(pending, destination); fs.unlinkSync(pending); }
            else fs.renameSync(pending, destination);
            dir = fs.openSync(this.directory, 'r'); fs.fsyncSync(dir); fs.closeSync(dir); dir = undefined;
            this.rows.set(row.command.commandId, row);
        } catch {
            this.failed = true; throw new AudioHostLedgerError('ledger_storage');
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
            if (dir !== undefined) fs.closeSync(dir);
        }
    }
}
