// Fail closed on recognition usage metering (⑨ advice a and b).
//   a. /asr on platform credentials with no way to report usage (RELAY_USAGE_SECRET or MARKETPLACE_USAGE_URL missing) is
//      refused with close 1011 "usage metering unavailable" before any upstream connection exists.
//   b. a 401 or 403 from the usage endpoint on the start or a tick closes the door ({continue:false}, USAGE_UNAVAILABLE);
//      timeouts, network errors and 5xx still fail open.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as asr from '../src/asr-meter.ts';

const src = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const between = (start, end) => {
    const i = src.indexOf(start);
    assert.ok(i >= 0, `anchor missing: ${start}`);
    const j = src.indexOf(end, i + start.length);
    assert.ok(j > i, `anchor missing after ${start}: ${end}`);
    return src.slice(i, j);
};

test('a: metering is configured only when both the usage URL and the usage secret are set and non-empty', () => {
    const ok = asr.asrMeteringConfigured;
    assert.equal(typeof ok, 'function');
    assert.equal(ok('https://m.example/api/internal/realtime-usage', 'secret'), true);
    for (const [url, secret] of [[undefined, 'secret'], ['https://m.example/x', undefined], ['', 'secret'], ['https://m.example/x', ''], [undefined, undefined]]) {
        assert.equal(ok(url, secret), false, `${String(url)} / ${String(secret)}`);
    }
});

test('a: wiring: the refusal comes before the upstream connection, with close 1011 and the stated reason', () => {
    const gate = src.indexOf("engineName === 'asr' && platformCredentials && !asrMeteringConfigured(env.MARKETPLACE_USAGE_URL, env.RELAY_USAGE_SECRET)");
    assert.ok(gate > 0, 'the fail-closed condition is missing');
    const upstream = src.indexOf('await fetch(fetchUrl, fetchOptions)');
    assert.ok(upstream > gate, 'the refusal must come before the upstream fetch: no upstream socket, nothing forwarded');
    const block = src.slice(gate, src.indexOf('webSocket: refusedClient', gate));
    assert.match(block, /refusedServer\.close\(1011, 'usage metering unavailable'\)/);
    assert.ok(!block.includes('upstream'), 'the refusal never touches an upstream socket');
    // The BYOK path (own keys, never metered) is decided earlier and is not caught by this rule.
    assert.ok(src.indexOf('url.searchParams.get("byok") === "1"') < gate);
});

test('b: every 4xx closes the door; 2xx and 5xx are not refusals', () => {
    const door = asr.usageDoorClosed;
    assert.equal(typeof door, 'function');
    for (const status of [400, 401, 403, 404, 408, 410, 422, 429]) assert.deepEqual(door(status), { continue: false, code: asr.ASR_USAGE_UNAVAILABLE_CODE }, String(status));
    assert.equal(asr.ASR_USAGE_UNAVAILABLE_CODE, 'USAGE_UNAVAILABLE', 'the marketplace ledger already uses this code; the client reads it as try again');
    for (const status of [200, 204, 500, 502, 503, 504]) assert.equal(door(status), null, String(status));
});

function meterWith(startAnswer, tickAnswer) {
    const forwarded = [], stops = [], reports = [];
    const meter = asr.createAsrMeter({
        schedule: () => ({}), cancel: () => {},
        report: async (r) => { reports.push(r.kind); return r.kind === 'start' ? startAnswer : r.kind === 'tick' ? tickAnswer : { continue: true }; },
        forward: (f) => { forwarded.push(f); return true; },
        stop: (reason, answer) => stops.push({ reason, answer }),
    });
    return { meter, forwarded, stops, reports, settle: () => new Promise((r) => setImmediate(r)) };
}

test('b: a start answered with the closed door forwards not one frame and stops with USAGE_UNAVAILABLE', async () => {
    const h = meterWith(asr.usageDoorClosed?.(403), { continue: true });
    assert.ok(asr.usageDoorClosed, 'usageDoorClosed missing');
    h.meter.offer({ n: 'request' }, 0);
    h.meter.offer({ n: 1 }, 3200);
    await h.settle(); await h.settle();
    h.meter.offer({ n: 2 }, 3200);
    await h.settle();
    assert.deepEqual(h.forwarded.filter((f) => f.n !== 'request'), [], 'no audio frame reaches upstream');
    assert.equal(h.stops.length, 1);
    assert.equal(h.stops[0].answer.code, 'USAGE_UNAVAILABLE');
});

test('b: a tick answered with the closed door stops the session; audio held so far was already paid for, nothing more goes', async () => {
    const h = meterWith({ continue: true, reservation: 'r', seconds: 60 }, asr.usageDoorClosed?.(401));
    assert.ok(asr.usageDoorClosed, 'usageDoorClosed missing');
    h.meter.offer({ n: 'request' }, 0);
    for (let i = 0; i < 55; i++) { h.meter.offer({ n: i }, 32000); await h.settle(); await h.settle(); }
    assert.equal(h.stops.length, 1, 'the ask for the next stretch closed the door');
    assert.equal(h.stops[0].answer.code, 'USAGE_UNAVAILABLE');
    const sentSeconds = h.forwarded.filter((f) => f.n !== 'request').length;
    assert.ok(sentSeconds <= 60, `never past what was held (${sentSeconds} s)`);
    const before = h.forwarded.length;
    h.meter.offer({ n: 'late' }, 32000); await h.settle();
    assert.equal(h.forwarded.length, before, 'after the stop nothing is forwarded');
});

test('b: wiring: 4xx closes the door, 5xx and a thrown fetch propagate to the meter fail-open budget', () => {
    const report = between('subject: asrSubject, meter: "asr_seconds"', 'forward: (frame) => {');
    assert.match(report, /const door = usageDoorClosed\(res\.status\);\s*if \(door\) \{[\s\S]*?return door;/);
    assert.match(report, /if \(!res\.ok\) throw new UsageReportError\("5xx"\)/, 'a 5xx is a failed report: the meter counts it, it is not "continue"');
    assert.doesNotMatch(report, /continue: true, reservation: null/, 'no failure is turned into continue here any more');
    assert.doesNotMatch(report, /catch \{ return/, 'a timeout or network error propagates to the meter');
});
