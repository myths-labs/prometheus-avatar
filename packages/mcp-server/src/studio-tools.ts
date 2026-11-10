/**
 * Forge Studio tools (2026-11-10): an AI walks one Avatar through the guided studio while the person watches the same
 * session on the studio page (`watch_url`) and answers every question there.
 *
 * The website holds every rule: an AI never spends points on its own
 * (a paid request becomes a question for the person), only the person answers a question or chooses a voice, and the
 * person can pause the AI. These tools only send requests and tell the model what to do next; they never try to get
 * around a refusal.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type StudioToolOptions = { fetch?: typeof fetch; pollMs?: number };

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionId = () => z.string().regex(UUID_TEXT, 'must be a UUID: 8-4-4-4-12 hexadecimal digits').describe('The studio session id from forge_studio_start.');
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const acting = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const REQUEST_TIMEOUT_MS = 15_000;
const WAIT_MAX_SECONDS = 25;

type Json = Record<string, any>;
type Answer = { status: number; json: Json | null };

const ASK_PERSON = 'Tell the user to open watch_url and answer it there. You cannot answer it yourself. You may mark your pick with forge_studio_suggest, then call forge_studio_wait.';

/** What the model should do after a refusal, by the website's code. */
function nextFor(code: string): string {
    switch (code) {
        case 'AI_PAUSED': return 'The person paused the AI on the studio page. Stop, tell the user, and do not retry until they switch it back on.';
        case 'CHECKPOINT_OPEN': return 'A question is waiting for the person on the studio page. Do not start other work: call forge_studio_wait until it is answered.';
        case 'CHECKPOINT_CHANGED': return 'The question changed. Call forge_studio_get and look again before suggesting anything.';
        case 'HUMAN_ONLY': return 'Only the person can do this, on the studio page. Tell them what to click, then call forge_studio_wait.';
        case 'STEP_LOCKED': return 'This step is not open yet. Finish the earlier steps first (see steps in forge_studio_get).';
        case 'STEP_BUSY': return 'This step is already running. Call forge_studio_wait to follow it.';
        case 'STALE': return 'The session changed meanwhile. Call forge_studio_get, then try once more.';
        case 'SESSION_NOT_FOUND': return 'There is no such session for this account. Start one with forge_studio_start.';
        case 'KEY_MISSING': return 'Set PROMETHEUS_API_KEY to the user\'s Agent key (Prometheus Settings > Agent keys), then call again.';
        case 'AUTH_REQUIRED': case 'SESSION_REQUIRED': case 'HTTP_401':
            return 'The Agent key was not accepted. Tell the user to check PROMETHEUS_API_KEY. Do not retry until they have.';
        case 'PRICE_UNAVAILABLE': return 'The price could not be read, so nothing was sent and nothing was charged. Wait a moment and call again.';
        case 'PRICE_INVALID': case 'REQUEST_INVALID': case 'REQUEST_UNKNOWN': case 'OPTION_UNKNOWN': case 'BODY_INVALID': case 'ASSET_INVALID':
            return 'Fix the arguments; calling again unchanged fails the same way.';
        case 'ASSET_NOT_FOUND': return 'That Avatar is not this account\'s. Ask the user which of their Avatars to use, or start without one.';
        default: return 'Call forge_studio_get to see what happened before trying again.';
    }
}

function result(body: Json, isError = false): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(body) }], ...(isError ? { isError: true } : {}) };
}

/** The session as the model reads it: state, the open question, and progress; never the server's held request. */
function summarize(session: Json | null | undefined) {
    if (!session) return null;
    const cp = session.checkpoint;
    const task = session.task;
    return {
        id: session.id, version: session.version, current_step: session.currentStep, steps: session.steps,
        checkpoint: cp ? { id: cp.id, kind: cp.kind, step: cp.step, options: cp.options, cost_points: cp.costPoints ?? 0, ai_pick: cp.aiPick ?? null } : null,
        agent_paused: session.agentPaused === true, asset_id: session.assetId ?? null,
        task: task ? { status: task.status, sub_step: task.sub_step ?? null, progress: task.progress ?? null } : null,
        last_seq: session.lastSeq ?? null,
    };
}

/** What to do next after a successful answer. */
function guide(view: ReturnType<typeof summarize>): { waiting_for_person: boolean; next: string } {
    if (!view) return { waiting_for_person: false, next: 'Call forge_studio_get.' };
    if (view.agent_paused) return { waiting_for_person: true, next: nextFor('AI_PAUSED') };
    const steps = (view.steps ?? {}) as Record<string, string>;
    if (view.checkpoint) {
        const what = view.checkpoint.kind === 'approve_spend' ? `approve spending ${view.checkpoint.cost_points} points`
            : view.checkpoint.kind === 'voice_pick' ? 'pick one of the voices' : 'confirm or redraw the first picture';
        return { waiting_for_person: true, next: `The studio is waiting for the person to ${what}. ${ASK_PERSON}` };
    }
    const yours = Object.keys(steps).find((s) => steps[s] === 'needs_you');
    if (yours) return { waiting_for_person: true, next: `Step "${yours}" is the person's turn on the studio page (for a voice, they choose it there). Tell the user, then call forge_studio_wait.` };
    const running = Object.keys(steps).find((s) => steps[s] === 'working');
    if (running) return { waiting_for_person: false, next: `Step "${running}" is running. Call forge_studio_wait to follow it.` };
    if (steps.avatar === 'ready') return { waiting_for_person: false, next: 'Describe the character and call forge_studio_make_avatar.' };
    if (steps.voice === 'ready') return { waiting_for_person: false, next: 'Call forge_studio_make_voices.' };
    if (steps.expressions === 'ready') return { waiting_for_person: false, next: 'The Avatar came with its expressions; the person can add more on the studio page. Tell the user.' };
    return { waiting_for_person: false, next: 'Call forge_studio_get to see the steps.' };
}

export function registerStudioTools(server: McpServer, apiBase: string, apiKey: string | undefined, version: string, options: StudioToolOptions = {}): number {
    const base = apiBase.replace(/\/+$/, '');
    const doFetch = options.fetch ?? fetch;
    const pollMs = options.pollMs ?? 2000;
    const watchUrl = (id: string) => `${base}/forge/studio?session=${encodeURIComponent(id)}`;

    async function request(method: 'GET' | 'POST', path: string, body?: Json): Promise<Answer> {
        try {
            const res = await doFetch(`${base}${path}`, {
                method,
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': `prometheus-mcp/${version}` },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            return { status: res.status, json: await res.json().catch(() => null) };
        } catch {
            return { status: 0, json: null };
        }
    }

    const refused = (answer: Answer, sessionIdValue?: string): CallToolResult => {
        const code = typeof answer.json?.code === 'string' ? answer.json.code : answer.status ? `HTTP_${answer.status}` : 'NETWORK';
        return result({ ok: false, code, ...(sessionIdValue ? { watch_url: watchUrl(sessionIdValue) } : {}), next: nextFor(code) }, true);
    };
    const missingKey = (): CallToolResult | null => (apiKey ? null : result({ ok: false, code: 'KEY_MISSING', next: nextFor('KEY_MISSING') }, true));
    const done = (session: Json, extra: Json = {}): CallToolResult => {
        const view = summarize(session);
        return result({ ok: true, session: view, watch_url: watchUrl(session.id), ...guide(view), ...extra });
    };

    /** Read the version, send the request at it; one more read-and-send on STALE. */
    async function act(id: string, studioRequest: Json): Promise<CallToolResult> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const read = await request('GET', `/api/forge/studio/${id}`);
            if (read.status !== 200 || !read.json?.session) return refused(read, id);
            const sent = await request('POST', `/api/forge/studio/${id}/actions`, { request: studioRequest, expected_version: read.json.session.version });
            if (sent.status === 200 && sent.json?.session) return done(sent.json.session);
            if (sent.json?.code !== 'STALE' || attempt === 1) return refused(sent, id);
        }
        return refused({ status: 409, json: { code: 'STALE' } }, id);
    }

    server.registerTool('forge_studio_start', {
        title: 'Start a Forge Studio session',
        description: 'Open a guided Forge Studio session: 1/5 avatar, 2/5 voice, 3/5 expressions (then motions, personality, listing). The person watches it live at watch_url and makes every choice there. Pass asset_id to continue with one of the user\'s Avatars from the voice step.',
        inputSchema: { asset_id: z.string().regex(UUID_TEXT).optional().describe('One of the user\'s Avatars to continue with.') },
        annotations: acting,
    }, async ({ asset_id }) => {
        const blocked = missingKey(); if (blocked) return blocked;
        const answer = await request('POST', '/api/forge/studio', asset_id ? { asset_id } : {});
        if (answer.status !== 201 || !answer.json?.session) return refused(answer);
        const view = summarize(answer.json.session);
        return result({ ok: true, session: view, watch_url: watchUrl(answer.json.session.id),
            waiting_for_person: false, next: `Ask the user to open watch_url so they can watch and answer questions. Then ${guide(view).next}` });
    });

    server.registerTool('forge_studio_get', {
        title: 'Read a Forge Studio session',
        description: 'Read the session: each step\'s status, the question waiting for the person (if any), progress, and the events after `since`.',
        inputSchema: { session_id: sessionId(), since: z.number().int().min(0).optional().describe('Return only events after this seq.') },
        annotations: readOnly,
    }, async ({ session_id, since }) => {
        const blocked = missingKey(); if (blocked) return blocked;
        const answer = await request('GET', `/api/forge/studio/${session_id}?since=${since ?? 0}`);
        if (answer.status !== 200 || !answer.json?.session) return refused(answer, session_id);
        return done(answer.json.session, { events: answer.json.session.events ?? [] });
    });

    server.registerTool('forge_studio_wait', {
        title: 'Wait for the next change in a Forge Studio session',
        description: `Wait until something new happens in the session (the person answered, a step finished) or timeout_s passes (at most ${WAIT_MAX_SECONDS}). Call it again to keep waiting.`,
        inputSchema: {
            session_id: sessionId(),
            since: z.number().int().min(0).describe('The last event seq you have seen (last_seq).'),
            timeout_s: z.number().int().min(1).max(WAIT_MAX_SECONDS).optional().describe(`Seconds to wait, 1-${WAIT_MAX_SECONDS} (default 20).`),
        },
        annotations: readOnly,
    }, async ({ session_id, since, timeout_s }) => {
        const blocked = missingKey(); if (blocked) return blocked;
        const deadline = Date.now() + (timeout_s ?? 20) * 1000;
        for (;;) {
            const answer = await request('GET', `/api/forge/studio/${session_id}?since=${since}`);
            if (answer.status !== 200 || !answer.json?.session) return refused(answer, session_id);
            const events = answer.json.session.events ?? [];
            if (events.length > 0 || Date.now() + pollMs > deadline) {
                return done(answer.json.session, { changed: events.length > 0, events });
            }
            await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
    });

    server.registerTool('forge_studio_make_avatar', {
        title: 'Step 1/5: make the Avatar',
        description: 'Ask the studio to make a 2D Avatar from a description. It costs points, so the studio asks the person to approve on the studio page first; nothing is charged until they do.',
        inputSchema: { session_id: sessionId(), prompt: z.string().min(4).max(2000).describe('How the character looks and who it is, in a few sentences.') },
        annotations: acting,
    }, async ({ session_id, prompt }) => {
        const blocked = missingKey(); if (blocked) return blocked;
        const prices = await request('GET', '/api/billing/generation-prices');
        const price = prices.json?.bundle_2d;
        if (prices.status !== 200 || !Number.isSafeInteger(price) || price < 0) return refused({ status: 0, json: { code: 'PRICE_UNAVAILABLE' } }, session_id);
        return act(session_id, { kind: 'make_avatar', prompt, pricePoints: price });
    });

    server.registerTool('forge_studio_make_voices', {
        title: 'Step 2/5: offer voices',
        description: 'Ask the studio for voice candidates for the Avatar. Choosing the voice is always the person\'s, on the studio page.',
        inputSchema: { session_id: sessionId() },
        annotations: acting,
    }, async ({ session_id }) => {
        const blocked = missingKey(); if (blocked) return blocked;
        return act(session_id, { kind: 'make_voices', pricePoints: 0 });
    });

    server.registerTool('forge_studio_suggest', {
        title: 'Mark your pick on the open question',
        description: 'Show the person which option you would pick, and why, on the open question. It does not answer the question: the person still decides.',
        inputSchema: {
            session_id: sessionId(),
            checkpoint_id: z.string().min(1).max(64),
            option_id: z.string().min(1).max(128),
            reason: z.string().min(1).max(280).describe('One short sentence the person will read.'),
        },
        annotations: acting,
    }, async ({ session_id, checkpoint_id, option_id, reason }) => {
        const blocked = missingKey(); if (blocked) return blocked;
        return act(session_id, { kind: 'suggest', checkpointId: checkpoint_id, optionId: option_id, reason });
    });

    return 6;
}
