/**
 * Copy of the Prometheus website's workspace contract (marketplace-app `src/lib/appWorkspace.ts`).
 *
 * Two different rules apply, on purpose:
 *
 *  - Everything this package SENDS is validated as strictly as the website validates it
 *    (`readWorkspaceInput`: exactly the 11 entry keys, millisecond timestamps, ...). A request that
 *    would be rejected is caught here, before the network.
 *
 *  - Everything this package READS BACK (snapshots, receipts, operation lookups) ignores keys it does
 *    not know. The website will add nullable fields later, and a package that is already installed on
 *    a user's machine cannot be redeployed, so it must keep working when the response grows. Values it
 *    cannot interpret (for example an entry kind that does not exist yet) are skipped and counted, not
 *    turned into a failure of the whole read.
 */
export const workspaceUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const workspaceContentMaximumBytes = 65536;
// JSON can escape one content byte as six bytes; allow the validated envelope too.
export const workspaceRequestMaximumBytes = workspaceContentMaximumBytes * 6 + 4096;
const categoryId = /^[a-z][a-z0-9_-]{0,63}$/;
const encoder = new TextEncoder();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, fields: string) => Object.keys(value).sort().join(',') === fields;
const has = (value: Record<string, unknown>, name: string) => Object.prototype.hasOwnProperty.call(value, name);
/** The named keys of `value`, or null when one is missing. Extra keys are left behind. */
function pick(value: Record<string, unknown>, names: readonly string[]): Record<string, unknown> | null {
    const out: Record<string, unknown> = {};
    for (const name of names) {
        if (!has(value, name)) return null;
        out[name] = value[name];
    }
    return out;
}
export const isWorkspaceDate = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
    && value.slice(0, 4) !== '0000' && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): value is string => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export const isWorkspaceSequence = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
    && BigInt(value) <= BigInt('9223372036854775807');

export interface WorkspaceInput {
    entryId: string;
    expectedRevision: number;
    categoryId: string;
    kind: 'message' | 'task';
    content: string;
    occurredAt: string;
    role: 'user' | 'assistant' | null;
    inputMode: 'text' | 'voice' | 'manual' | 'agent';
    status: 'open' | 'done' | null;
    dueOn: string | null;
    archived: boolean;
}
export interface WorkspaceEntry extends Omit<WorkspaceInput, 'entryId' | 'expectedRevision'> {
    id: string;
    sequence: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
}
/** `chat`, `markdown` and `tasks` are the presentations that exist today; a newer website may add others. */
export type WorkspacePresentation = 'chat' | 'markdown' | 'tasks' | (string & {});
export interface WorkspaceCategory { id: string; title: string; presentation: WorkspacePresentation }
export interface WorkspaceSnapshot {
    accountId: string;
    categories: WorkspaceCategory[];
    entries: WorkspaceEntry[];
    nextCursor: string | null;
    /** Entries the website returned that this package version cannot interpret (only present when > 0). */
    skippedEntries?: number;
}
export interface WorkspaceReceipt { accountId: string; operationId: string; entry: WorkspaceEntry }

/** Preserve text verbatim, including Markdown, while bounding bytes and typed fields. STRICT: this is the request shape. */
export function readWorkspaceInput(value: unknown): WorkspaceInput | null {
    if (!record(value) || !keys(value, 'archived,categoryId,content,dueOn,entryId,expectedRevision,inputMode,kind,occurredAt,role,status')
        || typeof value.entryId !== 'string' || !workspaceUuid.test(value.entryId)
        || !Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 || (value.expectedRevision as number) > 999999998
        || typeof value.categoryId !== 'string' || !categoryId.test(value.categoryId)
        || typeof value.content !== 'string' || !value.content.trim() || /\u0000/.test(value.content) || encoder.encode(value.content).length > workspaceContentMaximumBytes
        || !timestamp(value.occurredAt) || value.occurredAt.slice(0, 4) === '0000' || new Date(value.occurredAt).toISOString() !== value.occurredAt
        || typeof value.archived !== 'boolean' || !['message', 'task'].includes(value.kind as string)
        || !['text', 'voice', 'manual', 'agent'].includes(value.inputMode as string)) return null;
    if (value.kind === 'message') {
        if (!['user', 'assistant'].includes(value.role as string) || value.status !== null || value.dueOn !== null) return null;
    } else if (value.role !== null || !['manual', 'agent'].includes(value.inputMode as string)
        || !['open', 'done'].includes(value.status as string) || (value.dueOn !== null && !isWorkspaceDate(value.dueOn))) return null;
    return { entryId: value.entryId.toLowerCase(), expectedRevision: value.expectedRevision as number,
        categoryId: value.categoryId, kind: value.kind as WorkspaceInput['kind'], content: value.content, occurredAt: value.occurredAt,
        role: value.role as WorkspaceInput['role'], inputMode: value.inputMode as WorkspaceInput['inputMode'],
        status: value.status as WorkspaceInput['status'], dueOn: value.dueOn as string | null, archived: value.archived };
}

const ENTRY_KEYS = ['archived', 'categoryId', 'content', 'createdAt', 'dueOn', 'id', 'inputMode', 'kind', 'occurredAt', 'revision', 'role', 'sequence', 'status', 'updatedAt'] as const;

/** LENIENT: needs the 14 known keys, ignores any others. */
export function parseWorkspaceEntry(value: unknown): WorkspaceEntry | null {
    const known = record(value) ? pick(value, ENTRY_KEYS) : null;
    if (!known || !isWorkspaceSequence(known.sequence) || !Number.isInteger(known.revision) || (known.revision as number) < 1
        || !timestamp(known.createdAt) || !timestamp(known.updatedAt)) return null;
    const { id, revision, sequence, createdAt, updatedAt, ...fields } = known;
    const input = readWorkspaceInput({ ...fields, entryId: id, expectedRevision: (revision as number) - 1 });
    if (!input) return null;
    const { entryId, expectedRevision: _, ...rest } = input;
    return { ...rest, id: entryId, revision: revision as number, sequence: sequence as string, createdAt: createdAt as string, updatedAt: updatedAt as string };
}

/** LENIENT: extra keys on the receipt and on its entry are ignored. */
export function parseWorkspaceReceipt(value: unknown, scope: { accountId: string; operationId: string; input?: WorkspaceInput }): WorkspaceReceipt | null {
    if (!record(value) || !has(value, 'entry') || value.accountId !== scope.accountId
        || value.operationId !== scope.operationId || !workspaceUuid.test(scope.accountId) || !workspaceUuid.test(scope.operationId)) return null;
    const entry = parseWorkspaceEntry(value.entry); if (!entry) return null;
    if (scope.input) {
        const { entryId, expectedRevision, ...fields } = scope.input;
        if (entry.id !== entryId || entry.revision !== expectedRevision + 1
            || Object.entries(fields).some(([name, field]) => entry[name as keyof WorkspaceEntry] !== field)) return null;
    }
    return { accountId: scope.accountId, operationId: scope.operationId, entry };
}

/**
 * LENIENT on unknown keys (snapshot, categories, entries) and on entries it cannot interpret (skipped and
 * counted). STRICT on what would be a data leak or a lie: another account, an entry that belongs to a
 * category that was not asked for or is not listed, rows out of order, a cursor that does not match the page.
 */
export function parseWorkspaceSnapshot(value: unknown, scope: { accountId: string; categoryId?: string; before?: string; limit: number }): WorkspaceSnapshot | null {
    if (!record(value) || !has(value, 'categories') || !has(value, 'entries') || !has(value, 'nextCursor') || value.accountId !== scope.accountId
        || !workspaceUuid.test(scope.accountId) || !Number.isInteger(scope.limit) || scope.limit < 1 || scope.limit > 50
        || !Array.isArray(value.categories) || !value.categories.length || value.categories.length > 128
        || !Array.isArray(value.entries) || value.entries.length > scope.limit
        || (value.nextCursor !== null && !isWorkspaceSequence(value.nextCursor)) || (scope.before !== undefined && !isWorkspaceSequence(scope.before))) return null;
    const categories: WorkspaceCategory[] = [], entries: WorkspaceEntry[] = [];
    for (const raw of value.categories) {
        const known = record(raw) ? pick(raw, ['id', 'presentation', 'title']) : null;
        if (!known || typeof known.id !== 'string' || !categoryId.test(known.id)
            || typeof known.title !== 'string' || !known.title.trim() || known.title.length > 80
            || typeof known.presentation !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(known.presentation)
            || categories.some(row => row.id === known.id)) return null;
        categories.push({ id: known.id, title: known.title, presentation: known.presentation });
    }
    if (scope.categoryId !== undefined && !categories.some(category => category.id === scope.categoryId)) return null;
    let previous = scope.before, skipped = 0;
    for (const raw of value.entries) {
        const entry = parseWorkspaceEntry(raw);
        if (!entry) {
            // Not interpretable by this version. It still has to sit in the page in order, otherwise the page cannot be trusted.
            const sequence = record(raw) ? raw.sequence : undefined;
            if (!isWorkspaceSequence(sequence) || (previous && BigInt(sequence) >= BigInt(previous))) return null;
            previous = sequence; skipped++; continue;
        }
        const category = categories.find(row => row.id === entry.categoryId);
        if (!category || (scope.categoryId && entry.categoryId !== scope.categoryId) || entries.some(row => row.id === entry.id)
            || (previous && BigInt(entry.sequence) >= BigInt(previous))) return null;
        previous = entry.sequence;
        if (entry.archived || (entry.kind === 'task') !== (category.presentation === 'tasks')) { skipped++; continue; }
        entries.push(entry);
    }
    if (value.nextCursor !== null && (entries.length + skipped !== scope.limit || value.nextCursor !== previous)) return null;
    return { accountId: scope.accountId, categories, entries, nextCursor: value.nextCursor, ...(skipped ? { skippedEntries: skipped } : {}) };
}

export class WorkspaceRequestError extends Error {
    constructor(message: string, public readonly status: number) { super(message); }
}
/** Count actual streamed bytes and reject malformed UTF-8 before parsing JSON. */
export async function readWorkspaceJson(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal, maximumBytes = workspaceRequestMaximumBytes): Promise<unknown> {
    if (!body) throw new WorkspaceRequestError('JSON content is required.', 400);
    if (!Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024) throw new WorkspaceRequestError('Invalid JSON byte limit.', 400);
    const reader = body.getReader(), chunks: Uint8Array[] = []; let bytes = 0, count = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        for (;;) {
            if (signal?.aborted) throw new WorkspaceRequestError('The request was cancelled.', 408);
            const next = await reader.read(); if (next.done) break;
            bytes += next.value.byteLength; count++;
            if (bytes > maximumBytes || count > 12000) { await reader.cancel(); throw new WorkspaceRequestError('The request is too large.', 413); }
            chunks.push(next.value);
        }
        const raw = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
        catch { throw new WorkspaceRequestError('Valid UTF-8 JSON is required.', 400); }
    } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}

/**
 * Names the first field of an outgoing entry that the website would refuse, in words a model can act on.
 * Returns null when `readWorkspaceInput` accepts the value.
 */
export function describeWorkspaceInputProblem(value: unknown): { field: string; problem: string } | null {
    if (!record(value)) return { field: 'entry', problem: 'must be an object with exactly the 11 entry fields' };
    const expected = ['archived', 'categoryId', 'content', 'dueOn', 'entryId', 'expectedRevision', 'inputMode', 'kind', 'occurredAt', 'role', 'status'];
    for (const name of expected) if (!has(value, name)) return { field: name, problem: 'is missing (the entry needs exactly these 11 fields: ' + expected.join(', ') + ')' };
    const extra = Object.keys(value).find(name => !expected.includes(name));
    if (extra) return { field: extra, problem: 'is not an entry field (the entry needs exactly these 11 fields: ' + expected.join(', ') + ')' };
    if (typeof value.entryId !== 'string' || !workspaceUuid.test(value.entryId)) return { field: 'entryId', problem: 'must be a UUID' };
    if (!Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 || (value.expectedRevision as number) > 999999998)
        return { field: 'expectedRevision', problem: 'must be an integer from 0 (new entry) to 999999998 (the current revision when editing)' };
    if (typeof value.categoryId !== 'string' || !categoryId.test(value.categoryId)) return { field: 'categoryId', problem: 'must be a lowercase category id such as "work" or "todo"' };
    if (!['message', 'task'].includes(value.kind as string)) return { field: 'kind', problem: 'must be "message" (work output) or "task"' };
    if (typeof value.content !== 'string' || !value.content.trim()) return { field: 'content', problem: 'must be non-empty text' };
    if (/\u0000/.test(value.content)) return { field: 'content', problem: 'must not contain NUL characters' };
    const bytes = encoder.encode(value.content).length;
    if (bytes > workspaceContentMaximumBytes) return { field: 'content', problem: `is ${bytes} bytes; the limit is ${workspaceContentMaximumBytes} bytes (UTF-8). Shorten it or split it into several entries` };
    if (!timestamp(value.occurredAt) || value.occurredAt.slice(0, 4) === '0000' || new Date(value.occurredAt).toISOString() !== value.occurredAt)
        return { field: 'occurredAt', problem: 'must be a UTC timestamp with milliseconds and a trailing Z, for example 2026-10-14T01:30:00.123Z' };
    if (typeof value.archived !== 'boolean') return { field: 'archived', problem: 'must be true or false' };
    if (!['text', 'voice', 'manual', 'agent'].includes(value.inputMode as string)) return { field: 'inputMode', problem: 'must be "agent" for entries written by an agent' };
    if (value.kind === 'message') {
        if (!['user', 'assistant'].includes(value.role as string)) return { field: 'role', problem: 'must be "assistant" for work output' };
        if (value.status !== null) return { field: 'status', problem: 'must be null for work output' };
        if (value.dueOn !== null) return { field: 'dueOn', problem: 'must be null for work output' };
    } else {
        if (value.role !== null) return { field: 'role', problem: 'must be null for a task' };
        if (!['manual', 'agent'].includes(value.inputMode as string)) return { field: 'inputMode', problem: 'must be "agent" (or "manual" when editing a task the user created) for a task' };
        if (!['open', 'done'].includes(value.status as string)) return { field: 'status', problem: 'must be "open" or "done" for a task' };
        if (value.dueOn !== null && !isWorkspaceDate(value.dueOn)) return { field: 'dueOn', problem: 'must be a real calendar date written YYYY-MM-DD, or null' };
    }
    return null;
}
