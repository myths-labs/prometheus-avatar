// relay1129 / EVAL 1131-1136 items 2, 4, 5: renewals must not clear the failure count; a start retry in flight at disconnect
// must not orphan its reservation; a 2xx body that is not an answer must not hang end(). These tests fire timers for real.
import assert from 'node:assert/strict';
import test from 'node:test';
import {ASR_INPUT_BYTES_PER_SECOND, ASR_KEEPALIVE_MS, ASR_START_RETRY_MS, ASR_STEP_SECONDS, UsageReportError, createAsrMeter} from '../src/asr-meter.ts';

function harness({start, tick} = {}) {
    const reports = [], forwarded = [], stops = [], timers = [];
    const meter = createAsrMeter({
        schedule: (fn, ms) => { const t = {fn, ms, live: true}; timers.push(t); return t; },
        cancel: (t) => { t.live = false; },
        sessionKey: () => 'session-key-1',
        report: async (r) => {
            reports.push(r);
            if (r.kind === 'start') { const v = start ? start(r) : {continue: true, reservation: 'res-1', seconds: ASR_STEP_SECONDS}; if (v instanceof Error) throw v; return v; }
            if (r.kind === 'tick') { const v = tick ? tick(r) : {continue: true, seconds: r.seconds}; if (v instanceof Error) throw v; return v; }
            return {continue: true};
        },
        forward: (f) => { forwarded.push(f); return true; },
        stop: (reason, answer) => stops.push({reason, answer}),
    });
    const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
    const speak = async (n) => { for (let i = 0; i < n && stops.length === 0; i++) { meter.offer({bytes: ASR_INPUT_BYTES_PER_SECOND}, ASR_INPUT_BYTES_PER_SECOND); await settle(); } };
    const fire = async (ms) => { const t = timers.filter((x) => x.live && x.ms === ms).at(-1); assert.ok(t, `a ${ms} ms timer is armed`); t.live = false; t.fn(); await settle(); };
    return {meter, reports, forwarded, stops, timers, settle, speak, fire,
        sent: () => forwarded.reduce((s, f) => s + f.bytes, 0) / ASR_INPUT_BYTES_PER_SECOND};
}

// item 2
test('continuous 0-second renewals that succeed do not reset the failure count: the second failing ask still stops the session', async () => {
    const h = harness({tick: (r) => (r.seconds > 0 ? new UsageReportError('timeout') : {continue: true, seconds: 0})});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(55);           // lead point of the first 60 s hold: the ask times out, one unchecked step goes through
    assert.equal(h.stops.length, 0);
    await h.fire(ASR_KEEPALIVE_MS); // a renewal that SUCCEEDS
    assert.ok(h.reports.some((r) => r.kind === 'tick' && r.seconds === 0), 'the renewal went out');
    await h.speak(70);           // the next ask (at the lead point of the unchecked step) fails again
    assert.equal(h.stops.length, 1, 'stopped at the second failing ask');
    assert.equal(h.stops[0].answer.code, 'USAGE_UNAVAILABLE');
    assert.ok(h.sent() <= 2 * ASR_STEP_SECONDS, `at most two steps went through: ${h.sent()}`);
});

// item 4
test('a start retry still in flight at disconnect: the end report waits for it and carries its reservation and key', async () => {
    let release;
    const late = new Promise((res) => { release = res; });
    let n = 0;
    const h = harness({start: () => (++n === 1 ? new UsageReportError('timeout') : late)});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(3);
    await h.fire(ASR_START_RETRY_MS);          // the retry is now pending on `late`
    assert.equal(h.reports.filter((r) => r.kind === 'start').length, 2);
    h.meter.close();
    await h.settle();
    assert.equal(h.reports.filter((r) => r.kind === 'end').length, 0, 'the end must not go out before the pending start answers');
    release({continue: true, reservation: 'res-late', seconds: 60});
    await h.settle();
    const end = h.reports.find((r) => r.kind === 'end');
    assert.ok(end, 'the end report goes out after the start answered');
    assert.equal(end.reservation, 'res-late');
    assert.equal(end.session, 'session-key-1');
});

// item 5
test('a 2xx body that is not an answer (null) on the start is a failed start; close() still sends the end', async () => {
    const h = harness({start: () => null});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(2);
    h.meter.close();
    await h.settle();
    assert.ok(h.reports.some((r) => r.kind === 'end'), 'end() did not hang');
});

test('a 2xx null body on a tick is a failed report, not an answer: it counts and end() still goes out', async () => {
    const h = harness({tick: (r) => (r.seconds > 0 ? null : {continue: true, seconds: 0})});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(55);
    assert.equal(h.stops.length, 0, 'the first failure is the one unchecked step');
    await h.speak(70);
    assert.equal(h.stops.length, 1, 'the second null body stops the session');
    h.meter.close(); await h.settle();
    assert.ok(h.reports.some((r) => r.kind === 'end'));
});
