// What `npm publish` / `pnpm publish` would put on npm for @prometheusavatar/core, asked from npm itself
// (`npm pack --dry-run --json`). Exactly five files: 0.11.4 went out with four, without LICENSE, and nothing a test
// run leaves behind or an .env file may ever slip in. Runs after `npm run build` (see the test:package script), so dist/ exists.
// This package keeps its vitest suites in tests/ (a .ts-only include); this node:test file lives in test/ on purpose,
// the same split packages/mcp-server uses, so vitest never tries to load it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

function packedFiles() {
    const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'],
        { cwd: PACKAGE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const [packed] = JSON.parse(output);
    assert.equal(packed.name, '@prometheusavatar/core');
    return packed.files.map(file => file.path).sort();
}

test('the published package is exactly LICENSE, README.md, package.json and the built dist', () => {
    assert.deepEqual(packedFiles(), ['LICENSE', 'README.md', 'dist/index.d.ts', 'dist/index.js', 'package.json']);
});

test('the shipped LICENSE is the same MIT licence text as the repository root', () => {
    assert.equal(readFileSync(join(PACKAGE, 'LICENSE'), 'utf8'), readFileSync(join(PACKAGE, '..', '..', 'LICENSE'), 'utf8'));
});

test('no env file, test build output, state folder, docs or dependency folder is published', () => {
    const leaked = packedFiles().filter(path => /(^|\/)(\.env[^/]*|\.test-build|\.e2e-evidence|\.state|state|docs|tests?|node_modules)(\/|$)/.test(path));
    assert.deepEqual(leaked, []);
});
