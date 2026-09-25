import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AudioHostCacheError } from './audio-host-preparation.js';
import type { LocalAudioHostTransport } from './audio-host-transport.js';

const leases = new Set<string>();
/** Private atomic files; the live transport port is the cross-process writer lease. */
export class AudioHostCacheStore {
    readonly directory: string;
    private readonly endpoint: string;
    private closed = false;
    private failed = false;
    constructor(directory: string, private readonly transport: LocalAudioHostTransport) {
        this.endpoint = transport.url;
        if (!/^ws:\/\/127\.0\.0\.1:[1-9][0-9]*\/audio$/.test(this.endpoint) || !transport.state().listening) throw new AudioHostCacheError('cache_listener_required');
        if (!path.isAbsolute(directory)) throw new AudioHostCacheError('invalid_cache_directory');
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        this.directory = path.join(fs.realpathSync(directory), `host-${new URL(this.endpoint).port}`);
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        const stat = fs.lstatSync(this.directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !this.private(stat)) throw new AudioHostCacheError('cache_storage_not_private');
        if (leases.has(this.directory)) throw new AudioHostCacheError('cache_in_use'); leases.add(this.directory);
    }
    entries() { this.open(); return fs.readdirSync(this.directory); }
    size(name: string) {
        const stat = fs.lstatSync(path.join(this.directory, name));
        if (!stat.isFile() || stat.isSymbolicLink() || !this.private(stat)) throw new AudioHostCacheError('cache_corrupt');
        return stat.size;
    }
    read(name: string, limit: number): Buffer {
        this.open(); const size = this.size(name);
        if (size === 0 || size > limit) throw new AudioHostCacheError('cache_corrupt');
        return fs.readFileSync(path.join(this.directory, name));
    }
    write(name: string, data: string | Buffer, create: boolean) {
        this.writable(); const destination = path.join(this.directory, name);
        const pending = path.join(this.directory, `.pending-${name.endsWith('.bin') ? 'body' : 'meta'}-${randomUUID()}`);
        let fd: number | undefined, dir: number | undefined;
        try {
            if (!create) this.size(name);
            fd = fs.openSync(pending, 'wx', 0o600); fs.writeFileSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
            if (create) { fs.linkSync(pending, destination); fs.unlinkSync(pending); } else fs.renameSync(pending, destination);
            dir = fs.openSync(this.directory, 'r'); fs.fsyncSync(dir); fs.closeSync(dir); dir = undefined;
        } catch { this.failed = true; throw new AudioHostCacheError('cache_storage'); }
        finally { if (fd !== undefined) fs.closeSync(fd); if (dir !== undefined) fs.closeSync(dir); }
    }
    writable() {
        this.open(); if (this.failed) throw new AudioHostCacheError('cache_storage');
        if (!this.transport.state().listening || this.transport.url !== this.endpoint) throw new AudioHostCacheError('cache_listener_required');
    }
    open() { if (this.closed) throw new AudioHostCacheError('cache_closed'); }
    close() { if (!this.closed) { this.closed = true; leases.delete(this.directory); } }
    private private(stat: fs.Stats) { return (stat.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || stat.uid === process.getuid()); }
}
