// P-07 on the doubao platform path: every StartSession's prompt is bound to its live-voice ticket; and (option B, ⑨ 2026-11-10) on the
// own-key path (?byok=1) to its own-key grant. These run index.ts itself (in the support runtime: in-memory sockets, no network) and each
// rule carries its reverse proof: the same scenario against src/ with that rule removed by a text mutation must fail, so a pass here means
// the rule is what passes it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
    clientFrame, finishSession, installWorkersRuntime, loadSrc, startConnection, startSession, startSessionPayload, until,
} from './support/workers-harness.mjs';
import { mintLiveVoiceGrant, DEFAULT_LIVE_SPEAKER } from '../src/live-voice-grant.ts';
import { mintByokVoiceGrant } from '../src/byok-voice-grant.ts';

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

// ═══ P-07 option B (钱安全线 ⑨ 2026-11-10): the own-key path (?byok=1) ═══
// A live-voice session on the caller's own Volcengine key carries the own-key grant (?grant=ob1..., src/byok-voice-grant.ts) that
// /api/volcengine-realtime-token mints after the persona gate passed the session's prompt. The key itself still arrives in-band, as the
// socket's first frame; the frames after it reach the guard (session() sends every step at once, so they queue while the provider is
// dialled and are guarded when they come out of the queue).
const ACCESS_KEY = 'byok-test-access-key';
const CREDENTIALS = () => ['credentials', JSON.stringify({ type: 'byok', accessKey: ACCESS_KEY, appId: '1000002' })];
const ob1 = async (prompt, { signer = secret, now = Date.now(), model = voice.model } = {}) =>
    (await mintByokVoiceGrant(signer, { sub, model, promptSha256: prompt.sha256 }, now)).grant;
// The URL the app opens: no key and no ticket in it; the grant when there is one.
const ownKey = (grant) => `/doubao?byok=1&resourceId=volc.speech.dialog&appKey=PlgvMymc7f3tQnJ6${grant === undefined ? '' : `&grant=${encodeURIComponent(grant)}`}`;
const OWN_KEY_PROVIDER = 'https://openspeech.bytedance.com/api/v3/realtime/dialogue';
const SWITCH = [{}, { LIVE_VOICE_REQUIRE_PROMPT: '0' }, { LIVE_VOICE_REQUIRE_PROMPT: '1' }];
const WITHOUT_GRANT = '[P-07] own-key live voice without a grant';
const PROMPT_REFUSED = '[P-07] live voice refused: the StartSession prompt is not the one its ticket approved';
const refused = (reason) => ({ error: `doubao: own-key relay access requires a valid grant (${reason})` });
const ANY_PROMPT = { system_role: 'Whatever the user configured for their own key.' };
/** A grant, and its claims and its signature on their own. */
const grantParts = (grant) => [grant, ...grant.split('.').filter((part) => part.length >= 16)];
/** No log line carries any of `texts` (a grant, the access key, prompt text). */
function nothingSecretLogged(run, texts) {
    const logged = run.logs.map((l) => l.text).join('\n');
    for (const text of texts) if (text) assert.ok(!logged.includes(text), `a log line carries "${text.slice(0, 12)}..."`);
}
/** The own-key relay with one rule removed (a text mutation of doubao-byok-relay.ts). */
const byokWithout = (from, to) => mutant({ 'doubao-byok-relay.ts': [[from, to]] });
const BINDING = 'grant ? { promptSha256: () => grant.promptSha256, required: true } : undefined';

test('own key with a grant: a StartSession whose four dialog fields hash to the grant\'s promptSha256 is admitted and forwarded unchanged, whatever the switch says', async () => {
    const grant = await ob1(IRIS);
    assert.match(grant, /^ob1\./);
    for (const vars of SWITCH) {
        const run = await session(relay, ownKey(grant), [CREDENTIALS(), SC(), SS(1, IRIS)], vars);
        assert.equal(run.status, 101, JSON.stringify(vars));
        // `forwarded` names a frame only when the provider received that very frame (the same object): forwarded unchanged.
        assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1']);
        assert.equal(run.close, null);
        assert.deepEqual(p07(run), []);
        // Dialled once, after the credentials frame, with the key from it; nothing in the provider's URL.
        assert.deepEqual(run.dialled.map((d) => [d.url, d.headers['X-Api-Access-Key']]), [[OWN_KEY_PROVIDER, ACCESS_KEY]]);
        nothingSecretLogged(run, [...grantParts(grant), ACCESS_KEY, ...Object.values(IRIS.dialog)]);
    }
    // Reverse proof: the own-key path as it was (no grant parameter) refuses the same connection.
    const old = await byokWithout("['byok', 'resourceId', 'appKey', 'grant']", "['byok', 'resourceId', 'appKey']");
    const run = await session(old, ownKey(grant), [CREDENTIALS(), SC(), SS(1, IRIS)]);
    assert.deepEqual([run.status, run.body, run.dialled], [400, { error: 'Invalid own-key voice connection' }, []]);
});

test('own key with a grant: any other dialog closes 1008 "Voice prompt not approved" on both sides, whatever the switch says, and none of it reaches the provider', async () => {
    const grant = await ob1(IRIS);
    const marker = 'UNAPPROVED-OWN-KEY-PERSONA-9B2E';
    const dialogs = [
        { ...IRIS.dialog, system_role: `${IRIS.dialog.system_role} ${marker}` }, // text added
        { ...IRIS.dialog, speaking_style: `${IRIS.dialog.speaking_style} ` },    // one trailing space: nothing is trimmed
        XIAOMENG.dialog,                                                         // another approved prompt, not this grant's
        { system_role: marker },                                                 // the user's own prompt, never gated
    ];
    for (const vars of SWITCH) {
        for (const dialog of dialogs) {
            const run = await session(relay, ownKey(grant), [CREDENTIALS(), SC(), SS(1, dialog)], vars);
            assert.deepEqual(run.forwarded, ['StartConnection'], JSON.stringify(dialog));
            assert.deepEqual(run.close, NOT_APPROVED);
            assert.deepEqual(run.providerClose, NOT_APPROVED);
            assert.deepEqual(p07(run), [PROMPT_REFUSED]);
            nothingSecretLogged(run, [...grantParts(grant), ACCESS_KEY, marker, ...Object.values(dialog).map((v) => v.trim())]);
        }
    }
    // Reverse proof: the same guard without the grant's binding forwards every one of them.
    const unbound = await byokWithout(BINDING, 'undefined');
    for (const dialog of dialogs) {
        const run = await session(unbound, ownKey(grant), [CREDENTIALS(), SC(), SS(1, dialog)]);
        assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1'], `reverse proof: ${JSON.stringify(dialog)}`);
    }
});

test('own key with a grant: a StartSession after a FinishSession on the same socket is checked too', async () => {
    const grant = await ob1(IRIS);
    const again = await session(relay, ownKey(grant), [CREDENTIALS(), SC(), SS(1, IRIS), FS(1), SS(2, IRIS)]);
    assert.deepEqual(again.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1', 'StartSession#2']);
    assert.equal(again.close, null);
    const swapped = await session(relay, ownKey(grant), [CREDENTIALS(), SC(), SS(1, IRIS), FS(1), SS(2, XIAOMENG)]);
    assert.deepEqual(swapped.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1']);
    assert.deepEqual(swapped.close, NOT_APPROVED);
    assert.deepEqual(swapped.providerClose, NOT_APPROVED);
    // Reverse proof: a guard that checks only a socket's first StartSession lets the second prompt through.
    const firstOnly = await mutant({ 'doubao-frame-guard.ts': [
        ['promptRefusal: string | null = null;', 'promptRefusal: string | null = null, checked = false;'],
        ['if (binding) {', 'if (binding && !checked) { checked = true;'],
    ] });
    const run = await session(firstOnly, ownKey(grant), [CREDENTIALS(), SC(), SS(1, IRIS), FS(1), SS(2, XIAOMENG)]);
    assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1', 'StartSession#2']);
});

test('own key with a grant: a StartSession on another dialog model than the grant\'s closes 1008 and is not forwarded', async () => {
    const grant = await ob1(IRIS); // names voice.model, 1.2.1.1
    // The approved prompt and a public speaker: only the model differs from the grant.
    const otherModel = () => ['StartSession#1', startSession('session-1', IRIS.dialog, { speaker: voice.speakerId, model: '2.2.0.0' })];
    const run = await session(relay, ownKey(grant), [CREDENTIALS(), SC(), otherModel()]);
    assert.deepEqual(run.forwarded, ['StartConnection']);
    assert.deepEqual(run.close, { code: 1008, reason: 'Invalid voice session frame' });
    assert.deepEqual(run.providerClose, { code: 1008, reason: 'Invalid voice session frame' });
    // Reverse proof: without the grant's model pin the same StartSession reaches the provider.
    const anyModel = await byokWithout(' && (!grant || model === grant.model)', '');
    assert.deepEqual((await session(anyModel, ownKey(grant), [CREDENTIALS(), SC(), otherModel()])).forwarded, ['StartConnection', 'StartSession#1']);
});

test('own key with a grant that does not verify: 403 at the upgrade whatever the switch says, and the provider is never dialled', async () => {
    const good = await ob1(IRIS);
    const [, claims, signature] = good.split('.');
    const platform = await lv4(IRIS);
    const anotherPrompt = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(claims, 'base64url')), promptSha256: XIAOMENG.sha256 })).toString('base64url');
    const signedUnder = (label, payload) => `${payload}.${createHmac('sha256', secret).update(label + payload).digest('base64url')}`;
    const bad = [
        ['signed with another secret', await ob1(IRIS, { signer: 'another-secret' })],
        ['expired', await ob1(IRIS, { now: Date.now() - 120_000 })],
        ['another prompt under the same signature', `ob1.${anotherPrompt}.${signature}`],
        ['a platform lv4 ticket', platform],
        ['the grant with its prefix swapped to lv4', `lv4.${claims}.${signature}`],
        ['a platform lv4 ticket with its prefix swapped to ob1', `ob1.${platform.split('.').slice(1).join('.')}`],
        ['the grant signed under the platform label', signedUnder('prometheus-live-voice\n', `ob1.${claims}`)],
        ['garbage', 'not-a-grant'],
        ['empty', ''],
        ['longer than any grant', `ob1.${'A'.repeat(1100)}.${signature}`],
    ];
    for (const vars of SWITCH) {
        for (const [what, grant] of bad) {
            const run = await session(relay, ownKey(grant), [CREDENTIALS(), SC(), SS(1, IRIS)], vars);
            assert.deepEqual([run.status, run.body, run.dialled], [403, refused('bad-grant'), []], `${what} ${JSON.stringify(vars)}`);
            nothingSecretLogged(run, grantParts(grant));
        }
    }
    // Without its ticket secret the relay can verify no grant: 403 (unconfigured), never an unbound session.
    const unconfigured = await session(relay, ownKey(good), [CREDENTIALS(), SC(), SS(1, IRIS)], { WS_TICKET_SECRET: undefined });
    assert.deepEqual([unconfigured.status, unconfigured.body, unconfigured.dialled], [403, refused('unconfigured'), []]);
    // Two grants (a good one first, a forged one after it) are refused (400) before either is read, like any repeated parameter here.
    const twice = `${ownKey(good)}&grant=${encodeURIComponent(bad[0][1])}`;
    assert.deepEqual(await session(relay, twice).then((run) => [run.status, run.dialled]), [400, []]);
    // Reverse proof: without the one-of-each rule the first grant is read and the socket opens.
    assert.equal((await session(await byokWithout(' || params.getAll(k).length !== 1', ''), twice, [CREDENTIALS(), SC(), SS(1, IRIS)])).status, 101);
    // An own-key grant is no ticket: it opens no platform path.
    for (const path of [doubao(good), `/asr?ticket=${encodeURIComponent(good)}`]) {
        const run = await session(relay, path);
        assert.deepEqual([run.status, run.dialled], [403, []], path.slice(0, 6));
    }
    // Reverse proof: a relay that reads a grant that does not verify as no grant at all admits every one of them (the switch is unset).
    const lenient = await byokWithout('const refusal = presented !== null ?', 'const refusal = grant ?');
    for (const [what, grant] of bad) {
        const run = await session(lenient, ownKey(grant), [CREDENTIALS(), SC(), SS(1, IRIS)]);
        assert.deepEqual([run.status, run.forwarded], [101, ['StartConnection', 'StartSession#1']], `reverse proof: ${what}`);
    }
    // Reverse proofs in the verifier: without its signature check the forged grant opens the socket; without its expiry, the expired one.
    for (const [what, removed] of [['signed with another secret', ['if (!valid) return null;', 'void valid;']], ['expired', ['g.exp > now', 'true']]]) {
        const grant = bad.find(([name]) => name === what)[1];
        const run = await session(await mutant({ 'byok-voice-grant.ts': [removed] }), ownKey(grant), [CREDENTIALS(), SC(), SS(1, IRIS)]);
        assert.deepEqual([run.status, run.forwarded], [101, ['StartConnection', 'StartSession#1']], `reverse proof: ${what}`);
    }
});

test('own key without a grant when LIVE_VOICE_REQUIRE_PROMPT is "1": 403 at the upgrade, and the provider is never dialled', async () => {
    const required = { LIVE_VOICE_REQUIRE_PROMPT: '1' };
    const run = await session(relay, ownKey(), [CREDENTIALS(), SC(), SS(1, ANY_PROMPT)], required);
    assert.deepEqual([run.status, run.body, run.dialled], [403, refused('grant-required'), []]);
    // Reverse proof: a relay that does not read the switch for the own-key path admits it, unbound.
    const ignored = await mutant({ 'index.ts': [["requireGrant: env.LIVE_VOICE_REQUIRE_PROMPT === '1'", 'requireGrant: false']] });
    const admitted = await session(ignored, ownKey(), [CREDENTIALS(), SC(), SS(1, ANY_PROMPT)], required);
    assert.deepEqual([admitted.status, admitted.forwarded], [101, ['StartConnection', 'StartSession#1']]);
});

test('own key without a grant while LIVE_VOICE_REQUIRE_PROMPT is not "1": admitted as before (no ticket, the key only in-band, no prompt binding), with one "[P-07] own-key live voice without a grant" line per socket', async () => {
    for (const vars of [{}, { LIVE_VOICE_REQUIRE_PROMPT: '0' }]) {
        const run = await session(relay, ownKey(), [CREDENTIALS(), SC(), SS(1, ANY_PROMPT), FS(1), SS(2, XIAOMENG)], vars);
        assert.equal(run.status, 101);
        assert.deepEqual(run.forwarded, ['StartConnection', 'StartSession#1', 'FinishSession#1', 'StartSession#2']);
        assert.equal(run.close, null);
        assert.deepEqual(p07(run), [WITHOUT_GRANT]); // one for the socket, not one per StartSession
        assert.deepEqual(run.dialled.map((d) => [d.url, d.headers['X-Api-Access-Key']]), [[OWN_KEY_PROVIDER, ACCESS_KEY]]);
        nothingSecretLogged(run, [ACCESS_KEY, ANY_PROMPT.system_role, ...Object.values(XIAOMENG.dialog)]);
    }
    // Still no credential and no ticket in this path's URL: either one is refused (400) before anything is dialled.
    for (const extra of [`&accessKey=${ACCESS_KEY}`, `&ticket=${encodeURIComponent(await lv4(IRIS))}`]) {
        const run = await session(relay, ownKey() + extra, [CREDENTIALS(), SC()]);
        assert.deepEqual([run.status, run.dialled], [400, []], extra.split('=')[0]);
    }
    // Reverse proof (the line): without it, a socket opened without a grant leaves no trace.
    const silent = await byokWithout("if (!grant) console.warn('[P-07] own-key live voice without a grant');", 'void 0;');
    const quiet = await session(silent, ownKey(), [CREDENTIALS(), SC(), SS(1, ANY_PROMPT)]);
    assert.deepEqual([quiet.forwarded, p07(quiet)], [['StartConnection', 'StartSession#1'], []]);
    // Reverse proof (no binding): the same guard bound even without a grant refuses the same StartSession.
    const bound = await byokWithout(BINDING, '{ promptSha256: () => null, required: true }');
    const run = await session(bound, ownKey(), [CREDENTIALS(), SC(), SS(1, ANY_PROMPT)]);
    assert.deepEqual(run.forwarded, ['StartConnection']);
    assert.deepEqual(run.close, BINDING_REQUIRED);
});

test('own key: the log scan used above catches a relay that logs the grant (its reverse proof)', async () => {
    const forged = await ob1(IRIS, { signer: 'another-secret' });
    const clean = await session(relay, ownKey(forged));
    assert.equal(clean.status, 403);
    nothingSecretLogged(clean, grantParts(forged));
    const leaky = await byokWithout('rejected own-key request (${refusal})', 'rejected own-key request (${refusal}) ${presented}');
    const run = await session(leaky, ownKey(forged));
    assert.equal(run.status, 403);
    assert.throws(() => nothingSecretLogged(run, grantParts(forged)), /a log line carries/);
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
