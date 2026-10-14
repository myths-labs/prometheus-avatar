// End-to-end run for the K10 evidence folder. NOT part of `npm test` (it writes files): run it by hand after `npm run build`:
//
//   EVIDENCE_DIR=/path/to/evidence node test/e2e-evidence.mjs
//
// It starts the BUILT server (dist/index.js) as a child process over stdio, the way an MCP client does, against the
// contract-faithful fake website from test/fake-site.mjs on 127.0.0.1. It never contacts the production site and uses
// no real key. Every tool is called at least once; the request log of the fake site (keys already redacted) is stored
// next to each step.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFakeSite } from './fake-site.mjs';
import { E2E_PORT } from './port.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.EVIDENCE_DIR ?? join(root, '.e2e-evidence');
mkdirSync(out, { recursive: true });
const steps = [];
const failures = [];

const site = await startFakeSite({ keys: ['pak_fixture_key_for_tests'], port: E2E_PORT }); // 3486: the port reserved for this package's fake website
const stateDirectory = mkdtempSync(join(tmpdir(), 'k10-e2e-'));

async function start(key = site.key) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist', 'index.js')], stderr: 'pipe',
        env: { PROMETHEUS_API_URL: site.url, PROMETHEUS_API_KEY: key, PROMETHEUS_MCP_STATE_DIR: stateDirectory } });
    const client = new Client({ name: 'k10-e2e', version: '1' });
    let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
    await client.connect(transport);
    return { client, stderr: () => stderr, close: () => client.close() };
}
function expect(label, condition, detail) { if (!condition) { failures.push(`${label}: ${JSON.stringify(detail)}`); console.error('FAIL', label, detail); } else console.log('ok  ', label); }

async function step(name, mcp, tool, args, note = '') {
    const before = site.requests.length;
    const result = await mcp.client.callTool({ name: tool, arguments: args });
    const json = JSON.parse(result.content[0].text);
    steps.push({ step: steps.length + 1, name, note, tool, arguments: args, isError: result.isError === true, result: json, website_requests: site.requests.slice(before).map(r => ({ n: r.n, method: r.method, path: r.path + r.search, account_header: r.account, body: r.body, status: r.status, response: r.response })) });
    return json;
}

let mcp = await start();
try {
    const { tools } = await mcp.client.listTools();
    const names = tools.map(t => t.name);
    steps.push({ step: 0, name: 'tools/list', tools: names, count: names.length, descriptions: Object.fromEntries(tools.filter(t => /^(save_work|upsert_task|complete_task|log_visited_page)$/.test(t.name)).map(t => [t.name, t.description])) });
    expect('17 tools listed', names.length === 17, names);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect('start-up banner says 17 tools', /17 tools available/.test(mcp.stderr()), mcp.stderr());

    // 1. save_work, then an update through the same external_key
    const w1 = await step('save_work: new', mcp, 'save_work', { content: '# Launch checklist\n\n- [x] build\n- [ ] sign\n\n```bash\nnpm pack\n```', title: 'Launch checklist', external_key: 'launch-checklist' });
    expect('save_work created', w1.saved === true && w1.action === 'created', w1);
    const w2 = await step('save_work: same external_key, new text', mcp, 'save_work', { content: '# Launch checklist\n\n- [x] build\n- [x] sign\n', title: 'Launch checklist', external_key: 'launch-checklist' });
    expect('save_work updated the same entry', w2.action === 'updated' && w2.entry_id === w1.entry_id && w2.revision === 2, w2);
    expect('only one work entry on the website', site.list('work').length === 1, site.list('work').length);

    // 2. tasks
    const t1 = await step('upsert_task: new with due date', mcp, 'upsert_task', { text: 'Send the signed build to QA', due_on: '2026-10-16', external_key: 'send-build-qa' });
    expect('upsert_task created', t1.saved && t1.status === 'open' && t1.due_on === '2026-10-16', t1);
    const bad = await step('upsert_task: impossible date is explained, nothing sent', mcp, 'upsert_task', { text: 'x', due_on: '2026-02-30' });
    expect('bad due_on names the field', bad.saved === false && bad.field === 'due_on' && bad.outcome === 'nothing_was_saved', bad);
    const c1 = await step('complete_task by external_key', mcp, 'complete_task', { external_key: 'send-build-qa' });
    expect('complete_task done', c1.saved && c1.status === 'done' && c1.revision === 2, c1);
    const c2 = await step('complete_task again (harmless)', mcp, 'complete_task', { task_id: t1.entry_id });
    expect('second complete_task writes nothing', c2.action === 'unchanged', c2);

    // 3. browse: unavailable first (the website has no browse category yet), then available
    const v0 = await step('log_visited_page while the website has no browse category', mcp, 'log_visited_page', { url: 'https://example.com/pricing', title: 'Pricing' });
    expect('browse unavailable is explained', v0.saved === false && v0.error === 'workspace_browse_unavailable', v0);
    const refused = await step('log_visited_page refuses a non-http scheme', mcp, 'log_visited_page', { url: 'javascript:alert(1)', title: 'x' });
    expect('javascript: refused', refused.saved === false && refused.field === 'url', refused);
    site.categories.push({ id: 'browse', title: 'Browse', presentation: 'markdown', position: 40 });
    const v1 = await step('log_visited_page after the website gained the browse category', mcp, 'log_visited_page', { url: 'https://example.com/pricing', title: 'Pricing' }, 'no restart of the MCP server in between');
    expect('browse saved', v1.saved === true && v1.category === 'browse', v1);

    // 4. the three exact tools
    const read = await step('prometheus_read_workspace (todo)', mcp, 'prometheus_read_workspace', { category: 'todo' });
    expect('read shows the finished task and no chat category', read.entries?.[0]?.status === 'done' && !read.categories.some(c => c.presentation === 'chat'), read);
    const op = site.writes()[0].body.operationId;
    const receipt = await step('prometheus_get_workspace_operation', mcp, 'prometheus_get_workspace_operation', { account_id: site.accountId, operation_id: op });
    expect('operation receipt found', receipt.operation?.operationId === op, receipt);
    const exact = await step('prometheus_save_workspace_entry (all fields by hand)', mcp, 'prometheus_save_workspace_entry', {
        account_id: site.accountId, operation_id: randomUUID(),
        entry: { entryId: randomUUID(), expectedRevision: 0, categoryId: 'work', kind: 'message', content: 'Written with every field by hand', occurredAt: '2026-10-14T02:00:00.000Z', role: 'assistant', inputMode: 'agent', status: null, dueOn: null, archived: false } });
    expect('exact save accepted', exact.entry?.content === 'Written with every field by hand', exact);

    // 5. 409: somebody else edits the task between two of our calls
    const t2 = await step('upsert_task: create (for the conflict case)', mcp, 'upsert_task', { text: 'Review the contract', external_key: 'contract' });
    site.touch(t2.entry_id, { content: 'Review the contract (edited in the app)' });
    const t3 = await step('upsert_task: the revision is stale, the server re-reads and retries once', mcp, 'upsert_task', { text: 'Review the contract with legal', external_key: 'contract' });
    expect('409 handled automatically', t3.saved === true && t3.revision === 3, t3);
    const lastSteps = steps.at(-1).website_requests.map(r => `${r.method}:${r.status}`);
    expect('request pattern is POST 409, GET, POST 200', lastSteps.join(',') === 'POST:409,GET:200,POST:200', lastSteps);

    // 6. network cut after the website saved it, and a restart of the MCP server in between
    site.intercept = ctx => ctx.isWrite && !site.intercept.fired ? (site.intercept.fired = true, { drop: 'after' }) : undefined;
    const lost = await step('save_work: connection drops after the website saved it', mcp, 'save_work', { content: 'Quarterly summary: revenue up 12%.' });
    expect('reported as unknown, with the advice to repeat', lost.saved === false && lost.outcome === 'unknown_may_have_been_saved' && /exactly the same arguments/.test(lost.next_step), lost);
    expect('the website did keep it', site.list('work').filter(r => r.content.startsWith('Quarterly summary')).length === 1, null);
    await mcp.close();
    mcp = await start(); // a new process: only the state file remembers the operation
    const again = await step('save_work: same call after the MCP server was restarted', mcp, 'save_work', { content: 'Quarterly summary: revenue up 12%.' }, 'new process, same state directory');
    expect('retry returns the original entry', again.saved === true && again.action === 'created' && again.revision === 1, again);
    expect('still exactly one such entry (no duplicate)', site.list('work').filter(r => r.content.startsWith('Quarterly summary')).length === 1, null);
    const posts = site.writes().slice(-2);
    expect('the retry re-sent the same operation id', posts[0].body.operationId === posts[1].body.operationId && posts[0].body.entry.entryId === posts[1].body.entry.entryId, posts.map(p => p.body.operationId));
    site.intercept = null;

    // 7. a website that has grown new fields
    site.extras = true;
    const grown = await step('save_work against a website that now returns extra keys everywhere', mcp, 'save_work', { content: 'Still works', external_key: 'future-proof' });
    expect('extra keys ignored', grown.saved === true, grown);
    const regrown = await step('upsert_task + read with extra keys', mcp, 'prometheus_read_workspace', { category: 'work' });
    expect('read parses with extra keys', Array.isArray(regrown.entries), regrown);
    site.extras = false;

    // 8. wrong key -> a message that says what to do, not the website's raw sentence
    const wrong = await start('pak_a_key_nobody_issued');
    const rejected = await step('save_work with a key the website does not know', wrong, 'save_work', { content: 'x' });
    expect('401 explained', rejected.error === 'workspace_key_rejected' && /settings\/agent-keys/.test(rejected.message) && !/pak_/.test(rejected.message), rejected);
    await wrong.close();

    // 9. the fake website itself, probed with the mistakes RESULT_20261005.md recorded on the live site
    const probe = async (label, init, expectStatus, expectError) => {
        const res = await fetch(site.url + '/api/agent/workspace', { ...init, headers: { authorization: 'Bearer ' + site.key, 'content-type': 'application/json', ...init.headers } });
        const body = await res.json();
        steps.push({ step: steps.length + 1, name: 'fake-site self-check: ' + label, status: res.status, response: body });
        expect(`fake site: ${label}`, res.status === expectStatus && body.error === expectError, { status: res.status, body });
    };
    const entry = { entryId: randomUUID(), expectedRevision: 0, categoryId: 'work', kind: 'message', content: 'probe', occurredAt: '2026-10-14T02:00:00.000Z', role: 'assistant', inputMode: 'agent', status: null, dueOn: null, archived: false };
    const post = (body, headers = {}) => ({ method: 'POST', headers: { 'x-workspace-account': site.accountId, ...headers }, body: JSON.stringify(body) });
    await probe('only {category, content}', post({ category: 'work', content: 'x' }), 400, 'Use the original entry and operation.');
    await probe('no x-workspace-account header', { method: 'POST', body: JSON.stringify({ operationId: randomUUID(), entry }) }, 409, 'The Agent account changed. Read its workspace before using the original operation.');
    await probe('time without milliseconds', post({ operationId: randomUUID(), entry: { ...entry, occurredAt: '2026-10-14T02:00:00Z' } }), 400, 'Use Agent work output or an existing task with its original creation details.');
    await probe('an extra entry key', post({ operationId: randomUUID(), entry: { ...entry, extra: 1 } }), 400, 'Use Agent work output or an existing task with its original creation details.');
    await probe('new task with inputMode manual', post({ operationId: randomUUID(), entry: { ...entry, categoryId: 'todo', kind: 'task', role: null, status: 'open', inputMode: 'manual' } }), 400, 'Use Agent work output or an existing task with its original creation details.');
    await probe('write to chat', post({ operationId: randomUUID(), entry: { ...entry, categoryId: 'chat' } }), 403, 'This Agent path is for work output and tasks.');
    await probe('no key', { method: 'GET', headers: { authorization: '' } }, 401, 'Use an active Agent key with verified account ownership.');
} finally {
    await mcp.close().catch(() => {});
    await site.close();
    rmSync(stateDirectory, { recursive: true, force: true });
}

writeFileSync(join(out, 'e2e-steps.json'), JSON.stringify(steps, null, 2));
writeFileSync(join(out, 'e2e-all-website-requests.jsonl'), site.requests.map(r => JSON.stringify({ n: r.n, method: r.method, path: r.path + r.search, account_header: r.account, authorization: r.authorization, user_agent: r.userAgent, body: r.body, status: r.status, response: r.response })).join('\n') + '\n');
writeFileSync(join(out, 'e2e-result.txt'), `${failures.length ? 'FAIL' : 'PASS'}  steps=${steps.length}  website_requests=${site.requests.length}\n${failures.join('\n')}\n`);
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL E2E CHECKS PASSED', `(evidence in ${out})`);
process.exit(failures.length ? 1 : 0);
