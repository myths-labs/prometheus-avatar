// Plain-node tests for the embed bridge (src/embed.ts): queue until ready, replay once,
// speak only after loaded, origin/source checks, and the timeout fallbacks.
// Run: node --test packages/sdk/tests-node/   (Node >= 22.18 or 23.6 strips TypeScript types natively;
// on Node 22.6–22.17 add --experimental-strip-types)
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EmbedBridge, connectEmbed, EMBED_READY_TIMEOUT_MS, EMBED_LOADED_TIMEOUT_MS } from '../src/embed.ts';

const ORIGIN = 'https://prometheus.mythslabs.ai';
const SRC = `${ORIGIN}/embed/abc123?speak=Hi`;

function setup(options = {}) {
    const posted = [];
    const contentWindow = { postMessage: (msg, target) => posted.push({ msg, target }) };
    const frame = { contentWindow, src: SRC };
    const listeners = new Set();
    const hostWindow = {
        addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
        removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
    };
    const deliver = (data, { origin = ORIGIN, source = contentWindow } = {}) => {
        for (const fn of [...listeners]) fn({ origin, source, data });
    };
    const bridge = connectEmbed(frame, { hostWindow, ...options });
    return { bridge, posted, deliver, listeners, frame, contentWindow, types: () => posted.map((p) => p.msg.type) };
}

test('emotion and state are queued before ready, then replayed once in order', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bridge, posted, deliver } = setup();
    assert.equal(bridge.setState('thinking'), 'queued');
    assert.equal(bridge.setEmotion('happy'), 'queued');
    assert.equal(posted.length, 0);
    deliver({ type: 'prometheus:ready', id: 'abc123' });
    assert.deepEqual(posted.map((p) => p.msg), [
        { type: 'prometheus:state', state: 'thinking' },
        { type: 'prometheus:emotion', emotion: 'happy' },
    ]);
    // a repeated ready does not replay again
    deliver({ type: 'prometheus:ready', id: 'abc123' });
    assert.equal(posted.length, 2);
    // after ready, sends go straight through
    assert.equal(bridge.setEmotion('sad'), 'sent');
    assert.equal(posted.length, 3);
    bridge.destroy();
});

test('every post targets the embed origin, never "*"', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bridge, posted, deliver } = setup();
    bridge.setEmotion('happy');
    deliver({ type: 'prometheus:ready' });
    deliver({ type: 'prometheus:loaded' });
    bridge.speak('hello');
    assert.ok(posted.length >= 2);
    for (const p of posted) assert.equal(p.target, ORIGIN);
    bridge.destroy();
});

test('speak is held until loaded, not released by ready', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bridge, deliver, types } = setup();
    assert.equal(bridge.speak('first line'), 'queued');
    deliver({ type: 'prometheus:ready', id: 'abc123' });
    assert.deepEqual(types(), []);
    assert.equal(bridge.speak('second line'), 'queued');
    assert.equal(bridge.loaded, false);
    deliver({ type: 'prometheus:loaded', id: 'abc123' });
    assert.deepEqual(types(), ['prometheus:speak', 'prometheus:speak']);
    assert.equal(bridge.speak('third line'), 'sent');
    assert.equal(bridge.pending.speak, 0);
    bridge.destroy();
});

test('loaded without an earlier ready releases both queues, control first', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bridge, posted, deliver } = setup();
    bridge.speak('hello');
    bridge.setState('acting');
    deliver({ type: 'prometheus:loaded', id: 'abc123' });
    assert.deepEqual(posted.map((p) => p.msg.type), ['prometheus:state', 'prometheus:speak']);
    assert.equal(bridge.ready, true);
    assert.equal(bridge.loaded, true);
    bridge.destroy();
});

test('messages from another origin or another window are ignored', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bridge, posted, deliver } = setup();
    bridge.setEmotion('happy');
    deliver({ type: 'prometheus:ready' }, { origin: 'https://evil.example' });
    deliver({ type: 'prometheus:ready' }, { source: { postMessage() {} } });
    deliver({ type: 'prometheus:ready' }, { source: null });
    assert.equal(bridge.ready, false);
    assert.equal(posted.length, 0);
    deliver({ type: 'prometheus:ready' });
    assert.equal(posted.length, 1);
    bridge.destroy();
});

test('avatarId filter ignores ready/loaded for another avatar', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bridge, posted, deliver } = setup({ avatarId: 'abc123' });
    bridge.setEmotion('happy');
    deliver({ type: 'prometheus:ready', id: 'someone-else' });
    assert.equal(posted.length, 0);
    deliver({ type: 'prometheus:ready', id: 'abc123' });
    assert.equal(posted.length, 1);
    bridge.destroy();
});

test('fallback: no ready within 8 s sends everything queued and later sends go through', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const reasons = [];
    const { bridge, deliver, types } = setup({ onFallback: (r) => reasons.push(r) });
    assert.equal(EMBED_READY_TIMEOUT_MS, 8000);
    bridge.setEmotion('happy');
    bridge.speak('hello');
    t.mock.timers.tick(EMBED_READY_TIMEOUT_MS - 1);
    assert.deepEqual(types(), []);
    t.mock.timers.tick(1);
    assert.deepEqual(types(), ['prometheus:emotion', 'prometheus:speak']);
    assert.deepEqual(reasons, ['ready-timeout']);
    assert.equal(bridge.setState('done'), 'sent');
    assert.equal(bridge.speak('again'), 'sent');
    // a late ready after the fallback does not replay anything
    deliver({ type: 'prometheus:ready' });
    assert.equal(types().length, 4);
    bridge.destroy();
});

test('fallback: ready but no loaded within 30 s releases held speak', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const reasons = [];
    const { bridge, deliver, types } = setup({ onFallback: (r) => reasons.push(r) });
    deliver({ type: 'prometheus:ready' });
    bridge.speak('hello');
    t.mock.timers.tick(EMBED_LOADED_TIMEOUT_MS - 1);
    assert.deepEqual(types(), []);
    t.mock.timers.tick(1);
    assert.deepEqual(types(), ['prometheus:speak']);
    assert.deepEqual(reasons, ['loaded-timeout']);
    bridge.destroy();
});

test('ready timer does not fire after a real ready', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const reasons = [];
    const { bridge, deliver } = setup({ onFallback: (r) => reasons.push(r) });
    deliver({ type: 'prometheus:ready' });
    deliver({ type: 'prometheus:loaded' });
    t.mock.timers.tick(EMBED_LOADED_TIMEOUT_MS + EMBED_READY_TIMEOUT_MS);
    assert.deepEqual(reasons, []);
    bridge.destroy();
});

test('an embed reload (second ready after loaded) holds speak until the next loaded', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bridge, deliver, types } = setup();
    deliver({ type: 'prometheus:ready' });
    deliver({ type: 'prometheus:loaded' });
    deliver({ type: 'prometheus:ready' });
    assert.equal(bridge.speak('after reload'), 'queued');
    deliver({ type: 'prometheus:loaded' });
    assert.deepEqual(types(), ['prometheus:speak']);
    bridge.destroy();
});

test('queues are capped and drop the oldest', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bridge, posted, deliver } = setup({ maxQueue: 2 });
    bridge.setEmotion('happy');
    bridge.setEmotion('sad');
    bridge.setEmotion('angry');
    assert.equal(bridge.pending.control, 2);
    deliver({ type: 'prometheus:ready' });
    assert.deepEqual(posted.map((p) => p.msg.emotion), ['sad', 'angry']);
    bridge.destroy();
});

test('malformed messages are dropped', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { bridge } = setup();
    assert.equal(bridge.send({ type: 'prometheus:emotion', emotion: 'furious' }), 'dropped');
    assert.equal(bridge.send({ type: 'prometheus:state', state: 'constructor' }), 'dropped');
    assert.equal(bridge.send({ type: 'prometheus:speak', text: '   ' }), 'dropped');
    assert.equal(bridge.send({ type: 'something-else' }), 'dropped');
    assert.equal(bridge.send(null), 'dropped');
    assert.deepEqual(bridge.pending, { control: 0, speak: 0 });
    bridge.destroy();
});

test('viewer messages reach onViewerMessage; destroy stops listening and clears queues', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen = [];
    const { bridge, deliver, listeners, posted } = setup({ onViewerMessage: (text) => seen.push(text) });
    deliver({ type: 'prometheus:message', text: 'hi avatar' });
    deliver({ type: 'prometheus:message', text: 42 });
    assert.deepEqual(seen, ['hi avatar']);
    bridge.setEmotion('happy');
    bridge.destroy();
    assert.equal(listeners.size, 0);
    assert.equal(bridge.setEmotion('sad'), 'dropped');
    t.mock.timers.tick(EMBED_READY_TIMEOUT_MS * 2);
    assert.equal(posted.length, 0);
});

test('the origin comes from options.origin or the iframe src; neither is an error', () => {
    const hostWindow = { addEventListener() {}, removeEventListener() {} };
    const frame = { contentWindow: { postMessage() {} }, src: '' };
    assert.throws(() => new EmbedBridge(frame, { hostWindow }), /origin/);
    assert.throws(() => new EmbedBridge({ ...frame, src: 'about:blank' }, { hostWindow }), /origin/);
    const b = new EmbedBridge(frame, { hostWindow, origin: `${ORIGIN}/embed/x`, readyTimeoutMs: 1 });
    b.destroy();
});

test('a message queued while the iframe has no window stays queued', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const posted = [];
    const win = { postMessage: (msg) => posted.push(msg) };
    const frame = { contentWindow: win, src: SRC };
    let listener = null;
    const hostWindow = { addEventListener: (_t, fn) => { listener = fn; }, removeEventListener() {} };
    const bridge = new EmbedBridge(frame, { hostWindow });
    bridge.setEmotion('happy');
    frame.contentWindow = null;
    t.mock.timers.tick(EMBED_READY_TIMEOUT_MS);
    assert.equal(bridge.pending.control, 1);
    frame.contentWindow = win;
    listener({ origin: ORIGIN, source: win, data: { type: 'prometheus:ready' } });
    assert.equal(posted.length, 1);
    bridge.destroy();
});
