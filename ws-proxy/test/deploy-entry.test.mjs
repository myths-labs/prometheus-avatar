import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deploy, assertCommitId} from '../scripts/deploy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts', 'deploy-manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function fakes(gateCode) {
    const calls = [];
    return {calls, deps: {
        liveTree: () => '/live', log: () => {},
        gate: (a) => { calls.push(['gate', a]); return {code: gateCode, lines: ['GATE']}; },
        wrangler: () => { calls.push(['wrangler']); return {entry: '/trusted/bin/wrangler.js'}; },
        spawn: (cmd, args, opts) => { calls.push(['spawn', args, opts]); return {status: 0}; },
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

test('EVAL 1157-1: the real deploy spawn gets the whitelist environment, not this process\'s', () => {
    const saved = {...process.env};
    Object.assign(process.env, {NODE_OPTIONS: '--require /evil.js', GITHUB_TOKEN: 'ghp_x', npm_config_registry: 'https://evil', CLOUDFLARE_API_TOKEN: 'cf', CF_API_KEY: 'cf'});
    try {
        const f = fakes(0);
        assert.equal(deploy({manifest, candidate: '/c', deps: f.deps}), 0);
        const opts = f.calls.find((c) => c[0] === 'spawn')[2];
        assert.ok(opts.env && typeof opts.env === 'object', 'an explicit env is passed');
        for (const k of Object.keys(opts.env)) {
            assert.doesNotMatch(k, /^(NODE_OPTIONS|GITHUB_TOKEN|npm_config_.*|CLOUDFLARE_.*|CF_.*)$/i, `${k} reached wrangler deploy`);
        }
        assert.equal(opts.env.HOME, process.env.HOME, 'HOME (where the operator\'s wrangler login lives) is kept');
    } finally {
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
    }
});

test('EVAL 1157-2: a liveCommit that is not a hex id throws before any command runs, and its shell text never executes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-1157-'));
    const x = join(dir, 'X');
    try {
        const calls = [];
        const deps = {log: () => {}, gate: () => { calls.push('gate'); return {code: 0, lines: []}; }, wrangler: () => { calls.push('wrangler'); return {entry: '/w'}; }, spawn: () => { calls.push('spawn'); return {status: 0}; }};
        for (const bad of [`HEAD; touch ${x} #`, `$(touch ${x})`, 'HEAD', '99b88a6', '', null]) {
            if (bad === '99b88a6') continue; // a valid short id is not refused (checked below)
            assert.throws(() => deploy({manifest: {...manifest, liveCommit: bad}, candidate: ROOT, deps}), /not a 7-40 hex commit id/);
        }
        assert.equal(existsSync(x), false, 'the injected touch never ran');
        assert.deepEqual(calls, [], 'neither the gate nor wrangler was reached');
        assert.equal(assertCommitId('99b88a63'), '99b88a63');
        assert.equal(assertCommitId('a'.repeat(40)), 'a'.repeat(40));
        assert.throws(() => assertCommitId('A'.repeat(8)));
        assert.throws(() => assertCommitId('a'.repeat(41)));
    } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('EVAL 1157-2: extractLiveTree runs no shell (argument arrays only)', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'deploy.mjs'), 'utf8');
    assert.doesNotMatch(src, /spawnSync\(\s*['"](sh|bash|zsh)['"]/);
    assert.doesNotMatch(src, /['"]-c['"]/);
    assert.match(src, /assertCommitId\(commit\);\n\s*\/\/ Argument arrays only/);
});

test('EVAL 1157-3: the header says what the gate does not guard against, and points to the checklist', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'deploy.mjs'), 'utf8');
    assert.doesNotMatch(src, /never one from the tree/);
    assert.match(src, /Not a hostile tree/);
    assert.match(src, /PRECONDITIONS\.md/);
});
