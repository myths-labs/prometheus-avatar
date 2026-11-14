// ⑨'s money rule (11/14) for a usage report that cannot be answered: ONE unchecked step, then stop; the start is retried
// meanwhile with the SAME idempotency key; every unchecked step is logged with a hash of the subject, never the subject.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {ASR_FAIL_OPEN_STEPS, ASR_INPUT_BYTES_PER_SECOND, ASR_START_RETRY_MS, ASR_STEP_SECONDS, ASR_USAGE_UNAVAILABLE_CODE,
    UsageReportError, asrSubjectHash, createAsrMeter, formatFailOpenLog, usageDoorClosed} from '../src/asr-meter.ts';

const src = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const timeout = () => new UsageReportError('timeout');

function harness({starts = [], ticks = [], failOpenStart} = {}) {
    const reports = [], forwarded = [], stops = [], timers = [], failOpens = [];
    const meter = createAsrMeter({
        schedule: (fn, ms) => { const t = {fn, ms, live: true}; timers.push(t); return t; },
        cancel: (t) => { t.live = false; },
        sessionKey: () => 'session-key-1',
        failOpenStart,
        report: async (r) => {
            reports.push(r);
            const next = r.kind === 'start' ? starts.shift() : r.kind === 'tick' ? ticks.shift() : {continue: true};
            if (next instanceof Error) throw next;
            return next ?? (r.kind === 'start' ? {continue: true, reservation: 'res-1', seconds: ASR_STEP_SECONDS} : {continue: true, seconds: r.seconds});
        },
        forward: (f) => { forwarded.push(f); return true; },
        stop: (reason, answer) => stops.push({reason, answer}),
        onFailOpen: (i) => failOpens.push(i),
    });
    const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
    const second = async () => { assert.equal(meter.offer({bytes: ASR_INPUT_BYTES_PER_SECOND}, ASR_INPUT_BYTES_PER_SECOND), true); await settle(); };
    const speak = async (n) => { for (let i = 0; i < n && stops.length === 0; i++) await second(); };
    const retryNow = async () => { const t = timers.filter((x) => x.live && x.ms === ASR_START_RETRY_MS).at(-1); assert.ok(t, 'a start retry is armed'); t.live = false; t.fn(); await settle(); };
    return {meter, reports, forwarded, stops, timers, failOpens, settle, speak, retryNow,
        starts: () => reports.filter((r) => r.kind === 'start'), ticks: () => reports.filter((r) => r.kind === 'tick' && r.seconds > 0),
        sent: () => forwarded.reduce((s, f) => s + f.bytes, 0) / ASR_INPUT_BYTES_PER_SECOND};
}

test('the policy numbers: one unchecked step, unavailable code is the ledger one', () => {
    assert.equal(ASR_FAIL_OPEN_STEPS, 1);
    assert.equal(ASR_USAGE_UNAVAILABLE_CODE, 'USAGE_UNAVAILABLE');
});

test('every 4xx is a refusal (408 and 429 included); only a timeout, a network error or a 5xx is a failed report', () => {
    for (const status of [400, 401, 403, 404, 408, 409, 422, 429, 499]) assert.deepEqual(usageDoorClosed(status), {continue: false, code: ASR_USAGE_UNAVAILABLE_CODE}, String(status));
    for (const status of [200, 201, 500, 502, 503, 504]) assert.equal(usageDoorClosed(status), null, String(status));
});

test('a start that times out is retried with the same idempotency key, and the end carries that key too', async () => {
    const h = harness({starts: [timeout(), timeout(), {continue: true, reservation: 'res-1', seconds: 60}]});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(3);
    await h.retryNow(); // fails again: a free retry, nothing more goes through
    await h.retryNow(); // answers
    const keys = h.starts().map((r) => r.session);
    assert.equal(keys.length, 3, 'three start attempts');
    assert.ok(keys[0] && keys.every((k) => k === keys[0]), `same key on every attempt: ${keys}`);
    h.meter.close(); await h.settle();
    assert.equal(h.reports.find((r) => r.kind === 'end').session, keys[0], 'the end names the same reservation key');
});

test('a retry that answers before the 60th second puts the session on normal metering from then on', async () => {
    const h = harness({starts: [timeout()]});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(10);
    assert.equal(h.sent(), 10, 'the unchecked step lets audio through meanwhile');
    await h.retryNow();
    assert.equal(h.stops.length, 0);
    assert.equal(h.meter.heldSeconds(), 70, 'the ledger holds 60 s from now; the 10 unchecked seconds are not back-billed');
    await h.speak(55); // 65 s in: the lead point of the new hold
    assert.equal(h.ticks().length, 1, 'the next ask goes out as a tick');
    assert.equal(h.ticks()[0].reservation, 'res-1', 'with the reservation the retry obtained');
    await h.speak(60);
    assert.equal(h.stops.length, 0);
    assert.equal(h.sent(), 125);
    h.meter.close(); await h.settle();
    assert.deepEqual(h.reports.find((r) => r.kind === 'end').reservation, 'res-1');
});

test('the start still failing when the 60 s step is used up (the ask at the lead point) stops the session as unavailable', async () => {
    const h = harness({starts: [timeout(), timeout(), timeout()]});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(120);
    assert.equal(h.stops.length, 1);
    assert.equal(h.stops[0].answer.code, 'USAGE_UNAVAILABLE');
    assert.ok(h.sent() <= ASR_STEP_SECONDS, `unchecked audio ${h.sent()} s`);
    assert.equal(h.starts().length, 2, 'the start, then the counted retry at the lead point; no more once stopped');
});

test('each unchecked step is reported with the reason and the seconds that have no reservation behind them', async () => {
    for (const [error, reason] of [[new UsageReportError('timeout'), 'timeout'], [new UsageReportError('network'), 'network'], [new UsageReportError('5xx'), '5xx']]) {
        const h = harness({starts: [error]});
        h.meter.offer({bytes: 0}, 0);
        await h.speak(1);
        assert.deepEqual(h.failOpens, [{report: 'start', reason, unreservedSeconds: ASR_STEP_SECONDS}], reason);
    }
    const t = harness({ticks: [timeout()]});
    t.meter.offer({bytes: 0}, 0);
    await t.speak(55);
    assert.deepEqual(t.failOpens, [{report: 'tick', reason: 'timeout', unreservedSeconds: ASR_STEP_SECONDS}]);
    const plain = harness({starts: [new Error('boom')]});
    plain.meter.offer({bytes: 0}, 0); await plain.speak(1);
    assert.equal(plain.failOpens[0].reason, 'network', 'anything unclassified counts as a network error');
});

test('the log line carries the subject hash, the reason and the unreserved seconds, and never the subject itself', async () => {
    const sub = 'asr:3f2c9a1e-5b7d-4c88-9a41-0d6e7f1b2c33';
    const hash = await asrSubjectHash(sub);
    assert.match(hash, /^[0-9a-f]{12}$/);
    assert.equal(await asrSubjectHash(sub), hash, 'stable');
    assert.notEqual(await asrSubjectHash(sub + 'x'), hash);
    const line = formatFailOpenLog({subjectHash: hash, reason: 'timeout', unreservedSeconds: 60, report: 'start'});
    assert.match(line, /subject_hash=[0-9a-f]{12}/);
    assert.match(line, /reason=timeout/);
    assert.match(line, /unreserved_seconds=60/);
    assert.ok(!line.includes('3f2c9a1e') && !line.includes(sub) && !line.includes(sub.slice(4)), line);
});

test('wiring: the usage report classifies failures, alerts on 401/403, and no log line prints the subject', () => {
    const i = src.indexOf('report: async (r) => {'), j = src.indexOf('forward: (frame) => {', i);
    assert.ok(i > 0 && j > i);
    const report = src.slice(i, j);
    assert.match(report, /\(e as \{ name\?: string \}\)\?\.name === "TimeoutError" \? "timeout" : "network"/);
    assert.match(report, /throw new UsageReportError\("5xx"\)/);
    assert.match(report, /res\.status === 401 \|\| res\.status === 403\) console\.error\(`\[WS-Relay\] ALERT asr:/);
    assert.match(report, /session: r\.session, subject: asrSubject/);
    assert.match(report, /audio_seconds: r\.inputAudioSeconds, session: r\.session/);
    assert.match(src, /onFailOpen: \(info\) => \{ void asrSubjectHash\(asrSubject\)\.then\(\(h\) => console\.warn\(`\[WS-Relay\] \$\{formatFailOpenLog\(\{ subjectHash: h,/);
    const asrBlock = src.slice(src.indexOf('asrMeter = asrSubject'), j + 400);
    assert.doesNotMatch(asrBlock, /console\.[a-z]+\([^;]*\$\{asrSubject\}/, 'a log line must not print the raw subject');
    assert.doesNotMatch(asrBlock, /crypto\.randomUUID\(\)/, 'the idempotency key comes from the meter, one per socket');
});

// ⑨ 11/14 advice 1: the marketplace answers a start "continue" with NO reservation when its ledger cannot be reached.
const unreserved = {continue: true, reservation: null, seconds: ASR_STEP_SECONDS};

test('a start answered "continue" with no reservation is a failed start: one unchecked step, logged as unreserved, never a success', async () => {
    const h = harness({starts: [unreserved]});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(5);
    assert.deepEqual(h.failOpens, [{report: 'start', reason: 'unreserved', unreservedSeconds: ASR_STEP_SECONDS}]);
    assert.equal(h.sent(), 5, 'the unchecked step lets audio through');
    assert.equal(h.timers.filter((t) => t.live && t.ms === ASR_START_RETRY_MS).length, 1, 'and the start is retried, like any failed start');
});

test('a failed start followed by an unreserved answer is NOT 120 s with nobody counting: it stops at the 60 s mark', async () => {
    const h = harness({starts: [timeout(), unreserved, unreserved]});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(5);
    await h.retryNow(); // a free retry that answers "continue, no reservation": still failed, no more audio allowed
    assert.equal(h.meter.heldSeconds(), ASR_STEP_SECONDS, 'held is still the one unchecked step');
    await h.speak(120);
    assert.equal(h.stops.length, 1);
    assert.equal(h.stops[0].answer.code, 'USAGE_UNAVAILABLE');
    assert.ok(h.sent() <= ASR_STEP_SECONDS, `unchecked audio ${h.sent()} s`);
});

test('an unreserved start does not reset the failure count', async () => {
    const h = harness({starts: [unreserved, unreserved]});
    h.meter.offer({bytes: 0}, 0);
    await h.speak(120);
    assert.equal(h.stops.length, 1, 'the ask at the lead point is a start again and fails the second time');
    assert.ok(h.sent() <= ASR_STEP_SECONDS);
});

// ⑨ 11/14: no start is ever let through unchecked, account or visitor. failOpenStart is false everywhere in the relay.
test('a start that fails is closed at once with USAGE_UNAVAILABLE: no unchecked step, no retry, no audio (account and visitor alike)', async () => {
    for (const first of [timeout(), new UsageReportError('5xx'), unreserved]) {
        const h = harness({starts: [first], failOpenStart: false});
        h.meter.offer({bytes: 0}, 0);
        await h.speak(5);
        assert.equal(h.stops.length, 1);
        assert.equal(h.stops[0].answer.code, 'USAGE_UNAVAILABLE');
        assert.equal(h.sent(), 0, 'not one frame went upstream');
        assert.deepEqual(h.failOpens, [], 'nothing was let through, so nothing to log as let through');
        assert.equal(h.timers.filter((t) => t.live).length, 0, 'no retry, no renewal');
    }
});

test('a start that answers is metered as usual; once started, a failed mid-session renewal still gets its one step', async () => {
    const ok = harness({failOpenStart: false});
    ok.meter.offer({bytes: 0}, 0);
    await ok.speak(5);
    assert.equal(ok.stops.length, 0);
    assert.equal(ok.sent(), 5);
});

test('wiring: the relay never fails open on a start, and tells the client when to retry', () => {
    assert.match(src, /failOpenStart: false,/);
    assert.doesNotMatch(src, /failOpenStart: !asrSubject/);
    assert.match(src, /retry_after: code === "USAGE_UNAVAILABLE" \? ASR_RETRY_AFTER_SECONDS : null/);
    assert.match(src, /type: "usage-stop", code: "USAGE_UNAVAILABLE"[^\n]*retry_after: ASR_RETRY_AFTER_SECONDS/);
});
