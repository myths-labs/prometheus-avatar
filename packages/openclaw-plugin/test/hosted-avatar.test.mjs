// With a Prometheus agent key ("apiKey") and the id of a hosted avatar ("avatarId") and no "modelUrl", register(api) frames the
// hosted avatar page in the page element (containerSelector) and drives its expression through core's connectEmbed. Run
// against the built plugin (dist/index.js) and a stand-in for @prometheusavatar/core that records every connectEmbed call and
// every message sent to the frame.
// Rules pinned here: the page address is exactly https://prometheus.mythslabs.ai/embed/<id> (no query string, so no
// `?speak=`); the key never reaches the page address, the frame or a message; the plugin never makes the hosted avatar speak;
// a `modelUrl` always wins; every case without both settings keeps the 0.10.3 behaviour (a logged error, nothing shown).
// OpenClaw's hooks stand in for the old agent events: model_call_started = thinking, model_call_ended with an error =
// surprised, message_sent = the sentiment of the message.
// companionState is off in these runs: it would push the same events to the production state route with the test key, and
// it is pinned on its own in test/companion.test.mjs.
// Runs after `npm run build` (see the test script), so dist/ exists.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeApi, sleep, until, cleanupDirs } from './helpers/fakeApi.mjs';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const AVATAR_ID = '3f2a9c1e-7b64-4d0a-9e51-2c8d5b6a7f10';
const KEY = 'pak_test_marker_not_a_real_key';
const MODEL_URL = 'https://models.example.test/mao/mao.model3.json';
const EMBED_URL = `https://prometheus.mythslabs.ai/embed/${AVATAR_ID}`;
const TOOLS = ['prometheus_connect_seller', 'prometheus_connection_status', 'prometheus_deploy_asset', 'prometheus_disconnect_seller',
    'prometheus_generate_image_pro', 'prometheus_generate_thumbnail', 'prometheus_publish_listing'];

const FAKE_CORE = [
    'export const calls = [];',
    'export const embeds = [];',
    'export async function createAvatar(options) {',
    '    calls.push(options);',
    '    return { processText() {}, async speak() {}, setEmotion() {}, destroy() {} };',
    '}',
    'export class PrometheusAvatar {}',
    'export class AssetCreator { constructor(host, apiKey) { this.apiKey = apiKey; } }',
    'export class SellerChannelApi {}',
    'export class EmotionAnalyzer {',
    '    analyze(text) {',
    "        const emotion = /sorry|sad/i.test(text) ? 'sad' : /great|happy/i.test(text) ? 'happy' : 'neutral';",
    '        return { emotion, confidence: 1, triggers: [] };',
    '    }',
    '}',
    'export function connectEmbed(frame, options) {',
    '    const record = { srcAtConnect: frame.src, frame, options, sent: [], destroyed: false };',
    '    embeds.push(record);',
    "    const push = (message) => { record.sent.push(message); return 'queued'; };",
    '    return {',
    "        setEmotion: (emotion) => push({ type: 'prometheus:emotion', emotion }),",
    "        setState: (state) => push({ type: 'prometheus:state', state }),",
    "        speak: (text) => push({ type: 'prometheus:speak', text }),",
    '        send: (message) => push(message),',
    '        destroy: () => { record.destroyed = true; },',
    '    };',
    '}',
    '',
].join('\n');

// The plugin loads core lazily, after register() has returned, so the folders stay until the test is over.
const folders = [];
afterEach(() => {
    for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
    cleanupDirs();
    delete globalThis.document;
});

async function loadPlugin() {
    const dir = mkdtempSync(join(tmpdir(), 'openclaw-plugin-hosted-'));
    folders.push(dir);
    const coreDir = join(dir, 'node_modules', '@prometheusavatar', 'core');
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(coreDir, 'package.json'), JSON.stringify({ name: '@prometheusavatar/core', version: '0.0.0', type: 'module', main: 'index.js' }));
    writeFileSync(join(coreDir, 'index.js'), FAKE_CORE);
    copyFileSync(join(PACKAGE, 'dist', 'index.js'), join(dir, 'index.js'));
    const plugin = (await import(pathToFileURL(join(dir, 'index.js')).href)).default;
    const core = await import(pathToFileURL(join(coreDir, 'index.js')).href);
    return { plugin, core };
}

// A page element that can hold a frame: it has an owner document that makes elements, and a window the bridge listens on.
function fakeContainer() {
    const hostWindow = { marker: 'host-window' };
    const container = {
        children: [],
        removed: [],
        hostWindow,
        ownerDocument: {
            defaultView: hostWindow,
            createElement(tag) {
                const element = { tag, style: {}, attributes: {}, contentWindow: {}, setAttribute(name, value) { this.attributes[name] = value; }, remove() { container.removed.push(element); } };
                return element;
            },
        },
        appendChild(element) { container.children.push(element); return element; },
    };
    return container;
}

/** register(api) with a page element (unless `container` is null) and the given plugin config; waits for `ready` when asked. */
async function run(config, { container = fakeContainer(), env, ready } = {}) {
    const { plugin, core } = await loadPlugin();
    const savedKey = process.env.PROMETHEUS_API_KEY;
    if (env === undefined) delete process.env.PROMETHEUS_API_KEY; else process.env.PROMETHEUS_API_KEY = env;
    if (container) globalThis.document = { querySelector: (selector) => (selector === '#avatar' ? container : null) };
    const h = makeApi({ pluginConfig: { containerSelector: '#avatar', companionState: false, ...config } });
    try {
        plugin.register(h.api);
        if (ready) await until(() => ready(core));
        else await sleep(30);                                        // long enough for a lazy core load that should not happen
    } finally {
        if (savedKey === undefined) delete process.env.PROMETHEUS_API_KEY; else process.env.PROMETHEUS_API_KEY = savedKey;
    }
    const fire = async (hook, event = {}) => { for (const [name, fn] of h.hooks) if (name === hook) await fn(event, {}); };
    const at = (level) => h.logs.filter(([l]) => l === level).map(([, m]) => m);
    return { ...h, fire, at, container, core, createAvatarCalls: [...core.calls], embeds: [...core.embeds] };
}

const framed = (core) => core.embeds.length > 0;
const everythingSent = (result) => result.core.embeds.flatMap((record) => record.sent);

test('control: a stand-in bridge that is asked to speak records it (so "never speaks" below is not vacuous)', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID }, { ready: framed });
    assert.ok(result.core.embeds[0], 'a bridge must have been created for this control to mean anything');
    const probe = result.core.connectEmbed({ src: EMBED_URL }, {});
    probe.speak('hello');
    assert.deepEqual(result.core.embeds.at(-1).sent, [{ type: 'prometheus:speak', text: 'hello' }]);
});

test('apiKey and avatarId without modelUrl frame the hosted avatar page, exactly and only that address, and connect core\'s bridge to it', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID }, { ready: framed });
    assert.deepEqual(result.core.calls, [], 'the local 2D renderer must not run');
    assert.deepEqual(result.at('error'), []);
    assert.equal(result.container.children.length, 1);
    const frame = result.container.children[0];
    assert.equal(frame.tag, 'iframe');
    assert.equal(frame.src, EMBED_URL, 'no query string: nothing is asked of the page at load, `?speak=` included');
    assert.equal(result.core.embeds.length, 1);
    assert.equal(result.core.embeds[0].frame, frame);
    assert.equal(result.core.embeds[0].srcAtConnect, EMBED_URL, 'the address is set before the bridge is created');
    assert.equal(result.core.embeds[0].options.avatarId, AVATAR_ID);
    assert.equal(result.core.embeds[0].options.origin, 'https://prometheus.mythslabs.ai');
    assert.equal(result.core.embeds[0].options.hostWindow, result.container.hostWindow, 'the bridge listens on the window that owns the container');
});

test('the page stays on the production address when channelBaseUrl points the seller channel elsewhere', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID, channelBaseUrl: 'http://127.0.0.1:9' }, { ready: framed });
    assert.equal(result.container.children[0].src, EMBED_URL);
    assert.equal(result.core.embeds[0].options.origin, 'https://prometheus.mythslabs.ai');
});

test('the key reaches neither the page address, nor the frame, nor the bridge options, nor any message, nor the log', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID }, { ready: framed });
    const frame = result.container.children[0];
    await result.fire('model_call_started', {});
    await result.fire('model_call_ended', { outcome: 'error' });
    await result.fire('message_sent', { content: 'This is great news', success: true });
    result.core.embeds[0].options.onLoaded(AVATAR_ID);
    result.core.embeds[0].options.onFallback('loaded-timeout');
    result.core.embeds[0].options.onFallback('ready-timeout');
    const visible = JSON.stringify({ src: frame.src, attributes: frame.attributes, style: frame.style, options: Object.keys(result.core.embeds[0].options), sent: everythingSent(result), logs: result.logs });
    assert.ok(!visible.includes(KEY), visible);
    assert.ok(!visible.includes('pak_'), visible);
});

test('agent events drive the expression: thinking, error and the sentiment of a message; nothing else is sent', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID }, { ready: framed });
    await result.fire('model_call_started', {});
    await result.fire('model_call_ended', { outcome: 'error' });
    await result.fire('model_call_ended', { outcome: 'ok' });
    await result.fire('message_sent', { content: 'This is great news', success: true });
    await result.fire('message_sent', { content: 'Sorry, I could not do that', success: true });
    await result.fire('message_sent', {});
    await result.fire('message_sent', { content: 'This is great news', success: false });
    assert.deepEqual(everythingSent(result), [
        { type: 'prometheus:emotion', emotion: 'thinking' },
        { type: 'prometheus:emotion', emotion: 'surprised' },
        { type: 'prometheus:emotion', emotion: 'happy' },
        { type: 'prometheus:emotion', emotion: 'sad' },
    ]);
});

test('an event that comes before the bridge is ready is not lost', async () => {
    const { plugin, core } = await loadPlugin();
    const container = fakeContainer();
    globalThis.document = { querySelector: () => container };
    const h = makeApi({ pluginConfig: { containerSelector: '#avatar', companionState: false, apiKey: KEY, avatarId: AVATAR_ID } });
    plugin.register(h.api);
    const started = h.hooks.filter(([name]) => name === 'model_call_started').map(([, fn]) => fn({}, {}));   // core not loaded yet
    await Promise.all(started);
    assert.deepEqual(core.embeds.flatMap((record) => record.sent), [{ type: 'prometheus:emotion', emotion: 'thinking' }]);
});

test('the hosted avatar is never made to speak, whatever enableLipSync says', async () => {
    for (const enableLipSync of [undefined, true, false]) {
        const result = await run({ apiKey: KEY, avatarId: AVATAR_ID, enableLipSync }, { ready: framed });
        await result.fire('message_sent', { content: 'Hello there, nice to meet you', success: true });
        await result.fire('model_call_started', {});
        assert.deepEqual(everythingSent(result).filter((message) => message.type === 'prometheus:speak'), [], `enableLipSync=${enableLipSync}`);
        assert.ok(!result.container.children[0].src.includes('speak'), 'no speak parameter in the address');
    }
});

test('enableEmotion:false stops the sentiment from being sent', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID, enableEmotion: false }, { ready: framed });
    await result.fire('message_sent', { content: 'This is great news', success: true });
    assert.deepEqual(everythingSent(result), []);
});

test('"Hosted avatar ready." is logged when the hosted avatar reports it loaded, and a warning says so when it never does', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID }, { ready: framed });
    assert.equal(result.at('info').some((m) => /Hosted avatar ready/.test(m)), false, 'not ready before the page says the avatar loaded');
    result.core.embeds[0].options.onLoaded(AVATAR_ID);
    assert.equal(result.at('info').filter((m) => /Hosted avatar ready/.test(m)).length, 1);

    const silent = await run({ apiKey: KEY, avatarId: AVATAR_ID }, { ready: framed });
    silent.core.embeds[0].options.onFallback('loaded-timeout');
    const warnings = silent.at('warn');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /avatarId/);
    assert.match(warnings[0], /did not report/i);
});

test('the PROMETHEUS_API_KEY environment variable counts as a configured key, as it does for the API-key tools', async () => {
    const result = await run({ avatarId: AVATAR_ID }, { env: KEY, ready: framed });
    assert.equal(result.core.embeds.length, 1);
    assert.equal(result.container.children[0].src, EMBED_URL);
});

test('a modelUrl always wins: the 2D model file is drawn and no frame is made', async () => {
    const result = await run({ modelUrl: MODEL_URL, apiKey: KEY, avatarId: AVATAR_ID }, { ready: (core) => core.calls.length > 0 });
    assert.equal(result.core.calls.length, 1);
    assert.equal(result.core.calls[0].modelUrl, MODEL_URL);
    assert.deepEqual(result.core.embeds, []);
    assert.deepEqual(result.container.children, []);
});

test('an avatarId without a key shows nothing, and the error names apiKey and modelUrl', async () => {
    const result = await run({ avatarId: AVATAR_ID });
    assert.deepEqual(result.core.embeds, []);
    assert.deepEqual(result.container.children, []);
    assert.deepEqual(result.core.calls, []);
    const errors = result.at('error');
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.match(errors[0], /apiKey/);
    assert.match(errors[0], /modelUrl/);
    assert.deepEqual([...result.tools.keys()].sort(), TOOLS);
});

test('a key without an avatarId, and neither, keep the error about modelUrl and show nothing', async () => {
    for (const config of [{ apiKey: KEY }, {}]) {
        const result = await run(config);
        assert.deepEqual(result.core.embeds, []);
        assert.deepEqual(result.container.children, []);
        const errors = result.at('error');
        assert.equal(errors.length, 1, JSON.stringify(errors));
        assert.match(errors[0], /modelUrl/);
        assert.match(errors[0], /\.model3\.json/);
        assert.match(errors[0], /openclaw\.config\.json|plugin config/i);
    }
});

test('an avatarId that is not shaped like an id is refused: nothing is framed, so no path or query can be smuggled into the address', async () => {
    for (const avatarId of ['../etc', 'a/b', `${AVATAR_ID}?speak=hello`, `${AVATAR_ID}#x`, 'a b', 'x'.repeat(200), '   ']) {
        const result = await run({ apiKey: KEY, avatarId });
        assert.deepEqual(result.core.embeds, [], JSON.stringify(avatarId));
        assert.deepEqual(result.container.children, [], JSON.stringify(avatarId));
        const errors = result.at('error');
        assert.equal(errors.length, 1, JSON.stringify(errors));
        assert.match(errors[0], /avatarId/);
    }
});

test('a page element that cannot hold a frame gets one error, and the host is not crashed', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID }, { container: {} });
    assert.deepEqual(result.core.embeds, []);
    const errors = result.at('error');
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.match(errors[0], /page element|container/i);
    assert.deepEqual([...result.tools.keys()].sort(), TOOLS);
});

test('without a page element nothing is framed (the OpenClaw gateway cannot show it)', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID }, { container: null });
    assert.deepEqual(result.core.embeds, []);
    assert.deepEqual(result.at('error'), []);
    assert.ok(result.at('info').some((line) => /Avatar rendering skipped/.test(line)), JSON.stringify(result.logs));
    assert.equal(result.hooks.length, 0, 'no avatar hooks (and companionState is off here)');
});

test('the plugin source never builds a query string for the page, never sends a speak message and never calls speak on the bridge', () => {
    const files = [...readdirSync(join(PACKAGE, 'src')).filter((name) => name.endsWith('.ts')).map((name) => `src/${name}`), 'dist/index.js'];
    assert.ok(files.includes('src/avatarBridge.ts'));
    for (const file of files) {
        const text = readFileSync(join(PACKAGE, file), 'utf8');
        assert.doesNotMatch(text, /speak=/, `${file} puts speak into an address`);
        assert.doesNotMatch(text, /prometheus:speak/, `${file} sends a speak message`);
        assert.doesNotMatch(text, /\b(?:embed|bridge|hosted)\w*\.speak\(/i, `${file} calls speak on the bridge`);
    }
});

test('the plugin asks for a core that has connectEmbed (first published in 0.11.5)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
    const lower = pkg.dependencies['@prometheusavatar/core'].match(/(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
    const needed = [0, 11, 5];
    const ok = lower[0] > needed[0] || (lower[0] === needed[0] && (lower[1] > needed[1] || (lower[1] === needed[1] && lower[2] >= needed[2])));
    assert.ok(ok, `dependency on core starts at ${lower.join('.')}, but connectEmbed needs ${needed.join('.')}`);
});
