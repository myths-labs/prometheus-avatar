import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

const FILE_NAME = 'workspace-state.json';
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_LIMIT = 200;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export const keyFingerprint = (apiKey: string): string => createHash('sha256').update(apiKey).digest('hex').slice(0, 16);

/** Directory for the state file: PROMETHEUS_MCP_STATE_DIR, or ~/.prometheus-mcp. `off`, `none` or `memory` keep everything in memory. */
export function defaultStateDirectory(env: NodeJS.ProcessEnv = process.env): string | null {
    const configured = env.PROMETHEUS_MCP_STATE_DIR?.trim();
    if (configured && ['off', 'none', 'memory'].includes(configured.toLowerCase())) return null;
    if (configured) return configured;
    try { return join(homedir(), '.prometheus-mcp'); } catch { return null; }
}

interface Persisted { version: 1; accounts: Record<string, string>; pending: Record<string, Record<string, PendingOperation>> }
const empty = (): Persisted => ({ version: 1, accounts: {}, pending: {} });

function validPending(value: unknown, now: number): value is PendingOperation {
    return record(value) && typeof value.operationId === 'string' && typeof value.entryId === 'string' && typeof value.occurredAt === 'string'
        && Number.isInteger(value.expectedRevision) && (value.inputMode === 'manual' || value.inputMode === 'agent')
        && (value.role === 'assistant' || value.role === null) && typeof value.savedAt === 'number' && now - value.savedAt < PENDING_TTL_MS;
}

export function createWorkspaceState(options: { directory: string | null; apiKey: string; now?: () => number }): WorkspaceState {
    const now = options.now ?? Date.now, fingerprint = keyFingerprint(options.apiKey), directory = options.directory;
    const file = directory ? join(directory, FILE_NAME) : null;
    let memory: Persisted = empty();

    const load = (): Persisted => {
        if (!file) return memory;
        try {
            const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
            if (!record(parsed) || parsed.version !== 1 || !record(parsed.accounts) || !record(parsed.pending)) return memory;
            const loaded = empty();
            for (const [key, value] of Object.entries(parsed.accounts)) if (typeof value === 'string') loaded.accounts[key] = value;
            for (const [key, group] of Object.entries(parsed.pending)) {
                if (!record(group)) continue;
                loaded.pending[key] = {};
                for (const [intent, value] of Object.entries(group)) if (validPending(value, now())) loaded.pending[key][intent] = value;
            }
            return loaded;
        } catch { return memory; }
    };
    const save = (next: Persisted) => {
        for (const [key, group] of Object.entries(next.pending)) {
            const intents = Object.entries(group).sort((a, b) => b[1].savedAt - a[1].savedAt);
            next.pending[key] = Object.fromEntries(intents.slice(0, PENDING_LIMIT));
        }
        memory = next;
        if (!file || !directory) return;
        try {
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            const temporary = `${file}.${process.pid}.tmp`;
            writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
            try { chmodSync(temporary, 0o600); } catch { /* not supported everywhere */ }
            renameSync(temporary, file);
        } catch { /* memory still holds it */ }
    };
    // Read-modify-write on every change, so two MCP servers (Claude Desktop and Cursor) sharing the file do not erase each other.
    const change = (apply: (state: Persisted) => void) => { const current = load(); apply(current); save(current); };

    return {
        getAccount: () => load().accounts[fingerprint],
        setAccount: accountId => change(state => { state.accounts[fingerprint] = accountId; }),
        clearAccount: () => change(state => { delete state.accounts[fingerprint]; }),
        getPending: intent => load().pending[fingerprint]?.[intent],
        setPending: (intent, operation) => change(state => { (state.pending[fingerprint] ??= {})[intent] = operation; }),
        deletePending: intent => change(state => { if (state.pending[fingerprint]) delete state.pending[fingerprint][intent]; }),
    };
}
