// The image tools no longer offer reference pictures: the service refuses a picture sent with an image request (HTTP 400
// REFERENCE_IMAGE_NOT_ACCEPTED, nothing charged), so no public text may describe the parameter as something a caller can use.
// Scope: every tracked text file (README, generated API reference, source, tool descriptions, skills).
// A line that names the old parameter must say it is not supported (`never`, "Not supported", "not accepted", "is refused",
// "no longer", "has no"). Allowed without that: this file (it spells the names) and CHANGELOG.md (it records the removal).
// Run: node --test packages/sdk/tests-node/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const self = relative(repoRoot, fileURLToPath(import.meta.url));
const SKIP = new Set([self, 'CHANGELOG.md']);

// The names under which the old parameter was offered, and the phrase that described it.
const OFFERS = [/\breference_images\b/, /\breferenceImages\b/, /character consistency chain/i];
const SAYS_NOT_SUPPORTED = /\bnever\b|\bNot supported\b|\bnot accepted\b|\bis refused\b|\bno longer\b|\bhas no\b/i;

function trackedTextFiles() {
    const listed = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
    const files = [];
    for (const path of listed) {
        if (SKIP.has(path)) continue;
        let text;
        try { text = readFileSync(join(repoRoot, path), 'utf8'); } catch { continue; } // directories (submodule paths), unreadable
        if (text.includes('\0')) continue; // binary
        files.push({ path, text });
    }
    return files;
}

test('no tracked public text offers reference pictures on the image tools', () => {
    const hits = [];
    for (const { path, text } of trackedTextFiles()) {
        text.split('\n').forEach((line, index) => {
            if (!OFFERS.some((pattern) => pattern.test(line))) return;
            if (SAYS_NOT_SUPPORTED.test(line)) return;
            hits.push(`${path}:${index + 1}: ${line.trim().slice(0, 140)}`);
        });
    }
    assert.deepEqual(hits, [], `a reference-picture parameter is offered in:\n${hits.slice(0, 40).join('\n')}`);
});

test('the three packages keep no reference-picture parameter on the image tools', () => {
    const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');
    // MCP tool: no input field, nothing forwarded.
    assert.doesNotMatch(read('packages/mcp-server/src/index.ts'), /reference_images|referenceImages/);
    // OpenClaw tool: no input property, nothing passed to createImage.
    assert.doesNotMatch(read('packages/openclaw-plugin/src/index.ts'), /referenceImages|reference_images/);
    // Core: the option is typed `never` (a TypeScript caller is told), and the README has no row for it.
    assert.match(read('packages/sdk/src/creator.ts'), /^\s*referenceImages\?: never;$/m);
    assert.doesNotMatch(read('packages/sdk/README.md'), /^\|\s*`referenceImages`/m);
    assert.doesNotMatch(read('packages/sdk/docs/index.html'), /<td><code>referenceImages<\/code><\/td>/);
});

test('the check can fail: each old spelling is caught, and a line that says it is not supported passes', () => {
    const caught = (line) => OFFERS.some((pattern) => pattern.test(line)) && !SAYS_NOT_SUPPORTED.test(line);
    assert.ok(caught('| `referenceImages` | `string[]` | none | Data URLs or HTTPS URLs. |'));
    assert.ok(caught('reference_images: z.array(z.string()).optional().describe("Reference image URLs"),'));
    assert.ok(caught('Data URLs or HTTPS URLs · character consistency chain across multiple calls.'));
    assert.ok(!caught('referenceImages?: never;'));
    assert.ok(!caught('Reference pictures are not accepted: a picture sent (`referenceImages` or any other image field) is refused.'));
});
