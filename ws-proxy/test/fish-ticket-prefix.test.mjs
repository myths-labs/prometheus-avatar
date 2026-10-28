// /fish and /fish-rest spend the platform Fish key. They open only for a v1 ticket whose subject starts with "fish:".
// Money-safety line (2026-10-28): a bare or other-purpose v1 ticket must not open them, so a new kind of ticket never
// opens the Fish key by accident. The Worker itself is loaded and called here, with every outbound fetch stubbed.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as nodeModule from 'node:module';

// index.ts imports its siblings without a file extension; teach node to find the .ts file. No package is needed.
const needsTs = (e, specifier) => e.code === 'ERR_MODULE_NOT_FOUND' && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier);
if (nodeModule.registerHooks) {
    nodeModule.registerHooks({
        resolve(specifier, context, nextResolve) {
            try { return nextResolve(specifier, context); }
            catch (e) { if (needsTs(e, specifier)) return nextResolve(`${specifier}.ts`, context); throw e; }
        },
    });
} else {
    nodeModule.register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
    try { return await nextResolve(specifier, context); }
    catch (e) {
        if (e.code === 'ERR_MODULE_NOT_FOUND' && /^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/.test(specifier)) return nextResolve(specifier + '.ts', context);
        throw e;
    }
}`), import.meta.url);
}

// Never reach the network. Any outbound call is recorded and answered locally; the real fetch is never called.
const outbound = [];
globalThis.fetch = async (input, init) => {
    outbound.push({url: String(input instanceof Request ? input.url : input), init});
    return new Response('fake-audio', {status: 200, headers: {'content-type': 'audio/mpeg'}});
};

const worker = (await import('../src/index.ts')).default;
import {ticketFitsPath} from '../src/asr-meter.ts';

const SECRET = 'test-ticket-secret-not-real';
const ENV = {
    WS_TICKET_SECRET: SECRET,
    FISH_AUDIO_API_KEY: 'test-platform-fish-key-not-real',
    VOLCENGINE_API_KEY: 'test-volc-key-not-real',
    VOLCENGINE_APP_ID: 'test-volc-app-not-real',
    ALLOWED_ORIGINS: 'https://prometheus.mythslabs.ai',
};

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
async function ticket(sub, expMs = Date.now() + 60_000) {
    const subB64 = b64url(new TextEncoder().encode(sub));
    const payload = `v1.${expMs}.${subB64}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return `${payload}.${b64url(new Uint8Array(sig))}`;
}

const UUID = '0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c';
const call = (path, query, method = 'GET') => worker.fetch(new Request(`https://relay.test${path}?${query}`, {method, body: method === 'POST' ? '{"text":"hi"}' : undefined}), ENV);

// --- the rule itself -------------------------------------------------------------------------------------------

test('ticketFitsPath: /fish and /fish-rest take only a "fish:" ticket', () => {
    for (const path of ['fish', 'fish-rest']) {
        assert.equal(ticketFitsPath(`fish:${UUID}`, path), true, `${path}: fish:`);
        assert.equal(ticketFitsPath(`fish:anon:${'a'.repeat(32)}`, path), true, `${path}: fish:anon:`);
        assert.equal(ticketFitsPath(UUID, path), false, `${path}: a bare v1 ticket`);
        assert.equal(ticketFitsPath(`asr:${UUID}`, path), false, `${path}: an asr: ticket`);
        for (const prefix of ['doubao:', 'test:', 'x:', 'Fish:', 'FISH:', ' fish:', 'fish', 'asr:fish:']) {
            assert.equal(ticketFitsPath(`${prefix}${UUID}`, path), false, `${path}: ${JSON.stringify(prefix)}`);
        }
    }
});

test('ticketFitsPath: /asr still takes only "asr:", and a "fish:" ticket never opens it', () => {
    assert.equal(ticketFitsPath(`asr:${UUID}`, 'asr'), true);
    assert.equal(ticketFitsPath(UUID, 'asr'), false);
    assert.equal(ticketFitsPath(`fish:${UUID}`, 'asr'), false);
});

test('ticketFitsPath: the other platform paths keep today\'s rule (anything that is not an asr: ticket)', () => {
    // Deliberately not asserted: whether a "fish:" ticket should open these. Today it does, as any non-asr ticket does;
    // the 2026-10-28 line covers /fish and /fish-rest only.
    for (const path of ['doubao', 'minimax', 'volcengine', 'test']) {
        assert.equal(ticketFitsPath(UUID, path), true, `${path}: bare`);
        assert.equal(ticketFitsPath(`doubao:${UUID}`, path), true, `${path}: doubao:`);
        assert.equal(ticketFitsPath(`asr:${UUID}`, path), false, `${path}: asr:`);
    }
});

// --- /fish (realtime). A plain GET stops at "Expected WebSocket upgrade" (426) once the ticket gate lets it through ----

test('/fish: a "fish:" ticket passes the gate; every other v1 ticket gets 403 wrong-purpose', async () => {
    const ok = await call('/fish', `ticket=${await ticket(`fish:${UUID}`)}`);
    assert.equal(ok.status, 426, 'gate passed, then the missing upgrade stops it');
    for (const sub of [UUID, `asr:${UUID}`, `doubao:${UUID}`, `test:${UUID}`, `x:${UUID}`, `Fish:${UUID}`]) {
        const res = await call('/fish', `ticket=${await ticket(sub)}`);
        assert.equal(res.status, 403, sub);
        assert.equal(res.headers.get('content-type'), 'application/json', sub);
        assert.deepEqual(await res.json(), {error: 'fish: platform relay access requires a valid ticket (wrong-purpose)'}, sub);
    }
});

test('/fish: no ticket, a forged ticket and an expired "fish:" ticket stay rejected', async () => {
    assert.equal((await call('/fish', '')).status, 403);
    const forged = (await ticket(`fish:${UUID}`)).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    const bad = await call('/fish', `ticket=${forged}`);
    assert.equal(bad.status, 403);
    assert.match((await bad.json()).error, /\(bad-signature\)/);
    const old = await call('/fish', `ticket=${await ticket(`fish:${UUID}`, Date.now() - 1000)}`);
    assert.equal(old.status, 403);
    assert.match((await old.json()).error, /\(expired\)/);
});

test('/fish: a caller\'s own key (?token=) needs no ticket; a blank token is not a key', async () => {
    assert.equal((await call('/fish', 'token=caller-own-key')).status, 426);
    assert.equal((await call('/fish', 'token=%20')).status, 403);
    assert.equal((await call('/fish', `token=%20&ticket=${await ticket(UUID)}`)).status, 403, 'a blank token plus a bare ticket');
});

// --- /fish-rest ------------------------------------------------------------------------------------------------

test('/fish-rest: a "fish:" ticket reaches Fish with the platform key; every other v1 ticket gets 403 and sends nothing', async () => {
    outbound.length = 0;
    const ok = await call('/fish-rest', `ticket=${await ticket(`fish:${UUID}`)}`, 'POST');
    assert.equal(ok.status, 200);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].url, 'https://api.fish.audio/v1/tts');
    assert.equal(outbound[0].init.headers.Authorization, `Bearer ${ENV.FISH_AUDIO_API_KEY}`);

    outbound.length = 0;
    for (const sub of [UUID, `asr:${UUID}`, `doubao:${UUID}`, `test:${UUID}`, `x:${UUID}`, `Fish:${UUID}`]) {
        const res = await call('/fish-rest', `ticket=${await ticket(sub)}`, 'POST');
        assert.equal(res.status, 403, sub);
        assert.equal(res.headers.get('content-type'), 'application/json', sub);
        assert.deepEqual(await res.json(), {error: 'fish-rest: platform relay access requires a valid ticket (wrong-purpose)'}, sub);
    }
    assert.equal((await call('/fish-rest', '', 'POST')).status, 403, 'no ticket');
    assert.equal(outbound.length, 0, 'a rejected call must never reach Fish');
});

test('/fish-rest: a caller\'s own key (?token=) needs no ticket and is the key sent; a blank token is not a key', async () => {
    outbound.length = 0;
    const own = await call('/fish-rest', 'token=caller-own-key', 'POST');
    assert.equal(own.status, 200);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].init.headers.Authorization, 'Bearer caller-own-key');
    outbound.length = 0;
    assert.equal((await call('/fish-rest', 'token=%20', 'POST')).status, 403);
    assert.equal(outbound.length, 0);
});

// --- everything else is unchanged -----------------------------------------------------------------------------

test('/asr is unchanged: only an "asr:" ticket opens it; a "fish:" or bare ticket gets 403', async () => {
    assert.equal((await call('/asr', `ticket=${await ticket(`asr:${UUID}`)}`)).status, 426);
    for (const sub of [UUID, `fish:${UUID}`, `doubao:${UUID}`]) {
        const res = await call('/asr', `ticket=${await ticket(sub)}`);
        assert.equal(res.status, 403, sub);
        assert.match((await res.json()).error, /\(wrong-purpose\)/, sub);
    }
});

test('/doubao is unchanged: a bare v1 ticket still passes its gate, an asr: ticket still does not', async () => {
    assert.equal((await call('/doubao', `ticket=${await ticket(UUID)}`)).status, 426);
    const res = await call('/doubao', `ticket=${await ticket(`asr:${UUID}`)}`);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /\(wrong-purpose\)/);
});
