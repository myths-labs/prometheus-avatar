import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { workspaceUuid } from './workspace-contract.js';

/**
 * The only thing this package remembers between calls, and across restarts of the MCP server:
 *
 *  - the account id behind the key (saves a 4 second read on every start), and
 *  - for every write whose outcome is still unknown (network dropped, timeout, 5xx, or a replay of such a write that
 *    was refused): the operation id, the entry id and the timestamp that were used. When the model repeats the same
 *    call, the same values are sent again, and the website's own ledger turns the repeat into the original receipt
 *    instead of a second entry.
 *
 * Unconfirmed writes are filed under the ACCOUNT, not under the key, because the website's ledger counts operations per
 * account (primary key account_id + operation_id). Replacing a key that stopped working is exactly what the tools ask the
 * user to do when a save could not be confirmed; with the new key the repeated call still finds and re-sends the original
 * operation. (Every key of an account sees the same records; a key of another account never does.)
 *
 * It never stores content, titles, URLs or keys; keys are only represented by a 16-hex-digit fingerprint.
 * Disk is best effort: if the directory cannot be written, everything still works from memory.
 *
 * Layout (nothing is ever read, changed and written back as a whole, because several MCP servers on one machine,
 * for example Claude Desktop and Cursor, share this folder at the same time):
 *
 *   <dir>/workspace-state/accounts/<key fingerprint>.json                          the account id behind one key
 *   <dir>/workspace-state/pending-by-account/<account>/<sha256 of the call>.json   one unconfirmed write per file
 *
 * <account> is the account id when it is a UUID (as the website's are), otherwise a sha256 of it, so that a value read
 * from a file can never turn into a path.
 *
 * A file is written to a private temporary name and then renamed into place, so a reader sees the old file or the new
 * one, never half of one; a pending operation is removed with a single unlink. Two processes therefore only ever touch
 * the same file when they work on the same call, and then the last complete write wins. Folders are 0700, files 0600.
 *
 * Earlier layouts are moved into this one, never overwriting anything already there, and nothing in them can make a
 * start or a call fail (unreadable, expired or malformed files are dropped):
 *
 *  - `<dir>/workspace-state.json`, the single-file format of the first builds. Its entries are moved to the per-key
 *    folders below and only then is it removed; if any entry cannot be moved the file stays where it is, the entries
 *    stay usable from memory, and the move is tried again on the next call.
 *  - `<dir>/workspace-state/pending/<key fingerprint>/`, the per-key folders of later builds. Each moves to the account
 *    its key belongs to: the one in accounts/<fingerprint>.json or, for this server's own key, the account the website
 *    reported. This runs when the server starts and again on calls until it is done; a folder of another key whose
 *    account is not known is left as it is. A record the new layout already holds for the same call is kept and the
 *    old one dropped. Running it twice, or in two servers at once, moves each record once.
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
    /** Unconfirmed writes are kept per account (see above): `accountId` is the account the write goes to. */
    getPending(accountId: string, intent: string): PendingOperation | undefined;
    setPending(accountId: string, intent: string, operation: PendingOperation): void;
    /**
     * With `operationId`, only that operation's record is removed: when another MCP server sharing the folder has since tried
     * the same call (and so replaced the file with its own unconfirmed operation), its record stays.
     */
    deletePending(accountId: string, intent: string, operationId?: string): void;
}

const LEGACY_FILE = 'workspace-state.json';
const ROOT = 'workspace-state';
/** Per-key folders of earlier builds; only ever read and emptied. */
const KEY_FOLDERS = 'pending';
const ACCOUNT_FOLDERS = 'pending-by-account';
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_LIMIT = 200;
const STALE_TEMPORARY_MS = 10 * 60 * 1000;
const FINGERPRINT = /^[0-9a-f]{16}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export const keyFingerprint = (apiKey: string): string => createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
const intentFileName = (intent: string): string => `${createHash('sha256').update(intent).digest('hex')}.json`;
/** The folder name for an account: the UUID itself (lower case), or a sha256 of anything else. Never a path. */
const accountFolderName = (accountId: string): string =>
    workspaceUuid.test(accountId) ? accountId.toLowerCase() : createHash('sha256').update(accountId).digest('hex');

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
    const keyFolder = (key: string) => join(root!, KEY_FOLDERS, key);
    const accountFolder = (accountId: string) => join(root!, ACCOUNT_FOLDERS, accountFolderName(accountId));
    /** Where an unconfirmed write lives in memory: the same account folder and file name it has on disk. */
    const slot = (accountId: string, fileName: string) => `${accountFolderName(accountId)}/${fileName}`;

    // What this process knows even when the disk will not take it (read-only folder, full disk, folder removed by hand).
    // `onDisk` says the entry was written to the folder: then, while the folder is there, the folder is the truth, and an
    // entry that is gone from it was finished or removed by another MCP server and must not be brought back.
    let accountMemory: string | undefined;
    const pendingMemory = new Map<string, { operation: PendingOperation; onDisk: boolean }>();
    const remember = (key: string, operation: PendingOperation, onDisk: boolean) => {
        pendingMemory.delete(key); pendingMemory.set(key, { operation, onDisk });
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
    /** Removes a temporary file another process left behind (it crashed between writing and renaming). */
    const removeStaleTemporary = (path: string) => {
        try { if (Date.now() - statSync(path).mtimeMs > STALE_TEMPORARY_MS) removeFile(path); } catch { /* gone already */ }
    };
    /**
     * The account a per-key folder of an earlier build belongs to. For this server's own key, the account the current
     * call names (the website reported it for this key) comes first, then what is on disk or in memory.
     */
    const ownerOf = (key: string, current?: string): string | undefined =>
        key === fingerprint ? current ?? readAccount(key) ?? accountMemory : readAccount(key);

    /** Moves the single-file format of earlier builds into the per-key folders. Removes the old file only when every entry made it. */
    let migrated = !root;
    // Set once every per-key folder that can be attributed has been moved; the single-file move above clears it again.
    let adopted = !root;
    const migrate = (current?: string) => {
        if (migrated || !directory) return;
        const legacy = join(directory, LEGACY_FILE);
        let text: string;
        try { text = readFileSync(legacy, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') migrated = true; return; }
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { migrated = true; return; } // not a state file: nothing to rescue
        if (!record(parsed) || parsed.version !== 1 || !record(parsed.accounts) || !record(parsed.pending)) { migrated = true; return; }
        let complete = true;
        adopted = false; // whatever lands in the per-key folders below goes on to its account right after
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
                const name = intentFileName(intent);
                if (put(join(keyFolder(key), name), pendingText(value)) || key !== fingerprint) continue;
                // An entry of this key that could not be moved stays usable from memory (once its account is known),
                // and in the old file for the next process.
                const owner = ownerOf(key, current);
                if (owner) remember(slot(owner, name), value, false);
            }
        }
        if (!complete) return; // keep the old file; try again on the next call
        try { unlinkSync(legacy); migrated = true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') migrated = true; }
    };

    /** Moves the per-key folders of earlier builds to the account each key belongs to (see the comment on top). */
    const adoptKeyFolders = (current?: string) => {
        if (adopted) return;
        let keys: string[];
        try { keys = readdirSync(join(root!, KEY_FOLDERS)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') adopted = true; return; }
        let complete = true;
        for (const key of keys) {
            if (!FINGERPRINT.test(key)) continue;
            const owner = ownerOf(key, current);
            // Another key whose account is not known stays as it is. This server's own key is known after its first call.
            if (!owner) { if (key === fingerprint) complete = false; continue; }
            const from = keyFolder(key);
            let names: string[];
            try { names = readdirSync(from); } catch { continue; } // not a folder, or unreadable: nothing that can be moved
            for (const name of names) {
                const path = join(from, name);
                if (name.endsWith('.tmp')) { removeStaleTemporary(path); continue; }
                if (!name.endsWith('.json')) continue;
                const operation = readPending(path);
                if (!operation) { removeFile(path); continue; } // expired, malformed, or moved by another server a moment ago
                try {
                    // 'create': a record the new layout already holds for this call wins; the old one is dropped either way.
                    writePrivateFile(join(accountFolder(owner), name), pendingText(operation), 'create');
                    removeFile(path);
                } catch {
                    complete = false; // the disk refused: usable from memory now, moved on a later call or by the next process
                    remember(slot(owner, name), operation, false);
                }
            }
            try { rmdirSync(from); } catch { /* not empty: something could not be moved, or is not ours to remove */ }
        }
        try { rmdirSync(join(root!, KEY_FOLDERS)); } catch { /* still holds folders of keys whose account is not known */ }
        if (complete) adopted = true;
    };
    /** Brings earlier layouts up to date. Best effort: nothing on disk may stop a start or a call. */
    const upgrade = (current?: string) => {
        try { migrate(current); adoptKeyFolders(current); } catch { /* tried again on the next call */ }
    };
    upgrade(); // on start: everything whose account is already known moves now

    /** Drops what can no longer be used (expired, unreadable, leftover temporary names) and keeps at most PENDING_LIMIT of the newest. */
    const prune = (accountId: string) => {
        if (!root) return;
        const folder = accountFolder(accountId);
        let names: string[];
        try { names = readdirSync(folder); } catch { return; }
        const live: { path: string; savedAt: number }[] = [];
        for (const name of names) {
            const path = join(folder, name);
            if (name.endsWith('.tmp')) { removeStaleTemporary(path); continue; }
            if (!name.endsWith('.json')) continue;
            const operation = readPending(path);
            if (operation) live.push({ path, savedAt: operation.savedAt });
            else removeFile(path);
        }
        if (live.length > PENDING_LIMIT) for (const old of live.sort((a, b) => a.savedAt - b.savedAt).slice(0, live.length - PENDING_LIMIT)) removeFile(old.path);
    };

    return {
        getAccount() {
            upgrade();
            return readAccount(fingerprint) ?? accountMemory;
        },
        setAccount(accountId) {
            accountMemory = accountId;
            if (!root) return;
            upgrade(accountId);
            try { writePrivateFile(accountFile(fingerprint), JSON.stringify({ accountId }), 'replace'); } catch { /* memory still holds it */ }
        },
        clearAccount() {
            accountMemory = undefined;
            if (!root) return;
            upgrade();
            removeFile(accountFile(fingerprint));
        },
        getPending(accountId, intent) {
            upgrade(accountId);
            const name = intentFileName(intent), key = slot(accountId, name);
            const folder = root ? accountFolder(accountId) : null;
            const stored = folder ? readPending(join(folder, name)) : undefined;
            if (stored) return stored;
            const kept = pendingMemory.get(key);
            if (!kept || !validPending(kept.operation, now())) return undefined;
            if (kept.onDisk && folder && folderExists(folder)) { pendingMemory.delete(key); return undefined; }
            return kept.operation;
        },
        setPending(accountId, intent, operation) {
            upgrade(accountId);
            const name = intentFileName(intent), key = slot(accountId, name);
            remember(key, operation, false);
            if (!root) return;
            try {
                writePrivateFile(join(accountFolder(accountId), name), pendingText(operation), 'replace');
                remember(key, operation, true);
            } catch { /* memory still holds it */ }
            prune(accountId);
        },
        deletePending(accountId, intent, operationId) {
            upgrade(accountId);
            const name = intentFileName(intent), key = slot(accountId, name);
            if (!operationId || pendingMemory.get(key)?.operation.operationId === operationId) pendingMemory.delete(key);
            if (!root) return;
            const path = join(accountFolder(accountId), name);
            if (operationId) {
                const stored = readJson(path);
                if (record(stored) && stored.operationId !== operationId) return; // another server's try of the same call: not ours to finish
            }
            removeFile(path);
        },
    };
}
