// P-07 on the doubao platform path: every StartSession's prompt is bound to its live-voice ticket. These run index.ts itself (in the support
// runtime: in-memory sockets, no network) and each rule carries its reverse proof: the same scenario against src/ with that rule removed by
// a text mutation must fail, so a pass here means the rule is what passes it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
    clientFrame, finishSession, installWorkersRuntime, loadSrc, startConnection, startSession, startSessionPayload, until,
} from './support/workers-harness.mjs';
import { mintLiveVoiceGrant, DEFAULT_LIVE_SPEAKER } from '../src/live-voice-grant.ts';

const runtime = installWorkersRuntime();
const relay = await loadSrc('index.ts');
const mutant = (mutations) => loadSrc('index.ts', mutations);

const { vectors } = JSON.parse(readFileSync(new URL('./fixtures/voice-prompt-sha256-vectors.json', import.meta.url), 'utf8'));
// Two prompts the marketplace could approve; their hashes were computed independently (Python hashlib).
const IRIS = vectors.find((v) => v.name === 'all four fields');
const XIAOMENG = vectors.find((v) => v.name === 'Chinese');

const secret = 'test-secret-not-a-real-key';
const sub = '11111111-2222-4333-8444-555555555555';
const voice = { sub, assetId: null, speakerId: DEFAULT_LIVE_SPEAKER, model: '1.2.1.1', providerAppSha256: null };
const env = (vars) => ({ WS_TICKET_SECRET: secret, VOLCENGINE_API_KEY: 'test-platform-key', VOLCENGINE_APP_ID: '1000001',
    ALLOWED_ORIGINS: 'https://prometheus.test', ENVIRONMENT: 'test', ...vars });

const lv4 = async (prompt, now = Date.now()) => (await mintLiveVoiceGrant(secret, { ...voice, promptSha256: prompt.sha256 }, now)).ticket;
const lv3 = async (now = Date.now()) => (await mintLiveVoiceGrant(secret, voice, now)).ticket;
// lv2 is no longer minted; the relay still reads it while old public leases are about.
function lv2(now = Date.now()) {
    const grant = { aud: 'doubao-live', sub, assetId: null, speakerId: voice.speakerId, model: voice.model, iat: now, exp: now + 60_000 };
    const payload = 'lv2.' + Buffer.from(JSON.stringify(grant)).toString('base64url');
    return `${payload}.${createHmac('sha256', secret).update('prometheus-live-voice\n' + payload).digest('base64url')}`;
}
// The legacy ticket: "v1." + expMs + "." + b64url(subject) + "." + b64url(HMAC-SHA256(secret, everything before it)).
function v1(subject, exp = Date.now() + 60_000) {
    const payload = `v1.${exp}.${Buffer.from(subject).toString('base64url')}`;
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

const SC = () => ['StartConnection', startConnection()];
const SS = (n, prompt) => [`StartSession#${n}`, startSession(`session-${n}`, prompt.dialog ?? prompt, { speaker: voice.speakerId, model: voice.model })];
const FS = (n) => [`FinishSession#${n}`, finishSession(`session-${n}`)];
const RENEW = (ticket) => ['renewal', JSON.stringify({ type: 'voice-lease', ticket })];
const doubao = (ticket) => `/doubao?ticket=${encodeURIComponent(ticket)}`;

/**
 * Opens a socket on `path`, plays `steps` ([label, binary frame or text]) as the client, and waits until every binary frame reached the
 * provider and every renewal was answered, or the socket closed. Reports what reached the provider (by label) and how the socket ended.
 */
async function session(worker, path, steps = [], vars = {}) {
    const logs = [], saved = { log: console.log, warn: console.warn, error: console.error };
    for (const level of Object.keys(saved)) console[level] = (...args) => { logs.push({ level, text: args.map(String).join(' ') }); };
    try {
        const pairs = runtime.pairs.length, upstreams = runtime.upstreams.length, fetches = runtime.fetches.length;
        const response = await worker.default.fetch({ url: `https://relay.test${path}`, method: 'GET',
            headers: new Headers({ Upgrade: 'websocket' }) }, env(vars));
        const result = { status: response.status, logs };
        if (response.status !== 101) return { ...result, body: await response.json(), warns: warnsOf(logs), dialled: runtime.fetches.slice(fetches) };
        const socket = runtime.pairs[pairs].server, labels = new Map();
        const upstream = () => runtime.upstreams[upstreams] ?? null;
        const forwarded = () => (upstream()?.sent ?? []).map((data) => labels.get(data) ?? 'an unknown frame');
        let frames = 0, renewals = 0;
        for (const [label, data] of steps) {
            if (typeof data !== 'string') { labels.set(data, label); frames++; } else if (JSON.parse(data).type === 'voice-lease') renewals++;
            socket.dispatch('message', { data });
        }
        await until(`${path}: every frame forwarded or the socket closed`,
            () => socket.closed || forwarded().length === frames && socket.sent.length === renewals);
        Object.assign(result, { forwarded: forwarded(), close: socket.closed, providerClose: upstream()?.closed ?? null,
            answers: socket.sent.map((data) => JSON.parse(data).type), warns: warnsOf(logs), dialled: runtime.fetches.slice(fetches) });
        if (!socket.closed) socket.dispatch('close', { code: 1000, reason: 'test done' }); // ends the lease timer
        return result;
    } finally {
        Object.assign(console, saved);
    }
}
const warnsOf = (logs) => logs.filter((l) => l.level === 'warn').map((l) => l.text);
const p07 = (run) => run.warns.filter((text) => text.includes('[P-07]'));
const NOT_APPROVED = { code: 1008, reason: 'Voice prompt not approved' };
const BINDING_REQUIRED = { code: 1008, reason: 'Voice prompt binding required' };

test('lv4: a StartSession whose four dialog fields hash to the ticket\'s promptSha256 is admitted and forwarded unchanged', async () => {
    const ticket = await lv4(IRIS);
    assert.match(ticket, /^lv4\./);
    const run = await session(relay, doubao(ticket), [SC(), SS(1, IRIS)]);
    assert.equal(run.status, 101);
    assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1']);
    assert.equal(run.close, null);
    assert.deepEqual(p07(run), []);
    // Reverse proof: the gate as it was (lv2 and lv3 only) refuses the same ticket.
    const old = await session(await mutant({ 'index.ts': [['/^lv[234]\\./', '/^lv[23]\\./']] }), doubao(ticket), [SC(), SS(1, IRIS)]);
    assert.equal(old.status, 403);
});

test('lv4: any other dialog closes 1008 "Voice prompt not approved", none of it reaches the provider, and no log carries the prompt', async () => {
    const ticket = await lv4(IRIS);
    const marker = 'UNAPPROVED-PERSONA-MARKER-7F3A';
    for (const dialog of [
        { ...IRIS.dialog, system_role: `${IRIS.dialog.system_role} ${marker}` }, // text added
        { ...IRIS.dialog, speaking_style: `${IRIS.dialog.speaking_style} ` },    // one trailing space: nothing is trimmed
        { ...IRIS.dialog, bot_name: IRIS.dialog.speaking_style, speaking_style: IRIS.dialog.bot_name }, // the same texts in other fields
        XIAOMENG.dialog,                                                         // another approved prompt, not this ticket's
    ]) {
        const run = await session(relay, doubao(ticket), [SC(), SS(1, dialog)]);
        assert.deepEqual(run.forwarded, ['StartConnection'], JSON.stringify(dialog));
        assert.deepEqual(run.close, NOT_APPROVED);
        assert.deepEqual(run.providerClose, NOT_APPROVED);
        assert.equal(p07(run).length, 1);
        const logged = run.logs.map((l) => l.text).join('\n');
        for (const text of [marker, ...Object.values(dialog).map((v) => v.trim())]) assert.ok(!logged.includes(text), `a log line carries "${text}"`);
    }
    // Reverse proof: a guard that hashes the prompt but never compares it forwards the first case.
    const blind = await mutant({ 'doubao-frame-guard.ts': [['if (sent !== bound) {', 'if (sent !== bound && false) {']] });
    const run = await session(blind, doubao(ticket), [SC(), SS(1, { ...IRIS.dialog, system_role: marker })]);
    assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1']);
});

// ⑦ EVAL 965: the hash covers the four dialog text fields only, so no other part of a StartSession may carry text past it. Each case is an
// otherwise valid lv4-bound StartSession (its four fields are the approved ones, so the hash matches) with one piece of text elsewhere.
test('lv4: text anywhere in a StartSession outside the four hashed fields closes 1008, and none of it reaches the provider', async () => {
    const ticket = await lv4(IRIS);
    const text = 'UNHASHED-PERSONA-TEXT-4C1D';
    const edited = (edit) => {
        const payload = startSessionPayload(IRIS.dialog, { speaker: voice.speakerId, model: voice.model });
        edit(payload);
        return payload;
    };
    const canonical = JSON.stringify(edited(() => {}));
    assert.equal(canonical.split('"system_role":').length, 2);
    // The reverse proofs: the guard check reads as passed, or the lease stops pinning that value to the ticket.
    const guardCheck = (check) => ({ 'doubao-frame-guard.ts': [[check, 'false']] });
    const leasePin = (match) => ({ 'live-voice-lease.ts': [[match, '']] });
    const cases = [
        ['a new top-level key', edited((p) => { p.note = text; }), guardCheck("Object.keys(frame.json).some(k => !['dialog', 'tts', 'asr'].includes(k))")],
        ['a new dialog key', edited((p) => { p.dialog.note = text; }),
            guardCheck("Object.keys(dialogConfig).some(k => !['character_manifest', 'bot_name', 'system_role', 'speaking_style', 'extra'].includes(k))")],
        ['dialog.extra.note', edited((p) => { p.dialog.extra.note = text; }), guardCheck("Object.keys(extraConfig).sort().join(',') !== 'input_mod,model'")],
        ['dialog.extra.input_mod', edited((p) => { p.dialog.extra.input_mod = `keep_alive ${text}`; }),
            guardCheck("!['keep_alive', 'push_to_talk'].includes(String(extraConfig.input_mod))")],
        ['dialog.extra.model', edited((p) => { p.dialog.extra.model = text; }), leasePin(' && current.model === model')],
        ['tts.text', edited((p) => { p.tts.text = text; }), guardCheck("Object.keys(config).some(k => !['speaker', 'audio_config'].includes(k))")],
        ['tts.speaker', edited((p) => { p.tts.speaker = `${voice.speakerId} ${text}`; }), leasePin(' && current.speakerId === speaker')],
        ['tts.audio_config.text', edited((p) => { p.tts.audio_config.text = text; }),
            guardCheck("Object.keys(audio).sort().join(',') !== 'channel,format,sample_rate'")],
        ['asr.text', edited((p) => { p.asr.text = text; }), guardCheck("Object.keys(asr).join(',') !== 'extra'")],
        ['asr.extra.text', edited((p) => { p.asr.extra.text = text; }), guardCheck('Object.keys(asr.extra).length !== 0')],
        // A repeated key: JSON.parse keeps the last one (the approved text, so the hash matches); the provider's parser may keep the first.
        ['dialog.system_role given twice', canonical.replace('"system_role":', `"system_role":${JSON.stringify(text)},"system_role":`),
            guardCheck('JSON.stringify(json) !== raw')],
    ];
    for (const [where, payload, removed] of cases) {
        const run = await session(relay, doubao(ticket), [SC(), ['StartSession#1', clientFrame(100, 'session-1', payload)]]);
        assert.deepEqual(run.forwarded, ['StartConnection'], where);
        assert.deepEqual(run.close, { code: 1008, reason: 'Voice session authorization failed' }, where);
        assert.equal(run.providerClose?.code, 1008, where);
        // Reverse proof: without that one check, the hash alone admits the StartSession and the text reaches the provider.
        const leaked = await session(await mutant(removed), doubao(ticket), [SC(), ['StartSession#1', clientFrame(100, 'session-1', payload)]]);
        assert.deepEqual(leaked.forwarded, ['StartConnection', 'StartSession#1'], `reverse proof: ${where}`);
    }
});

test('lv4: a StartSession after a FinishSession on the same socket is checked too', async () => {
    const ticket = await lv4(IRIS);
    const again = await session(relay, doubao(ticket), [SC(), SS(1, IRIS), FS(1), SS(2, IRIS)]);
    assert.deepEqual(again.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1', 'StartSession#2']);
    assert.equal(again.close, null);
    const swapped = await session(relay, doubao(ticket), [SC(), SS(1, IRIS), FS(1), SS(2, XIAOMENG)]);
    assert.deepEqual(swapped.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1']);
    assert.deepEqual(swapped.close, NOT_APPROVED);
    // Reverse proof: a guard that checks only a socket's first StartSession lets the second prompt through.
    const firstOnly = await mutant({ 'doubao-frame-guard.ts': [
        ['promptRefusal: string | null = null;', 'promptRefusal: string | null = null, checked = false;'],
        ['if (binding) {', 'if (binding && !checked) { checked = true;'],
    ] });
    const run = await session(firstOnly, doubao(ticket), [SC(), SS(1, IRIS), FS(1), SS(2, XIAOMENG)]);
    assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1', 'StartSession#2']);
});

test('lv3 and lv2 while LIVE_VOICE_REQUIRE_PROMPT is not "1": admitted, one "[P-07] live voice without prompt binding" line per StartSession', async () => {
    for (const [ticket, vars] of [[await lv3(), {}], [await lv3(), { LIVE_VOICE_REQUIRE_PROMPT: '0' }], [lv2(), {}]]) {
        const run = await session(relay, doubao(ticket), [SC(), SS(1, XIAOMENG), FS(1), SS(2, IRIS)], vars);
        assert.equal(run.status, 101, ticket.slice(0, 3));
        assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1', 'StartSession#2']);
        assert.equal(run.close, null);
        assert.deepEqual(p07(run), ['[P-07] live voice without prompt binding', '[P-07] live voice without prompt binding']);
    }
    // Reverse proof: without the line, an unbound session leaves no trace.
    const silent = await mutant({ 'doubao-frame-guard.ts': [["console.warn('[P-07] live voice without prompt binding');", 'void 0;']] });
    const run = await session(silent, doubao(await lv3()), [SC(), SS(1, XIAOMENG)]);
    assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1']);
    assert.deepEqual(p07(run), []);
});

test('lv3 and lv2 when LIVE_VOICE_REQUIRE_PROMPT is "1": the StartSession closes 1008 "Voice prompt binding required" and is not forwarded', async () => {
    const required = { LIVE_VOICE_REQUIRE_PROMPT: '1' };
    for (const ticket of [await lv3(), lv2()]) {
        const run = await session(relay, doubao(ticket), [SC(), SS(1, XIAOMENG)], required);
        assert.deepEqual(run.forwarded, ['StartConnection'], ticket.slice(0, 3));
        assert.deepEqual(run.close, BINDING_REQUIRED);
        assert.deepEqual(run.providerClose, BINDING_REQUIRED);
    }
    // An lv4 session is held to its own prompt, whatever the switch says.
    const bound = await session(relay, doubao(await lv4(IRIS)), [SC(), SS(1, IRIS)], required);
    assert.deepEqual(bound.forwarded, ['StartConnection', 'StartSession#1']);
    // Reverse proof: a relay that never reads the switch admits the unbound session.
    const ignored = await mutant({ 'index.ts': [["required: env.LIVE_VOICE_REQUIRE_PROMPT === '1'", 'required: false']] });
    const run = await session(ignored, doubao(await lv3()), [SC(), SS(1, XIAOMENG)], required);
    assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1']);
});

test('a v1 ticket no longer opens the doubao platform path: 403 like every ticket refusal, and the provider is never dialled', async () => {
    const legacy = v1(sub);
    const run = await session(relay, doubao(legacy));
    assert.equal(run.status, 403);
    assert.deepEqual(run.body, { error: 'doubao: platform relay access requires a valid ticket (wrong-purpose)' });
    assert.deepEqual(run.dialled, []);
    // A live-voice ticket that does not verify (signed with another secret) is 'bad-ticket', and is not handed to the v1 verifier.
    const forged = (await mintLiveVoiceGrant('another-secret', { ...voice, promptSha256: IRIS.sha256 })).ticket;
    const bad = await session(relay, doubao(forged));
    assert.deepEqual([bad.status, bad.body], [403, { error: 'doubao: platform relay access requires a valid ticket (bad-ticket)' }]);
    // A relay without its ticket secret still says so (as it did before, through the v1 verifier), for any ticket.
    for (const ticket of [await lv4(IRIS), legacy]) {
        const unconfigured = await session(relay, doubao(ticket), [], { WS_TICKET_SECRET: undefined });
        assert.deepEqual([unconfigured.status, unconfigured.body], [403, { error: 'doubao: platform relay access requires a valid ticket (unconfigured)' }]);
    }
    // Reverse proof: with the v1 fallback back (the doubao refusal removed), the same v1 ticket opens the socket.
    const fallback = await mutant({ 'index.ts': [[
        ": engineName === 'doubao' ? { valid: false as const, reason: !env.WS_TICKET_SECRET ? 'unconfigured' : liveTicket ? 'bad-ticket' : 'wrong-purpose' }",
        '',
    ]] });
    assert.equal((await session(fallback, doubao(legacy))).status, 101);
});

test('a v1 ticket with an "asr:" subject still opens /asr (the refusal is for doubao only)', async () => {
    const path = `/asr?ticket=${encodeURIComponent(v1('asr:' + sub))}`;
    const run = await session(relay, path);
    assert.equal(run.status, 101);
    assert.deepEqual(run.dialled.map((d) => d.url), ['https://openspeech.bytedance.com/api/v3/sauc/bigmodel_async']);
    // Reverse proof: the same refusal applied to every engine closes /asr to it.
    const everywhere = await mutant({ 'index.ts': [[": engineName === 'doubao' ? { valid: false", ": engineName !== '' ? { valid: false"]] });
    assert.equal((await session(everywhere, path)).status, 403);
});

test('the BYOK path (?byok=1, the user\'s own key) is unchanged: no ticket, no prompt binding and no [P-07] line, whatever the switch', async () => {
    const credentials = ['credentials', JSON.stringify({ type: 'byok', accessKey: 'byok-test-access-key', appId: '1000002' })];
    const anyPrompt = { system_role: 'Whatever the user configured for their own key.' };
    for (const vars of [{}, { LIVE_VOICE_REQUIRE_PROMPT: '1' }]) {
        const run = await session(relay, '/doubao?byok=1', [credentials, SC(), SS(1, anyPrompt)], vars);
        assert.equal(run.status, 101);
        assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1']);
        assert.equal(run.close, null);
        assert.deepEqual(p07(run), []);
        assert.equal(run.dialled[0].headers['X-Api-Access-Key'], 'byok-test-access-key');
    }
    // Reverse proof: a BYOK guard given a binding (one requiring a prompt) refuses the same StartSession.
    const bound = await mutant({ 'doubao-byok-relay.ts': [[
        "(!speaker.startsWith('S_') || model === '2.2.0.0'));",
        "(!speaker.startsWith('S_') || model === '2.2.0.0'), { promptSha256: () => null, required: true });",
    ]] });
    const run = await session(bound, '/doubao?byok=1', [credentials, SC(), SS(1, anyPrompt)]);
    assert.deepEqual(run.forwarded, ['StartConnection']);
    assert.notEqual(run.close, null);
});

test('an in-band renewal must name the same prompt; later StartSessions stay held to it', async () => {
    const start = Date.now();
    const ticket = await lv4(IRIS, start);
    // The same prompt renews (answered), and a later StartSession with another prompt is still refused.
    const renewed = await session(relay, doubao(ticket), [SC(), SS(1, IRIS), RENEW(await lv4(IRIS, start + 1000)), FS(1), SS(2, XIAOMENG)]);
    assert.deepEqual(renewed.answers, ['voice-lease']);
    assert.deepEqual(renewed.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1']);
    assert.deepEqual(renewed.close, NOT_APPROVED);
    // A renewal naming another prompt, or none (lv3), is refused: the session closes before anything after it is forwarded.
    for (const renewal of [await lv4(XIAOMENG, start + 1000), await lv3(start + 1000)]) {
        const run = await session(relay, doubao(ticket), [SC(), SS(1, IRIS), RENEW(renewal), FS(1), SS(2, XIAOMENG)]);
        assert.deepEqual(run.answers, []);
        assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1'], renewal.slice(0, 3));
        assert.deepEqual(run.close, { code: 1008, reason: 'Voice session authorization failed' });
    }
    // Reverse proof: if a renewal could change the prompt (sameLiveVoiceSelection without promptSha256), the other prompt would be renewed
    // in, and the next StartSession is then held to the renewed grant's prompt (the guard reads the lease's current grant).
    const loose = await mutant({ 'live-voice-grant.ts': [[
        '&& a.providerAppSha256===b.providerAppSha256 && a.promptSha256===b.promptSha256;', '&& a.providerAppSha256===b.providerAppSha256;',
    ]] });
    const run = await session(loose, doubao(ticket), [SC(), SS(1, IRIS), RENEW(await lv4(XIAOMENG, start + 1000)), FS(1), SS(2, XIAOMENG)]);
    assert.deepEqual(run.answers, ['voice-lease']);
    assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1', 'StartSession#2']);
});
