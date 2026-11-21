// What `npm publish` / `pnpm publish` would put on npm, asked from npm itself (`npm pack --dry-run --json`).
// Exactly five files: the 0.3.6 candidate once shipped without LICENSE, and nothing a test run leaves behind (.test-build,
// state folders) or an .env file may ever slip in. Runs after `npm run build` (see the test script), so dist/ exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

test('the published package is exactly LICENSE, README.md, package.json and the built dist', () => {
    const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'],
        { cwd: PACKAGE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const [packed] = JSON.parse(output);
    assert.equal(packed.name, '@prometheusavatar/mcp-server');
    assert.deepEqual(packed.files.map(file => file.path).sort(), ['LICENSE', 'README.md', 'dist/index.d.ts', 'dist/index.js', 'package.json']);
    assert.equal(readFileSync(join(PACKAGE, 'LICENSE'), 'utf8'), readFileSync(join(PACKAGE, '..', '..', 'LICENSE'), 'utf8'),
        'the same MIT licence text as the repository root');
});
