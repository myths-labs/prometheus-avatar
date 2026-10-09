// JC 2026-10-09: public text in the SDK packages never names the 2D runtime (the engine).
// Scans every text file in packages/sdk, packages/mcp-server and packages/openclaw-plugin
// (README, package.json description/keywords, plugin manifest, skills, tool descriptions,
// source comments, generated docs). Technical names that cannot change are allowed only where
// they are needed: the third-party npm package `pixi-live2d-display` (dependency and import),
// its exported class name in the renderer, and the deprecated alias kept for old imports.
// LICENSE / third-party notice files may cite the engine; there are none in these packages today.
// Run: node --test packages/sdk/tests-node/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(here, '..', '..');
const PACKAGES = ['sdk', 'mcp-server', 'openclaw-plugin'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
const TEXT_EXT = /\.(md|json|ts|tsx|mts|js|mjs|cjs|html|css|txt|ya?ml)$/i;
const NOTICE_FILE = /(^|\/)(LICENSE|NOTICE|THIRD[_-]?PARTY[^/]*)(\.[a-z]+)?$/i;

// The engine name in any spelling: "Live2D", "live2d", "Live 2D", "live-2d", plus its SDK name.
const ENGINE = /live[\s_-]*2d|cubism/i;

// Allowed technical tokens, per file (path relative to packages/). Stripped before the check.
const ALLOW = [
    { file: /^sdk\/package\.json$/, tokens: ['"pixi-live2d-display"'] },
    { file: /^sdk\/src\/renderer\.ts$/, tokens: ["'pixi-live2d-display'", 'Live2DModel: L2DModel', 'Live2DRenderer'] },
    { file: /^sdk\/src\/index\.ts$/, tokens: ['Live2DRenderer'] },
];

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (TEXT_EXT.test(name)) out.push(full);
    }
    return out;
}

function hits() {
    const found = [];
    for (const pkg of PACKAGES) {
        for (const file of walk(join(packagesDir, pkg))) {
            const rel = relative(packagesDir, file).split('\\').join('/');
            if (NOTICE_FILE.test(rel)) continue;
            if (rel.startsWith('sdk/tests-node/')) continue; // this file names the word on purpose
            const allowed = ALLOW.filter((a) => a.file.test(rel)).flatMap((a) => a.tokens);
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                let rest = line;
                for (const token of allowed) rest = rest.split(token).join('');
                if (ENGINE.test(rest)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
            });
        }
    }
    return found;
}

test('no public text in the three packages names the 2D runtime', () => {
    assert.deepEqual(hits(), []);
});

test('the scan catches the old wording (reverse check)', () => {
    for (const s of [
        'Give your OpenClaw agent a Live2D avatar',
        'Direct URL to a Live2D model file (.model3.json)',
        '"live2d",',
        'PIXI.js + Live2D Cubism SDK',
        'a live-2d model',
    ]) {
        assert.ok(ENGINE.test(s), s);
    }
    assert.ok(!ENGINE.test('Direct URL to a 2D model file (.model3.json)'));
});

test('the allowed technical tokens are still where the allowlist expects them', () => {
    // If one disappears, drop it from ALLOW so the allowlist cannot hide a new hit.
    for (const { file, tokens } of ALLOW) {
        const rel = file.source.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\\\./g, '.');
        const text = readFileSync(join(packagesDir, rel), 'utf8');
        for (const token of tokens) assert.ok(text.includes(token), `${rel} no longer contains ${token}`);
    }
});

test('the plugin manifest and package descriptions describe a 2D or 3D avatar', () => {
    const manifest = JSON.parse(readFileSync(join(packagesDir, 'openclaw-plugin', 'openclaw.plugin.json'), 'utf8'));
    assert.match(manifest.description, /\b2D avatar\b/);
    assert.match(manifest.configSchema.modelUrl.description, /2D model file \(\.model3\.json\)/);
    for (const pkg of PACKAGES) {
        const json = JSON.parse(readFileSync(join(packagesDir, pkg, 'package.json'), 'utf8'));
        assert.ok(!ENGINE.test(json.description), `${pkg} description`);
        assert.ok(!(json.keywords ?? []).some((k) => ENGINE.test(k)), `${pkg} keywords`);
    }
});
