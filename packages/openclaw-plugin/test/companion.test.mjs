import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../dist/index.js';
import { startFakeSellerServer } from './helpers/fakeSellerServer.mjs';
import { makeApi, sleep, until, cleanupDirs } from './helpers/fakeApi.mjs';

let server;
const opened = [];
beforeEach(async () => { server = await startFakeSellerServer({ intervalSec: 1 }); });
afterEach(async () => { await server.close(); delete process.env.PROMETHEUS_API_KEY; cleanupDirs(); });

function boot(pluginConfig = {}) {
    const h = makeApi({ pluginConfig: { channelBaseUrl: server.url, apiKey: 'pak_test123', ...pluginConfig } });
    plugin.register(h.api);
    const fire = async (hook, event = {}) => { for (const [n, fn] of h.hooks) if (n === hook) await fn(event, {}); };
    return { ...h, fire };
}
const posted = () => server.state.avatarStates.map(({ at, ...b }) => b);

test('with an API key the hooks push thinking, then the emotion of the sent message alone (the server replaces the whole state, and the avatar page reads state before emotion)', async () => {
    const h = boot();
    assert.deepEqual(h.hooks.map(([n]) => n).sort(), ['message_sent', 'model_call_ended', 'model_call_started']);
    await h.fire('model_call_started');
    await until(() => posted().length === 1);
    assert.deepEqual(posted(), [{ state: 'thinking' }]);
    await h.fire('message_sent', { to: 'x', content: 'Great, all tests passed! Awesome work', success: true });
    await until(() => posted().length === 2, 5000);
    assert.deepEqual(posted()[1], { emotion: 'happy' });
    const req = server.state.requests.filter((r) => r.path === '/api/agent/avatar/state').at(-1);
    assert.equal(req.headers.authorization, 'Bearer pak_test123');
});

test('only transitions are pushed: a repeat is dropped, a failed send is not pushed, and a burst keeps only the newest', async () => {
    const h = boot({ enableEmotion: false });                     // no analysis, so the hooks below push in the same tick
    await h.fire('model_call_started');
    await until(() => posted().length === 1);
    await sleep(1700);                                            // past the minimum gap, so only the dedupe can hold it back
    await h.fire('model_call_started');                           // same state again: not a transition
    await h.fire('message_sent', { content: 'anything', success: false });
    await sleep(1700);
    assert.equal(posted().length, 1, 'one thinking push, nothing for the repeat or the failed send');
    await h.fire('model_call_ended', { outcome: 'error' });       // burst: the error emotion is replaced by done before it goes out
    await h.fire('message_sent', { content: 'Sorry, that failed.', success: true });
    await until(() => posted().length >= 2, 5000);
    await sleep(2000);
    assert.deepEqual(posted().slice(1), [{ state: 'done' }]);
});

test('a newer state is not lost behind a request that is still out: the server ends on the newest one', async () => {
    const h = boot({ enableEmotion: false });
    await h.fire('model_call_started');
    await until(() => posted().length === 1);                     // thinking is on the server
    server.state.stateDelayMs = 700;                              // the next request is held by the server for a while
    await h.fire('message_sent', { content: 'ok', success: true });   // done goes out, and is still in flight below
    const requests = () => server.state.requests.filter((r) => r.path === '/api/agent/avatar/state').length;
    await until(() => requests() === 2, 6000);
    await h.fire('model_call_started');                           // thinking again: equal to what the server showed before 'done' landed
    await until(() => posted().length === 3, 10000);
    assert.deepEqual(posted().map((p) => p.state), ['thinking', 'done', 'thinking']);
});

test('an account without an avatar yet does not switch the pushes off: they wait and try again later', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, stateRoute: 'no_avatar' });
    const h = boot();
    await h.fire('model_call_started');
    await until(() => h.logs.some(([, m]) => /has no avatar yet/.test(m)));
    assert.ok(!h.logs.some(([, m]) => /Avatar state updates are off/.test(m)), 'a 404 that carries an error text is not "no such channel"');
    const requests = () => server.state.requests.filter((r) => r.path === '/api/agent/avatar/state').length;
    const before = requests();
    await h.fire('message_sent', { content: 'done', success: true });
    await sleep(1800);
    assert.equal(requests(), before, 'no request inside the wait');
});

test('a failed push is retried and the state still arrives', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, stateFail: 1 });
    const h = boot();
    await h.fire('model_call_started');
    await until(() => posted().length === 1, 10000);
    assert.deepEqual(posted(), [{ state: 'thinking' }]);
    assert.equal(server.state.requests.filter((r) => r.path === '/api/agent/avatar/state').length, 2, 'one failed try, one delivery');
});

test('pushes are spaced out (at least the minimum gap between two requests)', async () => {
    const h = boot();
    await h.fire('model_call_started');
    await until(() => posted().length === 1);
    await h.fire('message_sent', { content: 'ok', success: true });
    await until(() => posted().length === 2, 5000);
    const [a, b] = server.state.avatarStates;
    assert.ok(b.at - a.at >= 1200, `gap ${b.at - a.at} ms (the minimum is 1500; the margin absorbs a busy machine)`);
});

test('no key, or companionState:false, registers no hooks; enableEmotion:false sends the state only', async () => {
    const none = boot({ apiKey: undefined });
    assert.equal(none.hooks.length, 0);
    const off = boot({ companionState: false });
    assert.equal(off.hooks.length, 0);
    const noEmo = boot({ enableEmotion: false });
    await noEmo.fire('message_sent', { content: 'Great!!! Awesome', success: true });
    await until(() => posted().length === 1);
    assert.deepEqual(posted(), [{ state: 'done' }]);
});

test('a platform build without the state channel (404) turns pushes off for good with one log line', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, stateRoute: 'missing' });
    const h = boot();
    await h.fire('model_call_started');
    await until(() => h.logs.some(([, m]) => /no companion state channel/.test(m)));
    const before = server.state.requests.filter((r) => r.path === '/api/agent/avatar/state').length;
    await h.fire('message_sent', { content: 'done', success: true });
    await sleep(1800);
    assert.equal(server.state.requests.filter((r) => r.path === '/api/agent/avatar/state').length, before, 'no further pushes');
    assert.equal(h.logs.filter(([, m]) => /Avatar state updates are off/.test(m)).length, 1);
});

test('a rejected key turns pushes off with a warning that never contains the key', async () => {
    await server.close();
    server = await startFakeSellerServer({ intervalSec: 1, stateRoute: 'reject' });
    const h = boot({ apiKey: 'pak_secretvalue99' });
    await h.fire('model_call_started');
    await until(() => h.logs.some(([l, m]) => l === 'warn' && /rejected the agent API key/.test(m)));
    assert.ok(!JSON.stringify(h.logs).includes('pak_secretvalue99'));
});

test('the key is never sent over plain http to a non-local address, and the env key never goes to a non-default host', async () => {
    const h = boot({ channelBaseUrl: 'http://prometheus.example.com' });
    assert.equal(h.hooks.filter(([n]) => n === 'model_call_started').length, 0);
    assert.ok(h.logs.some(([l, m]) => l === 'warn' && /must be https/.test(m)));
    process.env.PROMETHEUS_API_KEY = 'pak_fromenv';
    const other = boot({ apiKey: undefined });                 // channelBaseUrl = the local double, not the production host
    assert.equal(other.hooks.length, 0, 'an environment key is not used for another host');
});

test('the counterpart: an environment key IS used when the plugin talks to the production address', () => {
    process.env.PROMETHEUS_API_KEY = 'pak_fromenv';
    const h = boot({ apiKey: undefined, channelBaseUrl: undefined });     // no address set: the production host (nothing is sent until a hook fires)
    assert.deepEqual(h.hooks.map(([n]) => n).sort(), ['message_sent', 'model_call_ended', 'model_call_started']);
});
