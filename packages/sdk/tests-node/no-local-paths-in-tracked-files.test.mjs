// No tracked file may carry a path from a maintainer's machine. Generated files are the usual way in:
// typedoc once linked type sources through a sibling working tree (`../<tree>/node_modules/...`)
// because node_modules there was a symlink. Docs are to be generated in a clean checkout; this test
// catches the slip anyway, in every tracked text file of the repository, generated docs included.
// .gitignore is skipped: its patterns name local folders on purpose. This file is skipped because it
// spells the patterns.
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
const SKIP = new Set(['.gitignore', self]);

// Absolute home and volume paths, local working-tree folders, and sibling trees reached by a relative path.
const LOCAL_PATH = [
    /\/Users\/[A-Za-z0-9._-]+\//,
    /\/Volumes\/[A-Za-z0-9._-]+\//,
    /\/home\/[A-Za-z0-9._-]+\//,
    /[A-Za-z]:\\Users\\/,
    /\/worktrees\//,
    /\.codex\//,
    /\.claude\/worktrees/,
    /Prometheus(?:SSD|Dev)\b/,
    /\.\.\/[a-z0-9]+(?:-[a-z0-9]+)+\/node_modules\//,
];

function trackedTextFiles() {
    const listed = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
    const files = [];
    for (const path of listed) {
        if (SKIP.has(path)) continue;
        let text;
        try { text = readFileSync(join(repoRoot, path), 'utf8'); } catch { continue; }
        if (text.includes('\0')) continue; // binary
        files.push({ path, text });
    }
    return files;
}

test('no tracked file carries a path from a maintainer machine or a sibling working tree', () => {
    const hits = [];
    for (const { path, text } of trackedTextFiles()) {
        text.split('\n').forEach((line, index) => {
            for (const pattern of LOCAL_PATH) {
                const found = line.match(pattern);
                if (found) { hits.push(`${path}:${index + 1}: ${found[0]}`); break; }
            }
        });
    }
    assert.deepEqual(hits, [], `local paths in tracked files:\n${hits.slice(0, 40).join('\n')}`);
});

test('the patterns catch the shapes that leaked before, and leave ordinary relative links alone', () => {
    const leaks = ['href="../desk-k10-mcp/node_modules/pixi.js/lib/index.d.ts"', '/Users/someone/src/x.ts', '/Volumes/Drive/app/x.ts', 'C:\\Users\\someone\\x.ts'];
    for (const sample of leaks) assert.ok(LOCAL_PATH.some(pattern => pattern.test(sample)), sample);
    const fine = ['href="../classes/MemoryBridge.html"', '[docs](../docs/README.md)', 'https://github.com/myths-labs/prometheus-avatar/blob/main/packages/sdk/src/memory-bridge.ts'];
    for (const sample of fine) assert.ok(!LOCAL_PATH.some(pattern => pattern.test(sample)), sample);
});
