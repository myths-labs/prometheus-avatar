// What `npm publish` / `pnpm publish` would put on npm for @prometheusavatar/openclaw-plugin, asked from npm itself
// (`npm pack --dry-run --json`). Exactly this list: 0.10.2 went out without LICENSE, and nothing a test run leaves
// behind or an .env file may ever slip in. Runs after `npm run build` (see the test script), so dist/ exists.
// The plugin ships its TypeScript source and its bundled skill on purpose (the `files` field lists src and skills),
// so adding or removing one of those files changes this list: edit it here in the same change, that edit is the review.
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
    assert.equal(packed.name, '@prometheusavatar/openclaw-plugin');
    return packed.files.map(file => file.path).sort();
}

test('the published package is exactly LICENSE, README.md, package.json, the plugin manifest, the bundled skill, the source and the built dist', () => {
    assert.deepEqual(packedFiles(), [
        'LICENSE',
        'README.md',
        'dist/index.js',
        'openclaw.plugin.json',
        'package.json',
        'skills/prometheus-avatar/SKILL.md',
        'src/index.ts',
        'tsconfig.json',
    ]);
});

test('the shipped LICENSE is the same MIT licence text as the repository root', () => {
    assert.equal(readFileSync(join(PACKAGE, 'LICENSE'), 'utf8'), readFileSync(join(PACKAGE, '..', '..', 'LICENSE'), 'utf8'));
});

test('no env file, test build output, state folder or dependency folder is published', () => {
    const leaked = packedFiles().filter(path => /(^|\/)(\.env[^/]*|\.test-build|\.e2e-evidence|\.state|state|tests?|node_modules)(\/|$)/.test(path));
    assert.deepEqual(leaked, []);
});
