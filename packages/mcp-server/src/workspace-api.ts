import { parseWorkspaceReceipt, parseWorkspaceSnapshot, readWorkspaceInput, readWorkspaceJson,
    workspaceUuid, isWorkspaceSequence, type WorkspaceInput, type WorkspaceReceipt } from './workspace-contract.js';

export class WorkspaceAgentError extends Error {}
const validCategory = (value: string) => /^[a-z][a-z0-9_-]{0,63}$/.test(value);
function reject(code: string): never { throw new WorkspaceAgentError(code); }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: string) => { if (!workspaceUuid.test(value)) reject('workspace_invalid_identifier'); return value.toLowerCase(); };

/** The original server operation is the durable ledger. No generated IDs, redirects or automatic mutation retry. */
export function workspaceApi(apiBase: string, apiKey: string, version: string) {
    const base = new URL(apiBase);
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/'
        || !(base.protocol === 'https:' || base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))
        reject('workspace_invalid_api_url');
    const request = async (method: 'GET' | 'POST', query: URLSearchParams, accountId: string | undefined, signal: AbortSignal, body?: unknown) => {
        if (!/^pak_[A-Za-z0-9_-]+$/.test(apiKey)) reject('workspace_agent_key_required');
        const combined = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        try {
            const url = new URL('/api/agent/workspace', base); url.search = query.toString();
            const response = await fetch(url, { method, redirect: 'error', signal: combined,
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': `PrometheusAvatar-MCP/${version}`,
                    ...(accountId ? { 'X-Workspace-Account': accountId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
            if (!response.ok) { await response.body?.cancel(); reject(`workspace_http_${response.status}`); }
            const length = response.headers.get('content-length');
            if ((length !== null && (!/^\d+$/.test(length) || Number(length) > 2 * 1024 * 1024))
                || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
                await response.body?.cancel(); reject('workspace_response_invalid');
            }
            return await readWorkspaceJson(response.body, combined, 2 * 1024 * 1024);
        } catch (error) {
            if (error instanceof WorkspaceAgentError) throw error;
            reject(signal.aborted ? 'workspace_cancelled' : 'workspace_result_unconfirmed');
        }
    };
    const receipt = async (account: string, operation: string, signal: AbortSignal) => {
        const accountId = uuid(account), operationId = uuid(operation);
        const value = await request('GET', new URLSearchParams({ operationId }), accountId, signal);
        if (!record(value) || Object.keys(value).sort().join(',') !== 'accountId,operation' || value.accountId !== accountId)
            reject('workspace_response_invalid');
        const original = value.operation === null ? null : parseWorkspaceReceipt(value.operation, { accountId, operationId });
        if (value.operation !== null && !original) reject('workspace_response_invalid');
        if (original?.entry.categoryId === 'chat') reject('workspace_response_invalid');
        return { accountId, operation: original };
    };
    return {
        async read(options: { accountId?: string; category: string; cursor?: string; limit?: number }, signal: AbortSignal) {
            const accountId = options.accountId === undefined ? undefined : uuid(options.accountId), limit = options.limit ?? 5;
            if (!validCategory(options.category) || !Number.isInteger(limit) || limit < 1 || limit > 5
                || (options.cursor !== undefined && !isWorkspaceSequence(options.cursor))) reject('workspace_invalid_filter');
            const params = new URLSearchParams({ category: options.category, limit: String(limit) });
            if (options.cursor) params.set('cursor', options.cursor);
            const value = await request('GET', params, accountId, signal);
            const owner = accountId ?? (record(value) && typeof value.accountId === 'string' ? value.accountId : '');
            const snapshot = parseWorkspaceSnapshot(value, { accountId: owner, categoryId: options.category, before: options.cursor, limit });
            if (!snapshot || snapshot.categories.some(category => category.presentation === 'chat')) reject('workspace_response_invalid');
            return snapshot;
        },
        receipt,
        async save(account: string, operation: string, value: WorkspaceInput, signal: AbortSignal): Promise<WorkspaceReceipt> {
            const accountId = uuid(account), operationId = uuid(operation), input = readWorkspaceInput(value);
            if (!input || (input.kind === 'message' ? input.role !== 'assistant' || input.inputMode !== 'agent'
                : input.inputMode !== 'agent' && input.expectedRevision === 0)) reject('workspace_invalid_agent_entry');
            const recovered = await receipt(accountId, operationId, signal);
            if (recovered.operation) {
                const original = parseWorkspaceReceipt(recovered.operation, { accountId, operationId, input });
                if (!original) reject('workspace_intent_conflict');
                return original;
            }
            const result = await request('POST', new URLSearchParams(), accountId, signal, { operationId, entry: input });
            const saved = parseWorkspaceReceipt(result, { accountId, operationId, input });
            if (!saved) reject('workspace_response_invalid');
            return saved;
        },
    };
}
