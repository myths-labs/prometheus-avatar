// The words that reach the public npm page and every MCP client must match what the product does today (B review of
// d587f7e7, R2): production has no Live2D (3D / 2.5D avatars), the website's `browse` category is live (2026-10-19),
// and this public repository does not point at pull requests or migration files of the private website repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(join(PACKAGE, path), 'utf8');

test('no Live2D claim in what is published or sent to MCP clients: README, package.json, server source', () => {
    const manifest = JSON.parse(read('package.json'));
    assert.ok(!manifest.keywords.some(keyword => /live2d/i.test(keyword)), 'package.json keywords');
    assert.doesNotMatch(manifest.description, /live2d/i, 'package.json description');
    for (const path of ['README.md', 'src/index.ts', 'src/workspace-tools.ts', 'src/workspace-writer.ts', 'src/workspace-api.ts'])
        assert.doesNotMatch(read(path), /live2d/i, path);
});

test('the README does not say the visited-pages (browse) category is missing from the website', () => {
    const readme = read('README.md');
    assert.doesNotMatch(readme, /has not added yet|does not have the visited-pages list yet|还没有加上|网站还没有「访问过的页面」/);
    assert.match(readme, /browse[^\n]*2026-10-19/, 'English: says since when it is live');
    assert.match(readme, /2026-10-19[^\n]*上线|上线[^\n]*2026-10-19/, 'Chinese: says since when it is live');
});

/** The text of the changelog section whose heading starts with `heading`, up to the next rule line. */
function changelogSection(changelog, heading) {
    const start = changelog.indexOf(`\n${heading}`);
    assert.ok(start >= 0, `the changelog has a section "${heading}"`);
    const end = changelog.indexOf('\n---', start + 1);
    return changelog.slice(start, end < 0 ? undefined : end);
}
const PRIVATE_REFERENCE = /PR #\d+|#5\d\d\b|K\d+[a-z]?\b|\d{14}_[a-z_]+\.sql/;

test('the changelog text of mcp-server 0.3.6 and of the release that is not published yet (0.3.7) names no private pull request, internal ticket or website migration file', () => {
    const changelog = readFileSync(join(PACKAGE, '..', '..', 'CHANGELOG.md'), 'utf8');
    const sections = { 'mcp-server 0.3.6': changelogSection(changelog, '## [mcp-server 0.3.6]'), 'Unreleased': changelogSection(changelog, '## [Unreleased]') };
    assert.match(sections.Unreleased, /\*\*mcp-server\*\* \(0\.3\.7\)/, 'the 0.3.7 entry is inside the section that is scanned');
    for (const [name, text] of Object.entries(sections)) {
        const found = PRIVATE_REFERENCE.exec(text);
        assert.equal(found, null, `${name}: "${found?.[0]}" near "${found ? text.slice(Math.max(0, found.index - 40), found.index + 40).replace(/\s+/g, ' ') : ''}"`);
    }
});

test('wherever the key page\'s button is named, both of its labels are: "Generate key" (no key yet) and "Rotate key" (once the account has one)', () => {
    for (const path of ['README.md', 'src/workspace-api.ts']) {
        const lines = read(path).split('\n').filter(line => line.includes('Generate key'));
        assert.ok(lines.length > 0, `${path} names the button`);
        for (const line of lines) assert.match(line, /Rotate key/, `${path}: ${line.trim().slice(0, 90)}`);
    }
});

test('the README says the https-only rule for PROMETHEUS_API_URL belongs to the workspace tools, not to every tool', () => {
    const rows = read('README.md').split('\n').filter(line => line.startsWith('| `PROMETHEUS_API_URL`'));
    assert.equal(rows.length, 2, 'one row in English, one in Chinese');
    assert.match(rows[0], /workspace tools/);
    assert.match(rows[1], /工作区工具/);
});

// POST /api/agent/speak answers audio to the caller and does not make an open embed speak (the website's llms.txt says
// the same). The tool's description and its README row must not promise that the avatar plays it with lip-sync.
test('the speak tool says it returns audio to the caller and does not promise lip-sync playback', () => {
    const source = read('src/index.ts');
    const description = source.match(/registerTool\(\s*"speak",\s*"([^"]+)"/)?.[1];
    assert.ok(description, 'the speak tool description was not found');
    assert.doesNotMatch(description, /played with lip-sync|lip-sync animation/i, 'tool description');
    assert.match(description, /returns? the audio/i, 'tool description says the audio comes back to the caller');
    assert.match(description, /does not make an open embed speak/i, 'tool description says the embed is not driven');
    const row = read('README.md').split('\n').find(line => line.startsWith('| `speak` |'));
    assert.ok(row, 'README has a speak row');
    assert.doesNotMatch(row, /lip-sync animation/i, 'README speak row');
    assert.match(row, /audio/i, 'README speak row says it returns audio');
});
