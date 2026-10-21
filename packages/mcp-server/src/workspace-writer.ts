import { createHash } from 'node:crypto';
import { WorkspaceAgentError, type WorkspaceApi } from './workspace-api.js';
import { isWorkspaceDate, workspaceContentMaximumBytes, workspaceUuid, type WorkspaceCategory, type WorkspaceEntry, type WorkspaceInput } from './workspace-contract.js';
import { deriveEntryId, newWorkspaceUuid, normalizeExternalKey } from './workspace-ids.js';
import type { PendingOperation, WorkspaceState } from './workspace-state.js';

/**
 * The model-facing layer: the model supplies the least it can (text, a due date, an optional external_key);
 * everything the website insists on (entry id, operation id, millisecond timestamp, account header, role,
 * input mode, current revision) is produced here.
 *
 * Duplicates are prevented three ways:
 *  1. external_key: the entry id is a UUIDv5 of (category, key), so the same key always addresses the same entry.
 *  2. an unfinished write (network dropped, timeout, 5xx) is remembered with its operation id; the same call
 *     repeated later sends the same operation again and the website returns the original receipt.
 *  3. an identical call that already succeeded within `recentWindowMs` returns that result instead of writing again
 *     (MCP clients time out and retry calls that actually finished).
 */
export interface WriterOptions {
    now?: () => Date;
    newId?: () => string;
    /** How many pages (of 20 entries, newest first) are read back when an entry has to be found. Default 15, i.e. the 300 newest entries. */
    maxScanPages?: number;
    /**
     * Total time one call may spend on everything it reads before it writes: the account lookup and the read-back
     * that finds an entry (complete_task, or after a 409). Default 60 000 ms. When it runs out the call stops with
     * `workspace_lookup_timeout`, and nothing has been changed. The single write that may follow keeps its own request timeout.
     */
    lookupTimeoutMs?: number;
    /** An identical call within this window of a success is answered from memory. Default 120 000 ms. */
    recentWindowMs?: number;
}

export type WriteAction = 'created' | 'updated' | 'unchanged';
export interface WriteResult {
    saved: true;
    action: WriteAction;
    category: string;
    entry_id: string;
    revision: number;
    occurred_at: string;
    external_key?: string;
    text?: string;
    status?: 'open' | 'done' | null;
    due_on?: string | null;
    deduplicated?: boolean;
    note?: string;
}

interface Fields { content: string; status: 'open' | 'done' | null; dueOn: string | null }
interface Spec {
    tool: string;
    category: string;
    kind: 'message' | 'task';
    /** Derived from an external_key, or null when the first attempt should pick a random id. */
    entryId: string | null;
    externalKey?: string;
    /** Fingerprint of the model's arguments; the key under which an unfinished write is remembered. */
    intent: string;
    /** complete_task: the entry must exist already; it is always read back fresh. */
    existingOnly: boolean;
    /** Answer an identical call from the last few minutes without writing again. */
    recentDedupe: boolean;
    build(existing: WorkspaceEntry | null): Fields;
}

// 20 entries of up to 64 KB each stay well inside the 4 MB response bound of the request layer.
const scanLimit = 20;
const knownLimit = 100;

function fail(code: string, message: string, details: { field?: string; outcome?: 'not_sent' | 'rejected' | 'unconfirmed' } = {}): never {
    throw new WorkspaceAgentError(code, message, details);
}

/**
 * Answers that settle a save whatever an earlier try of it did, so they stay "nothing was saved" even when they answer a replay
 * (marketplace src/app/api/agent/workspace/route.ts:74-102 and the database function it calls):
 *  - workspace_category_full (HTTP 422): raised by the cap trigger on insert, which runs after the function's replay check;
 *    an operation id the website had stored would have been answered with its receipt (migration 20261014094200 :4, :12-13).
 *    So a 422 to a replay means the earlier try was not stored, and no receipt was stored now either.
 *  - workspace_account_unavailable (409): the account row is gone (migration 20260917140000 :63, :86, :101 raise it when the
 *    point_accounts row is not found), and its entries and receipts go with it (:12, :36 on delete cascade), so nothing of
 *    this save is stored, whatever the earlier try did.
 * Every other refusal comes before the website looks at its operation ledger (key, body, size, category checks), may come from
 * something between this machine and the website, or is a status nobody documented: it says nothing about an earlier try.
 */
const SETTLES_EARLIER_TRY = new Set(['workspace_category_full', 'workspace_account_unavailable']);
const EARLIER_TRY_SENTENCE = 'An earlier try of this same save got no confirmation and may already be stored; calling again with the same arguments re-sends that try and cannot create a duplicate, so do not change the content just to retry.';
/** This call failed while an earlier try of the same call is unconfirmed: unless the answer settles it, the outcome is unknown. */
function earlierTryMayBeStored(error: unknown): unknown {
    if (!(error instanceof WorkspaceAgentError) || error.outcome === 'unconfirmed' || SETTLES_EARLIER_TRY.has(error.code)) return error;
    // The website's own sentence often ends "Nothing was saved", which is true of this try only. Say so, and report the outcome
    // as unknown (the tool result's `outcome` is what an Agent reads), or an Agent may tell the user nothing was saved, or
    // rephrase the content to retry and so store a second copy next to the one the earlier try may have saved.
    return new WorkspaceAgentError(error.code, `${error.message} ${EARLIER_TRY_SENTENCE}`, { ...error.details, outcome: 'unconfirmed' });
}
const sha = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** Checks a body of text the way the website will, so the model hears which field is wrong before anything is sent. */
function checkText(value: unknown, field: string, label: string): string {
    if (typeof value !== 'string' || !value.trim()) fail('workspace_invalid_argument', `${field} is required: pass the ${label} as non-empty text.`, { field });
    if (/\u0000/.test(value)) fail('workspace_invalid_argument', `${field} contains a NUL character, which cannot be stored. Remove it.`, { field });
    return value;
}
function checkSize(content: string, field: string): void {
    const bytes = byteLength(content);
    if (bytes > workspaceContentMaximumBytes)
        fail('workspace_invalid_argument', `${field} is ${bytes} bytes; the limit is ${workspaceContentMaximumBytes} bytes (UTF-8). Shorten it, or save it as several entries with different external_key values.`, { field });
}
function checkKey(value: string | undefined, field = 'external_key'): string | undefined {
    if (value === undefined) return undefined;
    const key = normalizeExternalKey(value);
    if (!key) fail('workspace_invalid_argument', `${field} must be 1 to 200 characters with no control characters (for example "weekly-report-2026-10-14").`, { field });
    return key;
}
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** `# Title` on top of the body unless the body already starts with exactly that heading. */
export function composeWork(content: string, title?: string): string {
    const heading = title === undefined ? '' : oneLine(title).slice(0, 200);
    if (!heading) return content;
    const first = content.trimStart().split('\n', 1)[0].trim();
    return first === `# ${heading}` ? content : `# ${heading}\n\n${content}`;
}

/** One Markdown link per visit. The label is the title (or the host); the destination is angle-bracketed so parentheses in URLs survive. */
export function composeVisit(url: URL, title?: string): string {
    const label = (oneLine(title ?? '') || url.hostname).slice(0, 300).replace(/([\\[\]])/g, '\\$1');
    return `[${label}](<${url.href}>)`;
}

export function checkVisitUrl(raw: unknown): URL {
    if (typeof raw !== 'string' || !raw.trim()) fail('workspace_invalid_argument', 'url is required: pass the full address of the page, starting with http:// or https://.', { field: 'url' });
    let url: URL;
    try { url = new URL(raw.trim()); } catch { return fail('workspace_invalid_argument', 'url is not a valid address. Pass the full address of the page, starting with http:// or https://.', { field: 'url' }); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        fail('workspace_invalid_argument', `url must start with http:// or https:// (got "${url.protocol}"). Only web pages are logged; file:, javascript: and other schemes are refused.`, { field: 'url' });
    if (url.username || url.password) fail('workspace_invalid_argument', 'url contains a user name or password. Remove them from the address; they must not be stored.', { field: 'url' });
    if (!url.hostname) fail('workspace_invalid_argument', 'url has no host name.', { field: 'url' });
    if (url.href.length > 2000) fail('workspace_invalid_argument', 'url is longer than 2000 characters.', { field: 'url' });
    return url;
}

export function createWorkspaceWriter(getApi: () => WorkspaceApi, state: WorkspaceState, options: WriterOptions = {}) {
    const clock = options.now ?? (() => new Date());
    const newId = options.newId ?? newWorkspaceUuid;
    const maxScanPages = options.maxScanPages ?? 15;
    const lookupTimeoutMs = options.lookupTimeoutMs ?? 60_000;
    const recentWindowMs = options.recentWindowMs ?? 120_000;
    let accountMemo: string | undefined;
    let categoriesMemo: WorkspaceCategory[] | undefined;
    const known = new Map<string, WorkspaceEntry>();
    /** Remember what the website last said about an entry (its revision lets the next edit skip a read). Bounded, oldest out. */
    const remember = (entry: WorkspaceEntry) => {
        known.delete(entry.id); known.set(entry.id, entry);
        for (const id of known.keys()) { if (known.size <= knownLimit) break; known.delete(id); }
    };
    const recent = new Map<string, { result: WriteResult; at: number }>();
    const inflight = new Map<string, Promise<WriteResult>>();

    /** The account behind the key: memory, then the state folder, then one read (which also tells which categories exist). */
    async function ensureAccount(signal: AbortSignal, force = false): Promise<string> {
        if (!force) {
            accountMemo ??= state.getAccount();
            if (accountMemo) return accountMemo;
        }
        const snapshot = await getApi().read({ category: 'work', limit: 1 }, signal);
        accountMemo = snapshot.accountId; categoriesMemo = snapshot.categories;
        state.setAccount(snapshot.accountId);
        return snapshot.accountId;
    }
    /** Runs `action` with the account id; if the website says the account is not the cached one, forget it, look it up again and retry once. */
    async function withAccount<T>(signal: AbortSignal, action: (accountId: string) => Promise<T>): Promise<T> {
        const accountId = await ensureAccount(signal);
        try { return await action(accountId); }
        catch (error) {
            if (!(error instanceof WorkspaceAgentError) || error.code !== 'workspace_account_changed') throw error;
            accountMemo = undefined; state.clearAccount();
            return action(await ensureAccount(signal, true));
        }
    }
    /** The categories the website lists for this key. `fresh` says whether this very call had to read them from the website. */
    async function categories(signal: AbortSignal, refresh: boolean): Promise<{ list: WorkspaceCategory[]; fresh: boolean }> {
        const read = refresh || !categoriesMemo;
        if (read) await ensureAccount(signal, true);
        return { list: categoriesMemo ?? [], fresh: read };
    }

    /** One shared time budget for the reads a single call makes before it writes. Aborting it is not the caller cancelling. */
    function lookupBudget(signal: AbortSignal) {
        const timer = AbortSignal.timeout(lookupTimeoutMs);
        return { signal: AbortSignal.any([signal, timer]), expired: () => timer.aborted && !signal.aborted };
    }
    type LookupBudget = ReturnType<typeof lookupBudget>;
    const lookupTimedOut = (spec: Spec): WorkspaceAgentError => {
        const seconds = Math.max(1, Math.round(lookupTimeoutMs / 1000)), unit = seconds === 1 ? 'second' : 'seconds';
        return new WorkspaceAgentError('workspace_lookup_timeout', spec.existingOnly
            ? `Looking for this task in the ${spec.category} category took longer than ${seconds} ${unit}, so it was not found in time and nothing was changed. The website may be slow, or the task is far back. You may try once more later; if it times out again, tell the user the task could not be completed and ask them to tick it off in their To-do pane.`
            : `Reading the entry back from the website took longer than ${seconds} ${unit}, so the call stopped and nothing was saved. The website may be slow. Try again in a moment.`,
        { field: spec.existingOnly ? 'task_id' : undefined, outcome: 'not_sent' });
    };
    /** Runs a read that may only use what is left of the budget; running out becomes `workspace_lookup_timeout`, not "cancelled". */
    async function withinBudget<T>(budget: LookupBudget, spec: Spec, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
        if (budget.expired()) throw lookupTimedOut(spec);
        try { return await read(budget.signal); }
        catch (error) {
            if (budget.expired() && error instanceof WorkspaceAgentError && error.code === 'workspace_cancelled') throw lookupTimedOut(spec);
            throw error;
        }
    }

    /** Newest-first read-back of a category until the entry turns up. `complete` is false when the scan stopped before the end. */
    async function findEntry(category: string, entryId: string, signal: AbortSignal): Promise<{ entry: WorkspaceEntry | null; complete: boolean }> {
        let cursor: string | undefined;
        for (let page = 0; page < maxScanPages; page++) {
            const snapshot = await withAccount(signal, accountId => getApi().read({ accountId, category, cursor, limit: scanLimit }, signal));
            categoriesMemo = snapshot.categories;
            const hit = snapshot.entries.find(entry => entry.id === entryId);
            if (hit) { remember(hit); return { entry: hit, complete: true }; }
            if (!snapshot.nextCursor) return { entry: null, complete: true };
            cursor = snapshot.nextCursor;
        }
        return { entry: null, complete: false };
    }

    const notFound = (spec: Spec, complete: boolean): WorkspaceAgentError => new WorkspaceAgentError('workspace_entry_not_found',
        spec.existingOnly
            ? `No task with this id${spec.externalKey ? ' / external_key' : ''} was found in the ${spec.category} category${complete ? '' : ` among the ${maxScanPages * scanLimit} most recent entries`}. Archived or deleted tasks are not visible. Create it with upsert_task first.`
            : `An entry for this external_key already exists on the website but could not be read back${complete ? ' (it is probably archived)' : ` among the ${maxScanPages * scanLimit} most recent entries`}, so it cannot be updated. Use a different external_key, or ask the user to restore it. Nothing was saved.`,
        { field: spec.existingOnly ? 'task_id' : 'external_key', outcome: 'rejected' });

    const sameAs = (entry: WorkspaceEntry, fields: Fields) => entry.content === fields.content && entry.status === fields.status && entry.dueOn === fields.dueOn;
    const describe = (spec: Spec, entry: WorkspaceEntry, action: WriteAction, extra: Partial<WriteResult> = {}): WriteResult => ({
        saved: true, action, category: entry.categoryId, entry_id: entry.id, revision: entry.revision, occurred_at: entry.occurredAt,
        ...(spec.externalKey ? { external_key: spec.externalKey } : {}),
        ...(entry.kind === 'task' ? { text: entry.content, status: entry.status, due_on: entry.dueOn } : {}),
        ...extra,
    });

    async function write(spec: Spec, signal: AbortSignal): Promise<WriteResult> {
        const budget = lookupBudget(signal);
        let accountId = await withinBudget(budget, spec, read => ensureAccount(read));
        const pending = state.getPending(accountId, spec.intent);
        const entryId = spec.entryId ?? pending?.entryId ?? newId();
        let existing: WorkspaceEntry | null = null, fresh = false;
        if (spec.existingOnly) {
            const found = await withinBudget(budget, spec, read => findEntry(spec.category, entryId, read));
            if (!found.entry) { state.deletePending(accountId, spec.intent); throw notFound(spec, found.complete); }
            existing = found.entry; fresh = true;
        } else existing = known.get(entryId) ?? null;

        let resynced = false, reusePending = !!pending && pending.entryId === entryId;
        for (;;) {
            const fields = spec.build(existing);
            if (existing && fresh && sameAs(existing, fields)) {
                state.deletePending(accountId, spec.intent);
                return describe(spec, existing, 'unchanged', { note: 'The website already holds exactly this content; nothing was written.' });
            }
            // A remembered operation is only replayed against the revision it was first sent for; otherwise the world moved on.
            let operation: PendingOperation;
            if (reusePending && pending && pending.expectedRevision === (existing?.revision ?? 0)) operation = pending;
            else operation = {
                operationId: newId(), entryId, savedAt: clock().getTime(),
                occurredAt: existing ? existing.occurredAt : clock().toISOString(),
                expectedRevision: existing ? existing.revision : 0,
                inputMode: existing ? (existing.inputMode === 'manual' ? 'manual' : 'agent') : 'agent',
                role: existing ? (existing.role === 'assistant' ? 'assistant' : null) : (spec.kind === 'message' ? 'assistant' : null),
            };
            reusePending = false;
            // A replay re-sends an operation an earlier call left unconfirmed; the website may already have committed that one.
            // `uncertain` also turns true when this very try was answered "the account or key changed" after the website may
            // have committed it: from then on, whatever the next answer is, this operation is not known to be unsaved.
            let uncertain = operation === pending;
            const input: WorkspaceInput = {
                entryId, expectedRevision: operation.expectedRevision, categoryId: spec.category, kind: spec.kind, content: fields.content,
                occurredAt: operation.occurredAt, role: operation.role, inputMode: operation.inputMode, status: fields.status, dueOn: fields.dueOn, archived: false,
            };
            state.setPending(accountId, spec.intent, operation);
            try {
                const saved = await getApi().post(accountId, operation.operationId, input, signal).catch(async error => {
                    if (!(error instanceof WorkspaceAgentError) || error.code !== 'workspace_account_changed') throw error;
                    if (error.outcome === 'unconfirmed') uncertain = true;
                    accountMemo = undefined; state.clearAccount();
                    const previous = accountId;
                    accountId = await ensureAccount(signal, true);
                    // The record follows the account the key belongs to now, which is where the next call will look for it.
                    if (accountId !== previous) { state.setPending(accountId, spec.intent, operation); state.deletePending(previous, spec.intent, operation.operationId); }
                    return getApi().post(accountId, operation.operationId, input, signal);
                });
                remember(saved.entry);
                state.deletePending(accountId, spec.intent, operation.operationId);
                return describe(spec, saved.entry, saved.entry.revision === 1 ? 'created' : 'updated');
            } catch (error) {
                if (!(error instanceof WorkspaceAgentError)) throw error;
                const conflict = error.code === 'workspace_revision_conflict' || error.code === 'workspace_intent_conflict';
                if (conflict && !resynced) {
                    // The entry already exists / changed, or this operation id was spent on an earlier version: read the truth back and decide again.
                    resynced = true; state.deletePending(accountId, spec.intent, operation.operationId); known.delete(entryId);
                    const found = await withinBudget(budget, spec, read => findEntry(spec.category, entryId, read));
                    if (!found.entry) throw notFound(spec, found.complete);
                    existing = found.entry; fresh = true;
                    continue;
                }
                // A refused fresh operation wrote nothing, so its record can go. A refused replay (429, rejected key, a 400/403/413,
                // an unknown HTTP status) only says this try failed; the earlier unconfirmed try may have been committed, so its record
                // stays and the next call re-sends the same operation and entry id instead of minting new ones and duplicating the entry.
                // What settles it: the website's 409 answers about an operation id (handled above), and the answers in
                // SETTLES_EARLIER_TRY (a 422 "category full" comes after the replay check; an unavailable account holds nothing).
                const settled = SETTLES_EARLIER_TRY.has(error.code);
                if (error.outcome !== 'unconfirmed' && (!uncertain || settled)) state.deletePending(accountId, spec.intent, operation.operationId);
                if (uncertain && !conflict) throw earlierTryMayBeStored(error);
                if (conflict) throw new WorkspaceAgentError('workspace_revision_conflict',
                    'The entry kept changing while it was being saved (someone else is editing it). Nothing was saved by this call. Try again in a moment.', { field: 'expectedRevision', outcome: 'rejected' });
                throw error;
            }
        }
    }

    async function perform(spec: Spec, signal: AbortSignal): Promise<WriteResult> {
        if (spec.recentDedupe) {
            const hit = recent.get(spec.intent);
            if (hit && clock().getTime() - hit.at < recentWindowMs)
                return { ...hit.result, deduplicated: true, note: 'An identical call succeeded moments ago, so nothing new was written. To store a second copy on purpose, change the content.' };
        }
        const running = inflight.get(spec.intent);
        if (running) return running;
        const job = write(spec, signal).then(result => {
            if (spec.recentDedupe) {
                const at = clock().getTime();
                recent.set(spec.intent, { result, at });
                if (recent.size > 200) for (const [intent, item] of recent) if (at - item.at >= recentWindowMs) recent.delete(intent);
            }
            return result;
        }).finally(() => { inflight.delete(spec.intent); });
        inflight.set(spec.intent, job);
        return job;
    }

    function messageSpec(tool: string, category: string, content: string, externalKey: string | undefined, intentParts: unknown[]): Spec {
        checkSize(content, 'content');
        return {
            tool, category, kind: 'message', externalKey, existingOnly: false, recentDedupe: externalKey === undefined,
            entryId: externalKey === undefined ? null : deriveEntryId(category, externalKey),
            intent: sha([tool, ...intentParts]),
            build: () => ({ content, status: null, dueOn: null }),
        };
    }

    return {
        /** Work output (Markdown) into the `work` category. */
        async saveWork(args: { content: unknown; title?: string; external_key?: string }, signal: AbortSignal): Promise<WriteResult> {
            const body = checkText(args.content, 'content', 'Markdown text to save');
            if (args.title !== undefined && typeof args.title !== 'string') fail('workspace_invalid_argument', 'title must be text.', { field: 'title' });
            const key = checkKey(args.external_key);
            const content = composeWork(body, args.title);
            return perform(messageSpec('save_work', 'work', content, key, [content, key ?? null]), signal);
        },

        /** A task into `todo`: created, or (same external_key) edited. Omitted due_on / done keep what the task already has. */
        async upsertTask(args: { text: unknown; due_on?: string | null; external_key?: string; done?: boolean }, signal: AbortSignal): Promise<WriteResult> {
            const text = checkText(args.text, 'text', 'task, one short sentence').trim();
            checkSize(text, 'text');
            if (args.due_on !== undefined && args.due_on !== null && !isWorkspaceDate(args.due_on))
                fail('workspace_invalid_argument', 'due_on must be a real calendar date written YYYY-MM-DD (for example 2026-10-15). The task has no time of day and no reminder.', { field: 'due_on' });
            if (args.done !== undefined && typeof args.done !== 'boolean') fail('workspace_invalid_argument', 'done must be true or false.', { field: 'done' });
            const key = checkKey(args.external_key);
            const spec: Spec = {
                tool: 'upsert_task', category: 'todo', kind: 'task', externalKey: key, existingOnly: false, recentDedupe: key === undefined,
                entryId: key === undefined ? null : deriveEntryId('todo', key),
                intent: sha(['upsert_task', text, args.due_on === undefined ? '~keep' : args.due_on, key ?? null, args.done ?? '~keep']),
                build: existing => ({
                    content: text,
                    status: args.done === undefined ? (existing?.status === 'done' ? 'done' : 'open') : (args.done ? 'done' : 'open'),
                    dueOn: args.due_on === undefined ? (existing?.dueOn ?? null) : args.due_on,
                }),
            };
            return perform(spec, signal);
        },

        /** Mark a task done, by the task_id that upsert_task returned or by the external_key it was created with. */
        async completeTask(args: { task_id?: string; external_key?: string }, signal: AbortSignal): Promise<WriteResult> {
            const key = checkKey(args.external_key);
            if (args.task_id !== undefined && (typeof args.task_id !== 'string' || !workspaceUuid.test(args.task_id)))
                fail('workspace_invalid_argument', 'task_id must be the UUID returned as entry_id by upsert_task (or listed by prometheus_read_workspace).', { field: 'task_id' });
            if (args.task_id === undefined && key === undefined) fail('workspace_invalid_argument', 'Pass task_id (the entry_id upsert_task returned) or the external_key the task was created with.', { field: 'task_id' });
            const derived = key === undefined ? undefined : deriveEntryId('todo', key);
            if (args.task_id !== undefined && derived !== undefined && args.task_id.toLowerCase() !== derived)
                fail('workspace_invalid_argument', 'task_id and external_key point at different tasks. Pass only one of them.', { field: 'task_id' });
            const entryId = (derived ?? args.task_id!.toLowerCase());
            const spec: Spec = {
                tool: 'complete_task', category: 'todo', kind: 'task', entryId, externalKey: key, existingOnly: true, recentDedupe: false,
                intent: sha(['complete_task', entryId]),
                build: existing => ({ content: existing!.content, status: 'done', dueOn: existing!.dueOn }),
            };
            return perform(spec, signal);
        },

        /** One Markdown link in `browse`. Only possible while the website lists that category for this key; otherwise a clear refusal, nothing saved. */
        async logVisitedPage(args: { url: unknown; title?: string }, signal: AbortSignal): Promise<WriteResult> {
            const url = checkVisitUrl(args.url);
            if (args.title !== undefined && typeof args.title !== 'string') fail('workspace_invalid_argument', 'title must be text.', { field: 'title' });
            const unavailable = () => new WorkspaceAgentError('workspace_browse_unavailable',
                'The Prometheus website does not list the "browse" category for this key, so visited pages cannot be saved right now. Nothing was saved. This is not an error in your call: logging works again by itself once the website lists the category, so do not retry now and do not tell the user the page was logged.',
                { field: 'category', outcome: 'rejected' });
            const listed = (all: WorkspaceCategory[]) => all.some(category => category.id === 'browse' && category.presentation === 'markdown');
            let { list, fresh } = await categories(signal, false);
            if (!listed(list) && !fresh) list = (await categories(signal, true)).list; // the website may have gained the category since the last read
            if (!listed(list)) throw unavailable();
            const content = composeVisit(url, args.title);
            try { return await perform(messageSpec('log_visited_page', 'browse', content, undefined, [content]), signal); }
            catch (error) {
                if (error instanceof WorkspaceAgentError && ['workspace_category_missing', 'workspace_input_rejected'].includes(error.code) && !listed((await categories(signal, true)).list)) throw unavailable();
                throw error;
            }
        },
    };
}
export type WorkspaceWriter = ReturnType<typeof createWorkspaceWriter>;
