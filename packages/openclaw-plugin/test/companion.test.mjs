import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../dist/index.js';
import { startFakeSellerServer } from './helpers/fakeSellerServer.mjs';
import { makeApi, sleep, until } from './helpers/fakeApi.mjs';

let server;
const opened = [];
beforeEach(async () => { server = await startFakeSellerServer({ intervalSec: 0.05 }); });
afterEach(async () => { await server.close(); delete process.env.PROMETHEUS_API_KEY; });

function boot(pluginConfig = {}) {
    const h = makeApi({ pluginConfig: { channelBaseUrl: server.url, apiKey: 'pak_test123', ...pluginConfig } });
    plugin.register(h.api);
    const fire = async (hook, event = {}) => { for (const [n, fn] of h.hooks) if (n === hook) await fn(event, {}); };
    return { ...h, fire };
}
const posted = () => server.state.avatarStates.map(({ at, ...b }) => b);

test('with an API key the hooks push thinking, then done with the emotion of the sent message (Bearer pak_ key, whitelisted values)', async () => {
    const h = boot();
    assert.deepEqual(h.hooks.map(([n]) => n).sort(), ['message_sent', 'model_call_ended', 'model_call_started']);
    await h.fire('model_call_started');
    await until(() => posted().length === 1);
    assert.deepEqual(posted(), [{ state: 'thinking' }]);
    await h.fire('message_sent', { to: 'x', content: 'Great, all tests passed! Awesome work', success: true });
    await until(() => posted().length === 2, 5000);
    assert.deepEqual(posted()[1], { state: 'done', emotion: 'happy' });
    const req = server.state.requests.filter((r) => r.path === '/api/agent/avatar/state').at(-1);
    assert.equal(req.headers.authorization, 'Bearer pak_test123');
});

test('only transitions are pushed: repeats are dropped, a failed send is not pushed, and a burst keeps only the newest', async () => {
    const h = boot();
    await h.fire('model_call_started');
    await until(() => posted().length === 1);
    await sleep(1700);                                            // past the minimum gap, so only the dedupe can hold it back
    await h.fire('model_call_started');                           // same state again: not a transition
    await h.fire('message_sent', { content: 'anything', success: false });
    await sleep(1700);
    assert.equal(posted().length, 1, 'one thinking push, nothing for the repeat or the failed send');
    // burst: thinking (already sent) -> error emotion -> done: the middle one is replaced by the newest
    await h.fire('model_call_ended', { outcome: 'error' });
    await h.fire('message_sent', { content: 'Sorry, that failed.', success: true });
    await until(() => posted().length >= 2, 5000);
    await sleep(2000);
    const rest = posted().slice(1);
    assert.ok(rest.length <= 2, JSON.stringify(rest));
    assert.equal(rest.at(-1).state, 'done');
});

test('pushes are spaced out (at least the minimum gap between two requests)', async () => {
    const h = boot();
    await h.fire('model_call_started');
    await until(() => posted().length === 1);
    await h.fire('message_sent', { content: 'ok', success: true });
    await until(() => posted().length === 2, 5000);
    const [a, b] = server.state.avatarStates;
    assert.ok(b.at - a.at >= 1400, `gap ${b.at - a.at} ms`);
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
    server = await startFakeSellerServer({ intervalSec: 0.05, stateRoute: 'missing' });
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
    server = await startFakeSellerServer({ intervalSec: 0.05, stateRoute: 'reject' });
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
