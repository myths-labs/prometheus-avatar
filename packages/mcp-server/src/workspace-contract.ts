export const workspaceUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const workspaceContentMaximumBytes = 65536;
// JSON can escape one content byte as six bytes; allow the validated envelope too.
export const workspaceRequestMaximumBytes = workspaceContentMaximumBytes * 6 + 4096;
const categoryId = /^[a-z][a-z0-9_-]{0,63}$/;
const encoder = new TextEncoder();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, fields: string) => Object.keys(value).sort().join(',') === fields;
const date = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
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
export interface WorkspaceCategory { id: string; title: string; presentation: 'chat' | 'markdown' | 'tasks' }
export interface WorkspaceSnapshot { accountId: string; categories: WorkspaceCategory[]; entries: WorkspaceEntry[]; nextCursor: string | null }
export interface WorkspaceReceipt { accountId: string; operationId: string; entry: WorkspaceEntry }

/** Preserve text verbatim, including Markdown, while bounding bytes and typed fields. */
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
        || !['open', 'done'].includes(value.status as string) || (value.dueOn !== null && !date(value.dueOn))) return null;
    return { entryId: value.entryId.toLowerCase(), expectedRevision: value.expectedRevision as number,
        categoryId: value.categoryId, kind: value.kind as WorkspaceInput['kind'], content: value.content, occurredAt: value.occurredAt,
        role: value.role as WorkspaceInput['role'], inputMode: value.inputMode as WorkspaceInput['inputMode'],
        status: value.status as WorkspaceInput['status'], dueOn: value.dueOn as string | null, archived: value.archived };
}

export function parseWorkspaceEntry(value: unknown): WorkspaceEntry | null {
    if (!record(value) || !keys(value, 'archived,categoryId,content,createdAt,dueOn,id,inputMode,kind,occurredAt,revision,role,sequence,status,updatedAt')
        || !isWorkspaceSequence(value.sequence) || !Number.isInteger(value.revision) || (value.revision as number) < 1
        || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) return null;
    const { id, revision, sequence, createdAt, updatedAt, ...fields } = value;
    const input = readWorkspaceInput({ ...fields, entryId: id, expectedRevision: (revision as number) - 1 });
    if (!input) return null;
    const { entryId, expectedRevision: _, ...rest } = input;
    return { ...rest, id: entryId, revision: revision as number, sequence, createdAt, updatedAt };
}

export function parseWorkspaceReceipt(value: unknown, scope: { accountId: string; operationId: string; input?: WorkspaceInput }): WorkspaceReceipt | null {
    if (!record(value) || !keys(value, 'accountId,entry,operationId') || value.accountId !== scope.accountId
        || value.operationId !== scope.operationId || !workspaceUuid.test(scope.accountId) || !workspaceUuid.test(scope.operationId)) return null;
    const entry = parseWorkspaceEntry(value.entry); if (!entry) return null;
    if (scope.input) {
        const { entryId, expectedRevision, ...fields } = scope.input;
        if (entry.id !== entryId || entry.revision !== expectedRevision + 1
            || Object.entries(fields).some(([name, field]) => entry[name as keyof WorkspaceEntry] !== field)) return null;
    }
    return { accountId: scope.accountId, operationId: scope.operationId, entry };
}

export function parseWorkspaceSnapshot(value: unknown, scope: { accountId: string; categoryId?: string; before?: string; limit: number }): WorkspaceSnapshot | null {
    if (!record(value) || !keys(value, 'accountId,categories,entries,nextCursor') || value.accountId !== scope.accountId
        || !workspaceUuid.test(scope.accountId) || !Number.isInteger(scope.limit) || scope.limit < 1 || scope.limit > 50
        || !Array.isArray(value.categories) || !value.categories.length || value.categories.length > 128
        || !Array.isArray(value.entries) || value.entries.length > scope.limit
        || (value.nextCursor !== null && !isWorkspaceSequence(value.nextCursor)) || (scope.before !== undefined && !isWorkspaceSequence(scope.before))) return null;
    const categories: WorkspaceCategory[] = [], entries: WorkspaceEntry[] = [];
    for (const raw of value.categories) {
        if (!record(raw) || !keys(raw, 'id,presentation,title') || typeof raw.id !== 'string' || !categoryId.test(raw.id)
            || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 80
            || !['chat', 'markdown', 'tasks'].includes(raw.presentation as string) || categories.some(row => row.id === raw.id)) return null;
        categories.push(raw as unknown as WorkspaceCategory);
    }
    if (scope.categoryId !== undefined && !categories.some(category => category.id === scope.categoryId)) return null;
    let previous = scope.before;
    for (const raw of value.entries) {
        const entry = parseWorkspaceEntry(raw), category = entry && categories.find(row => row.id === entry.categoryId);
        if (!entry || !category || entry.archived || (entry.kind === 'task') !== (category.presentation === 'tasks')
            || (scope.categoryId && entry.categoryId !== scope.categoryId) || entries.some(row => row.id === entry.id)
            || (previous && BigInt(entry.sequence) >= BigInt(previous))) return null;
        previous = entry.sequence; entries.push(entry);
    }
    if (value.nextCursor !== null && (entries.length !== scope.limit || value.nextCursor !== previous)) return null;
    return { accountId: scope.accountId, categories, entries, nextCursor: value.nextCursor };
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
