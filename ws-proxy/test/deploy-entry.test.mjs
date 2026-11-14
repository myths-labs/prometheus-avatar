import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deploy} from '../scripts/deploy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts', 'deploy-manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function fakes(gateCode) {
    const calls = [];
    return {calls, deps: {
        liveTree: () => '/live', log: () => {},
        gate: (a) => { calls.push(['gate', a]); return {code: gateCode, lines: ['GATE']}; },
        wrangler: () => { calls.push(['wrangler']); return {entry: '/trusted/bin/wrangler.js'}; },
        spawn: (cmd, args) => { calls.push(['spawn', args]); return {status: 0}; },
    }};
}

test('a failing gate means wrangler deploy is never started', () => {
    const f = fakes(1);
    assert.equal(deploy({manifest, candidate: '/c', deps: f.deps}), 1);
    assert.deepEqual(f.calls.map((c) => c[0]), ['gate']);
});

test('a passing gate runs the pinned wrangler deploy, after the gate', () => {
    const f = fakes(0);
    assert.equal(deploy({manifest, candidate: '/c', deps: f.deps}), 0);
    assert.deepEqual(f.calls.map((c) => c[0]), ['gate', 'wrangler', 'spawn']);
    assert.deepEqual(f.calls[2][1], ['/trusted/bin/wrangler.js', 'deploy']);
    const a = f.calls[0][1];
    assert.equal(a.skipVersionCheck, false, 'the deploy entry never skips the version check');
    assert.equal(a.expectVersion, manifest.liveVersion);
});

test('--check-only stops after the gate', () => {
    const f = fakes(0);
    assert.equal(deploy({checkOnly: true, manifest, candidate: '/c', deps: f.deps}), 0);
    assert.deepEqual(f.calls.map((c) => c[0]), ['gate']);
});

test('npm run deploy IS the gated entry, and no package script runs wrangler deploy directly', () => {
    assert.equal(pkg.scripts.deploy, 'node scripts/deploy.mjs');
    for (const [name, cmd] of Object.entries(pkg.scripts)) assert.doesNotMatch(cmd, /wrangler\s+deploy/, `script ${name} bypasses the gate`);
});

test('static: in deploy.mjs the gate call comes before the only deploy spawn, and the version check is never skipped', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'deploy.mjs'), 'utf8');
    const gateAt = src.indexOf('d.gate('), spawnAt = src.indexOf("'deploy']");
    assert.ok(gateAt > 0 && spawnAt > gateAt);
    assert.equal(src.split("'deploy']").length - 1, 1, 'exactly one deploy spawn');
    assert.doesNotMatch(src, /skipVersionCheck:\s*true/);
});

test('the manifest pins the live version, a full wrangler hash set, and declares package.json for the deploy script change', () => {
    assert.match(manifest.liveVersion, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    for (const k of ['binSha256', 'cliSha256']) assert.match(manifest.wrangler[k], /^[0-9a-f]{64}$/);
    assert.ok(manifest.declared.includes('package.json'));
    assert.ok(existsSync(join(ROOT, 'scripts', 'trusted-wrangler.mjs')));
});
