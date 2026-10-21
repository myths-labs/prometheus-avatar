// JC 2026-10-09: public text in the SDK packages never names the 2D runtime (the engine).
// Scans every text file in packages/sdk, packages/mcp-server and packages/openclaw-plugin
// (README, package.json description/keywords, plugin manifest, skills, tool descriptions,
// source comments, generated docs). Technical names that cannot change are allowed only where
// they are needed: the third-party npm package `pixi-live2d-display` (dependency and import),
// its exported class name in the renderer, and the deprecated alias kept for old imports.
// The one file that may, and must, name the engine is THIRD_PARTY_LICENSES.md at the repository root:
// it is where users learn they need a licence of their own. No file inside a package is exempt.
// packages/mcp-server/test/ is not scanned: it has its own public-text test, which spells the word on purpose.
// The root README.md is scanned too (no exemption); the rest of the repository root, apps/ and examples/ are not.
//
// Owner decision 2026-10-10: core and openclaw-plugin say only what they do today, a 2D model file
// (.model3.json) drawn in the page. They claim no 3D or 2.5D ability until the embed bridge has been run
// in a browser against the live embed page. The second half of this file pins that.
// Run: node --test packages/sdk/tests-node/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(here, '..', '..');
const repoRoot = join(packagesDir, '..');
const PACKAGES = ['sdk', 'mcp-server', 'openclaw-plugin'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
const TEXT_EXT = /\.(md|json|ts|tsx|mts|js|mjs|cjs|html|css|txt|ya?ml)$/i;

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
            if (rel.startsWith('sdk/tests-node/')) continue; // this file names the word on purpose
            if (rel.startsWith('mcp-server/test/')) continue; // its public-text test names the word on purpose
            const allowed = ALLOW.filter((a) => a.file.test(rel)).flatMap((a) => a.tokens);
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                let rest = line;
                for (const token of allowed) rest = rest.split(token).join('');
                if (ENGINE.test(rest)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
            });
        }
    }
    readFileSync(join(repoRoot, 'README.md'), 'utf8').split('\n').forEach((line, i) => {
        if (ENGINE.test(line)) found.push(`README.md:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
    return found;
}

test('no public text in the three packages or the root README names the 2D runtime (no file inside a package is exempt)', () => {
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

test('the plugin manifest says 2D avatar, and no package description or keyword names the engine', () => {
    const manifest = JSON.parse(readFileSync(join(packagesDir, 'openclaw-plugin', 'openclaw.plugin.json'), 'utf8'));
    assert.match(manifest.description, /\b2D avatar\b/);
    assert.match(manifest.configSchema.modelUrl.description, /2D model file \(\.model3\.json\)/);
    for (const pkg of PACKAGES) {
        const json = JSON.parse(readFileSync(join(packagesDir, pkg, 'package.json'), 'utf8'));
        assert.ok(!ENGINE.test(json.description), `${pkg} description`);
        assert.ok(!(json.keywords ?? []).some((k) => ENGINE.test(k)), `${pkg} keywords`);
    }
});

// ---------------------------------------------------------------------------------------------
// The one place that names the engine, and the pointers to it
// ---------------------------------------------------------------------------------------------

test('THIRD_PARTY_LICENSES.md names the engine and says every user gets their own licence from its owner', () => {
    const text = readFileSync(join(repoRoot, 'THIRD_PARTY_LICENSES.md'), 'utf8');
    assert.ok(ENGINE.test(text), 'the file that is allowed to name the engine must name it');
    assert.match(text, /## Live2D: you need a licence of your own/);
    assert.match(text, /must get the licen[cs]e they require from Live2D Inc\. themselves/);
    assert.match(text, /does not include a licen[cs]e from Live2D Inc\./);
});

test('no placeholder text is left in THIRD_PARTY_LICENSES.md', () => {
    const text = readFileSync(join(repoRoot, 'THIRD_PARTY_LICENSES.md'), 'utf8');
    assert.doesNotMatch(text, /\b(TODO|TBD|FIXME|XXX|coming soon|placeholder)\b|\[link\]|<link>/i);
});

test('the root README and the core and openclaw-plugin READMEs end with a pointer to THIRD_PARTY_LICENSES.md that does not name the engine', () => {
    for (const rel of ['README.md', 'packages/sdk/README.md', 'packages/openclaw-plugin/README.md']) {
        const lines = readFileSync(join(repoRoot, rel), 'utf8').trimEnd().split('\n');
        const last = lines[lines.length - 1];
        assert.match(last, /\(?(https:\/\/github\.com\/myths-labs\/prometheus-avatar\/blob\/main\/)?THIRD_PARTY_LICENSES\.md\)?/, `${rel}: last line is ${JSON.stringify(last)}`);
        assert.ok(!ENGINE.test(last), `${rel}: the pointer must not name the engine`);
        if (rel.startsWith('packages/')) {
            // npm shows these READMEs away from the repository, so the link must be absolute
            assert.match(last, /\]\(https:\/\/github\.com\/myths-labs\/prometheus-avatar\/blob\/main\/THIRD_PARTY_LICENSES\.md\)/, `${rel}: needs an absolute link`);
        }
    }
});

// ---------------------------------------------------------------------------------------------
// No 3D / 2.5D claim in core or openclaw-plugin
// ---------------------------------------------------------------------------------------------

const CLAIM_PACKAGES = ['sdk', 'openclaw-plugin'];
const CLAIM = /\b3D\b|2\.5D/i;
// Prompts that the image engine is told to draw. They describe a picture, not what the package renders.
const IMAGE_PROMPT_TOKENS = ['3D cel-shaded engine render'];

function claimHits() {
    const found = [];
    for (const pkg of CLAIM_PACKAGES) {
        for (const file of walk(join(packagesDir, pkg))) {
            const rel = relative(packagesDir, file).split('\\').join('/');
            if (rel.startsWith('sdk/tests-node/') || /^[^/]+\/test\//.test(rel)) continue;
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                let rest = line;
                for (const token of IMAGE_PROMPT_TOKENS) rest = rest.split(token).join('');
                if (CLAIM.test(rest)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
            });
        }
    }
    return found;
}

test('core and openclaw-plugin claim no 3D or 2.5D ability anywhere in their public text', () => {
    assert.deepEqual(claimHits(), []);
});

test('the claim scan catches the old wording (reverse check)', () => {
    for (const s of [
        'an embed bridge for the hosted 3D character',
        '"3d-avatar",',
        'Render a complete Prometheus digital character (2.5D / 3D)',
        'vibrant 2.5D surface',
    ]) {
        assert.ok(CLAIM.test(s), s);
    }
    for (const s of ['a 2D model file (.model3.json)', '3/4 hero pose', 'NOT flat 2D illustration']) {
        assert.ok(!CLAIM.test(s), s);
    }
});

// ---------------------------------------------------------------------------------------------
// The root README says what the SDK does about models and voices, and the code backs it
// ---------------------------------------------------------------------------------------------

const readme = () => readFileSync(join(repoRoot, 'README.md'), 'utf8');

test('the root README points at no sample model', () => {
    assert.doesNotMatch(readme(), /\b(haru|shizuku|koharu)\b/i);
    assert.doesNotMatch(readme(), /https?:\/\/(?!your-cdn\.example)[^\s'")]*\.model3\.json/, 'only the your-cdn.example placeholder host may appear in a model URL');
});

test('the TTS wording in the root README matches the code: browser speech by default, no request, own engine via ttsEngine', () => {
    const sdkSrc = join(packagesDir, 'sdk', 'src');
    assert.match(readFileSync(join(sdkSrc, 'avatar.ts'), 'utf8'), /\?\? new WebSpeechTTS\(config\.ttsOptions\)/, 'the default engine changed: update the README TTS rows');
    assert.match(readFileSync(join(sdkSrc, 'tts.ts'), 'utf8'), /window\.speechSynthesis/);
    assert.doesNotMatch(readFileSync(join(sdkSrc, 'tts.ts'), 'utf8'), /\bfetch\(|XMLHttpRequest|WebSocket/, 'the default engine now makes requests: update the README TTS rows');
    const text = readme();
    assert.match(text, /browser's built-in speech synthesis/);
    assert.match(text, /`ttsEngine`/);
    assert.match(text, /浏览器自带的语音合成/);
    assert.doesNotMatch(text, /Gemini (Live API|TTS|2\.0 Flash)/);
});

test('the plugin docs promise no Marketplace or cloned voice: the SDK matches the browser\'s own voices by name', () => {
    const plugin = join(packagesDir, 'openclaw-plugin');
    for (const file of ['README.md', 'openclaw.plugin.json', 'skills/prometheus-avatar/SKILL.md']) {
        assert.doesNotMatch(readFileSync(join(plugin, file), 'utf8'), /Prometheus voice backend|<marketplace-voice-id>|reference a Prometheus Marketplace voice ID|saturn_zh_female/, file);
    }
    assert.match(readFileSync(join(packagesDir, 'sdk', 'src', 'tts.ts'), 'utf8'), /v\.name === opts\.voice \|\| v\.voiceURI === opts\.voice/,
        'voice selection changed: update the plugin docs about ttsVoice');
});
