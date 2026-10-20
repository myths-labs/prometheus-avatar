import {
    describeWorkspaceInputProblem, isWorkspaceSequence, parseWorkspaceReceipt, parseWorkspaceSnapshot, readWorkspaceInput, readWorkspaceJson,
    WorkspaceRequestError, workspaceUuid, type WorkspaceInput, type WorkspaceReceipt, type WorkspaceSnapshot,
} from './workspace-contract.js';

/**
 * What a failed call tells you about the write:
 *  - `not_sent`    nothing reached the website (or it was a read); nothing changed.
 *  - `rejected`    the website looked at it and said no; nothing was saved. The same call will fail the same way.
 *  - `unconfirmed` it may or may not have been saved. Repeating the SAME operation is safe (the website remembers operation ids).
 */
export type WorkspaceOutcome = 'not_sent' | 'rejected' | 'unconfirmed';
export interface WorkspaceErrorDetails { status?: number; field?: string; outcome?: WorkspaceOutcome; siteMessage?: string; retryAfterSeconds?: number }

/** An error whose text is written for the model that has to act on it. `message` never contains the website's raw text or any key. */
export class WorkspaceAgentError extends Error {
    readonly outcome: WorkspaceOutcome;
    constructor(readonly code: string, message: string, readonly details: WorkspaceErrorDetails = {}) {
        super(message);
        this.name = 'WorkspaceAgentError';
        this.outcome = details.outcome ?? 'not_sent';
    }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validCategory = (value: string) => /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const KEY_PAGE = 'https://prometheus.mythslabs.ai/settings/agent-keys';
const maxResponseBytes = 4 * 1024 * 1024; // a page of 20 entries of 64 KB, with room for JSON escaping
const RETRY_SAFE = 'Call this tool again with exactly the same arguments: the operation id is remembered, so a repeat cannot create a duplicate.';

function fail(code: string, message: string, details?: WorkspaceErrorDetails): never {
    throw new WorkspaceAgentError(code, message, details);
}
function uuid(value: string, label: string): string {
    if (!workspaceUuid.test(value)) fail('workspace_invalid_identifier', `${label} must be a UUID (for example 3f2b8c1e-5d4a-4e7b-9c1d-2a6f8b0e4d17).`, { field: label });
    return value.toLowerCase();
}

const CATEGORY_FULL = { code: 'workspace_category_full', field: 'category', outcome: 'rejected' as const,
    text: 'This workspace category is full: it already holds 2,000 active (not archived) entries, so nothing was saved. Do not retry; the same call will be refused until there is room. Ask the user to archive or delete some older entries in this category of their Prometheus workspace, then try again.' };

/** The website's own error sentences (static strings in its route) mapped to what they mean for a caller of this package. */
const SITE_MESSAGES: Record<string, { code: string; field?: string; outcome?: WorkspaceOutcome; text: string }> = {
    'Use an active Agent key with verified account ownership.': { code: 'workspace_key_rejected', outcome: 'rejected',
        text: `The Prometheus website did not accept the Agent key in PROMETHEUS_API_KEY (it is missing, mistyped, revoked, or its account is not verified). Nothing was saved. Ask the user to open ${KEY_PAGE}, click Generate key, and put the new key in this MCP server's PROMETHEUS_API_KEY setting. Generating a key revokes the previous one.` },
    'The Agent key is no longer active. Keep the original operation for recovery.': { code: 'workspace_key_rejected', outcome: 'unconfirmed',
        text: `The Agent key stopped being valid while the request was running, so the website cannot say whether it saved. Ask the user to check the key at ${KEY_PAGE}. After the key is fixed, call this tool again with the same arguments: it will not create a duplicate.` },
    'The Agent account changed. Read its workspace before using the original operation.': { code: 'workspace_account_changed', outcome: 'rejected',
        text: 'The website says the account behind this key is not the account this server last used. The server re-reads the account itself; if this keeps happening the key was replaced mid-session.' },
    'The Agent account or key changed. Recover through the original account.': { code: 'workspace_account_changed', outcome: 'unconfirmed',
        text: 'The account or key changed while the request was running. Call this tool again with the same arguments.' },
    'The Agent account is unavailable.': { code: 'workspace_account_unavailable', outcome: 'rejected',
        text: 'The website says the account behind this key is unavailable (it may have been deleted or suspended). Nothing was saved.' },
    'Use the original entry and operation.': { code: 'workspace_request_shape', outcome: 'rejected',
        text: 'The website rejected the shape of the request (it expects exactly operationId plus an entry with exactly 11 fields). This server and the website disagree about the format. Ask the user to update @prometheusavatar/mcp-server to the latest version. Nothing was saved.' },
    'Use Agent work output or an existing task with its original creation details.': { code: 'workspace_entry_rejected', outcome: 'rejected',
        text: 'The website rejected the entry. For new work output it requires role "assistant" and inputMode "agent"; for a new task it requires inputMode "agent"; occurredAt must be a UTC time with milliseconds ending in Z (for example 2026-10-14T01:30:00.123Z); when editing, category, kind, role, inputMode and occurredAt must stay exactly as first saved. This server fills these in itself, so this usually means it is out of date: ask the user to update @prometheusavatar/mcp-server. Nothing was saved.' },
    'Check the workspace entry or filter.': { code: 'workspace_input_rejected', field: 'category', outcome: 'rejected',
        text: 'The website refused the entry or filter. The usual cause is a category that does not exist in this workspace; the other is an edit that tried to change something that cannot change after the first save (category, kind, role, inputMode, occurredAt). Nothing was saved.' },
    'Use an existing workspace category.': { code: 'workspace_category_missing', field: 'category', outcome: 'rejected',
        text: 'The website does not have this workspace category. Nothing was saved.' },
    'Use the matching work or task category.': { code: 'workspace_category_kind_mismatch', field: 'category', outcome: 'rejected',
        text: 'Tasks can only go into a task category and Markdown work output only into a Markdown category. Nothing was saved.' },
    'This Agent path is for work output and tasks.': { code: 'workspace_category_forbidden', field: 'category', outcome: 'rejected',
        text: 'Agent keys can only read and write work output and tasks (not chat). Nothing was saved.' },
    'This entry changed. Read its current revision before editing.': { code: 'workspace_revision_conflict', field: 'expectedRevision', outcome: 'rejected',
        text: 'The entry was changed since it was last read (or it already exists), so the revision number sent was out of date. Nothing was saved.' },
    'This operation saved different details. Recover its original result.': { code: 'workspace_intent_conflict', outcome: 'rejected',
        text: 'This operation id was already used for different content. Use a new operation id for new content. Nothing was changed by this call.' },
    'Use one valid workspace filter or original operation.': { code: 'workspace_filter_rejected', outcome: 'rejected', text: 'The website rejected the read filter (only category, cursor and limit are allowed).' },
    'Use a valid category, cursor and page size.': { code: 'workspace_filter_rejected', field: 'category', outcome: 'rejected',
        text: 'The website rejected the read filter: category must be lowercase letters, digits, - or _; cursor must be a number returned as nextCursor; limit must be 1 to 50.' },
    'Use the original operation identifier.': { code: 'workspace_filter_rejected', field: 'operation_id', outcome: 'rejected', text: 'operation_id must be a UUID.' },
    // HTTP 422 with code WORKSPACE_CATEGORY_FULL (work, todo and browse hold at most 2,000 entries that are not archived, per account).
    // Final: the website stored no receipt, so nothing was saved and the same call fails the same way until there is room.
    'This workspace category is full (2,000 entries). Nothing was saved. Do not retry; archive older entries to make room.': CATEGORY_FULL,
};
/** The website's machine-readable `code`, checked before the sentence so a reworded sentence still maps. */
const SITE_CODES: Record<string, { code: string; field?: string; outcome?: WorkspaceOutcome; text: string }> = {
    WORKSPACE_CATEGORY_FULL: CATEGORY_FULL,
};
const own = <T>(map: Record<string, T>, key: string | undefined): T | undefined =>
    key !== undefined && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

function fromHttp(status: number, site: SiteError, retryAfterSeconds: number | undefined, writing: boolean): WorkspaceAgentError {
    const details = (extra: WorkspaceErrorDetails = {}): WorkspaceErrorDetails => ({ status, ...extra });
    const siteMessage = site.error;
    // Own keys only: a sentence such as "constructor" or "__proto__" must not resolve to something inherited from Object.
    const known = own(SITE_CODES, site.code) ?? own(SITE_MESSAGES, siteMessage);
    if (known) return new WorkspaceAgentError(known.code, known.text, details({ field: known.field, outcome: known.outcome ?? 'rejected', siteMessage }));
    if (status === 401) return new WorkspaceAgentError('workspace_key_rejected', SITE_MESSAGES['Use an active Agent key with verified account ownership.'].text, details({ outcome: 'rejected' }));
    if (status === 403) return new WorkspaceAgentError('workspace_category_forbidden', SITE_MESSAGES['This Agent path is for work output and tasks.'].text, details({ outcome: 'rejected' }));
    if (status === 413) return new WorkspaceAgentError('workspace_too_large', 'The website says the request is too large (content limit is 65536 bytes of UTF-8). Nothing was saved. Shorten the content or split it into several entries.', details({ field: 'content', outcome: 'rejected' }));
    if (status === 415) return new WorkspaceAgentError('workspace_unsupported_media', 'The website refused the request content type. This server sends JSON; something between this machine and the website is rewriting requests.', details({ outcome: 'rejected' }));
    if (status === 429) {
        const wait = retryAfterSeconds ? ` Wait about ${retryAfterSeconds} seconds before trying again.` : ' Wait a minute before trying again.';
        // The website limits reads too (marketplace K11a: per key, read, write and operation look-up each have their own allowance).
        return new WorkspaceAgentError('workspace_rate_limited', writing
            ? `The website is limiting how fast this key can write.${wait} Nothing was saved by this call.`
            : `The website is limiting how fast this key can read.${wait} Nothing was changed.`, details({ outcome: 'rejected', retryAfterSeconds }));
    }
    if (status === 408 || status >= 500) {
        return new WorkspaceAgentError('workspace_result_unconfirmed',
            `The website did not confirm the ${writing ? 'save' : 'read'} (HTTP ${status}). ${writing ? 'It may or may not have been saved. ' + RETRY_SAFE : 'Nothing was changed; try again.'}`,
            details({ outcome: writing ? 'unconfirmed' : 'not_sent' }));
    }
    return new WorkspaceAgentError(`workspace_http_${status}`, `The website answered HTTP ${status}, which this server does not know how to handle. ${writing ? 'Nothing is known to have been saved.' : 'Nothing was changed.'}`, details({ outcome: 'rejected' }));
}

export interface WorkspaceApiOptions {
    /** Test seam: replaces the global fetch. */
    fetch?: typeof fetch;
    /** Per-request deadline. The website gives up on its own at 12 s; reads and writes take 3 to 7 s in practice. */
    requestTimeoutMs?: number;
}

export interface WorkspaceReadOptions { accountId?: string; category: string; cursor?: string; limit?: number }

/** The original server operation is the durable ledger. No generated IDs inside this layer, no redirects, no automatic mutation retry. */
export function workspaceApi(apiBase: string, apiKey: string, version: string, options: WorkspaceApiOptions = {}) {
    const fetchImpl = options.fetch ?? fetch;
    const timeoutMs = options.requestTimeoutMs ?? 30000;
    let base: URL;
    try { base = new URL(apiBase); } catch { return fail('workspace_invalid_api_url', 'PROMETHEUS_API_URL is not a valid URL. Leave it unset to use https://prometheus.mythslabs.ai.'); }
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/'
        || !(base.protocol === 'https:' || base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))
        fail('workspace_invalid_api_url', 'PROMETHEUS_API_URL must be an https:// address with no path, credentials or query (http:// is only accepted for localhost). Leave it unset to use https://prometheus.mythslabs.ai.');

    const request = async (method: 'GET' | 'POST', query: URLSearchParams, accountId: string | undefined, signal: AbortSignal, body?: unknown): Promise<unknown> => {
        const writing = method === 'POST';
        if (!apiKey) fail('workspace_key_missing', `PROMETHEUS_API_KEY is not set for this MCP server. Ask the user to open ${KEY_PAGE}, click Generate key, and put the key in the server's PROMETHEUS_API_KEY setting. Nothing was saved.`);
        if (!/^pak_[A-Za-z0-9_-]+$/.test(apiKey)) fail('workspace_key_missing', `PROMETHEUS_API_KEY does not look like an Agent key (it starts with pak_). Ask the user to copy the key again from ${KEY_PAGE}. Nothing was saved.`);
        const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
        const unreached = (): never => signal.aborted
            ? fail('workspace_cancelled', writing ? 'The call was cancelled while the save was in flight, so it may or may not have been saved. ' + RETRY_SAFE : 'The read was cancelled. Nothing was changed.', { outcome: writing ? 'unconfirmed' : 'not_sent' })
            : fail('workspace_result_unconfirmed', writing
                ? 'The connection to the Prometheus website dropped or timed out before a confirmation came back, so it may or may not have been saved. ' + RETRY_SAFE
                : 'Could not reach the Prometheus website (network error or timeout). Nothing was changed; try again.', { outcome: writing ? 'unconfirmed' : 'not_sent' });
        try {
            const url = new URL('/api/agent/workspace', base); url.search = query.toString();
            const response = await fetchImpl(url, { method, redirect: 'error', signal: combined,
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': `PrometheusAvatar-MCP/${version}`,
                    ...(accountId ? { 'X-Workspace-Account': accountId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
            if (!response.ok) {
                const site = await readSiteError(response);
                const retryAfter = Number(response.headers.get('retry-after'));
                throw fromHttp(response.status, site, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined, writing);
            }
            const length = response.headers.get('content-length');
            if ((length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes))
                || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
                await response.body?.cancel();
                fail('workspace_response_invalid', 'The address in PROMETHEUS_API_URL did not answer like the Prometheus workspace (not JSON, or too large). Nothing was changed by this server.', { outcome: writing ? 'unconfirmed' : 'not_sent' });
            }
            return await readWorkspaceJson(response.body, combined, maxResponseBytes);
        } catch (error) {
            if (error instanceof WorkspaceAgentError) throw error;
            // A 2xx whose body is not valid UTF-8 JSON (or is oversized) is a foreign server, not a dropped connection.
            if (error instanceof WorkspaceRequestError && error.status !== 408)
                fail('workspace_response_invalid', 'The address in PROMETHEUS_API_URL did not answer like the Prometheus workspace (invalid or oversized JSON). ' + (writing ? 'Whether anything was saved is unknown. ' + RETRY_SAFE : 'Nothing was changed.'), { outcome: writing ? 'unconfirmed' : 'not_sent' });
            return unreached();
        }
    };

    const receipt = async (account: string, operation: string, signal: AbortSignal) => {
        const accountId = uuid(account, 'account_id'), operationId = uuid(operation, 'operation_id');
        const value = await request('GET', new URLSearchParams({ operationId }), accountId, signal);
        if (!record(value) || !('operation' in value) || value.accountId !== accountId)
            fail('workspace_response_invalid', 'The website answered the operation lookup in a form this version of the server does not recognise. Update @prometheusavatar/mcp-server.');
        const original = value.operation === null ? null : parseWorkspaceReceipt(value.operation, { accountId, operationId });
        if (value.operation !== null && !original) fail('workspace_response_invalid', 'The website answered the operation lookup in a form this version of the server does not recognise. Update @prometheusavatar/mcp-server.');
        return { accountId, operation: original };
    };

    /** Everything the website would refuse, caught before the network. */
    const checkedEntry = (value: unknown): WorkspaceInput => {
        const problem = describeWorkspaceInputProblem(value), input = problem ? null : readWorkspaceInput(value);
        if (problem || !input) fail('workspace_invalid_agent_entry', `entry.${problem?.field ?? '?'} ${problem?.problem ?? 'is not valid'}. Nothing was sent.`, { field: problem?.field });
        if (input.kind === 'message' ? input.role !== 'assistant' || input.inputMode !== 'agent' : input.inputMode !== 'agent' && input.expectedRevision === 0)
            fail('workspace_invalid_agent_entry', input.kind === 'message'
                ? 'entry.role / entry.inputMode: work output written by an agent needs role "assistant" and inputMode "agent". Nothing was sent.'
                : 'entry.inputMode: a new task written by an agent needs inputMode "agent". Nothing was sent.', { field: input.kind === 'message' ? 'role' : 'inputMode' });
        return input;
    };

    const post = async (account: string, operation: string, value: WorkspaceInput, signal: AbortSignal): Promise<WorkspaceReceipt> => {
        const accountId = uuid(account, 'account_id'), operationId = uuid(operation, 'operation_id');
        const input = checkedEntry(value);
        const result = await request('POST', new URLSearchParams(), accountId, signal, { operationId, entry: input });
        const saved = parseWorkspaceReceipt(result, { accountId, operationId, input });
        if (!saved) fail('workspace_response_invalid', 'The website answered, but its confirmation does not match what was sent, so it cannot be treated as saved. ' + RETRY_SAFE, { outcome: 'unconfirmed' });
        return saved;
    };

    return {
        async read(readOptions: WorkspaceReadOptions, signal: AbortSignal): Promise<WorkspaceSnapshot> {
            const accountId = readOptions.accountId === undefined ? undefined : uuid(readOptions.accountId, 'account_id'), limit = readOptions.limit ?? 5;
            if (!validCategory(readOptions.category)) fail('workspace_invalid_filter', 'category must be lowercase letters, digits, - or _ (for example "work" or "todo").', { field: 'category' });
            if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('workspace_invalid_filter', 'limit must be a whole number from 1 to 50.', { field: 'limit' });
            if (readOptions.cursor !== undefined && !isWorkspaceSequence(readOptions.cursor)) fail('workspace_invalid_filter', 'cursor must be the nextCursor value returned by the previous read, unchanged.', { field: 'cursor' });
            const params = new URLSearchParams({ category: readOptions.category, limit: String(limit) });
            if (readOptions.cursor) params.set('cursor', readOptions.cursor);
            const value = await request('GET', params, accountId, signal);
            // With a known account the answer must name exactly that account. Without one (the first read, which
            // discovers it) the answer's own id is adopted, lower-cased the way the website writes it.
            const owner = accountId ?? (record(value) && typeof value.accountId === 'string' ? value.accountId.toLowerCase() : '');
            const answer = accountId === undefined && record(value) ? { ...value, accountId: owner } : value;
            const snapshot = parseWorkspaceSnapshot(answer, { accountId: owner, categoryId: readOptions.category, before: readOptions.cursor, limit });
            if (!snapshot) fail('workspace_response_invalid', 'The website answered the read in a form this version of the server does not recognise, or for a different account. Update @prometheusavatar/mcp-server.');
            // Chat belongs to the user, never to an agent: refuse any row from a chat category, and never list chat categories.
            const chat = new Set(snapshot.categories.filter(category => category.presentation === 'chat').map(category => category.id));
            if (snapshot.entries.some(entry => chat.has(entry.categoryId))) fail('workspace_response_invalid', 'The website returned chat rows on the Agent path, which is not allowed. Nothing was used.');
            return { ...snapshot, categories: snapshot.categories.filter(category => category.presentation !== 'chat') };
        },
        receipt,
        post,
        /** Low-level save: look the operation up first, adopt its receipt when it already exists, otherwise POST once. */
        async save(account: string, operation: string, value: WorkspaceInput, signal: AbortSignal): Promise<WorkspaceReceipt> {
            const accountId = uuid(account, 'account_id'), operationId = uuid(operation, 'operation_id');
            const input = checkedEntry(value);
            const recovered = await receipt(accountId, operationId, signal);
            if (recovered.operation) {
                const original = parseWorkspaceReceipt(recovered.operation, { accountId, operationId, input });
                if (!original) fail('workspace_intent_conflict', 'This operation_id was already used to save different content. Nothing was changed. Use a new operation_id for new content, or resend the original content to get its receipt.', { outcome: 'rejected' });
                return original;
            }
            return post(accountId, operationId, input, signal);
        },
    };
}
export type WorkspaceApi = ReturnType<typeof workspaceApi>;

interface SiteError { error?: string; code?: string }
/**
 * The website's error body is `{ "error": "<sentence>" }`, plus `"code"` on some answers (422 WORKSPACE_CATEGORY_FULL).
 * Read a bounded amount and keep only those two strings; they are only ever used as lookup keys, never shown to the model.
 */
async function readSiteError(response: Response): Promise<SiteError> {
    try {
        const parsed = await readWorkspaceJson(response.body, undefined, 4096);
        if (!record(parsed)) return {};
        return {
            ...(typeof parsed.error === 'string' && parsed.error.length <= 300 ? { error: parsed.error } : {}),
            ...(typeof parsed.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(parsed.code) ? { code: parsed.code } : {}),
        };
    } catch { return {}; }
}
