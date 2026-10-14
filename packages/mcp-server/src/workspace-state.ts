import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The only thing this package remembers between calls, and across restarts of the MCP server:
 *
 *  - the account id behind the key (saves a 4 second read on every start), and
 *  - for every write whose outcome is still unknown (network dropped, timeout, 5xx): the operation id,
 *    the entry id and the timestamp that were used. When the model repeats the same call, the same
 *    values are sent again, and the website's own ledger turns the repeat into the original receipt
 *    instead of a second entry.
 *
 * It never stores content, titles, URLs or keys; keys are only represented by a 16-hex-digit fingerprint.
 * Disk is best effort: if the directory cannot be written, everything still works from memory.
 *
 * Layout (nothing is ever read, changed and written back as a whole, because several MCP servers on one machine,
 * for example Claude Desktop and Cursor, share this folder at the same time):
 *
 *   <dir>/workspace-state/accounts/<key fingerprint>.json            the account id behind one key
 *   <dir>/workspace-state/pending/<key fingerprint>/<sha256 of the call>.json   one unconfirmed write per file
 *
 * A file is written to a private temporary name and then renamed into place, so a reader sees the old file or the new
 * one, never half of one; a pending operation is removed with a single unlink. Two processes therefore only ever touch
 * the same file when they work on the same call, and then the last complete write wins. Folders are 0700, files 0600.
 *
 * `<dir>/workspace-state.json` is the single-file format of earlier builds. When it is found, its entries are moved
 * into the layout above (without overwriting anything already there) and only then is it removed; if any entry cannot
 * be moved the file stays where it is, the entries stay usable from memory, and the move is tried again on the next call.
 */
export interface PendingOperation {
    operationId: string;
    entryId: string;
    occurredAt: string;
    expectedRevision: number;
    inputMode: 'manual' | 'agent';
    role: 'assistant' | null;
    savedAt: number;
}
export interface WorkspaceState {
    getAccount(): string | undefined;
    setAccount(accountId: string): void;
    clearAccount(): void;
    getPending(intent: string): PendingOperation | undefined;
    setPending(intent: string, operation: PendingOperation): void;
    deletePending(intent: string): void;
}

const LEGACY_FILE = 'workspace-state.json';
const ROOT = 'workspace-state';
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_LIMIT = 200;
const STALE_TEMPORARY_MS = 10 * 60 * 1000;
const FINGERPRINT = /^[0-9a-f]{16}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export const keyFingerprint = (apiKey: string): string => createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
const intentFileName = (intent: string): string => `${createHash('sha256').update(intent).digest('hex')}.json`;

/** Directory for the state files: PROMETHEUS_MCP_STATE_DIR, or ~/.prometheus-mcp. `off`, `none` or `memory` keep everything in memory. */
export function defaultStateDirectory(env: NodeJS.ProcessEnv = process.env): string | null {
    const configured = env.PROMETHEUS_MCP_STATE_DIR?.trim();
    if (configured && ['off', 'none', 'memory'].includes(configured.toLowerCase())) return null;
    if (configured) return configured;
    try { return join(homedir(), '.prometheus-mcp'); } catch { return null; }
}

function validPending(value: unknown, now: number): value is PendingOperation {
    return record(value) && typeof value.operationId === 'string' && typeof value.entryId === 'string' && typeof value.occurredAt === 'string'
        && Number.isInteger(value.expectedRevision) && (value.inputMode === 'manual' || value.inputMode === 'agent')
        && (value.role === 'assistant' || value.role === null) && typeof value.savedAt === 'number' && now - value.savedAt < PENDING_TTL_MS;
}
/** Only the known fields are ever written, so nothing else can end up on disk. */
const pendingText = (operation: PendingOperation): string => JSON.stringify({
    operationId: operation.operationId, entryId: operation.entryId, occurredAt: operation.occurredAt, expectedRevision: operation.expectedRevision,
    inputMode: operation.inputMode, role: operation.role, savedAt: operation.savedAt,
});

/**
 * Writes `text` to `path` as a private file in one step. `replace` swaps any existing file for the new one;
 * `create` leaves an existing file alone and says so (returns false). Throws when the disk refuses.
 */
function writePrivateFile(path: string, text: string, how: 'replace' | 'create'): boolean {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
        writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
        try { chmodSync(temporary, 0o600); } catch { /* not supported everywhere */ }
        if (how === 'replace') { renameSync(temporary, path); return true; }
        try { linkSync(temporary, path); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
    } finally {
        // After a rename the temporary name is gone already; after a link or a failure it is not.
        try { unlinkSync(temporary); } catch { /* already moved */ }
    }
}
const removeFile = (path: string) => { try { unlinkSync(path); } catch { /* already gone */ } };
/** The parsed JSON in a file, or undefined when it is missing, unreadable or not JSON. */
function readJson(path: string): unknown {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
}

export function createWorkspaceState(options: { directory: string | null; apiKey: string; now?: () => number }): WorkspaceState {
    const now = options.now ?? Date.now, fingerprint = keyFingerprint(options.apiKey), directory = options.directory;
    const root = directory ? join(directory, ROOT) : null;
    const accountFile = (key: string) => join(root!, 'accounts', `${key}.json`);
    const pendingDirectory = (key: string) => join(root!, 'pending', key);

    // What this process knows even when the disk will not take it (read-only folder, full disk, folder removed by hand).
    // `onDisk` says the entry was written to the folder: then, while the folder is there, the folder is the truth, and an
    // entry that is gone from it was finished or removed by another MCP server and must not be brought back.
    let accountMemory: string | undefined;
    const pendingMemory = new Map<string, { operation: PendingOperation; onDisk: boolean }>();
    const remember = (intent: string, operation: PendingOperation, onDisk: boolean) => {
        pendingMemory.delete(intent); pendingMemory.set(intent, { operation, onDisk });
        if (pendingMemory.size > PENDING_LIMIT) {
            const oldest = [...pendingMemory.entries()].sort((a, b) => a[1].operation.savedAt - b[1].operation.savedAt)[0];
            pendingMemory.delete(oldest[0]);
        }
    };
    const folderExists = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };

    const readAccount = (key: string): string | undefined => {
        if (!root) return undefined;
        const value = readJson(accountFile(key));
        return record(value) && typeof value.accountId === 'string' && value.accountId ? value.accountId : undefined;
    };
    const readPending = (path: string): PendingOperation | undefined => {
        const value = readJson(path);
        return validPending(value, now()) ? value : undefined;
    };

    /** Moves the single-file format of earlier builds into the layout above. Removes the old file only when every entry made it. */
    let migrated = !root;
    const migrate = () => {
        if (migrated || !directory) return;
        const legacy = join(directory, LEGACY_FILE);
        let text: string;
        try { text = readFileSync(legacy, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') migrated = true; return; }
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { migrated = true; return; } // not a state file: nothing to rescue
        if (!record(parsed) || parsed.version !== 1 || !record(parsed.accounts) || !record(parsed.pending)) { migrated = true; return; }
        let complete = true;
        // true = the entry is in the new layout now (or already was, which is as good); false = the disk refused it.
        const put = (path: string, body: string): boolean => {
            try { writePrivateFile(path, body, 'create'); return true; } catch { complete = false; return false; }
        };
        for (const [key, accountId] of Object.entries(parsed.accounts)) {
            if (!FINGERPRINT.test(key) || typeof accountId !== 'string' || !accountId) continue;
            if (!put(accountFile(key), JSON.stringify({ accountId })) && key === fingerprint) accountMemory ??= accountId;
        }
        for (const [key, group] of Object.entries(parsed.pending)) {
            if (!FINGERPRINT.test(key) || !record(group)) continue;
            for (const [intent, value] of Object.entries(group)) {
                if (!validPending(value, now())) continue;
                // An entry that could not be moved stays usable from memory, and in the old file for the next process.
                if (!put(join(pendingDirectory(key), intentFileName(intent)), pendingText(value)) && key === fingerprint) remember(intent, value, false);
            }
        }
        if (!complete) return; // keep the old file; try again on the next call
        try { unlinkSync(legacy); migrated = true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') migrated = true; }
    };

    /** Drops what can no longer be used (expired, unreadable, leftover temporary names) and keeps at most PENDING_LIMIT of the newest. */
    const prune = () => {
        if (!root) return;
        const folder = pendingDirectory(fingerprint);
        let names: string[];
        try { names = readdirSync(folder); } catch { return; }
        const live: { path: string; savedAt: number }[] = [];
        for (const name of names) {
            const path = join(folder, name);
            if (name.endsWith('.tmp')) {
                try { if (Date.now() - statSync(path).mtimeMs > STALE_TEMPORARY_MS) removeFile(path); } catch { /* gone already */ }
                continue;
            }
            if (!name.endsWith('.json')) continue;
            const operation = readPending(path);
            if (operation) live.push({ path, savedAt: operation.savedAt });
            else removeFile(path);
        }
        if (live.length > PENDING_LIMIT) for (const old of live.sort((a, b) => a.savedAt - b.savedAt).slice(0, live.length - PENDING_LIMIT)) removeFile(old.path);
    };

    return {
        getAccount() {
            migrate();
            return readAccount(fingerprint) ?? accountMemory;
        },
        setAccount(accountId) {
            accountMemory = accountId;
            if (!root) return;
            migrate();
            try { writePrivateFile(accountFile(fingerprint), JSON.stringify({ accountId }), 'replace'); } catch { /* memory still holds it */ }
        },
        clearAccount() {
            accountMemory = undefined;
            if (!root) return;
            migrate();
            removeFile(accountFile(fingerprint));
        },
        getPending(intent) {
            migrate();
            const folder = root ? pendingDirectory(fingerprint) : null;
            const stored = folder ? readPending(join(folder, intentFileName(intent))) : undefined;
            if (stored) return stored;
            const kept = pendingMemory.get(intent);
            if (!kept || !validPending(kept.operation, now())) return undefined;
            if (kept.onDisk && folder && folderExists(folder)) { pendingMemory.delete(intent); return undefined; }
            return kept.operation;
        },
        setPending(intent, operation) {
            if (root) migrate();
            remember(intent, operation, false);
            if (!root) return;
            try {
                writePrivateFile(join(pendingDirectory(fingerprint), intentFileName(intent)), pendingText(operation), 'replace');
                remember(intent, operation, true);
            } catch { /* memory still holds it */ }
            prune();
        },
        deletePending(intent) {
            pendingMemory.delete(intent);
            if (!root) return;
            migrate();
            removeFile(join(pendingDirectory(fingerprint), intentFileName(intent)));
        },
    };
}
