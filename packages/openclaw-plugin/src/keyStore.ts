import fs from 'node:fs/promises';
import path from 'node:path';
import type { PluginApi, PluginLogger } from './types';

/** What is kept after the device flow: the one-time channel key and how to describe it. Never logged. */
export interface StoredChannel {
    key: string;
    key_prefix: string;
    channel: 'openclaw';
    linked_at: string;
    client_version: string;
}

export interface KeyStore {
    /** Where the key lives, for status messages and tests. */
    readonly location: () => string;
    get(): Promise<StoredChannel | null>;
    set(value: StoredChannel): Promise<void>;
    clear(): Promise<void>;
}

const NAMESPACE = 'prometheus-seller-channel';
const RECORD = 'openclaw';

function isStored(v: unknown): v is StoredChannel {
    const s = v as StoredChannel | null;
    return !!s && typeof s.key === 'string' && s.key.startsWith('pch_') && typeof s.key_prefix === 'string';
}

/** A 0600 file in a 0700 folder under the OpenClaw state directory. Written through a temp file and renamed. */
export class FileKeyStore implements KeyStore {
    constructor(private readonly file: string) {}
    location = () => this.file;

    async get(): Promise<StoredChannel | null> {
        try {
            const v = JSON.parse(await fs.readFile(this.file, 'utf8'));
            return isStored(v) ? v : null;
        } catch {
            return null;
        }
    }

    async set(value: StoredChannel): Promise<void> {
        await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
        await fs.chmod(tmp, 0o600);
        await fs.rename(tmp, this.file);
    }

    async clear(): Promise<void> {
        await fs.rm(this.file, { force: true });
    }
}

/**
 * OpenClaw's own plugin state (`api.runtime.state.openKeyedStore`) is the preferred home for the key, but in
 * OpenClaw 2026.9.x it throws for any plugin that is not bundled or trusted-official (checked on 2026.9.6:
 * "only available for trusted plugins"). So: try it, and when it is refused keep the key in a 0600 file under
 * `resolveStateDir()`. `get` looks in both places, so a later change of trust does not lose the key.
 */
export class RuntimeKeyStore implements KeyStore {
    private mode: 'unknown' | 'state' | 'file' = 'unknown';
    private readonly fileStore: FileKeyStore;

    constructor(private readonly api: PluginApi, private readonly log: PluginLogger, env: Record<string, string | undefined> = process.env) {
        const dir = api.runtime.state.resolveStateDir(env);
        this.fileStore = new FileKeyStore(path.join(dir, 'prometheus-avatar', 'channel-openclaw.json'));
    }

    location = () => (this.mode === 'state' ? 'OpenClaw plugin state' : this.fileStore.location());

    private open() {
        if (this.mode === 'file') return null;
        const open = this.api.runtime.state.openKeyedStore;
        if (typeof open !== 'function') { this.mode = 'file'; return null; }
        try {
            const store = open.call(this.api.runtime.state, { namespace: NAMESPACE, maxEntries: 4 }) as ReturnType<NonNullable<PluginApi['runtime']['state']['openKeyedStore']>> & object;
            return store as { lookup(k: string): Promise<unknown>; register(k: string, v: unknown): Promise<void>; consume?(k: string): Promise<unknown>; clear?(): Promise<void> };
        } catch (err) {
            this.mode = 'file';
            this.log.info(`OpenClaw plugin state is not open to this plugin (${String((err as Error).message).slice(0, 80)}...); keeping the seller key in a private file instead.`);
            return null;
        }
    }

    async get(): Promise<StoredChannel | null> {
        const store = this.open();
        if (store) {
            try {
                const v = await store.lookup(RECORD);
                if (isStored(v)) { this.mode = 'state'; return v; }
                if (this.mode === 'unknown') this.mode = 'state';
            } catch {
                this.mode = 'file';
            }
        }
        return this.fileStore.get();
    }

    async set(value: StoredChannel): Promise<void> {
        const store = this.open();
        if (store) {
            try {
                await store.register(RECORD, value);
                this.mode = 'state';
                await this.fileStore.clear();       // one home only
                return;
            } catch {
                this.mode = 'file';
            }
        }
        await this.fileStore.set(value);
    }

    async clear(): Promise<void> {
        const store = this.open();
        if (store) {
            try {
                if (store.consume) await store.consume(RECORD);
                else if (store.clear) await store.clear();
            } catch { /* fall through: the file store is cleared below either way */ }
        }
        await this.fileStore.clear();
    }
}
