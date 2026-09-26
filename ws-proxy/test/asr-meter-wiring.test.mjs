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
    // fish-rest, test, the main gate, and the doubao frame guard's public-speaker re-check (which only ever sees doubao).
    assert.equal(checks.length, 4, `unexpected number of v1 checks: ${checks.length}`);
    assert.match(src, /ticketFitsPath\(checked\.sub, "fish-rest"\)/);
    assert.match(src, /ticketFitsPath\(checked\.sub, "test"\)/);
    assert.match(src, /ticketFitsPath\(checked\.sub, engineName\)/);
});

test('a platform /asr call cannot pick its endpoint or resource', () => {
    assert.match(src, /const platformParams = \(engineName === 'doubao' \|\| engineName === 'asr'\) && platformCredentials \? new URLSearchParams\(\) : url\.searchParams;/);
    assert.match(src, /engine\.upstreamUrl\(engineName === 'asr' \? platformParams : url\.searchParams, applicationEnv\)/);
    assert.match(src, /engine\.headers\(applicationEnv, platformParams\)/);
});

test('every client frame passes the guard before it is sent upstream, and the meter counts only what was sent', () => {
    const handler = between('// Client → Upstream', 'if (frameGuard) {');
    const inspect = handler.indexOf('asrGuard.inspect(event.data)');
    const send = handler.indexOf('upstreamWs.send(event.data)');
    const feed = handler.indexOf('asrMeter?.onAudio(verdict.audioBytes)');
    assert.ok(inspect > 0 && send > inspect && feed > send, 'guard, then send, then meter');
    assert.ok(handler.slice(inspect, send).includes('rejectFrame()'), 'a refused frame closes the socket');
    assert.match(src, /const asrGuard = engineName === 'asr' && platformCredentials \? createAsrFrameGuard\(\) : null;/);
});

test('the meter reports the ticket subject without its prefix, as asr_seconds, and every end closes it', () => {
    assert.match(src, /ticketSubject\.slice\(ASR_TICKET_PREFIX\.length\)/);
    assert.match(src, /\{ event: "start", session: crypto\.randomUUID\(\), subject: asrSubject, meter: "asr_seconds" \}/);
    assert.match(src, /\{ event: "end", reservation: r\.reservation, audio_seconds: r\.inputAudioSeconds \}/);
    for (const [start, end] of [
        ['const rejectFrame = () => {', '};'],
        ['serverWs.addEventListener("close", (event) => {', '});'],
        ['upstreamWs.addEventListener("close"', '});'],
        ['upstreamWs.addEventListener("error"', '});'],
    ]) {
        assert.ok(between(start, end).includes('asrMeter?.close()'), `${start} does not close the recognition meter`);
    }
});
