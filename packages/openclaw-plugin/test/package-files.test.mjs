// What `npm publish` / `pnpm publish` would put on npm for @prometheusavatar/openclaw-plugin, asked from npm itself
// (`npm pack --dry-run --json`). 0.10.2 went out without LICENSE, and nothing a test run leaves behind or an .env
// file may ever slip in. Runs after `npm run build` (see the test script), so dist/ exists.
// The plugin ships its TypeScript source and its bundled skill on purpose (`files` lists src and skills), so the
// layout is pinned at the top level only: which files and folders sit at the package root. The files inside those
// folders are not listed, so adding a source file or a skill document needs no edit here. What may never be
// published is checked against every packed path, however deep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

function packedPaths() {
    const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'],
        { cwd: PACKAGE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const [packed] = JSON.parse(output);
    assert.equal(packed.name, '@prometheusavatar/openclaw-plugin');
    return packed.files.map(file => file.path).sort();
}

// A folder at the package root is written with a trailing slash, so a file that happens to share a folder's name
// cannot stand in for it.
function topLevelEntries(paths) {
    return [...new Set(paths.map(path => (path.includes('/') ? `${path.split('/')[0]}/` : path)))].sort();
}

test('the package root holds exactly LICENSE, README.md, package.json, the plugin manifest, tsconfig.json and the dist, src and skills folders', () => {
    assert.deepEqual(topLevelEntries(packedPaths()), [
        'LICENSE',
        'README.md',
        'dist/',
        'openclaw.plugin.json',
        'package.json',
        'skills/',
        'src/',
        'tsconfig.json',
    ]);
});

test('the shipped LICENSE is the same MIT licence text as the repository root', () => {
    assert.equal(readFileSync(join(PACKAGE, 'LICENSE'), 'utf8'), readFileSync(join(PACKAGE, '..', '..', 'LICENSE'), 'utf8'));
});

test('no env file, test build output, state folder, test folder or dependency folder is published, at any depth', () => {
    const leaked = packedPaths().filter(path => /(^|\/)(\.env[^/]*|\.test-build|\.e2e-evidence|\.state|state|tests?|node_modules)(\/|$)/.test(path));
    assert.deepEqual(leaked, []);
});
