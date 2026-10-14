// A stand-in for the Prometheus website's /api/agent/workspace route, written from the website's own source
// (marketplace-app src/app/api/agent/workspace/route.ts, src/lib/appWorkspace.ts and the SQL in
// supabase/migrations/20260917140000_app_workspace.sql) and from the live results recorded on 2026-10-05.
// It is deliberately an independent re-implementation: it does not import anything from this package, so a
// request the package builds wrongly is rejected here for the same reason the real site would reject it.
// It never talks to any other host and listens only on 127.0.0.1, on port 3486 (the port the desktop line reserved for it)
// when asked for it (options.port), otherwise on the first free port of 54860-54869 so that parallel tests can coexist.
// Every answer says `connection: close`, so a client never reuses a socket of a website that was shut down a moment ago.
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { listenOnFreePort } from './port.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ENTRY_KEYS = 'archived,categoryId,content,dueOn,entryId,expectedRevision,inputMode,kind,occurredAt,role,status';
const FUTURE = 9223372036854775807n;
const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
const validDate = v => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) && v.slice(0, 4) !== '0000'
    && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

/** What the website's readWorkspaceInput + the SQL function accept. */
function readInput(v) {
    if (!isRecord(v) || Object.keys(v).sort().join(',') !== ENTRY_KEYS) return null;
    if (typeof v.entryId !== 'string' || !UUID.test(v.entryId)) return null;
    if (!Number.isInteger(v.expectedRevision) || v.expectedRevision < 0 || v.expectedRevision > 999999998) return null;
    if (typeof v.categoryId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(v.categoryId)) return null;
    if (typeof v.content !== 'string' || !v.content.trim() || v.content.includes('\u0000') || Buffer.byteLength(v.content) > 65536) return null;
    // The SQL function insists on exactly three fraction digits and a trailing Z.
    if (typeof v.occurredAt !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(v.occurredAt)
        || Number.isNaN(Date.parse(v.occurredAt)) || new Date(v.occurredAt).toISOString() !== v.occurredAt) return null;
    if (typeof v.archived !== 'boolean' || !['message', 'task'].includes(v.kind) || !['text', 'voice', 'manual', 'agent'].includes(v.inputMode)) return null;
    if (v.kind === 'message') {
        if (!['user', 'assistant'].includes(v.role) || v.status !== null || v.dueOn !== null) return null;
    } else if (v.role !== null || !['manual', 'agent'].includes(v.inputMode) || !['open', 'done'].includes(v.status) || (v.dueOn !== null && !validDate(v.dueOn))) return null;
    return v;
}
const stable = v => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : isRecord(v) ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}` : JSON.stringify(v);
const pgTime = date => date.toISOString().replace(/Z$/, '') + '000+00:00'; // like Postgres: 6 fraction digits and a numeric offset

/**
 * options.categories: list of {id,title,presentation,position}. Default: chat, work, todo (what production has on 2026-10-14).
 * options.browse: also seed the `browse` markdown category (what the K5 migration will add).
 * options.extras: answer with extra keys the package has never seen (a future website), at every level.
 * options.port: listen on this port only (the by-hand end-to-end run uses 3486). Default: first free port of 54860-54869.
 * options.cap / site.cap: the K5b limit of entries that are not archived in work, todo and browse (2,000 on the website).
 *   A new entry, or one taken out of the archive, beyond it is answered 422 { error, code: WORKSPACE_CATEGORY_FULL }.
 * site.intercept: (ctx) => undefined | {drop:'before'|'after'} | {status, body, headers} — failure injection.
 */
export async function startFakeSite(options = {}) {
    const accountId = options.accountId ?? randomUUID();
    const keys = new Set(options.keys ?? ['pak_fixture_key_for_tests']);
    const categories = options.categories ?? [
        { id: 'chat', title: 'Chat', presentation: 'chat', position: 10 },
        { id: 'work', title: 'Work', presentation: 'markdown', position: 20 },
        { id: 'todo', title: 'To-do', presentation: 'tasks', position: 30 },
        ...(options.browse ? [{ id: 'browse', title: 'Browse', presentation: 'markdown', position: 40 }] : []),
    ];
    const entries = new Map(); // id -> row
    const operations = new Map(); // operationId -> { hash, receipt }
    let seq = 0n, clock = options.clock ?? (() => new Date());
    const requests = [];
    const site = {
        accountId, entries, operations, requests, categories, intercept: options.intercept ?? null, extras: !!options.extras, cap: options.cap,
        /** Rows the way a user would have created them in the app (not through the agent route). */
        addEntry(row) {
            const now = clock();
            const entry = { id: randomUUID(), seq: ++seq, revision: 1, archived: false, role: null, status: null, dueOn: null, inputMode: 'manual', createdAt: now, updatedAt: now,
                occurredAt: now.toISOString(), ...row };
            entries.set(entry.id, entry); return entry;
        },
        /** A concurrent edit from somewhere else: bumps the revision. */
        touch(id, patch = {}) { const row = entries.get(id); Object.assign(row, patch, { revision: row.revision + 1, updatedAt: clock() }); return row; },
        list(categoryId) { return [...entries.values()].filter(row => !categoryId || row.category_id === categoryId); },
        writes: () => requests.filter(r => r.method === 'POST'),
        url: '', port: 0, close: async () => {},
    };
    const value = row => ({ id: row.id, sequence: String(row.seq), categoryId: row.category_id, kind: row.kind, content: row.content, occurredAt: row.occurredAt,
        role: row.role, inputMode: row.inputMode, status: row.status, dueOn: row.dueOn, archived: row.archived, revision: row.revision,
        createdAt: pgTime(row.createdAt), updatedAt: pgTime(row.updatedAt), ...(site.extras ? { source: null, labels: [] } : {}) });
    const receiptOf = (operationId, row) => ({ accountId, operationId, entry: value(row), ...(site.extras ? { ledger: { replayed: false } } : {}) });

    const handler = async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString('utf8');
        const url = new URL(req.url, 'http://fake.invalid');
        const write = req.method === 'POST';
        const log = { n: requests.length + 1, method: req.method, path: url.pathname, search: url.search, account: req.headers['x-workspace-account'] ?? null,
            authorization: req.headers.authorization ? req.headers.authorization.replace(/pak_[A-Za-z0-9_-]+/, 'pak_<redacted>') : null,
            contentType: req.headers['content-type'] ?? null, userAgent: req.headers['user-agent'] ?? null, body: raw ? safeJson(raw) : null, status: 0, response: null };
        requests.push(log);
        const send = (status, body, headers = {}) => {
            log.status = status; log.response = body;
            res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store', connection: 'close', ...headers }); res.end(JSON.stringify(body));
        };
        const fail = (status, error, headers) => send(status, { error }, headers);

        const injected = site.intercept?.({ ...log, writes: requests.filter(r => r.method === 'POST').length, isWrite: write });
        if (injected?.drop === 'before') { log.status = 'dropped-before'; req.socket.destroy(); return; }
        if (injected?.status) return send(injected.status, injected.body ?? { error: 'injected' }, injected.headers);

        if (url.pathname !== '/api/agent/workspace') return fail(404, 'Not found');
        if (!['GET', 'POST'].includes(req.method)) return fail(405, 'Method not allowed');
        const match = /^Bearer\s+(pak_[A-Za-z0-9_-]+)$/i.exec((req.headers.authorization ?? '').trim());
        if (!match || !keys.has(match[1])) return fail(401, 'Use an active Agent key with verified account ownership.');
        const params = url.searchParams, names = [...params.keys()];
        const expected = req.headers['x-workspace-account'];
        if (((write || params.has('operationId')) && !expected) || (expected !== undefined && (!UUID.test(expected) || expected.toLowerCase() !== accountId)))
            return fail(409, 'The Agent account changed. Read its workspace before using the original operation.');

        const category = id => categories.find(row => row.id === id);
        const readCategory = (id, cursor, limit) => {
            const definition = category(id);
            if (!definition) return { status: 400, error: 'Check the workspace entry or filter.' }; // WORKSPACE_INPUT from read_app_workspace
            if (definition.presentation === 'chat') return { status: 403, error: 'This Agent path is for work output and tasks.' };
            const rows = [...entries.values()].filter(r => r.category_id === id && !r.archived && (cursor === undefined || BigInt(r.seq) < BigInt(cursor))).sort((a, b) => Number(b.seq - a.seq));
            const page = rows.slice(0, limit), last = page.length ? page[page.length - 1].seq : null;
            const more = last !== null && [...entries.values()].some(r => r.category_id === id && !r.archived && r.seq < last);
            return { snapshot: { accountId,
                categories: categories.filter(c => c.presentation !== 'chat').sort((a, b) => a.position - b.position)
                    .map(c => ({ id: c.id, title: c.title, presentation: c.presentation, ...(site.extras ? { icon: null } : {}) })),
                entries: page.map(value), nextCursor: more ? String(last) : null, ...(site.extras ? { schemaVersion: 2 } : {}) }, definition };
        };

        if (write) {
            if (url.search) return fail(400, 'Use the workspace operation body.');
            if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return fail(415, 'JSON content is required.');
            let body; try { body = JSON.parse(raw); } catch { return fail(400, 'Valid UTF-8 JSON is required.'); }
            if (!isRecord(body) || Object.keys(body).sort().join(',') !== 'entry,operationId') return fail(400, 'Use the original entry and operation.');
            const input = readInput(body.entry);
            if (typeof body.operationId !== 'string' || !UUID.test(body.operationId) || !input
                || (input.kind === 'message' ? input.role !== 'assistant' || input.inputMode !== 'agent' : input.inputMode !== 'agent' && input.expectedRevision === 0))
                return fail(400, 'Use Agent work output or an existing task with its original creation details.');
            const checked = readCategory(input.categoryId, undefined, 1);
            if (checked.error) return fail(checked.status, checked.error);
            if ((input.kind === 'task') !== (checked.definition.presentation === 'tasks')) return fail(400, 'Use the matching work or task category.');
            // mutate_app_workspace_entry
            const operationId = body.operationId.toLowerCase(), hash = createHash('sha256').update(stable(input)).digest('hex');
            const spent = operations.get(operationId);
            if (spent) {
                if (spent.hash !== hash) return fail(409, 'This operation saved different details. Recover its original result.');
                return finish(200, spent.receipt);
            }
            const existing = entries.get(input.entryId.toLowerCase());
            if ((existing && existing.revision !== input.expectedRevision) || (!existing && input.expectedRevision !== 0)) return fail(409, 'This entry changed. Read its current revision before editing.');
            if (existing && (existing.category_id !== input.categoryId || existing.kind !== input.kind || existing.role !== input.role
                || existing.inputMode !== input.inputMode || existing.occurredAt !== input.occurredAt)) return fail(400, 'Check the workspace entry or filter.');
            // K5b trigger (migration 20261014094200): runs after the replay check above, so a write that already succeeded
            // still gets its receipt; a refused write stores no receipt.
            const capped = ['work', 'todo', 'browse'].includes(input.categoryId) && site.cap !== undefined
                && [...entries.values()].filter(r => r.category_id === input.categoryId && !r.archived).length >= site.cap;
            if (capped && (!existing || (existing.archived && !input.archived)))
                return send(422, { error: 'This workspace category is full (2,000 entries). Nothing was saved. Do not retry; archive older entries to make room.', code: 'WORKSPACE_CATEGORY_FULL' });
            let row;
            if (!existing) {
                row = { id: input.entryId.toLowerCase(), seq: ++seq, category_id: input.categoryId, kind: input.kind, content: input.content, occurredAt: input.occurredAt,
                    role: input.role, inputMode: input.inputMode, status: input.status, dueOn: input.dueOn, archived: input.archived, revision: 1, createdAt: clock(), updatedAt: clock() };
                entries.set(row.id, row);
            } else {
                row = existing; Object.assign(row, { content: input.content, status: input.status, dueOn: input.dueOn, archived: input.archived, revision: row.revision + 1, updatedAt: clock() });
            }
            const receipt = receiptOf(operationId, row);
            operations.set(operationId, { hash, receipt });
            return finish(200, receipt);
        }

        if (names.some(name => !['category', 'cursor', 'limit', 'operationId'].includes(name) || params.getAll(name).length !== 1)) return fail(400, 'Use one valid workspace filter or original operation.');
        if (params.has('operationId')) {
            const id = params.get('operationId');
            if (names.length !== 1 || !UUID.test(id)) return fail(400, 'Use the original operation identifier.');
            const spent = operations.get(id.toLowerCase());
            if (spent) { const checked = readCategory(spent.receipt.entry.categoryId, undefined, 1); if (checked.error) return fail(checked.status, checked.error); }
            return send(200, { accountId, operation: spent ? spent.receipt : null });
        }
        const categoryId = params.get('category') ?? 'work', cursor = params.get('cursor') ?? undefined, count = params.get('limit');
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(categoryId) || (cursor !== undefined && !/^[1-9][0-9]{0,18}$/.test(cursor)) || (cursor !== undefined && BigInt(cursor) > FUTURE)
            || (count !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(count))) return fail(400, 'Use a valid category, cursor and page size.');
        const checked = readCategory(categoryId, cursor, count === null ? 50 : Number(count));
        if (checked.error) return fail(checked.status, checked.error);
        return send(200, checked.snapshot);

        function finish(status, body) {
            if (injected?.drop === 'after') { log.status = 'committed-then-dropped'; log.response = body; req.socket.destroy(); return; }
            send(status, body);
        }
    };

    const server = http.createServer((req, res) => { handler(req, res).catch(error => { try { res.writeHead(500); res.end(String(error)); } catch { /* socket gone */ } }); });
    await listenOnFreePort(server, options.port === undefined ? {} : { ports: [options.port] });
    site.port = server.address().port; site.url = `http://127.0.0.1:${site.port}`;
    site.close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
    site.key = [...keys][0];
    return site;
}
function safeJson(raw) { try { return JSON.parse(raw); } catch { return raw; } }
