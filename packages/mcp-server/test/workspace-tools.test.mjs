// The tools as a model sees them: registered on a real McpServer and called through a real MCP Client
// (in-memory transport), against the contract-faithful fake website.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startFakeSite } from './fake-site.mjs';
import { registerWorkspaceTools } from '../.test-build/workspace-tools.js';

async function connect(apiBase, apiKey, options = {}) {
    const server = new McpServer({ name: 'test', version: '0' });
    const count = registerWorkspaceTools(server, apiBase, apiKey, 'test', { stateDirectory: null, ...options });
    const client = new Client({ name: 'client', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        return { result, json: JSON.parse(result.content[0].text) };
    };
    return { client, call, count, close: async () => { await client.close(); await server.close(); } };
}

test('registers the seven workspace tools: four for models, three exact ones kept', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        assert.equal(mcp.count, 7);
        const { tools } = await mcp.client.listTools();
        assert.deepEqual(tools.map(t => t.name).sort(), ['complete_task', 'log_visited_page', 'prometheus_get_workspace_operation', 'prometheus_read_workspace', 'prometheus_save_workspace_entry', 'save_work', 'upsert_task']);
        const byName = Object.fromEntries(tools.map(t => [t.name, t]));
        assert.deepEqual(byName.save_work.inputSchema.required, ['content'], 'a model only has to supply content');
        assert.deepEqual(Object.keys(byName.save_work.inputSchema.properties).sort(), ['content', 'external_key', 'title']);
        assert.deepEqual(byName.upsert_task.inputSchema.required, ['text']);
        assert.deepEqual(Object.keys(byName.upsert_task.inputSchema.properties).sort(), ['done', 'due_on', 'external_key', 'text']);
        assert.equal(byName.complete_task.inputSchema.required, undefined);
        assert.deepEqual(byName.log_visited_page.inputSchema.required, ['url']);
        for (const tool of tools) assert.ok(tool.description.length > 40, `${tool.name} is described`);
        assert.match(byName.upsert_task.description, /no reminder/, 'the description does not let a model promise a reminder');
    } finally { await mcp.close(); await site.close(); }
});

test('every tool works once through MCP, against the website contract', async () => {
    const site = await startFakeSite({ browse: true });
    const mcp = await connect(site.url, site.key);
    try {
        const work = await mcp.call('save_work', { content: '# Notes\n\nDone.', title: 'Notes', external_key: 'notes-1' });
        assert.equal(work.result.isError, undefined);
        assert.deepEqual([work.json.saved, work.json.action, work.json.category], [true, 'created', 'work']);

        const task = await mcp.call('upsert_task', { text: 'Send the notes', due_on: '2026-10-15', external_key: 'send-notes' });
        assert.deepEqual([task.json.saved, task.json.status, task.json.due_on], [true, 'open', '2026-10-15']);

        const done = await mcp.call('complete_task', { task_id: task.json.entry_id });
        assert.deepEqual([done.json.saved, done.json.status], [true, 'done']);

        const page = await mcp.call('log_visited_page', { url: 'https://example.com/pricing', title: 'Pricing' });
        assert.deepEqual([page.json.saved, page.json.category], [true, 'browse']);

        // low-level: read it all back, look up an operation, and write with every field under our control
        const read = await mcp.call('prometheus_read_workspace', { category: 'todo' });
        assert.equal(read.json.accountId, site.accountId);
        assert.equal(read.json.entries[0].status, 'done');
        assert.ok(read.json.categories.every(c => c.presentation !== 'chat'));
        const operationId = site.writes()[0].body.operationId;
        const receipt = await mcp.call('prometheus_get_workspace_operation', { account_id: site.accountId, operation_id: operationId });
        assert.equal(receipt.json.operation.entry.content, '# Notes\n\nDone.', 'the title was already the first heading, so it is not doubled');
        const exact = await mcp.call('prometheus_save_workspace_entry', {
            account_id: site.accountId, operation_id: randomUUID(),
            entry: { entryId: randomUUID(), expectedRevision: 0, categoryId: 'work', kind: 'message', content: 'Exact', occurredAt: '2026-10-14T01:30:00.000Z', role: 'assistant', inputMode: 'agent', status: null, dueOn: null, archived: false },
        });
        assert.equal(exact.json.entry.content, 'Exact');
        assert.equal(site.list('work').length, 2);
    } finally { await mcp.close(); await site.close(); }
});

test('a failed call comes back as a structured, actionable error: which field, was anything saved, what next', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        const bad = await mcp.call('upsert_task', { text: 'Pay', due_on: '2026-02-30' });
        assert.equal(bad.result.isError, true);
        assert.deepEqual([bad.json.saved, bad.json.error, bad.json.field, bad.json.outcome], [false, 'workspace_invalid_argument', 'due_on', 'nothing_was_saved']);
        assert.match(bad.json.next_step, /Fix the problem/);

        site.intercept = ctx => ctx.isWrite ? { drop: 'before' } : undefined;
        const lost = await mcp.call('save_work', { content: 'Lost in transit' });
        assert.equal(lost.result.isError, true);
        assert.deepEqual([lost.json.error, lost.json.outcome], ['workspace_result_unconfirmed', 'unknown_may_have_been_saved']);
        assert.match(lost.json.next_step, /exactly the same arguments/);
        site.intercept = null;
        const retried = await mcp.call('save_work', { content: 'Lost in transit' });
        assert.equal(retried.json.saved, true);
        assert.equal(site.list('work').length, 1);

        const noKey = await mcp.call('prometheus_read_workspace', { category: 'chat' });
        assert.equal(noKey.result.isError, true);
        assert.equal(noKey.json.error, 'workspace_category_forbidden', 'chat is not readable by an agent');

        const browse = await mcp.call('log_visited_page', { url: 'https://example.com/' });
        assert.equal(browse.json.error, 'workspace_browse_unavailable');
        assert.match(browse.json.message, /Nothing was saved/);
    } finally { await mcp.close(); await site.close(); }
});

test('a bad PROMETHEUS_API_URL or a missing key does not stop the tools from registering; they explain themselves', async () => {
    const wrongUrl = await connect('http://example.com', 'pak_whatever_key_value');
    try {
        assert.equal(wrongUrl.count, 7);
        const attempt = await wrongUrl.call('save_work', { content: 'x' });
        assert.deepEqual([attempt.result.isError, attempt.json.error], [true, 'workspace_invalid_api_url']);
        assert.match(attempt.json.message, /PROMETHEUS_API_URL/);
    } finally { await wrongUrl.close(); }
    const site = await startFakeSite();
    const noKey = await connect(site.url, '');
    try {
        const attempt = await noKey.call('save_work', { content: 'x' });
        assert.equal(attempt.json.error, 'workspace_key_missing');
        assert.match(attempt.json.message, /settings\/agent-keys/);
        assert.equal(site.requests.length, 0);
    } finally { await noKey.close(); await site.close(); }
});

test('a full category (422) reaches the model as final: nothing saved, do not retry, which category', async () => {
    const site = await startFakeSite({ cap: 0 });
    const mcp = await connect(site.url, site.key);
    try {
        const full = await mcp.call('upsert_task', { text: 'One more task' });
        assert.equal(full.result.isError, true);
        assert.deepEqual([full.json.saved, full.json.error, full.json.field, full.json.http_status, full.json.outcome],
            [false, 'workspace_category_full', 'category', 422, 'nothing_was_saved']);
        assert.match(full.json.next_step, /^Do not retry/);
        assert.match(full.json.message, /2,000 active/);
        assert.equal(site.list('todo').length, 0);
    } finally { await mcp.close(); await site.close(); }
});

test('the exact-control tools take every id the website takes: any 8-4-4-4-12 hex, like the official account 00000000-0000-0000-0000-000000000001', async () => {
    const OFFICIAL = '00000000-0000-0000-0000-000000000001';
    const site = await startFakeSite({ accountId: OFFICIAL });
    const mcp = await connect(site.url, site.key);
    try {
        const read = await mcp.call('prometheus_read_workspace', { category: 'work', account_id: OFFICIAL });
        assert.equal(read.result.isError, undefined, JSON.stringify(read.json));
        assert.equal(read.json.accountId, OFFICIAL);
        const operationId = '00000000-0000-0000-0000-0000000000a1', entryId = '00000000-0000-0000-0000-000000000002';
        const saved = await mcp.call('prometheus_save_workspace_entry', {
            account_id: OFFICIAL, operation_id: operationId,
            entry: { entryId, expectedRevision: 0, categoryId: 'work', kind: 'message', content: 'Saved under the official account', occurredAt: '2026-10-14T01:30:00.000Z', role: 'assistant', inputMode: 'agent', status: null, dueOn: null, archived: false },
        });
        assert.equal(saved.result.isError, undefined, JSON.stringify(saved.json));
        assert.equal(saved.json.entry.id, entryId);
        // upper case is the same id
        const receipt = await mcp.call('prometheus_get_workspace_operation', { account_id: OFFICIAL.toUpperCase(), operation_id: operationId.toUpperCase() });
        assert.equal(receipt.result.isError, undefined, JSON.stringify(receipt.json));
        assert.equal(receipt.json.operation.entry.content, 'Saved under the official account');
    } finally { await mcp.close(); await site.close(); }
});

test('ids that are not 8-4-4-4-12 hexadecimal digits are still refused before anything is sent', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        const bad = ['not-a-uuid', '0000000-0000-0000-0000-000000000001', 'g0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000011', ' 00000000-0000-0000-0000-000000000001'];
        for (const id of bad) {
            for (const [tool, args] of [['prometheus_read_workspace', { account_id: id }], ['prometheus_get_workspace_operation', { account_id: site.accountId, operation_id: id }]]) {
                const result = await mcp.client.callTool({ name: tool, arguments: args }).catch(error => ({ isError: true, content: [{ text: String(error.message) }] }));
                assert.equal(result.isError, true, `${tool} with ${JSON.stringify(id)}`);
            }
        }
        assert.equal(site.requests.length, 0, 'none of them reached the website');
    } finally { await mcp.close(); await site.close(); }
});

test('the request limit (429, marketplace K11a) reaches the model with the wait as a number: nothing saved, wait, then the same call', async () => {
    const site = await startFakeSite({ intercept: ctx => ctx.isWrite ? { status: 429, body: { error: 'Too many workspace requests from this Agent key. Nothing was saved. Try again in 12s.', code: 'AGENT_KEY_RATE_LIMITED' }, headers: { 'retry-after': '12' } } : undefined });
    const mcp = await connect(site.url, site.key);
    try {
        const limited = await mcp.call('save_work', { content: 'A burst of work' });
        assert.equal(limited.result.isError, true);
        assert.deepEqual([limited.json.saved, limited.json.error, limited.json.http_status, limited.json.outcome, limited.json.retry_after_seconds],
            [false, 'workspace_rate_limited', 429, 'nothing_was_saved', 12]);
        assert.match(limited.json.message, /about 12 seconds/); assert.match(limited.json.next_step, /^Wait 12 seconds \(retry_after_seconds\), then call this tool again/);
        assert.equal(site.list('work').length, 0);
    } finally { await mcp.close(); await site.close(); }
});

test('R3 the replay of an unconfirmed save answered 429: outcome unknown (the first try may be stored), the wait the website gave, then the same call stores one entry', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        const args = { content: 'Committed, but the answer was lost' };
        site.intercept = ctx => ctx.isWrite && ctx.writes === 1 ? { drop: 'after' } : undefined;
        const lost = await mcp.call('save_work', args);
        assert.equal(lost.json.outcome, 'unknown_may_have_been_saved');
        assert.equal(site.list('work').length, 1, 'the website did store the first try');
        site.intercept = ctx => ctx.isWrite ? { status: 429, body: { error: 'Too many workspace requests from this Agent key. Nothing was saved. Try again in 7s.', code: 'AGENT_KEY_RATE_LIMITED' }, headers: { 'retry-after': '7' } } : undefined;
        const limited = await mcp.call('save_work', args);
        assert.equal(limited.result.isError, true);
        assert.deepEqual([limited.json.saved, limited.json.error, limited.json.http_status, limited.json.outcome, limited.json.retry_after_seconds],
            [false, 'workspace_rate_limited', 429, 'unknown_may_have_been_saved', 7], 'not "nothing_was_saved": the earlier try is on the website');
        assert.match(limited.json.message, /may already be stored/);
        assert.match(limited.json.next_step, /^Wait 7 seconds \(retry_after_seconds\), then call this tool again with exactly the same arguments/);
        assert.match(limited.json.next_step, /do not tell the user it was not saved/);
        site.intercept = null;
        const done = await mcp.call('save_work', args);
        assert.equal(done.json.saved, true);
        assert.equal(site.list('work').length, 1, 'one entry, not two');
        const writes = site.writes();
        assert.equal(writes.at(-1).body.operationId, writes[0].body.operationId, 'the same operation was re-sent');
    } finally { await mcp.close(); await site.close(); }
});

test('R3 the replay of an unconfirmed save refused because the key was revoked: outcome unknown, and the model is told to repeat only once the key is fixed', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        const args = { content: 'Committed just before the key was revoked' };
        site.intercept = ctx => ctx.isWrite && ctx.writes === 1 ? { drop: 'after' } : undefined;
        assert.equal((await mcp.call('save_work', args)).json.outcome, 'unknown_may_have_been_saved');
        site.intercept = null;
        site.keys.delete(site.key);
        const refused = await mcp.call('save_work', args);
        assert.deepEqual([refused.json.error, refused.json.outcome], ['workspace_key_rejected', 'unknown_may_have_been_saved']);
        assert.match(refused.json.next_step, /^Tell the user to fix the Agent key as described in message\. Once they have, call this tool again with exactly the same arguments/);
        assert.equal(site.list('work').length, 1);
    } finally { await mcp.close(); await site.close(); }
});

test('the website\'s own error sentence never reaches the model: not as a field, not inside the text, known or unknown', async () => {
    const known = 'Use an active Agent key with verified account ownership.';
    const site = await startFakeSite({ intercept: ctx => ctx.isWrite ? { status: 401, body: { error: known } } : undefined });
    const mcp = await connect(site.url, site.key);
    const allowed = ['saved', 'error', 'message', 'field', 'http_status', 'retry_after_seconds', 'outcome', 'next_step'];
    try {
        const refused = await mcp.call('save_work', { content: 'Refused by the key check' });
        assert.equal(refused.json.error, 'workspace_key_rejected');
        assert.deepEqual(Object.keys(refused.json).filter(key => !allowed.includes(key)), [], 'no siteMessage or other extra field');
        assert.equal(refused.result.content[0].text.includes(known), false, 'the website sentence is not in the text');
        assert.equal(JSON.stringify(refused.result.structuredContent).includes(known), false);
        site.intercept = ctx => ctx.isWrite ? { status: 418, body: { error: 'private supplier detail 1234' } } : undefined;
        const odd = await mcp.call('save_work', { content: 'Refused with a status nobody expects' });
        assert.equal(odd.json.error, 'workspace_http_418');
        assert.deepEqual(Object.keys(odd.json).filter(key => !allowed.includes(key)), []);
        assert.doesNotMatch(odd.result.content[0].text, /private supplier detail/);
    } finally { await mcp.close(); await site.close(); }
});

// ───────────── What next_step says when an earlier try of the same save is unconfirmed ─────────────
// The website (marketplace src/app/api/agent/workspace/route.ts, migrations 20260917140000 and 20261014094200) answers the
// replay of an operation id it has stored with the original receipt; its replay check runs inside the database function,
// after the key, body and category checks and before the revision check and the category cap.
const dropFirstWrite = when => ctx => ctx.isWrite && ctx.writes === 1 ? { drop: when } : undefined;

test('contract: the replay of a save the website did store gets its receipt even when the category has filled up since (the replay check runs before the cap)', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        const args = { content: 'Committed, answer lost; then the category filled up' };
        site.intercept = dropFirstWrite('after');
        assert.equal((await mcp.call('save_work', args)).json.outcome, 'unknown_may_have_been_saved');
        site.intercept = null; site.cap = 0;
        const replayed = await mcp.call('save_work', args);
        assert.deepEqual([replayed.json.saved, replayed.json.action], [true, 'created']);
        assert.equal(site.list('work').length, 1);
    } finally { await mcp.close(); await site.close(); }
});

test('R-M1 the replay of an unconfirmed save answered 422 (category full): nothing was saved, do not retry, exactly as message says; once there is room the next call stores one entry', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        const args = { content: 'Lost before it reached the website; meanwhile the category filled up' };
        site.intercept = dropFirstWrite('before');
        assert.equal((await mcp.call('save_work', args)).json.outcome, 'unknown_may_have_been_saved');
        assert.equal(site.list('work').length, 0, 'the first try never reached the website');
        site.intercept = null; site.cap = 0; // the fake website's own 422, after its replay check found no receipt
        const full = await mcp.call('save_work', args);
        assert.equal(full.result.isError, true);
        assert.deepEqual([full.json.error, full.json.http_status, full.json.outcome], ['workspace_category_full', 422, 'nothing_was_saved'],
            'a 422 on the replay means the website holds no receipt for that operation: the earlier try was not stored');
        assert.match(full.json.message, /Do not retry/);
        assert.doesNotMatch(full.json.message, /may already be stored/);
        assert.match(full.json.next_step, /^Do not retry\. Tell the user this category is full and nothing was saved/);
        assert.doesNotMatch(full.json.next_step, /call this tool again/i);
        const still = await mcp.call('save_work', args);
        assert.deepEqual([still.json.error, still.json.outcome], ['workspace_category_full', 'nothing_was_saved'], 'still full: still final');
        site.cap = undefined;
        const done = await mcp.call('save_work', args);
        assert.equal(done.json.saved, true);
        assert.equal(site.list('work').length, 1);
    } finally { await mcp.close(); await site.close(); }
});

test('R-M1 the replay answered "account unavailable": final, nothing was saved (the account is gone, and with it everything it held), do not retry', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        const args = { content: 'Sent just before the account was deleted' };
        site.intercept = dropFirstWrite('before');
        assert.equal((await mcp.call('save_work', args)).json.outcome, 'unknown_may_have_been_saved');
        site.intercept = ctx => ctx.isWrite ? { status: 409, body: { error: 'The Agent account is unavailable.' } } : undefined;
        const gone = await mcp.call('save_work', args);
        assert.deepEqual([gone.json.error, gone.json.http_status, gone.json.outcome], ['workspace_account_unavailable', 409, 'nothing_was_saved']);
        assert.doesNotMatch(gone.json.message, /may already be stored/);
        assert.match(gone.json.next_step, /^Do not retry\. Tell the user the Prometheus account behind this Agent key is unavailable/);
        const fresh = await mcp.call('save_work', { content: 'A different save' });
        assert.deepEqual([fresh.json.error, fresh.json.outcome], ['workspace_account_unavailable', 'nothing_was_saved']);
        assert.match(fresh.json.next_step, /^Do not retry/, 'the same answer without an earlier try');
    } finally { await mcp.close(); await site.close(); }
});

test('R-M1 every other refusal of a replay: the outcome stays unknown, and next_step never says to call again unchanged now, does not contradict message, and tells the user to look first; once fixed, the same call stores one entry', async () => {
    const cases = [
        ['workspace_request_shape', 400, { error: 'Use the original entry and operation.' }],
        ['workspace_entry_rejected', 400, { error: 'Use Agent work output or an existing task with its original creation details.' }],
        ['workspace_input_rejected', 400, { error: 'Check the workspace entry or filter.' }],
        ['workspace_category_missing', 400, { error: 'Use an existing workspace category.' }],
        ['workspace_category_kind_mismatch', 400, { error: 'Use the matching work or task category.' }],
        ['workspace_category_forbidden', 403, { error: 'This Agent path is for work output and tasks.' }],
        ['workspace_too_large', 413, { error: 'The request is too large.' }],
        ['workspace_unsupported_media', 415, { error: 'JSON content is required.' }],
        ['workspace_http_418', 418, { error: 'something nobody expects' }],
    ];
    for (const [code, status, body] of cases) {
        const site = await startFakeSite();
        const mcp = await connect(site.url, site.key);
        try {
            const args = { content: `Committed, answer lost, then refused: ${code}` };
            site.intercept = dropFirstWrite('after');
            assert.equal((await mcp.call('save_work', args)).json.outcome, 'unknown_may_have_been_saved', code);
            site.intercept = ctx => ctx.isWrite ? { status, body } : undefined;
            const refused = await mcp.call('save_work', args);
            assert.deepEqual([refused.json.error, refused.json.http_status, refused.json.outcome], [code, status, 'unknown_may_have_been_saved'], code);
            assert.match(refused.json.message, /may already be stored/, code);
            assert.match(refused.json.next_step, /^Do not call this tool again unchanged now: it would be refused the same way\./, code);
            assert.match(refused.json.next_step, /may already be in their workspace/, code);
            assert.match(refused.json.next_step, /changed content would be saved as a separate entry/, code);
            site.intercept = null;
            const done = await mcp.call('save_work', args);
            assert.equal(done.json.saved, true, code);
            assert.equal(site.list('work').length, 1, `${code}: one entry, not two`);
            assert.equal(new Set(site.writes().map(write => write.body.operationId)).size, 1, `${code}: the same operation every time`);
        } finally { await mcp.close(); await site.close(); }
    }
});

test('R-M2 a read that dropped, timed out, or was answered 408 / 5xx: nothing changed; wait a moment and call again unchanged, as message says (not "fails the same way")', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key, { api: { requestTimeoutMs: 300 } });
    try {
        const failures = [
            ['dropped', { drop: 'before' }],
            ['timed out', { delayMs: 3000 }],
            ['408', { status: 408, body: { error: 'The request was cancelled. Recover the original operation.' } }],
            ['503', { status: 503, body: { error: 'The workspace is unavailable. Keep the original operation for recovery.' } }],
        ];
        for (const [label, injected] of failures) {
            site.intercept = ctx => ctx.isWrite ? undefined : injected;
            const read = await mcp.call('prometheus_read_workspace', { category: 'work' });
            assert.deepEqual([read.json.error, read.json.outcome], ['workspace_result_unconfirmed', 'nothing_was_saved'], label);
            assert.match(read.json.message, /try again/, label);
            assert.equal(read.json.next_step, 'Nothing was changed. Wait a moment, then call this tool again with the same arguments.', label);
            // save_work with no earlier try: its account lookup is a read too
            const save = await mcp.call('save_work', { content: `Nothing earlier: ${label}` });
            assert.deepEqual([save.json.error, save.json.outcome], ['workspace_result_unconfirmed', 'nothing_was_saved'], label);
            assert.equal(save.json.next_step, 'Nothing was changed. Wait a moment, then call this tool again with the same arguments.', label);
        }
        site.intercept = null;
        assert.equal((await mcp.call('prometheus_read_workspace', { category: 'work' })).result.isError, undefined, 'the same call works once the website answers');
        assert.equal(site.writes().length, 0);
    } finally { await mcp.close(); await site.close(); }
});

test('R-M2 the account lookup a repeat needs before it can replay an unconfirmed save fails (dropped, 503, 429): the outcome is unknown, not "nothing was saved"; the same call afterwards stores one entry', async () => {
    const OLD = 'pak_k10r2_key_before_rotation', NEW = 'pak_k10r2_key_after_rotation';
    const dir = mkdtempSync(join(tmpdir(), 'k10r2-lookup-'));
    const site = await startFakeSite({ keys: [OLD, NEW] });
    try {
        const args = { content: 'Committed, answer lost, then the key was replaced' };
        const first = await connect(site.url, OLD, { stateDirectory: dir });
        site.intercept = dropFirstWrite('after');
        assert.equal((await first.call('save_work', args)).json.outcome, 'unknown_may_have_been_saved');
        await first.close();
        site.keys.delete(OLD);
        const second = await connect(site.url, NEW, { stateDirectory: dir }); // a new key: its account has to be looked up
        try {
            site.intercept = ctx => ctx.isWrite ? undefined : { drop: 'before' };
            const control = await second.call('save_work', { content: 'Never tried before' });
            assert.deepEqual([control.json.error, control.json.outcome], ['workspace_result_unconfirmed', 'nothing_was_saved'], 'no earlier try of this call anywhere');

            const dropped = await second.call('save_work', args);
            assert.deepEqual([dropped.json.error, dropped.json.outcome], ['workspace_result_unconfirmed', 'unknown_may_have_been_saved']);
            assert.match(dropped.json.message, /may already be stored/);
            assert.match(dropped.json.next_step, /^Call this tool again with exactly the same arguments/);

            site.intercept = ctx => ctx.isWrite ? undefined : { status: 503, body: { error: 'The workspace is unavailable. Keep the original operation for recovery.' } };
            const unavailable = await second.call('save_work', args);
            assert.deepEqual([unavailable.json.error, unavailable.json.http_status, unavailable.json.outcome], ['workspace_result_unconfirmed', 503, 'unknown_may_have_been_saved']);

            site.intercept = ctx => ctx.isWrite ? undefined : { status: 429, body: { error: 'Too many workspace requests from this Agent key. Nothing was changed. Try again in 9s.', code: 'AGENT_KEY_RATE_LIMITED' }, headers: { 'retry-after': '9' } };
            const limited = await second.call('save_work', args);
            assert.deepEqual([limited.json.error, limited.json.outcome, limited.json.retry_after_seconds], ['workspace_rate_limited', 'unknown_may_have_been_saved', 9]);
            assert.match(limited.json.next_step, /^Wait 9 seconds \(retry_after_seconds\), then call this tool again with exactly the same arguments/);

            site.intercept = null;
            const done = await second.call('save_work', args);
            assert.equal(done.json.saved, true);
            assert.equal(site.list('work').length, 1, 'one entry, not two');
            const writes = site.writes();
            assert.equal(writes.at(-1).body.operationId, writes[0].body.operationId, 'the original operation was re-sent');
        } finally { await second.close(); }
    } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('R-M2 complete_task with an unconfirmed earlier try: a failed read-back is reported as unknown too; the same call afterwards finds the task done', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        const task = await mcp.call('upsert_task', { text: 'File the report' });
        site.intercept = ctx => ctx.isWrite && ctx.writes === 2 ? { drop: 'after' } : undefined;
        assert.equal((await mcp.call('complete_task', { task_id: task.json.entry_id })).json.outcome, 'unknown_may_have_been_saved');
        assert.equal(site.list('todo')[0].status, 'done', 'the website did mark it done');
        site.intercept = ctx => ctx.isWrite ? undefined : { drop: 'before' };
        const lookup = await mcp.call('complete_task', { task_id: task.json.entry_id });
        assert.deepEqual([lookup.json.error, lookup.json.outcome], ['workspace_result_unconfirmed', 'unknown_may_have_been_saved']);
        site.intercept = null;
        const done = await mcp.call('complete_task', { task_id: task.json.entry_id });
        assert.deepEqual([done.json.saved, done.json.status], [true, 'done']);
    } finally { await mcp.close(); await site.close(); }
});

test('R-M2 log_visited_page with an unconfirmed earlier try: the category read it makes first fails after a restart, and the outcome is unknown too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'k10r2-browse-'));
    const site = await startFakeSite({ browse: true });
    try {
        const args = { url: 'https://example.com/pricing', title: 'Pricing' };
        const first = await connect(site.url, site.key, { stateDirectory: dir });
        site.intercept = dropFirstWrite('after');
        assert.equal((await first.call('log_visited_page', args)).json.outcome, 'unknown_may_have_been_saved');
        await first.close();
        const second = await connect(site.url, site.key, { stateDirectory: dir }); // restarted: the categories are read again
        try {
            site.intercept = ctx => ctx.isWrite ? undefined : { drop: 'before' };
            const control = await second.call('log_visited_page', { url: 'https://example.com/other' });
            assert.deepEqual([control.json.error, control.json.outcome], ['workspace_result_unconfirmed', 'nothing_was_saved'], 'no earlier try of that page');
            const lookup = await second.call('log_visited_page', args);
            assert.deepEqual([lookup.json.error, lookup.json.outcome], ['workspace_result_unconfirmed', 'unknown_may_have_been_saved']);
            site.intercept = null;
            assert.equal((await second.call('log_visited_page', args)).json.saved, true);
            assert.equal(site.list('browse').length, 1, 'one entry, not two');
        } finally { await second.close(); }
    } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ───────────── B review of dde55b31: S1, S2, S3 ─────────────
test('S1 an answer this server cannot read while the save may be stored: next_step says to tell the user and repeat once it is fixed, not to call again at once; message agrees; then the same call stores one entry', async () => {
    const site = await startFakeSite();
    const mcp = await connect(site.url, site.key);
    try {
        // the write itself was answered with a 2xx that cannot be read: a foreign page, or a confirmation that does not match
        const odd = [['foreign page', { status: 200, body: '<html>', headers: { 'content-type': 'text/html' } }],
            ['mismatched confirmation', { status: 200, body: { accountId: site.accountId, operationId: randomUUID() } }]];
        for (const [label, injected] of odd) {
            site.intercept = ctx => ctx.isWrite ? injected : undefined;
            const result = await mcp.call('save_work', { content: `Answered oddly: ${label}` });
            assert.deepEqual([result.json.error, result.json.outcome], ['workspace_response_invalid', 'unknown_may_have_been_saved'], label);
            assert.match(result.json.next_step, /^Tell the user what message says, and that this save may already be stored\. Do not call this tool again until that is fixed/, label);
            assert.doesNotMatch(result.json.message, /Call this tool again with exactly the same arguments:/, label);
        }
        // a read the repeat needs first (complete_task's read-back) is answered in a shape this version does not know
        site.intercept = null;
        const task = await mcp.call('upsert_task', { text: 'File the report' });
        const before = site.writes().length;
        site.intercept = ctx => ctx.isWrite && ctx.writes === before + 1 ? { drop: 'after' } : undefined;
        assert.equal((await mcp.call('complete_task', { task_id: task.json.entry_id })).json.outcome, 'unknown_may_have_been_saved');
        site.intercept = ctx => ctx.isWrite ? undefined : { status: 200, body: { hello: 'a newer website shape' } };
        for (let i = 0; i < 2; i++) {
            const unread = await mcp.call('complete_task', { task_id: task.json.entry_id });
            assert.deepEqual([unread.json.error, unread.json.outcome], ['workspace_response_invalid', 'unknown_may_have_been_saved']);
            assert.match(unread.json.next_step, /^Tell the user what message says/);
            assert.doesNotMatch(unread.json.next_step, /^Call this tool again/);
        }
        site.intercept = null;
        for (const [label] of odd) assert.equal((await mcp.call('save_work', { content: `Answered oddly: ${label}` })).json.saved, true, label);
        assert.equal(site.list('work').length, 2, 'one entry for each, not two');
        assert.deepEqual([(await mcp.call('complete_task', { task_id: task.json.entry_id })).json.status, site.list('todo')[0].status], ['done', 'done']);
    } finally { await mcp.close(); await site.close(); }
});
