// Forge Studio tools (2026-11-10) as a model sees them: registered on a real McpServer, called through a real MCP Client,
// against a small fake of the website's studio routes (/api/forge/studio/**). The website decides every
// rule (an AI never spends alone, only the person answers a question); these tests pin what the tools send and what they
// tell the model to do next.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerStudioTools } from '../.test-build/studio-tools.js';

const KEY = 'pak_test_studio_key';
const SESSION = '33333333-3333-4333-8333-333333333333';

function steps(over = {}) {
    return { avatar: 'ready', voice: 'locked', expressions: 'locked', motions: 'locked', personality: 'locked', listing: 'locked', ...over };
}

/** The website's studio routes, reduced to what the tools read. `plan` lets a test choose the answers. */
async function fakeSite(plan = {}) {
    const seen = [];
    const state = { version: 1, steps: steps(), checkpoint: null, agentPaused: false, events: [{ seq: 1, actor: 'ai', type: 'opened', step: null, payload: {}, at: '2026-11-10T09:00:00Z' }] };
    const session = () => ({ id: SESSION, version: state.version, currentStep: 'avatar', steps: state.steps, checkpoint: state.checkpoint,
        agentPaused: state.agentPaused, taskId: null, assetId: null, task: null, events: [], lastSeq: state.events.at(-1).seq });
    const server = http.createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
        const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
        const url = new URL(req.url, 'http://x');
        if (req.method === 'GET' && url.pathname === '/api/billing/generation-prices') return send(200, { bundle_2d: plan.price ?? 25 });
        if (req.method === 'POST' && url.pathname === '/api/forge/studio') return send(201, { success: true, session: { ...session(), events: state.events } });
        if (req.method === 'GET' && url.pathname === `/api/forge/studio/${SESSION}`) {
            const since = Number(url.searchParams.get('since') ?? 0);
            return send(200, { success: true, session: { ...session(), events: state.events.filter((e) => e.seq > since) } });
        }
        if (req.method === 'POST' && url.pathname === `/api/forge/studio/${SESSION}/actions`) {
            if (plan.refuse) return send(plan.refuse.status, { success: false, code: plan.refuse.code });
            const request = JSON.parse(body).request;
            if (request.kind === 'make_avatar' && request.pricePoints > 0) {
                state.version += 1;
                state.steps = steps({ avatar: 'needs_you' });
                state.checkpoint = { id: 'cp-1', kind: 'approve_spend', step: 'avatar', costPoints: request.pricePoints, aiPick: null, sourceAttempt: null,
                    options: [{ id: 'approve', label: `Spend ${request.pricePoints} points` }, { id: 'skip', label: 'Not now' }] };
                state.events.push({ seq: state.events.length + 1, actor: 'ai', type: 'needs_you', step: 'avatar', payload: { kind: 'approve_spend' }, at: '2026-11-10T09:00:05Z' });
            }
            return send(200, { success: true, session: session() });
        }
        return send(404, { success: false, code: 'NOT_FOUND' });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    return { url, seen, state, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function connect(apiBase, options = {}) {
    const server = new McpServer({ name: 'test', version: '0' });
    const count = registerStudioTools(server, apiBase, KEY, 'test', { pollMs: 50, ...options });
    const client = new Client({ name: 'client', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        return { result, json: JSON.parse(result.content[0].text) };
    };
    return { client, call, count, close: async () => { await client.close(); await server.close(); } };
}

test('registers the studio tools for steps 1-3', async () => {
    const site = await fakeSite();
    const mcp = await connect(site.url);
    try {
        const { tools } = await mcp.client.listTools();
        assert.equal(mcp.count, 6);
        assert.deepEqual(tools.map((t) => t.name).sort(),
            ['forge_studio_get', 'forge_studio_make_avatar', 'forge_studio_make_voices', 'forge_studio_start', 'forge_studio_suggest', 'forge_studio_wait']);
    } finally { await mcp.close(); await site.close(); }
});

test('start opens a session and gives the page the person should open', async () => {
    const site = await fakeSite();
    const mcp = await connect(site.url);
    try {
        const { json } = await mcp.call('forge_studio_start', {});
        assert.equal(json.ok, true);
        assert.equal(json.session.id, SESSION);
        assert.equal(json.watch_url, `${site.url}/forge/studio?session=${SESSION}`);
        assert.match(json.next, /open/i);
        assert.equal(site.seen.at(-1).auth, `Bearer ${KEY}`);
    } finally { await mcp.close(); await site.close(); }
});

test('making an avatar sends the price the website shows and stops at the person when it costs points', async () => {
    const site = await fakeSite({ price: 25 });
    const mcp = await connect(site.url);
    try {
        const { json } = await mcp.call('forge_studio_make_avatar', { session_id: SESSION, prompt: 'a red panda in a yellow raincoat' });
        const action = site.seen.find((r) => r.url.endsWith('/actions'));
        assert.deepEqual(action.body.request, { kind: 'make_avatar', prompt: 'a red panda in a yellow raincoat', pricePoints: 25 });
        assert.equal(action.body.expected_version, 1);
        assert.equal(json.ok, true);
        assert.equal(json.session.checkpoint.kind, 'approve_spend');
        assert.equal(json.session.checkpoint.cost_points, 25);
        assert.equal(json.waiting_for_person, true);
        assert.match(json.next, /forge_studio_wait/);
        assert.doesNotMatch(json.next, /approve it yourself/i);
    } finally { await mcp.close(); await site.close(); }
});

test('a paused AI is told to stop, not to retry', async () => {
    const site = await fakeSite({ refuse: { status: 423, code: 'AI_PAUSED' } });
    const mcp = await connect(site.url);
    try {
        const { json, result } = await mcp.call('forge_studio_make_voices', { session_id: SESSION });
        assert.equal(json.ok, false);
        assert.equal(json.code, 'AI_PAUSED');
        assert.match(json.next, /do not retry/i);
        assert.equal(result.isError, true);
    } finally { await mcp.close(); await site.close(); }
});

test('wait returns as soon as something new happens', async () => {
    const site = await fakeSite();
    const mcp = await connect(site.url);
    try {
        setTimeout(() => site.state.events.push({ seq: 2, actor: 'you', type: 'answered', step: 'avatar', payload: { optionId: 'approve' }, at: '2026-11-10T09:01:00Z' }), 150);
        const started = Date.now();
        const { json } = await mcp.call('forge_studio_wait', { session_id: SESSION, since: 1, timeout_s: 5 });
        assert.equal(json.ok, true);
        assert.equal(json.changed, true);
        assert.deepEqual(json.events.map((e) => e.seq), [2]);
        assert.ok(Date.now() - started < 4000);
    } finally { await mcp.close(); await site.close(); }
});

test('wait with nothing new ends at its timeout and says so', async () => {
    const site = await fakeSite();
    const mcp = await connect(site.url);
    try {
        const { json } = await mcp.call('forge_studio_wait', { session_id: SESSION, since: 1, timeout_s: 1 });
        assert.equal(json.ok, true);
        assert.equal(json.changed, false);
        assert.deepEqual(json.events, []);
    } finally { await mcp.close(); await site.close(); }
});

test('a missing key is reported before any request', async () => {
    const site = await fakeSite();
    const server = new McpServer({ name: 'test', version: '0' });
    registerStudioTools(server, site.url, undefined, 'test', { pollMs: 50 });
    const client = new Client({ name: 'client', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
        const result = await client.callTool({ name: 'forge_studio_start', arguments: {} });
        const json = JSON.parse(result.content[0].text);
        assert.equal(json.code, 'KEY_MISSING');
        assert.equal(site.seen.length, 0);
    } finally { await client.close(); await server.close(); await site.close(); }
});
