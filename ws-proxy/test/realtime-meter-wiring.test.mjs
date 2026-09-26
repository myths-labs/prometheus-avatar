// The relay's Doubao loop feeds the session meter and ends it on every path.
// A source-level check: the Worker cannot run a real Doubao session here, and a
// meter that is created but never fed, or never closed, fails silently.
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

test('the meter is created only for platform live-voice grants with a configured report endpoint', () => {
    assert.match(src, /import \{ createSessionMeter, signUsageReport \} from '\.\/realtime-meter';/);
    assert.match(src, /MARKETPLACE_USAGE_URL\?: string;/);
    assert.match(src, /RELAY_USAGE_SECRET\?: string;/);
    assert.match(src, /const meter = meterGrant && usageUrl && usageSecret \? createSessionMeter/);
});

test('every upstream frame reaches the meter before it is forwarded', () => {
    const handler = between('upstreamWs.addEventListener("message"', 'upstreamWs.addEventListener("close"');
    const feed = handler.indexOf('meter?.onServerFrame(event.data)');
    assert.ok(feed > 0, 'upstream frames are not fed to the meter');
    assert.ok(feed < handler.indexOf('serverWs.send(event.data)'), 'the meter must see a frame before the client does');
});

test('every way the socket ends also ends the meter', () => {
    for (const [start, end] of [
        ['const rejectFrame = () => {', '};'],
        // The platform path's handler; the in-band BYOK path spends no platform key and has no meter.
        ['serverWs.addEventListener("close", (event) => {', '});'],
        ['upstreamWs.addEventListener("close"', '});'],
        ['upstreamWs.addEventListener("error"', '});'],
    ]) {
        assert.ok(between(start, end).includes('meter?.close()'), `${start} does not close the meter`);
    }
});

test('a quota stop closes the client with 4402 and the upstream normally', () => {
    const stop = between('stop: (reason) => {', '},');
    assert.match(stop, /reason === "quota" \? 4402 : 1000/);
    assert.match(stop, /upstreamWs\.close\(1000/);
});
