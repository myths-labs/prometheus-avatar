// The relay's /asr path on platform credentials: the purpose check, the fixed resource, the frame guard and the meter.
// A source-level check like realtime-meter-wiring: the Worker cannot open a real recognition session here, and a guard
// or meter that is created but never reached fails silently.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const between = (start, end) => {
    const i = src.indexOf(start);
    assert.ok(i >= 0, `anchor missing: ${start}`);
    const j = src.indexOf(end, i + start.length);
    assert.ok(j > i, `anchor missing after ${start}: ${end}`);
    return src.slice(i, j);
};

test('every v1 ticket check applies the purpose rule', () => {
    const checks = src.match(/await verifyVoiceTicket\(env\.WS_TICKET_SECRET, [^)]*\)/g) ?? [];
    // test, the main gate, and the doubao frame guard's public-speaker re-check (which only ever sees doubao).
    // The Fish routes are retired (/fish and /fish-rest answer 404), so no check may admit them.
    assert.equal(checks.length, 3, `unexpected number of v1 checks: ${checks.length}`);
    assert.doesNotMatch(src, /ticketFitsPath\(checked\.sub, "fish-rest"\)/);
    assert.match(src, /ticketFitsPath\(checked\.sub, "test"\)/);
    assert.match(src, /ticketFitsPath\(checked\.sub, engineName\)/);
    // An lv2/lv3 grant is judged by its own rule, so closing v1 tickets on /doubao leaves live voice open.
    assert.match(src, /const fits = checked\.valid && \(liveGrant \? liveGrantFitsPath\(checked\.sub, engineName\) : ticketFitsPath\(checked\.sub, engineName\)\);/);
    assert.match(src, /checked\.valid && !fits \?/);
});

test('a platform /asr call cannot pick its endpoint or resource', () => {
    assert.match(src, /const platformParams = \(engineName === 'doubao' \|\| engineName === 'asr'\) && platformCredentials \? new URLSearchParams\(\) : url\.searchParams;/);
    assert.match(src, /engine\.upstreamUrl\(engineName === 'asr' \? platformParams : url\.searchParams, applicationEnv\)/);
    assert.match(src, /engine\.headers\(applicationEnv, platformParams\)/);
});

test('every client frame goes through handleAsrClientFrame; the recognition branch has no send of its own', () => {
    const handler = between('// Client → Upstream', 'if (frameGuard) {');
    assert.match(handler, /handleAsrClientFrame\(event\.data, \{ guard: asrGuard, meter: asrMeter, reject: /);
    assert.ok(handler.includes('return;'));
    assert.ok(!handler.includes('upstreamWs.send'), 'the recognition branch never sends upstream itself (the meter forwards)');
    // The meter's forward is the only road upstream, and it sends nothing once either side is closed.
    const forward = between('forward: (frame) => {', 'stop: (_reason, answer) => {');
    const guardAt = forward.indexOf('if (clientClosed || upstreamClosed) return false;'), sendAt = forward.indexOf('upstreamWs.send(frame); return true;');
    assert.ok(guardAt >= 0 && sendAt > guardAt);
    assert.match(src, /createAsrMeter<ArrayBuffer, ReturnType<typeof setTimeout>>\(\{\s*schedule: \(fn, ms\) => setTimeout\(fn, ms\),\s*cancel: \(t\) => clearTimeout\(t\),/,
        'the hold renewal runs on a real timer, cancelled on every end');
    assert.match(src, /const asrGuard = engineName === 'asr' && platformCredentials \? createAsrFrameGuard\(\) : null;/);
});

test('the meter reports the ticket subject without its prefix, as asr_seconds, and every end closes it', () => {
    assert.match(src, /ticketSubject\.slice\(ASR_TICKET_PREFIX\.length\)/);
    assert.match(src, /\{ event: "start", session: r\.session, subject: asrSubject, meter: "asr_seconds" \}/);
    assert.match(src, /\{ event: "end", reservation: r\.reservation, audio_seconds: r\.inputAudioSeconds, session: r\.session \}/);
    assert.match(src, /\{ event: "tick", reservation: r\.reservation, seconds: r\.seconds \}/, 'each ask names its seconds (B-167)');
    const asrReport = between('subject: asrSubject, meter: "asr_seconds"', 'stop: (_reason, answer) => {');
    assert.ok(asrReport.includes('signal: AbortSignal.timeout(5000)'), 'a stuck usage report must not hold the socket open');
    for (const [start, end] of [
        ['const rejectFrame = () => {', '};'],
        ['serverWs.addEventListener("close", (event) => {', '});'],
        ['upstreamWs.addEventListener("close"', '});'],
        ['upstreamWs.addEventListener("error"', '});'],
    ]) {
        assert.ok(between(start, end).includes('asrMeter?.close()'), `${start} does not close the recognition meter`);
    }
});

test('a ledger stop tells the client why, then closes 4402 with the code (B-167)', () => {
    const stop = between('subject: asrSubject, meter: "asr_seconds"', '}) : null;');
    const frame = stop.indexOf('serverWs.send(JSON.stringify({ type: "usage-stop", code, resets_at: text(answer.resets_at), tier: text(answer.tier), retry_after: code === "USAGE_UNAVAILABLE" ? ASR_RETRY_AFTER_SECONDS : null }))');
    const close = stop.indexOf('serverWs.close(4402, code)');
    assert.ok(frame > 0 && close > frame, 'the usage-stop frame goes out before the 4402 close');
    const flagAt = stop.indexOf('clientClosed = true; upstreamClosed = true;');
    assert.ok(flagAt >= 0 && flagAt < frame, 'no audio is forwarded once stopped');
    assert.match(stop, /upstreamWs\.close\(1000, "Voice session ended"\)/);
});
