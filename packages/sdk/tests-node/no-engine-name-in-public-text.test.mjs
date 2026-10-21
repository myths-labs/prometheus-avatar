// JC 2026-10-09: public text in the SDK packages never names the 2D runtime (the engine).
// Scans every text file in packages/sdk, packages/mcp-server and packages/openclaw-plugin
// (README, package.json description/keywords, plugin manifest, skills, tool descriptions,
// source comments, generated docs). Technical names that cannot change are allowed only where
// they are needed: the third-party npm package `pixi-live2d-display` (dependency and import),
// its exported class name in the renderer, the deprecated alias kept for old imports, and the mock of that package
// in the test that pins "no default model".
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
    // The one test that replaces the third-party package with a recorder, to pin that core loads no default model.
    { file: /^sdk\/tests\/no-default-model\.test\.ts$/, tokens: ["'pixi-live2d-display'", 'Live2DModel: { from: runtime.from }'] },
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

test('THIRD_PARTY_LICENSES.md summarises the Live2D terms as the published ones: small-scale exemption except Expandable Application, and no looser summary of our own', () => {
    const text = readFileSync(join(repoRoot, 'THIRD_PARTY_LICENSES.md'), 'utf8');
    assert.match(text, /Expandable Application/);
    assert.match(text, /small-scale enterprises/);
    assert.match(text, /Publication License Agreement/);
    // The two old one-line summaries said "free" without the exception, which made users believe they were covered.
    assert.doesNotMatch(text, /Free for (small-scale|non-commercial)/i);
    assert.doesNotMatch(text, /Commercial use requires a separate agreement/i);
});

// Wording that would say Prometheus holds, got or passes on a Live2D licence for the user.
const LICENCE_OVERCLAIM = [
    /\b(has|have|had|already) (obtained|secured|acquired|purchased|bought|paid for)\b/i,
    /\bon your behalf\b/i,
    /\blicen[cs]ed to you\b/i,
    /\bwe (hold|have|own|obtained|secured)\b[^.]{0,60}licen[cs]e/i,
    /\bprometheus (holds|owns|provides|grants|includes)\b[^.]{0,60}licen[cs]e/i,
    /licen[cs]e[^.]{0,40}\b(is|are) (already )?(included|covered|provided|granted|taken care of)\b/i,
    /\byou (do not|don't) need (a |your own )?(live2d )?licen[cs]e\b/i,
    /\bno (live2d )?licen[cs]e (is |are )?(needed|required)\b/i,
];

test('no text that points at THIRD_PARTY_LICENSES.md says Prometheus obtained, holds or passes on a Live2D licence, and the file keeps its "does not sell, sublicense or vouch" sentence', () => {
    const third = readFileSync(join(repoRoot, 'THIRD_PARTY_LICENSES.md'), 'utf8');
    assert.match(third, /Prometheus does not sell, sublicense or vouch for a Live2D licen[cs]e/);
    const found = [];
    for (const rel of ['THIRD_PARTY_LICENSES.md', 'README.md', 'packages/sdk/README.md', 'packages/openclaw-plugin/README.md', 'packages/openclaw-plugin/openclaw.plugin.json', 'packages/openclaw-plugin/skills/prometheus-avatar/SKILL.md']) {
        readFileSync(join(repoRoot, rel), 'utf8').split('\n').forEach((line, i) => {
            if (LICENCE_OVERCLAIM.some((re) => re.test(line))) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
        });
    }
    assert.deepEqual(found, []);
});

test('the licence-overclaim scan catches the wording it exists for (reverse check)', () => {
    for (const s of [
        'Prometheus has obtained the Live2D licence for you.',
        'We hold the Live2D licence, so you are covered.',
        'The licence is already included in this package.',
        'You do not need a Live2D licence.',
        'No licence is needed to use the sample models.',
        'Prometheus licenses the runtime on your behalf.',
        'The model is licensed to you under the plan.',
    ]) {
        assert.ok(LICENCE_OVERCLAIM.some((re) => re.test(s)), s);
    }
    for (const s of [
        'Prometheus does not sell, sublicense or vouch for a Live2D licence.',
        'It does not include a licence from Live2D Inc.',
        'must get the licence they require from Live2D Inc. themselves',
    ]) {
        assert.ok(!LICENCE_OVERCLAIM.some((re) => re.test(s)), s);
    }
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

test('the live-voice wording in the root README matches the example: the backend only issues a token, the browser connects to a third-party service and the audio never touches the backend', () => {
    const src = readFileSync(join(repoRoot, 'examples', 'live-voice', 'live-voice.ts'), 'utf8');
    assert.match(src, /fetch\('\/api\/live-token'\)/, 'the example no longer fetches a token: update the README live-voice rows');
    assert.match(src, /const wsUrl = `wss:\/\/(?!localhost)[a-z0-9.-]+\//, 'the WebSocket no longer points at an external host: update the README live-voice rows');
    assert.match(src, /new WebSocket\(wsUrl\)/);
    assert.equal(src.match(/\bfetch\(/g).length, 1, 'the example now sends something to the backend besides the token: update the README live-voice rows');
    const rows = readme().split('\n').filter((line) => line.includes('examples/live-voice/'));
    assert.equal(rows.length, 3, 'expected the feature row, the example row and the Chinese feature row');
    for (const row of rows) {
        assert.doesNotMatch(row, /through a backend you run|via a backend you run|经由你自己后端|通过你自己的后端/, row);
    }
    const [featureEn, exampleEn, featureZh] = rows;
    for (const row of [featureEn, exampleEn]) {
        assert.match(row, /short-lived token/, row);
        assert.match(row, /directly from the browser/, row);
        assert.match(row, /audio does not pass through your backend/, row);
    }
    assert.match(featureZh, /短期令牌/);
    assert.match(featureZh, /浏览器直接连接/);
    assert.match(featureZh, /音频不经过你的后端/);
    assert.doesNotMatch(readme(), /Gemini Live|generativelanguage/i, 'the root README does not name the upstream voice service');
});

test('the live-voice scan catches the old wording (reverse check)', () => {
    const OLD = /through a backend you run|via a backend you run|经由你自己后端|通过你自己的后端/;
    for (const s of [
        'shows microphone capture and a streaming voice connection through a backend you run.',
        'Real-time voice over a WebSocket, through a backend you run',
        '演示麦克风采集和经由你自己后端的流式语音连接',
    ]) {
        assert.ok(OLD.test(s), s);
    }
});

// ---------------------------------------------------------------------------------------------
// No default model: nothing in core or the plugin may say one exists
// ---------------------------------------------------------------------------------------------

const DEFAULT_MODEL_CLAIM = /default model is (?:used|shown|loaded)|uses? the default (?:model|avatar|character)|falls? back to (?:the |a )?default (?:model|avatar|character)|bundled (?:2D )?(?:sample|model)|\bharu\b/i;

test('no doc or manifest of core or the plugin says a default or bundled model exists', () => {
    const files = [
        'README.md',
        'packages/sdk/README.md',
        'packages/sdk/package.json',
        'packages/openclaw-plugin/README.md',
        'packages/openclaw-plugin/package.json',
        'packages/openclaw-plugin/openclaw.plugin.json',
        'packages/openclaw-plugin/skills/prometheus-avatar/SKILL.md',
    ];
    const found = [];
    for (const rel of files) {
        readFileSync(join(repoRoot, rel), 'utf8').split('\n').forEach((line, i) => {
            if (DEFAULT_MODEL_CLAIM.test(line)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
        });
    }
    assert.deepEqual(found, []);
});

test('no source comment, generated docs page or plugin skill of core or the plugin points at a third-party sample model', () => {
    const SAMPLE_MODEL = /\b(haru|shizuku|koharu)\b/i;
    const roots = ['packages/sdk/src', 'packages/sdk/docs', 'packages/openclaw-plugin/src', 'packages/openclaw-plugin/skills'];
    const found = [];
    for (const rel of roots) {
        for (const file of walk(join(repoRoot, rel))) {
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                if (SAMPLE_MODEL.test(line)) found.push(`${relative(repoRoot, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
            });
        }
    }
    assert.deepEqual(found, []);
});

test('the plugin manifest says an avatarId alone shows no avatar and points at modelUrl; modelUrl says what happens without it', () => {
    const manifest = JSON.parse(readFileSync(join(packagesDir, 'openclaw-plugin', 'openclaw.plugin.json'), 'utf8'));
    assert.match(manifest.configSchema.avatarId.description, /only avatarId is set[^.]*no avatar is shown/);
    assert.match(manifest.configSchema.avatarId.description, /modelUrl/);
    assert.match(manifest.configSchema.modelUrl.description, /without it the plugin logs how to set it and shows nothing/);
});

test('the default-model scan catches the old wording (reverse check)', () => {
    for (const s of [
        'when only avatarId is set the default model is used',
        '| `modelUrl` | `string` | bundled 2D sample | Direct URL |',
        "const modelUrl = config.modelUrl || '/models/haru/haru_greeter_t03.model3.json';",
        'falls back to the default avatar',
    ]) {
        assert.ok(DEFAULT_MODEL_CLAIM.test(s), s);
    }
    for (const s of ['No default model.', 'used to fall back to a sample path that was never part of the package', 'shows no avatar']) {
        assert.ok(!DEFAULT_MODEL_CLAIM.test(s), s);
    }
});
