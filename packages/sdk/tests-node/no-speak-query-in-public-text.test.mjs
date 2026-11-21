// Public text must not recommend `?speak=` on an embed URL. The embed page is dropping the query-string
// greeting (anything that can put text in the address could make an avatar talk on someone else's page),
// so the supported way to greet is to call `embed.speak(...)` after the avatar has loaded; the bridge
// already holds a speak until `prometheus:loaded`.
// Scope: every tracked text file (README, generated docs, source comments, skills, changelog, tests).
// Allowed: this file (it spells the patterns), the tests that assert the plugin never builds such an
// address, and CHANGELOG lines that say it is no longer suggested.
// Run: node --test packages/sdk/tests-node/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const self = relative(repoRoot, fileURLToPath(import.meta.url));

// Files that mention the query string only to assert it is absent (or to feed it to a validator as bad input).
const ASSERTS_ABSENCE = [
    'packages/openclaw-plugin/test/hosted-avatar.test.mjs',
    'packages/sdk/tests-node/plugin-hosted-avatar-docs.test.mjs',
];
const SKIP = new Set([self, ...ASSERTS_ABSENCE]);

// The query string in any spelling that puts `speak` into an address.
const SPEAK_IN_ADDRESS = [
    /\bspeak=/i,
    /[?&]speak\b/i,
    /searchParams\.(?:set|append)\(\s*['"`]speak['"`]/,
    /URLSearchParams\(\s*\{[^}]*\bspeak\b/,
];
const NO_LONGER = /\bno longer (?:suggest|recommend|advis)/i;

const hasSpeakInAddress = (line) => SPEAK_IN_ADDRESS.some((pattern) => pattern.test(line));

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

test('no tracked public text recommends `?speak=` on an embed URL', () => {
    const hits = [];
    for (const { path, text } of trackedTextFiles()) {
        text.split('\n').forEach((line, index) => {
            if (!hasSpeakInAddress(line)) return;
            if (path === 'CHANGELOG.md' && NO_LONGER.test(line)) return;
            hits.push(`${path}:${index + 1}: ${line.trim().slice(0, 140)}`);
        });
    }
    assert.deepEqual(hits, [], `\`?speak=\` is recommended (or spelled) in:\n${hits.slice(0, 40).join('\n')}`);
});

test('the patterns catch the spellings that were published, and leave the supported call alone', () => {
    const bad = [
        "frame.src = `${embedUrl}?speak=${encodeURIComponent('Hi there!')}`; // greet on load",
        "frame.src = embedUrl + '?speak=' + encodeURIComponent('Hi there');",
        'To greet on load, put `?speak=` on the embed URL.',
        '`?speak=Hello` makes it greet on load.',
        'https://prometheus.mythslabs.ai/embed/abc123?speak=Hi',
        'https://prometheus.mythslabs.ai/embed/abc123?ref=x&speak=Hi',
        "url.searchParams.set('speak', text);",
        "new URLSearchParams({ speak: text })",
    ];
    for (const sample of bad) assert.ok(hasSpeakInAddress(sample), sample);
    const fine = [
        "embed.speak('Here is what I found.'); // held until the avatar has loaded",
        'https://prometheus.mythslabs.ai/embed/abc123?ref=x',
        '`speak` is held until `prometheus:loaded`.',
        'onspeak=handler',
    ];
    for (const sample of fine) assert.ok(!hasSpeakInAddress(sample), sample);
});

test('the only changelog lines that may spell it say it is no longer suggested', () => {
    assert.ok(NO_LONGER.test('embed docs no longer suggest `?speak=` (the embed page is dropping it)'));
    assert.ok(!NO_LONGER.test('To greet on load, put `?speak=` on the embed URL.'));
    assert.ok(!NO_LONGER.test('embed docs suggest `?speak=`'));
});

test('every allowed file exists, so a rename cannot leave a stale exemption', () => {
    for (const path of ASSERTS_ABSENCE) assert.ok(existsSync(join(repoRoot, path)), path);
});
