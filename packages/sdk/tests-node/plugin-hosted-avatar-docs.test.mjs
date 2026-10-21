// What the openclaw-plugin docs say about showing a hosted avatar, tied to what the plugin's code does.
// The docs say: it needs both apiKey and avatarId, modelUrl wins, the address carries nothing, the plugin never makes the
// hosted avatar speak. They do not say it is the default, and they promise no kind of avatar (2D / 2.5D / 3D) the hosted page
// may not draw for every id. test/hosted-avatar.test.mjs in the plugin pins the behaviour; this pins the words.
// Run: node --experimental-strip-types --test packages/sdk/tests-node/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const plugin = (rel) => readFileSync(join(repoRoot, 'packages', 'openclaw-plugin', rel), 'utf8');
const manifest = () => JSON.parse(plugin('openclaw.plugin.json'));
const DOCS = ['README.md', 'openclaw.plugin.json', 'skills/prometheus-avatar/SKILL.md'];

const HOSTED_OVERCLAIM = [
    /by default|\bdefaults? to\b|out of the box|automatically/i,
    /\b(any|every|all) (kind|type|style|sort)s? of (avatar|character|model)/i,
];

test('the plugin docs describe the hosted avatar as needing apiKey and avatarId, with modelUrl winning', () => {
    const readme = plugin('README.md');
    assert.match(readme, /### Showing a hosted avatar/);
    assert.match(readme, /set both `apiKey` and `avatarId`/);
    assert.match(readme, /If `modelUrl` is also set, the 2D model file is drawn and `avatarId` is not used/);
    assert.match(manifest().configSchema.avatarId.description, /With apiKey also set \(and no modelUrl\)/);
    assert.match(manifest().configSchema.modelUrl.description, /Wins over avatarId/);
    assert.match(plugin('skills/prometheus-avatar/SKILL.md'), /`apiKey` \(a `pak_\.\.\.` agent key\) and `avatarId`/);
});

test('the plugin docs say the hosted avatar is never made to speak and the key never goes to it', () => {
    const readme = plugin('README.md');
    assert.match(readme, /does not make the hosted avatar speak/);
    assert.match(readme, /It is never put into the avatar's page address or sent to it/);
    assert.match(manifest().configSchema.avatarId.description, /never makes it speak/);
    assert.match(manifest().configSchema.apiKey.description, /never put into the avatar's page address or sent to it/);
    assert.match(manifest().configSchema.enableLipSync.description, /never makes it speak/);
    assert.match(plugin('skills/prometheus-avatar/SKILL.md'), /never makes the hosted avatar speak/);
});

test('the page address in the docs is the one the code builds, with nothing after it', () => {
    const src = plugin('src/index.ts');
    assert.match(src, /const PROMETHEUS_ORIGIN = 'https:\/\/prometheus\.mythslabs\.ai';/);
    assert.match(src, /frame\.src = `\$\{PROMETHEUS_ORIGIN\}\/embed\/\$\{avatarId\}`;/);
    assert.match(plugin('README.md'), /`https:\/\/prometheus\.mythslabs\.ai\/embed\/<avatarId>`, with nothing added to it/);
    for (const rel of [...DOCS, 'src/index.ts']) assert.doesNotMatch(plugin(rel), /speak=|\?speak/i, rel);
});

test('no plugin doc calls the hosted avatar the default or promises it for every kind of avatar', () => {
    const found = [];
    for (const rel of DOCS) {
        plugin(rel).split('\n').forEach((line, i) => {
            if (!/hosted/i.test(line)) return;
            if (HOSTED_OVERCLAIM.some((re) => re.test(line))) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
        });
    }
    assert.deepEqual(found, []);
});

test('the hosted-avatar overclaim scan catches the wording it exists for (reverse check)', () => {
    for (const s of [
        'The plugin shows the hosted avatar by default.',
        'Hosted avatars work out of the box for every kind of avatar.',
        'The hosted avatar is shown automatically when avatarId is set.',
    ]) {
        assert.ok(HOSTED_OVERCLAIM.some((re) => re.test(s)), s);
    }
    assert.ok(!HOSTED_OVERCLAIM.some((re) => re.test('With apiKey also set (and no modelUrl) the plugin shows that hosted avatar.')));
});

test('the enableLipSync text matches what the code does: it decides whether agent messages are spoken', () => {
    const src = plugin('src/index.ts');
    assert.match(src, /if \(config\.enableLipSync !== false\) \{\s*await avatar\.speak\(text\);/);
    assert.match(manifest().configSchema.enableLipSync.description, /false means agent messages are not spoken/);
    assert.match(plugin('README.md'), /`false` means agent messages are not spoken/);
    for (const rel of DOCS) assert.doesNotMatch(plugin(rel), /audio-driven/i, rel);
});
