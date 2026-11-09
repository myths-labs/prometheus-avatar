// How index.ts uses the Call recognition lease. A source-level check like asr-meter-wiring: the Worker cannot open a real
// recognition session here, and a lease that is built but never reached (or reached from the wrong path) fails silently.
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

test('an ac1 ticket is verified only on /asr; on any other platform path it is the wrong purpose', () => {
    const gate = between("const callAsrTicket = ticket.startsWith(CALL_ASR_TICKET_PREFIX + '.');", 'const verdict =');
    assert.match(gate, /if \(callAsrTicket && engineName === 'asr'\) callAsrGrant = await verifyCallAsrTicket\(env\.WS_TICKET_SECRET, ticket\);/);
    assert.match(gate, /reason: engineName === 'asr' \? 'bad-ticket' : 'wrong-purpose'/);
    // an ac1 ticket never falls through to the v1 verifier
    assert.match(gate, /: callAsrTicket \? \(/);
    const test = between('// /test dials upstream with PLATFORM credentials', 'const validationError = engineConfig.validate(env);');
    assert.match(test, /startsWith\(CALL_ASR_TICKET_PREFIX \+ "\."\)\s*\? \{ valid: false as const, reason: "wrong-purpose" \}/);
});

test('metering is unchanged: the ac1 subject becomes "asr:" + sub, the same subject the v1 ticket carried', () => {
    assert.match(src, /sub: ASR_TICKET_PREFIX \+ callAsrGrant\.sub/);
});

test('the lease exists only for an ac1 recognition socket, and its expiry closes client 4408, upstream 1000, meter', () => {
    assert.match(src, /if \(asrGuard && callAsrGrant\) asrLease = createCallAsrLease\(callAsrGrant, \(\) => \{/);
    assert.equal((src.match(/asrLease = createCallAsrLease/g) ?? []).length, 1);
    const expiry = between('asrLease = createCallAsrLease(callAsrGrant, () => {', 'sameCallAsr);');
    assert.match(expiry, /clientClosed = true; upstreamClosed = true;/);
    assert.match(expiry, /asrMeter\?\.close\(\);/);
    assert.match(expiry, /serverWs\.close\(4408, 'Call window ended'\)/);
    assert.match(expiry, /upstreamWs\.close\(1000, 'Call window ended'\)/);
});

test('a text frame is taken as a renewal only on a leased socket, and before the audio guard sees it', () => {
    const handler = between('// Client → Upstream', 'if (frameGuard) {');
    const lease = handler.indexOf("if (asrLease && typeof event.data === 'string') {");
    const guard = handler.indexOf('if (asrGuard) {');
    assert.ok(lease > 0 && guard > lease, 'the lease branch comes first');
    assert.ok(handler.slice(lease, guard).includes('void renewAsrLease(event.data)'));
    // without a lease the text frame reaches asrGuard, which refuses it (asr-meter.test.mjs pins that)
    assert.equal((src.match(/typeof event\.data === 'string'\) \{\n\s+if \(clientClosed \|\| upstreamClosed\) return;\n\s+void renewAsrLease/g) ?? []).length, 1);
});

test('the renewal frame is exactly {type:"asr-lease", ticket}; a good one is answered with the new deadline, anything else closes', () => {
    const renew = between('const renewAsrLease = async (data: string) => {', "if (liveGrant?.assetId && liveGrant.providerAppSha256) voiceProof");
    assert.match(renew, /Object\.keys\(message\)\.sort\(\)\.join\(','\) !== 'ticket,type' \|\| message\.type !== 'asr-lease'/);
    assert.match(renew, /typeof message\.ticket !== 'string'\) \{ rejectFrame\(\); return; \}/);
    assert.match(renew, /const expiresAt = await asrLease!\.renew\(message\.ticket\);/);
    assert.match(renew, /if \(expiresAt === null \|\| clientClosed \|\| upstreamClosed\) \{ rejectFrame\(\); return; \}/);
    assert.match(renew, /serverWs\.send\(JSON\.stringify\(\{ type: 'asr-lease', expiresAt \}\)\)/);
    assert.match(renew, /\} catch \{ rejectFrame\(\); \}/);
});

test('every way the socket ends also ends the lease timer', () => {
    assert.equal((src.match(/asrLease\?\.close\(\);/g) ?? []).length, 4, 'rejectFrame, client close, upstream close, upstream error');
    const reject = between('const rejectFrame = () => {', "try { serverWs.close(1008, 'Voice session authorization failed')");
    assert.ok(reject.includes('asrLease?.close();'));
});

// One connection per call (包 2b, 钱安全线 ⑨): the start names the call, a second connection is refused 4409 before the provider hears
// its audio, and a Call's start the marketplace cannot answer is refused rather than waved through.
test('an ac1 start names its call; a v1 start does not', () => {
    const report = between('subject: asrSubject, meter: "asr_seconds"', '// 4409: another connection of this call');
    assert.match(report, /\.\.\.\(callAsrGrant \? \{ call: callAsrGrant\.call \} : \{\}\)/);
    // tick and end carry the reservation only
    assert.match(report, /\{ event: "tick", reservation: r\.reservation \}/);
    assert.doesNotMatch(report.slice(report.indexOf('"tick"')), /call:/);
});

test('a Call start that gets no answer is refused; every other report still fails open', () => {
    const report = between('subject: asrSubject, meter: "asr_seconds"', '// 4409: another connection of this call');
    assert.match(report, /const unanswered = r\.kind === "start" && callAsrGrant\s*\? \{ continue: false, reservation: null, code: ASR_UNAVAILABLE_CODE \} : \{ continue: true, reservation: null \};/);
    assert.match(report, /: unanswered;/);
    assert.match(report, /catch \{ return unanswered; \}/);
    assert.doesNotMatch(report, /continue: true, reservation: null \}\s*;?\s*\}\s*catch/, 'no inline fail-open left in the catch');
});

test('the busy stop closes the client 4409, an unreachable marketplace 1013, the pool 4402, and the upstream 1000', () => {
    const stop = between('// 4409: another connection of this call', "// A Call's recognition socket (ac1 ticket) lives only");
    assert.match(stop, /reason === "busy" \? \[4409, "Call already connected"\]/);
    assert.match(stop, /reason === "unavailable" \? \[1013, "Usage unavailable, try again"\] : \[4402, "Voice is text-only for now"\]/);
    assert.match(stop, /upstreamWs\.close\(1000, "Voice session ended"\)/);
});

test('a leased socket sends no audio upstream until the start is answered, and keeps order', () => {
    const handler = between('// Client → Upstream', 'if (frameGuard) {');
    const gated = handler.indexOf('if (asrLease && (asrAudioSeen || verdict.audioBytes > 0)) {');
    const plain = handler.indexOf('try { upstreamWs.send(event.data); }');
    assert.ok(gated > 0 && plain > gated, 'the gated branch is taken before the plain send');
    const branch = handler.slice(gated, plain);
    // the clock starts, then the send waits for the answer, behind the packets before it
    assert.ok(branch.indexOf('asrMeter?.onAudio(verdict.audioBytes)') < branch.indexOf('await asrMeter!.ready()'));
    assert.match(branch, /asrSendQueue = asrSendQueue\.then\(/);
    assert.match(branch, /if \(!\(await asrMeter!\.ready\(\)\) \|\| clientClosed \|\| upstreamClosed\) return;/);
    // waiting audio is bounded
    assert.match(branch, /asrPendingBytes \+ frame\.byteLength > ASR_PENDING_MAX_BYTES\) \{ rejectFrame\(\); return; \}/);
    // after the first audio every frame (even an empty last packet) stays behind the queue
    assert.match(branch, /asrAudioSeen = true;/);
});

test('an ac1 socket is refused (503) when the relay cannot meter it', () => {
    const gate = between('A Call\'s recognition is metered per call', 'if (!verdict.valid) {');
    assert.match(gate, /if \(verdict\.valid && callAsrGrant && !\(env\.MARKETPLACE_USAGE_URL && env\.RELAY_USAGE_SECRET\)\) \{/);
    assert.match(gate, /status: 503/);
});
