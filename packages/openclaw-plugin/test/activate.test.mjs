// register(api) of the built plugin (dist/index.js), run against a stand-in for @prometheusavatar/core so no browser,
// canvas or network is needed. The plugin draws a 2D model file and has none of its own: with no `modelUrl` it must
// say how to set one instead of loading a sample that is not shipped, and it must not crash the host.
// (0.10.3 tested the same rules through the old activate(context) entry; 0.11.0 only has register(api).)
// Runs after `npm run build` (see the test script), so dist/ exists.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeApi, sleep, until, cleanupDirs } from './helpers/fakeApi.mjs';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const MODEL_URL = 'https://models.example.test/mao/mao.model3.json';
const TOOLS = ['prometheus_connect_seller', 'prometheus_connection_status', 'prometheus_deploy_asset', 'prometheus_disconnect_seller',
    'prometheus_generate_image_pro', 'prometheus_generate_thumbnail', 'prometheus_publish_listing'];

// The plugin loads core lazily, after register() has returned, so the folders stay until the test is over.
const folders = [];
afterEach(() => {
    for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
    cleanupDirs();
    delete globalThis.document;
});

// Copy dist/index.js next to a fake node_modules/@prometheusavatar/core, then import it from there. The fake core
// records every createAvatar() call, so the test can see whether (and with what) the plugin tried to draw.
async function loadPlugin() {
    const dir = mkdtempSync(join(tmpdir(), 'openclaw-plugin-activate-'));
    folders.push(dir);
    const coreDir = join(dir, 'node_modules', '@prometheusavatar', 'core');
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(coreDir, 'package.json'), JSON.stringify({ name: '@prometheusavatar/core', version: '0.0.0', type: 'module', main: 'index.js' }));
    writeFileSync(join(coreDir, 'index.js'), [
        'export const calls = [];',
        'export const spoken = [];',
        'export async function createAvatar(options) {',
        '    calls.push(options);',
        '    return { processText() {}, async speak(text) { spoken.push(text); }, setEmotion() {}, destroy() {} };',
        '}',
        'export class PrometheusAvatar {}',
        'export class AssetCreator { constructor(host, apiKey) { this.apiKey = apiKey; } }',
        'export class SellerChannelApi {}',
        'export class EmotionAnalyzer { analyze() { return { emotion: \'neutral\', confidence: 1, triggers: [] }; } }',
        'export function connectEmbed() { throw new Error(\'connectEmbed must not be reached without an apiKey and an avatarId\'); }',
        '',
    ].join('\n'));
    copyFileSync(join(PACKAGE, 'dist', 'index.js'), join(dir, 'index.js'));
    const plugin = (await import(pathToFileURL(join(dir, 'index.js')).href)).default;
    const core = await import(pathToFileURL(join(coreDir, 'index.js')).href);
    return { plugin, core };
}

// A host that records what the plugin registers and the lines it logs. `withContainer` gives it a page element.
async function run(config, { withContainer = true, ready } = {}) {
    const { plugin, core } = await loadPlugin();
    if (withContainer) globalThis.document = { querySelector: (selector) => (selector === '#avatar' ? {} : null) };
    const h = makeApi({ pluginConfig: { containerSelector: '#avatar', ...config } });
    const ret = plugin.register(h.api);
    if (ready) await until(() => ready(core));
    else await sleep(30);                                            // long enough for a lazy core load that should not happen
    const at = (level) => h.logs.filter(([l]) => l === level).map(([, m]) => m);
    const fire = async (hook, event = {}) => { for (const [name, fn] of h.hooks) if (name === hook) await fn(event, {}); };
    return { ...h, ret, at, fire, core, createAvatarCalls: [...core.calls] };
}

test('without modelUrl no model is loaded, the error says how to set modelUrl, and the host is not crashed', async () => {
    const result = await run({});
    assert.deepEqual(result.createAvatarCalls, [], 'createAvatar must not be called with a made-up default model');
    assert.equal(result.at('info').some((m) => /Avatar ready/.test(m)), false);
    assert.equal(result.hooks.length, 0, 'nothing to drive, so no avatar hooks');
    const errors = result.at('error');
    assert.equal(errors.length, 1, `one error line, got: ${JSON.stringify(errors)}`);
    assert.match(errors[0], /modelUrl/);
    assert.match(errors[0], /\.model3\.json/);
    assert.match(errors[0], /openclaw\.config\.json|plugin config/i, 'names where the setting goes');
    assert.match(errors[0], /plugins\.entries\.prometheus-avatar\.config/, 'the path OpenClaw really reads');
});

test('without modelUrl the seller, deploy and image tools are still registered', async () => {
    const result = await run({});
    assert.deepEqual([...result.tools.keys()].sort(), TOOLS);
});

test('with only an avatarId the error says the avatarId needs an apiKey, or a modelUrl instead', async () => {
    const result = await run({ avatarId: 'abc123' });
    assert.deepEqual(result.createAvatarCalls, []);
    const errors = result.at('error');
    assert.equal(errors.length, 1, `one error line, got: ${JSON.stringify(errors)}`);
    assert.match(errors[0], /avatarId/);
    assert.match(errors[0], /apiKey/);
    assert.match(errors[0], /modelUrl/);
});

test('with a modelUrl that exact URL is drawn, the avatar is reported ready, and messages are spoken unless enableLipSync is false', async () => {
    const result = await run({ modelUrl: MODEL_URL }, { ready: (core) => core.calls.length > 0 });
    assert.equal(result.createAvatarCalls.length, 1);
    assert.equal(result.createAvatarCalls[0].modelUrl, MODEL_URL);
    await until(() => result.at('info').some((m) => /Avatar ready/.test(m)));
    assert.deepEqual(result.at('error'), []);
    await result.fire('message_sent', { content: 'Hello there', success: true });
    assert.deepEqual([...result.core.spoken], ['Hello there']);

    const quiet = await run({ modelUrl: MODEL_URL, enableLipSync: false }, { ready: (core) => core.calls.length > 0 });
    await until(() => quiet.at('info').some((m) => /Avatar ready/.test(m)));
    await quiet.fire('message_sent', { content: 'Hello there', success: true });
    assert.deepEqual([...quiet.core.spoken], [], 'false means agent messages are not spoken');
});

test('without a page element nothing is drawn and the missing modelUrl is not reported (a headless agent cannot draw anyway)', async () => {
    const result = await run({}, { withContainer: false });
    assert.deepEqual(result.createAvatarCalls, []);
    assert.deepEqual(result.at('error'), []);
    assert.ok(result.at('info').some((line) => /Avatar rendering skipped/.test(line)), JSON.stringify(result.logs));
    assert.deepEqual([...result.tools.keys()].sort(), TOOLS);
});

test('neither the built plugin nor its source carries a bundled sample model path', () => {
    const files = [...readdirSync(join(PACKAGE, 'src')).filter((name) => name.endsWith('.ts')).map((name) => `src/${name}`), 'dist/index.js'];
    assert.ok(files.includes('src/avatarBridge.ts'));
    for (const file of files) {
        const text = readFileSync(join(PACKAGE, file), 'utf8');
        assert.doesNotMatch(text, /haru/i, `${file} still names a sample model`);
        assert.doesNotMatch(text, /['"`]\/models\//, `${file} still has a /models/ default path`);
    }
});

test('package.json and the plugin manifest carry the same version', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, 'openclaw.plugin.json'), 'utf8'));
    const pkg = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
    assert.equal(manifest.version, pkg.version);
});
