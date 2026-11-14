import assert from 'node:assert/strict';
import test from 'node:test';
import {createAsrFrameGuard, createAsrMeter, ASR_BACKLOG_SECONDS, ASR_INPUT_BYTES_PER_SECOND, ASR_KEEPALIVE_MS, ASR_LEAD_SECONDS,
    ASR_STEP_SECONDS, ASR_TICKET_PREFIX} from '../src/asr-meter.ts';

// SAUC v3 frame: [0x11][type<<4|flags][serialization<<4|compression][0][payload size u32][payload]
function frame(type, flags, serialization, compression, payload) {
    const body = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
    const buf = new ArrayBuffer(8 + body.length), bytes = new Uint8Array(buf);
    bytes.set([0x11, (type << 4) | flags, (serialization << 4) | compression, 0]);
    new DataView(buf).setUint32(4, body.length);
    bytes.set(body, 8);
    return buf;
}
const request = (audio = {format: 'pcm', rate: 16000, bits: 16, channel: 1}) =>
    frame(1, 0, 1, 0, JSON.stringify({user: {uid: 'u'}, audio, request: {model_name: 'bigmodel'}}));
const audio = (bytes, last = false) => frame(2, last ? 2 : 0, 0, 0, new Uint8Array(bytes));

test('the guard admits the marketplace client: one PCM request, then audio packets up to the last', () => {
    const g = createAsrFrameGuard();
    assert.deepEqual(g.inspect(request()), {ok: true, audioBytes: 0});
    assert.deepEqual(g.inspect(audio(3200)), {ok: true, audioBytes: 3200});
    assert.deepEqual(g.inspect(audio(640, true)), {ok: true, audioBytes: 640});
    assert.equal(g.inspect(audio(3200)).ok, false, 'nothing after the last packet');
});

test('the guard refuses anything that would make bytes stop meaning seconds', () => {
    const refusals = {
        'text frame': ['{"audio":{}}'],
        'audio before the request': [audio(3200)],
        'opus codec': [request({format: 'pcm', rate: 16000, bits: 16, channel: 1, codec: 'opus'})],
        'ogg container': [request({format: 'ogg', rate: 16000, bits: 16, channel: 1})],
        '8 kHz': [request({format: 'pcm', rate: 8000, bits: 16, channel: 1})],
        'stereo': [request({format: 'pcm', rate: 16000, bits: 16, channel: 2})],
        'gzip request': [frame(1, 0, 1, 1, '{}')],
        'gzip audio': [request(), frame(2, 0, 0, 1, new Uint8Array(100))],
        'request not JSON': [frame(1, 0, 1, 0, '{not json')],
        'wrong payload size': [(() => { const f = request(); new DataView(f).setUint32(4, 5); return f; })()],
        'sequence flag': [request(), frame(2, 1, 0, 0, new Uint8Array(100))],
        'a second request': [request(), request()],
        'oversized packet': [request(), audio(65 * 1024)],
    };
    for (const [name, frames] of Object.entries(refusals)) {
        const g = createAsrFrameGuard();
        const verdicts = frames.map((f) => g.inspect(f));
        assert.equal(verdicts.at(-1).ok, false, name);
        assert.equal(g.inspect(audio(10)).ok, false, `${name}: the socket stays refused`);
    }
});

// The meter, driven the way index.ts drives it: every frame that passed the guard is offered, in order, and the meter
// forwards it (forward()) once the ledger holds its seconds. Frames here are {bytes, n}; forwarded ones are recorded.
function harness(answers = {}) {
    const reports = [], stops = [], log = [], timers = [], forwarded = [];
    let pendingStart = null;
    const pendingTicks = [];
    const ticks = [...(answers.ticks ?? [])];
    const meter = createAsrMeter({
        schedule: (fn, ms) => { const t = {fn, ms, live: true}; timers.push(t); return t; },
        cancel: (t) => { t.live = false; },
        report: async (r) => {
            reports.push(r); log.push(r.kind === 'tick' && r.seconds === 0 ? 'renew' : r.kind);
            if (r.kind === 'start' && answers.holdStart) return new Promise((resolve) => { pendingStart = resolve; });
            if (r.kind === 'start' && answers.failStart) throw new Error('network');
            if (r.kind === 'start') return answers.start ?? {continue: true, reservation: 'res-1', seconds: 60};
            if (r.kind === 'tick' && r.seconds > 0 && answers.holdTicks) return new Promise((resolve) => { pendingTicks.push(resolve); });
            if (r.kind === 'tick') {
                const next = (r.seconds === 0 ? answers.renew : ticks.shift()) ?? {continue: true, seconds: r.seconds};
                if (next instanceof Error) throw next;
                return next;
            }
            return {continue: true};
        },
        forward: (frame) => { forwarded.push(frame); return true; },
        stop: (reason, answer) => { stops.push({reason, answer}); log.push('stop'); },
    });
    const settle = () => new Promise((r) => setImmediate(r));
    const offerSeconds = (seconds, n) => meter.offer({bytes: seconds * ASR_INPUT_BYTES_PER_SECOND, n}, seconds * ASR_INPUT_BYTES_PER_SECOND);
    /** Speaks `seconds` of audio, one second at a time and in real time (each answer is in before the next second). */
    const speak = async (seconds) => {
        for (let i = 0; i < seconds && stops.length === 0; i++) {
            assert.equal(offerSeconds(1), true, 'a real-time microphone is never refused');
            await settle(); await settle();
        }
    };
    /** ASR_KEEPALIVE_MS of silence: the armed renewal fires. */
    const fire = async () => {
        const t = timers.filter((x) => x.live).at(-1);
        assert.ok(t, 'a renewal is armed');
        t.live = false; t.fn();
        await settle(); await settle();
    };
    return {meter, reports, stops, log, forwarded, settle, speak, fire, offerSeconds,
        sent: () => forwarded.reduce((s, f) => s + f.bytes, 0) / ASR_INPUT_BYTES_PER_SECOND,
        armed: () => timers.filter((t) => t.live),
        releaseStart: (a) => pendingStart(a), releaseTick: (a) => pendingTicks.shift()(a),
        asks: () => reports.filter((r) => r.kind === 'tick' && r.seconds > 0),
        renewals: () => reports.filter((r) => r.kind === 'tick' && r.seconds === 0)};
}

test('no audio, no report; the first packet starts the meter once and the end carries the audio seconds', async () => {
    const h = harness();
    h.meter.offer({bytes: 0, n: 'request'}, 0);
    await h.settle();
    assert.deepEqual(h.reports, []);
    assert.deepEqual(h.forwarded, [{bytes: 0, n: 'request'}], 'the request frame carries no audio and goes at once');
    h.meter.offer({bytes: 3200}, 3200); h.meter.offer({bytes: 3200}, 3200); h.offerSeconds(3);
    await h.settle(); await h.settle();
    assert.deepEqual(h.reports.map((r) => r.kind), ['start']);
    assert.equal(h.sent(), 3.2);
    h.meter.close(); h.meter.close();
    await h.settle();
    assert.deepEqual(h.reports.at(-1), {kind: 'end', reservation: 'res-1', inputAudioSeconds: 3.2});
    assert.equal(h.reports.filter((r) => r.kind === 'end').length, 1, 'one end, however often the socket closes');
});

test('nothing is forwarded before the start is answered; then the waiting audio goes out, in order', async () => {
    const h = harness({holdStart: true});
    h.meter.offer({bytes: 0, n: 0}, 0);
    // The client's connect buffer arrives at once: 3 s in 100 ms packets.
    for (let n = 1; n <= 30; n++) assert.equal(h.meter.offer({bytes: 3200, n}, 3200), true);
    await h.settle();
    assert.equal(h.sent(), 0, 'no audio upstream before the ledger holds it');
    assert.equal(h.meter.waitingSeconds(), 3);
    h.releaseStart({continue: true, reservation: 'res-1', seconds: 60});
    await h.settle(); await h.settle();
    assert.equal(h.sent(), 3);
    assert.deepEqual(h.forwarded.map((f) => f.n), [...Array(31).keys()], 'in the order the client sent them');
    assert.equal(h.meter.waitingSeconds(), 0);
});

test('a refused start forwards no audio at all: an exhausted budget leaks nothing per connection', async () => {
    const refused = {continue: false, reservation: null, code: 'USAGE_BUDGET_EXCEEDED'};
    const h = harness({start: refused});
    // A scripted client pushes as fast as it can before the answer lands.
    let accepted = 0;
    while (accepted < 1000 && h.meter.offer({bytes: 3200}, 3200)) accepted++;
    assert.equal(accepted, ASR_BACKLOG_SECONDS * 10, 'at most ASR_BACKLOG_SECONDS wait; the next packet is refused (1008)');
    await h.settle(); await h.settle();
    assert.equal(h.sent(), 0);
    assert.deepEqual(h.stops, [{reason: 'quota', answer: refused}]);
    assert.deepEqual(h.reports.map((r) => r.kind), ['start', 'end']);
    assert.equal(h.reports.at(-1).inputAudioSeconds, 0, 'nothing was forwarded, nothing is billed');
});

test('the meter asks by audio seconds, not by the clock: 10 s before what is held runs out, for another 60 s', async () => {
    const h = harness();
    await h.speak(49);
    assert.equal(h.asks().length, 0, '49 of 60 held seconds sent: no ask yet');
    await h.speak(1);
    assert.deepEqual(h.asks(), [{kind: 'tick', reservation: 'res-1', seconds: ASR_STEP_SECONDS}]);
    assert.equal(h.meter.heldSeconds(), 120);
    await h.speak(59);
    assert.equal(h.asks().length, 1);
    await h.speak(1);
    assert.equal(h.asks().length, 2, 'at 110 of 120 held seconds');
    assert.equal(ASR_LEAD_SECONDS, 10);
});

test('the budget moment: a short grant is the last stretch, the next ask is refused, the session stops at once', async () => {
    const exhausted = {continue: false, code: 'USAGE_BUDGET_EXHAUSTED', resets_at: '2026-10-11T00:00:00+00:00', tier: 'free'};
    const h = harness({ticks: [{continue: true, seconds: 60}, {continue: true, seconds: 24}, exhausted]});
    await h.speak(200);
    assert.deepEqual(h.asks().map((r) => r.seconds), [60, 60, 60]);
    assert.equal(h.meter.heldSeconds(), 144, '60 + 60 + 24');
    assert.equal(h.sent(), 134, 'the third ask, at 144 - 10 s, is refused and nothing is sent after it');
    assert.deepEqual(h.stops, [{reason: 'quota', answer: exhausted}], 'the refusal reaches the relay, for the client');
    await h.settle();
    assert.deepEqual(h.log, ['start', 'tick', 'tick', 'tick', 'stop', 'end'], 'stopped before the end report goes out');
    assert.deepEqual(h.reports.at(-1), {kind: 'end', reservation: 'res-1', inputAudioSeconds: 134});
    assert.equal(h.meter.offer({bytes: 3200}, 3200), true);
    h.meter.close();
    await h.settle();
    assert.equal(h.sent(), 134, 'nothing more goes upstream');
    assert.equal(h.reports.length, 5, 'nothing after the end');
    assert.equal(h.armed().length, 0, 'no renewal is armed after the end');
});

test('a burst after a network stall waits for the answer instead of closing the session', async () => {
    const h = harness({holdTicks: true});
    await h.speak(45);
    // 20 s of buffered audio arrive at once, in 100 ms packets, while the next stretch is still being asked for.
    for (let i = 0; i < 200; i++) assert.equal(h.meter.offer({bytes: 3200}, 3200), true);
    await h.settle();
    assert.equal(h.asks().length, 1, 'asked as soon as the audio came within 10 s of what is held');
    assert.equal(h.sent(), 60, 'forwarded up to what is held, not past it');
    assert.equal(h.meter.waitingSeconds(), 5);
    assert.equal(h.stops.length, 0);
    h.releaseTick({continue: true, seconds: 60});
    await h.settle(); await h.settle();
    assert.equal(h.sent(), 65, 'the rest goes out once the ledger holds it');
    assert.equal(h.meter.waitingSeconds(), 0);
});

test('a client sending far faster than real time is held to what the ledger holds, then refused', async () => {
    const h = harness({holdTicks: true});
    await h.speak(1);
    let accepted = 0;
    while (accepted < 1000 && h.offerSeconds(1)) accepted++;
    assert.equal(accepted, 59 + ASR_BACKLOG_SECONDS, '59 s up to the 60 held, then ASR_BACKLOG_SECONDS waiting');
    assert.equal(h.sent(), 60);
    assert.equal(h.asks().length, 1, 'one ask in flight at a time');
});

test('a quiet hands-free client keeps its hold: 50 s after the last answer, an ask for 0 s renews it', async () => {
    // The route's TTL is 120 s: two renewals, each with the relay's 5 s to answer, fit before a hold could lapse.
    assert.equal(ASR_KEEPALIVE_MS, 50_000);
    assert.ok(2 * (ASR_KEEPALIVE_MS + 5_000) < 120_000);
    const h = harness();
    await h.speak(5);
    assert.deepEqual(h.armed().map((t) => t.ms), [ASR_KEEPALIVE_MS], 'armed once the start is answered');
    await h.fire();
    assert.deepEqual(h.renewals(), [{kind: 'tick', reservation: 'res-1', seconds: 0}]);
    assert.equal(h.meter.heldSeconds(), 60, 'a renewal holds no more audio');
    assert.equal(h.armed().length, 1, 'and is armed again');
    await h.fire(); await h.fire();
    assert.equal(h.renewals().length, 3, 'three quiet stretches, three renewals, nothing stopped');
    await h.speak(50);
    assert.equal(h.asks().length, 1, 'speaking again asks as before');
    assert.equal(h.stops.length, 0);
    assert.equal(h.armed().length, 1, 'one renewal armed at a time');

    // An older marketplace answers a renewal without seconds: it still holds nothing more.
    const old = harness({start: {continue: true, reservation: 'res-1'}, renew: {continue: true}});
    await old.speak(1); await old.fire();
    assert.equal(old.meter.heldSeconds(), 60);
});

test('a renewal the ledger refuses (pool used up) stops the session; with no reservation nothing is renewed', async () => {
    const pool = {continue: false, code: 'USAGE_POOL_EXHAUSTED', resets_at: null, tier: 'free'};
    const h = harness({renew: pool});
    await h.speak(5); await h.fire();
    assert.deepEqual(h.stops, [{reason: 'quota', answer: pool}]);
    const unmetered = harness({start: {continue: true, reservation: null, seconds: 60}});
    await unmetered.speak(5);
    assert.equal(unmetered.armed().length, 0, 'the ledger was unreachable at the start: there is no hold to renew');
});

test('an older marketplace (answers without seconds) and a failed ask both count as what was asked: fail open', async () => {
    const h = harness({start: {continue: true, reservation: 'res-1'}, ticks: [{continue: true}, new Error('network'), {continue: true, reservation: null}]});
    await h.speak(1);
    assert.equal(h.meter.heldSeconds(), 60);
    await h.speak(200);
    assert.equal(h.stops.length, 0);
    assert.equal(h.asks().length, 3, 'one ask per 60 s of audio (at 50, 110 and 170 s), answered or not');
    assert.equal(h.meter.heldSeconds(), 240);
});

test('one failed ask lets one step through unchecked; the next ask meets the ledger again', async () => {
    const exhausted = {continue: false, code: 'USAGE_BUDGET_EXHAUSTED'};
    const h = harness({ticks: [{continue: true, seconds: 60}, new Error('timeout'), exhausted]});
    await h.speak(300);
    assert.equal(h.meter.heldSeconds(), 180, '60 + 60 + 60 (the failed ask, failed open)');
    assert.equal(h.sent(), 170, 'stopped at the next ask, 10 s before the end of the unchecked step');
    assert.deepEqual(h.stops.map((s) => s.answer.code), ['USAGE_BUDGET_EXHAUSTED']);
});

test('a hands-free client that speaks a quarter of the time (REFUTE P3) is renewed between asks and never stopped', async () => {
    const h = harness();
    for (let turn = 0; turn < 12; turn++) {
        await h.speak(10);           // the user speaks
        await h.fire();              // then nothing is sent while the avatar answers, longer than the renewal wait
    }
    assert.equal(h.stops.length, 0);
    assert.equal(h.sent(), 120);
    assert.equal(h.renewals().length, 12, 'every quiet stretch renews the hold');
    assert.deepEqual(h.asks().map((r) => r.seconds), [60, 60], 'asks still follow the audio: at 50 and 110 s');
    assert.equal(h.meter.heldSeconds(), 180);
});

test('an answer that says continue but grants nothing for an ask ends the session instead of asking again at once', async () => {
    const h = harness({ticks: [{continue: true, seconds: 0}]});
    await h.speak(70);
    assert.equal(h.asks().length, 1, 'one ask, not a loop');
    assert.deepEqual(h.stops.map((s) => s.answer.code), ['USAGE_BUDGET_EXHAUSTED']);
    assert.equal(h.sent(), 50, 'stopped where the ask was made, inside the 60 s held');
});

test('a refused start stops at once, without waiting on itself', async () => {
    const refused = {continue: false, reservation: null, code: 'USAGE_BUDGET_EXCEEDED'};
    const h = harness({start: refused});
    h.meter.offer({bytes: 3200}, 3200);
    await h.settle(); await h.settle();
    assert.deepEqual(h.reports.map((r) => r.kind), ['start', 'end']);
    assert.deepEqual(h.stops, [{reason: 'quota', answer: refused}]);
});

test('a close before the start answer still ends with that reservation, and forwards none of the waiting audio', async () => {
    const h = harness({holdStart: true});
    h.offerSeconds(1);
    h.meter.close();
    await h.settle();
    assert.deepEqual(h.reports.map((r) => r.kind), ['start'], 'the end waits for the start answer');
    h.releaseStart({continue: true, reservation: 'late-res', seconds: 60});
    await h.settle(); await h.settle();
    assert.deepEqual(h.reports.at(-1), {kind: 'end', reservation: 'late-res', inputAudioSeconds: 0});
    assert.equal(h.sent(), 0);
    assert.equal(h.asks().length, 0, 'nothing is asked after the end');
    assert.equal(h.armed().length, 0, 'nor renewed');
});

test('a failed start report fails open and still ends', async () => {
    const h = harness({failStart: true});
    h.meter.offer({bytes: 3200}, 3200);
    await h.settle(); await h.settle();
    assert.equal(h.stops.length, 0);
    assert.equal(h.sent(), 0.1, 'forwarded: one step, failed open');
    assert.equal(h.armed().length, 0, 'no reservation, so no renewal');
    h.meter.close();
    await h.settle();
    assert.deepEqual(h.reports.at(-1), {kind: 'end', reservation: null, inputAudioSeconds: 0.1});
});

test('the recognition ticket purpose is the asr: subject prefix', () => {
    assert.equal(ASR_TICKET_PREFIX, 'asr:');
});

import {ticketFitsPath, liveGrantFitsPath, asrResource, ASR_RESOURCES} from '../src/asr-meter.ts';

test('a v1 ticket opens /asr only, and only a recognition ticket opens it', () => {
    assert.equal(ticketFitsPath('asr:0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', 'asr'), true);
    assert.equal(ticketFitsPath('asr:anon:' + 'a'.repeat(32), 'asr'), true);
    assert.equal(ticketFitsPath('0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', 'asr'), false, 'an unprefixed v1 ticket');
    // The old marketplace (08-15 to 09-25) minted unprefixed v1 tickets for realtime voice: none of them opens an
    // unmetered platform path any more, and neither does a recognition ticket.
    for (const path of ['doubao', 'volcengine', 'minimax', 'test', 'fish-rest', 'fish']) {
        assert.equal(ticketFitsPath('asr:0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', path), false, `asr: ticket on ${path}`);
        assert.equal(ticketFitsPath('0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', path), false, `unprefixed v1 ticket on ${path}`);
    }
});

test('a live-voice grant opens /doubao only, never with a recognition subject', () => {
    assert.equal(liveGrantFitsPath('0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', 'doubao'), true);
    assert.equal(liveGrantFitsPath('asr:0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', 'doubao'), false);
    for (const path of ['asr', 'volcengine', 'minimax', 'test']) {
        assert.equal(liveGrantFitsPath('0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', path), false, path);
    }
});

test('recognition resources: ASR 2.0 by default and for anything unknown, the legacy one only when named', () => {
    assert.equal(asrResource(), 'volc.seedasr.sauc.duration');
    assert.equal(asrResource(new URLSearchParams()), 'volc.seedasr.sauc.duration');
    assert.equal(asrResource(new URLSearchParams('resourceId=volc.bigasr.sauc.duration')), 'volc.bigasr.sauc.duration');
    for (const r of ['volc.bigasr.sauc.concurrent', 'volc.speech.dialog', 'toString', '__proto__']) {
        assert.equal(asrResource(new URLSearchParams(`resourceId=${r}`)), 'volc.seedasr.sauc.duration', r);
    }
    assert.equal(ASR_RESOURCES['volc.seedasr.sauc.duration'], 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async');
});
