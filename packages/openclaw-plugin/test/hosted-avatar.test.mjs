// With a Prometheus agent key ("apiKey") and the id of a hosted avatar ("avatarId") and no "modelUrl", activate() frames the
// hosted avatar page and drives its expression through core's connectEmbed. Run against the built plugin (dist/index.js)
// and a stand-in for @prometheusavatar/core that records every connectEmbed call and every message sent to the frame.
// Rules pinned here: the page address is exactly https://prometheus.mythslabs.ai/embed/<id> (no query string, so no
// `?speak=`); the key never reaches the page address, the frame or a message; the plugin never makes the hosted avatar speak;
// a `modelUrl` always wins; every case without both settings keeps today's behaviour (a logged error, nothing shown).
// Runs after `npm run build` (see the test script), so dist/ exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const AVATAR_ID = '3f2a9c1e-7b64-4d0a-9e51-2c8d5b6a7f10';
const KEY = 'pak_test_marker_not_a_real_key';
const MODEL_URL = 'https://models.example.test/mao/mao.model3.json';
const EMBED_URL = `https://prometheus.mythslabs.ai/embed/${AVATAR_ID}`;

const FAKE_CORE = [
    'export const calls = [];',
    'export const embeds = [];',
    'export async function createAvatar(options) {',
    '    calls.push(options);',
    '    return { processText() {}, async speak() {}, setEmotion() {}, destroy() {} };',
    '}',
    'export class PrometheusAvatar {}',
    'export class AssetCreator { constructor(host, apiKey) { this.apiKey = apiKey; } }',
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

async function loadPlugin() {
    const dir = mkdtempSync(join(tmpdir(), 'openclaw-plugin-hosted-'));
    const coreDir = join(dir, 'node_modules', '@prometheusavatar', 'core');
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(coreDir, 'package.json'), JSON.stringify({ name: '@prometheusavatar/core', version: '0.0.0', type: 'module', main: 'index.js' }));
    writeFileSync(join(coreDir, 'index.js'), FAKE_CORE);
    copyFileSync(join(PACKAGE, 'dist', 'index.js'), join(dir, 'index.js'));
    const plugin = await import(pathToFileURL(join(dir, 'index.js')).href);
    const core = await import(pathToFileURL(join(coreDir, 'index.js')).href);
    return { plugin, core, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// A container that can hold a frame: it has an owner document that makes elements, and a window the bridge listens on.
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

async function run(config, { container = fakeContainer(), env } = {}) {
    const { plugin, core, cleanup } = await loadPlugin();
    const seen = { tools: [], handlers: {}, emitted: [], errors: [], warnings: [], logs: [] };
    const original = { error: console.error, warn: console.warn, log: console.log };
    const savedKey = process.env.PROMETHEUS_API_KEY;
    if (env === undefined) delete process.env.PROMETHEUS_API_KEY; else process.env.PROMETHEUS_API_KEY = env;
    console.error = (...args) => seen.errors.push(args.join(' '));
    console.warn = (...args) => seen.warnings.push(args.join(' '));
    console.log = (...args) => seen.logs.push(args.join(' '));
    let cleanupFn;
    try {
        cleanupFn = await plugin.activate({
            config,
            container,
            on: (event, handler) => { seen.handlers[event] = handler; },
            emit: (event, data) => seen.emitted.push({ event, data }),
            registerTool: (name) => seen.tools.push(name),
        });
    } finally {
        Object.assign(console, original);
        if (savedKey === undefined) delete process.env.PROMETHEUS_API_KEY; else process.env.PROMETHEUS_API_KEY = savedKey;
        cleanup();
    }
    return { ...seen, cleanupFn, container, core, createAvatarCalls: [...core.calls], embeds: [...core.embeds] };
}

const everythingSent = (result) => result.embeds.flatMap((record) => record.sent);

test('control: a stand-in bridge that is asked to speak records it (so "never speaks" below is not vacuous)', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID });
    const bridgeLikeCall = result.embeds[0];
    assert.ok(bridgeLikeCall, 'a bridge must have been created for this control to mean anything');
    const { connectEmbed } = result.core;
    const probe = connectEmbed({ src: EMBED_URL }, {});
    probe.speak('hello');
    assert.deepEqual(result.core.embeds.at(-1).sent, [{ type: 'prometheus:speak', text: 'hello' }]);
});

test('apiKey and avatarId without modelUrl frame the hosted avatar page, exactly and only that address, and connect core\'s bridge to it', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID });
    assert.deepEqual(result.createAvatarCalls, [], 'the local 2D renderer must not run');
    assert.deepEqual(result.errors, []);
    assert.equal(result.container.children.length, 1);
    const frame = result.container.children[0];
    assert.equal(frame.tag, 'iframe');
    assert.equal(frame.src, EMBED_URL, 'no query string: nothing is asked of the page at load, `?speak=` included');
    assert.equal(result.embeds.length, 1);
    assert.equal(result.embeds[0].frame, frame);
    assert.equal(result.embeds[0].srcAtConnect, EMBED_URL, 'the address is set before the bridge is created');
    assert.equal(result.embeds[0].options.avatarId, AVATAR_ID);
    assert.equal(result.embeds[0].options.hostWindow, result.container.hostWindow, 'the bridge listens on the window that owns the container');
    assert.equal(typeof result.cleanupFn, 'function');
});

test('the key reaches neither the page address, nor the frame, nor the bridge options, nor any message, nor the log', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID });
    const frame = result.container.children[0];
    // Handlers run after activate() returns, so their output is collected by wrapping the console here too.
    const late = [];
    const original = { error: console.error, warn: console.warn, log: console.log };
    console.error = console.warn = console.log = (...args) => late.push(args.join(' '));
    try {
        result.handlers['agent:thinking']({ type: 'agent:thinking', data: {} });
        result.handlers['agent:error']({ type: 'agent:error', data: {} });
        await result.handlers['agent:message']({ type: 'agent:message', data: { text: 'This is great news' } });
        result.embeds[0].options.onLoaded(AVATAR_ID);
        result.embeds[0].options.onFallback('loaded-timeout');
        result.embeds[0].options.onFallback('ready-timeout');
    } finally { Object.assign(console, original); }
    const visible = JSON.stringify({ late, src: frame.src, attributes: frame.attributes, style: frame.style, options: Object.keys(result.embeds[0].options), sent: everythingSent(result), logs: result.logs, errors: result.errors, warnings: result.warnings, emitted: result.emitted });
    assert.ok(!visible.includes(KEY), visible);
    assert.ok(!visible.includes('pak_'), visible);
});

test('agent events drive the expression: thinking, error and the sentiment of a message; nothing else is sent', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID });
    result.handlers['agent:thinking']({ type: 'agent:thinking', data: {} });
    result.handlers['agent:error']({ type: 'agent:error', data: {} });
    await result.handlers['agent:message']({ type: 'agent:message', data: { text: 'This is great news' } });
    await result.handlers['agent:message']({ type: 'agent:message', data: { text: 'Sorry, I could not do that' } });
    await result.handlers['agent:message']({ type: 'agent:message', data: {} });
    assert.deepEqual(everythingSent(result), [
        { type: 'prometheus:emotion', emotion: 'thinking' },
        { type: 'prometheus:emotion', emotion: 'surprised' },
        { type: 'prometheus:emotion', emotion: 'happy' },
        { type: 'prometheus:emotion', emotion: 'sad' },
    ]);
});

test('the hosted avatar is never made to speak, whatever enableLipSync says', async () => {
    for (const enableLipSync of [undefined, true, false]) {
        const result = await run({ apiKey: KEY, avatarId: AVATAR_ID, enableLipSync });
        await result.handlers['agent:message']({ type: 'agent:message', data: { text: 'Hello there, nice to meet you' } });
        result.handlers['agent:thinking']({ type: 'agent:thinking', data: {} });
        assert.deepEqual(everythingSent(result).filter((message) => message.type === 'prometheus:speak'), [], `enableLipSync=${enableLipSync}`);
        assert.ok(!result.container.children[0].src.includes('speak'), 'no speak parameter in the address');
        assert.equal(result.emitted.some((e) => e.event === 'avatar:speak'), false, 'avatar:speak means the avatar spoke');
    }
});

test('enableEmotion:false stops the sentiment from being sent', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID, enableEmotion: false });
    await result.handlers['agent:message']({ type: 'agent:message', data: { text: 'This is great news' } });
    assert.deepEqual(everythingSent(result), []);
});

test('avatar:ready is emitted when the hosted avatar reports it loaded, and a warning says so when it never does', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID });
    assert.equal(result.emitted.some((e) => e.event === 'avatar:ready'), false, 'not ready before the page says the avatar loaded');
    result.embeds[0].options.onLoaded(AVATAR_ID);
    assert.deepEqual(result.emitted.filter((e) => e.event === 'avatar:ready'), [{ event: 'avatar:ready', data: { avatarId: AVATAR_ID } }]);

    const silent = await run({ apiKey: KEY, avatarId: AVATAR_ID });
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try { silent.embeds[0].options.onFallback('loaded-timeout'); } finally { console.warn = original; }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /avatarId/);
    assert.match(warnings[0], /did not report/i);
});

test('the returned cleanup destroys the bridge and removes the frame', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID });
    result.cleanupFn();
    assert.equal(result.embeds[0].destroyed, true);
    assert.deepEqual(result.container.removed, [result.container.children[0]]);
});

test('the PROMETHEUS_API_KEY environment variable counts as a configured key, as it does for the creator tools', async () => {
    const result = await run({ avatarId: AVATAR_ID }, { env: KEY });
    assert.equal(result.embeds.length, 1);
    assert.equal(result.container.children[0].src, EMBED_URL);
});

test('a modelUrl always wins: the 2D model file is drawn and no frame is made', async () => {
    const result = await run({ modelUrl: MODEL_URL, apiKey: KEY, avatarId: AVATAR_ID });
    assert.equal(result.createAvatarCalls.length, 1);
    assert.equal(result.createAvatarCalls[0].modelUrl, MODEL_URL);
    assert.deepEqual(result.embeds, []);
    assert.deepEqual(result.container.children, []);
});

test('an avatarId without a key shows nothing, and the error names apiKey and modelUrl', async () => {
    const result = await run({ avatarId: AVATAR_ID });
    assert.deepEqual(result.embeds, []);
    assert.deepEqual(result.container.children, []);
    assert.deepEqual(result.createAvatarCalls, []);
    assert.equal(result.errors.length, 1, JSON.stringify(result.errors));
    assert.match(result.errors[0], /apiKey/);
    assert.match(result.errors[0], /modelUrl/);
    assert.deepEqual([...result.tools].sort(), ['prometheus_deploy_asset', 'prometheus_generate_image_pro', 'prometheus_generate_thumbnail']);
});

test('a key without an avatarId, and neither, keep today\'s error about modelUrl and show nothing', async () => {
    for (const config of [{ apiKey: KEY }, {}]) {
        const result = await run(config);
        assert.deepEqual(result.embeds, []);
        assert.deepEqual(result.container.children, []);
        assert.equal(result.errors.length, 1, JSON.stringify(result.errors));
        assert.match(result.errors[0], /modelUrl/);
        assert.match(result.errors[0], /\.model3\.json/);
        assert.match(result.errors[0], /openclaw\.config\.json|plugin config/i);
    }
});

test('an avatarId that is not shaped like an id is refused: nothing is framed, so no path or query can be smuggled into the address', async () => {
    for (const avatarId of ['../etc', 'a/b', `${AVATAR_ID}?speak=hello`, `${AVATAR_ID}#x`, 'a b', 'x'.repeat(200), '   ']) {
        const result = await run({ apiKey: KEY, avatarId });
        assert.deepEqual(result.embeds, [], JSON.stringify(avatarId));
        assert.deepEqual(result.container.children, [], JSON.stringify(avatarId));
        assert.equal(result.errors.length, 1, JSON.stringify(result.errors));
        assert.match(result.errors[0], /avatarId/);
    }
});

test('a container that cannot hold a frame gets one error, and the host is not crashed', async () => {
    const result = await run({ apiKey: KEY, avatarId: AVATAR_ID }, { container: {} });
    assert.deepEqual(result.embeds, []);
    assert.equal(result.errors.length, 1, JSON.stringify(result.errors));
    assert.match(result.errors[0], /container/i);
    assert.equal(result.tools.length, 3);
});

test('without a container nothing is framed (a headless agent cannot show it)', async () => {
    const { plugin, core, cleanup } = await loadPlugin();
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        await plugin.activate({ config: { apiKey: KEY, avatarId: AVATAR_ID }, on() {}, emit() {}, registerTool() {} });
    } finally { console.warn = original; cleanup(); }
    assert.deepEqual(core.embeds, []);
    assert.ok(warnings.some((line) => /No container/.test(line)));
});

test('the plugin source never builds a query string for the page, never sends a speak message and never calls speak on the bridge', () => {
    for (const file of ['src/index.ts', 'dist/index.js']) {
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
