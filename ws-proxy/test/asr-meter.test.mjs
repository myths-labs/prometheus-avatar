import assert from 'node:assert/strict';
import test from 'node:test';
import {createAsrFrameGuard, createAsrMeter, ASR_INPUT_BYTES_PER_SECOND, ASR_TICKET_PREFIX} from '../src/asr-meter.ts';

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

function harness(answers = {}) {
    const reports = [], timers = [], stops = [];
    let pendingStart = null;
    const meter = createAsrMeter({
        schedule: (fn, ms) => { const t = {fn, ms, live: true}; timers.push(t); return t; },
        cancel: (t) => { t.live = false; },
        report: async (r) => {
            reports.push(r);
            if (r.kind === 'start' && answers.holdStart) return new Promise((resolve) => { pendingStart = resolve; });
            if (r.kind === 'start' && answers.failStart) throw new Error('network');
            if (r.kind === 'start') return answers.start ?? {continue: true, reservation: 'res-1'};
            if (r.kind === 'tick') return answers.tick ?? {continue: true};
            return {continue: true};
        },
        stop: (reason) => stops.push(reason),
    });
    const fire = async () => { const t = timers.filter((x) => x.live).at(-1); t.live = false; await t.fn(); };
    const settle = () => new Promise((r) => setImmediate(r));
    return {meter, reports, timers, stops, fire, settle, releaseStart: (a) => pendingStart(a)};
}

test('no audio, no report; the first packet starts the meter once and the end carries the audio seconds', async () => {
    const h = harness();
    h.meter.onAudio(0);
    await h.settle();
    assert.deepEqual(h.reports, []);
    h.meter.onAudio(3200); h.meter.onAudio(3200); h.meter.onAudio(ASR_INPUT_BYTES_PER_SECOND * 3);
    await h.settle();
    assert.deepEqual(h.reports.map((r) => r.kind), ['start']);
    h.meter.close(); h.meter.close();
    await h.settle();
    assert.deepEqual(h.reports.at(-1), {kind: 'end', reservation: 'res-1', inputAudioSeconds: 3.2});
    assert.equal(h.reports.filter((r) => r.kind === 'end').length, 1, 'one end, however often the socket closes');
});

test('each minute is reported; a stop answer ends the session once with quota', async () => {
    const h = harness({tick: {continue: false}});
    h.meter.onAudio(3200);
    await h.settle();
    assert.equal(h.timers.at(-1).ms, 60_000);
    await h.fire();
    await h.settle();
    assert.deepEqual(h.reports.map((r) => r.kind), ['start', 'tick', 'end']);
    assert.deepEqual(h.stops, ['quota']);
    h.meter.onAudio(3200); h.meter.close();
    await h.settle();
    assert.equal(h.reports.length, 3, 'nothing after the end');
});

test('a refused start stops at once, without waiting on itself', async () => {
    const h = harness({start: {continue: false, reservation: null}});
    h.meter.onAudio(3200);
    await h.settle(); await h.settle();
    assert.deepEqual(h.reports.map((r) => r.kind), ['start', 'end']);
    assert.deepEqual(h.stops, ['quota']);
});

test('a close before the start answer still ends with that reservation', async () => {
    const h = harness({holdStart: true});
    h.meter.onAudio(ASR_INPUT_BYTES_PER_SECOND);
    h.meter.close();
    await h.settle();
    assert.deepEqual(h.reports.map((r) => r.kind), ['start'], 'the end waits for the start answer');
    h.releaseStart({continue: true, reservation: 'late-res'});
    await h.settle(); await h.settle();
    assert.deepEqual(h.reports.at(-1), {kind: 'end', reservation: 'late-res', inputAudioSeconds: 1});
    assert.equal(h.timers.filter((t) => t.live).length, 0, 'no tick is armed after the end');
});

test('a failed start report fails open and still ends', async () => {
    const h = harness({failStart: true});
    h.meter.onAudio(3200);
    await h.settle();
    assert.equal(h.stops.length, 0);
    h.meter.close();
    await h.settle();
    assert.deepEqual(h.reports.at(-1), {kind: 'end', reservation: null, inputAudioSeconds: 0.1});
});

test('the recognition ticket purpose is the asr: subject prefix', () => {
    assert.equal(ASR_TICKET_PREFIX, 'asr:');
});

import {ticketFitsPath, asrResource, ASR_RESOURCES} from '../src/asr-meter.ts';

test('a recognition ticket opens /asr only, and /asr takes no other v1 ticket', () => {
    assert.equal(ticketFitsPath('asr:0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', 'asr'), true);
    assert.equal(ticketFitsPath('asr:anon:' + 'a'.repeat(32), 'asr'), true);
    assert.equal(ticketFitsPath('0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', 'asr'), false, 'an unprefixed v1 ticket');
    for (const path of ['fish-rest', 'test', 'doubao', 'minimax', 'fish']) {
        assert.equal(ticketFitsPath('asr:0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', path), false, path);
        assert.equal(ticketFitsPath('0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c', path), true, path);
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
