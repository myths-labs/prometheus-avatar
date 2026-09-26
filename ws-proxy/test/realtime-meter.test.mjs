import assert from 'node:assert/strict';
import test from 'node:test';
import {frameEvent, createSessionMeter, signUsageReport, SERVER_EVENT} from '../src/realtime-meter.ts';

// Doubao frame: [0x11][type<<4 | flags=4][json<<4][0][event u32][session len u32][session][payload len u32][payload]
function frame(type, event, payloadBytes = 0) {
    const session = new TextEncoder().encode('sess-1');
    const buf = new ArrayBuffer(4 + 4 + 4 + session.length + 4 + payloadBytes);
    const v = new DataView(buf); let o = 0;
    v.setUint8(o++, 0x11); v.setUint8(o++, (type << 4) | 4); v.setUint8(o++, 0x10); v.setUint8(o++, 0);
    v.setUint32(o, event); o += 4;
    v.setUint32(o, session.length); o += 4; new Uint8Array(buf, o, session.length).set(session); o += session.length;
    v.setUint32(o, payloadBytes);
    return buf;
}

test('frame events are read from Doubao headers, with audio payload sizes', () => {
    assert.deepEqual(frameEvent(frame(0x9, SERVER_EVENT.SESSION_STARTED)), {event: 150, payloadBytes: 0});
    assert.deepEqual(frameEvent(frame(0xB, SERVER_EVENT.BOT_AUDIO, 48000)), {event: 202, payloadBytes: 48000});
    assert.equal(frameEvent(new ArrayBuffer(2)), null);
    assert.equal(frameEvent('text frame'), null);
});

function harness(replies = {}) {
    let now = 0; const timers = []; const reports = []; const stops = [];
    const meter = createSessionMeter({
        now: () => now,
        schedule: (fn, ms) => { const t = {fn, at: now + ms}; timers.push(t); return t; },
        cancel: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
        report: async (r) => { reports.push(r); return replies[r.kind]?.(r) ?? {continue: true, reservation: 'res-1'}; },
        stop: (reason) => stops.push(reason),
    });
    const advance = async (ms) => {
        now += ms;
        // Like real timers: one cancelled while an earlier one ran never fires.
        for (const t of timers.filter((t) => t.at <= now)) { if (!timers.includes(t)) continue; timers.splice(timers.indexOf(t), 1); await t.fn(); }
    };
    return {meter, reports, stops, advance};
}

test('a pre-connection that never starts a session reports nothing', async () => {
    const h = harness();
    h.meter.close();
    assert.deepEqual(h.reports, []);
});

test('a session reports start, a tick per minute, and an end with connected and output seconds', async () => {
    const h = harness();
    await h.meter.onServerFrame(frame(0x9, SERVER_EVENT.SESSION_STARTED));
    await h.meter.onServerFrame(frame(0xB, SERVER_EVENT.BOT_AUDIO, 96000)); // 2 s of 24 kHz s16 mono
    await h.advance(30_000);
    await h.meter.onServerFrame(frame(0x9, SERVER_EVENT.ASR_INFO)); // the user speaks: not idle
    await h.advance(30_000);
    await h.meter.onServerFrame(frame(0xB, SERVER_EVENT.BOT_AUDIO, 48000));
    await h.advance(35_000);
    await h.meter.onServerFrame(frame(0x9, SERVER_EVENT.SESSION_FINISHED));
    assert.deepEqual(h.reports, [
        {kind: 'start'},
        {kind: 'tick', reservation: 'res-1'},
        {kind: 'end', reservation: 'res-1', connectedSeconds: 95, outputAudioSeconds: 3},
    ]);
});

test('a stop answer ends the session with a quota reason', async () => {
    const h = harness({tick: () => ({continue: false, code: 'USAGE_POOL_EXHAUSTED'})});
    await h.meter.onServerFrame(frame(0x9, SERVER_EVENT.SESSION_STARTED));
    await h.advance(60_000);
    assert.deepEqual(h.stops, ['quota']);
    assert.equal(h.reports.at(-1).kind, 'end');
});

test('sixty seconds with neither side speaking hangs up', async () => {
    const h = harness();
    await h.meter.onServerFrame(frame(0x9, SERVER_EVENT.SESSION_STARTED));
    await h.advance(30_000);
    await h.meter.onServerFrame(frame(0x9, SERVER_EVENT.ASR_INFO));
    await h.advance(59_000);
    assert.deepEqual(h.stops, []);
    await h.advance(2_000);
    assert.deepEqual(h.stops, ['idle']);
});

test('report signatures match the marketplace verifier (fixed vector)', async () => {
    // Same vector as marketplace tests/usageClients.test.mjs.
    assert.equal(await signUsageReport('relay-usage-test-secret-0123456789abcdef', '{"event":"start"}', 1790000000000),
        '1790000000000.0b39113d173fa0dbd86709b4301e816a1e86ae169e4f9be31524d390d16706fc');
});
