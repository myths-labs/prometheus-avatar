// activate() of the built plugin (dist/index.js), run against a stand-in for @prometheusavatar/core so no browser,
// canvas or network is needed. The plugin draws a 2D model file and has none of its own: with no `modelUrl` it must
// say how to set one instead of loading a sample that is not shipped, and it must not crash the host.
// Runs after `npm run build` (see the test script), so dist/ exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const MODEL_URL = 'https://models.example.test/mao/mao.model3.json';

// Copy dist/index.js next to a fake node_modules/@prometheusavatar/core, then import it from there. The fake core
// records every createAvatar() call, so the test can see whether (and with what) the plugin tried to draw.
async function loadPlugin() {
    const dir = mkdtempSync(join(tmpdir(), 'openclaw-plugin-activate-'));
    const coreDir = join(dir, 'node_modules', '@prometheusavatar', 'core');
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(coreDir, 'package.json'), JSON.stringify({ name: '@prometheusavatar/core', version: '0.0.0', type: 'module', main: 'index.js' }));
    writeFileSync(join(coreDir, 'index.js'), [
        'export const calls = [];',
        'export const destroyed = [];',
        'export async function createAvatar(options) {',
        '    calls.push(options);',
        '    return { processText() {}, async speak() {}, setEmotion() {}, destroy() { destroyed.push(options.modelUrl); } };',
        '}',
        'export class PrometheusAvatar {}',
        'export class AssetCreator { constructor(host, apiKey) { this.apiKey = apiKey; } }',
        'export class EmotionAnalyzer { analyze() { return { emotion: \'neutral\', confidence: 1, triggers: [] }; } }',
        'export function connectEmbed() { throw new Error(\'connectEmbed must not be reached without an apiKey and an avatarId\'); }',
        '',
    ].join('\n'));
    copyFileSync(join(PACKAGE, 'dist', 'index.js'), join(dir, 'index.js'));
    const plugin = await import(pathToFileURL(join(dir, 'index.js')).href);
    const core = await import(pathToFileURL(join(coreDir, 'index.js')).href);
    return { plugin, core, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// A host context that records what the plugin registers, listens to and emits, and the console lines it prints.
async function run(config, { withContainer = true } = {}) {
    const { plugin, core, cleanup } = await loadPlugin();
    const seen = { tools: [], listeners: [], emitted: [], errors: [], warnings: [] };
    const original = { error: console.error, warn: console.warn, log: console.log };
    console.error = (...args) => seen.errors.push(args.join(' '));
    console.warn = (...args) => seen.warnings.push(args.join(' '));
    console.log = () => {};
    let cleanupFn;
    try {
        cleanupFn = await plugin.activate({
            config,
            container: withContainer ? {} : undefined,
            on: (event) => seen.listeners.push(event),
            emit: (event, data) => seen.emitted.push({ event, data }),
            registerTool: (name) => seen.tools.push(name),
        });
    } finally {
        Object.assign(console, original);
        cleanup();
    }
    return { ...seen, cleanupFn, core, createAvatarCalls: [...core.calls] };
}

test('without modelUrl no model is loaded, the error says how to set modelUrl, and the host is not crashed', async () => {
    const result = await run({});
    assert.deepEqual(result.createAvatarCalls, [], 'createAvatar must not be called with a made-up default model');
    assert.equal(result.cleanupFn, undefined);
    assert.equal(result.emitted.some(e => e.event === 'avatar:ready'), false);
    assert.equal(result.errors.length, 1, `one error line, got: ${JSON.stringify(result.errors)}`);
    assert.match(result.errors[0], /modelUrl/);
    assert.match(result.errors[0], /\.model3\.json/);
    assert.match(result.errors[0], /openclaw\.config\.json|plugin config/i, 'names where the setting goes');
});

test('without modelUrl the creator tools are still registered', async () => {
    const result = await run({});
    assert.deepEqual([...result.tools].sort(), ['prometheus_deploy_asset', 'prometheus_generate_image_pro', 'prometheus_generate_thumbnail']);
});

test('with only an avatarId the error says the avatarId needs an apiKey, or a modelUrl instead', async () => {
    const result = await run({ avatarId: 'abc123' });
    assert.deepEqual(result.createAvatarCalls, []);
    assert.equal(result.errors.length, 1, `one error line, got: ${JSON.stringify(result.errors)}`);
    assert.match(result.errors[0], /avatarId/);
    assert.match(result.errors[0], /apiKey/);
    assert.match(result.errors[0], /modelUrl/);
});

test('with a modelUrl that exact URL is drawn, avatar:ready names it, and the returned cleanup destroys the avatar', async () => {
    const result = await run({ modelUrl: MODEL_URL });
    assert.equal(result.createAvatarCalls.length, 1);
    assert.equal(result.createAvatarCalls[0].modelUrl, MODEL_URL);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.emitted.filter(e => e.event === 'avatar:ready'), [{ event: 'avatar:ready', data: { modelUrl: MODEL_URL } }]);
    assert.equal(typeof result.cleanupFn, 'function');
    result.cleanupFn();
    assert.deepEqual([...result.core.destroyed], [MODEL_URL]);
});

test('without a container nothing is drawn and the missing modelUrl is not reported (a headless agent cannot draw anyway)', async () => {
    const result = await run({}, { withContainer: false });
    assert.deepEqual(result.createAvatarCalls, []);
    assert.deepEqual(result.errors, []);
    assert.ok(result.warnings.some(line => /No container/.test(line)), JSON.stringify(result.warnings));
    assert.equal(result.tools.length, 3);
});

test('neither the built plugin nor its source carries a bundled sample model path', () => {
    for (const file of ['dist/index.js', 'src/index.ts']) {
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
