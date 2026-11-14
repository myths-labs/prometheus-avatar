import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {changedFiles, checkDiff, latestDeployedVersion} from '../scripts/deploy-diff-gate.mjs';

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'deploy-diff-gate.mjs');
const BASE = {
    'src/index.ts': 'index v1', 'src/asr-meter.ts': 'asr-meter v1', 'wrangler.toml': 'name = "x"',
    'package.json': '{}', 'package-lock.json': '{}', 'tsconfig.json': '{}', 'test/a.test.mjs': 't1', 'scripts/s.mjs': 's1',
};
function tree(files) {
    const root = mkdtempSync(join(tmpdir(), 'gate-'));
    for (const [f, c] of Object.entries(files)) { mkdirSync(dirname(join(root, f)), {recursive: true}); writeFileSync(join(root, f), c); }
    return root;
}
function gate(live, candidate, declared) {
    const r = spawnSync(process.execPath, [GATE, '--live', live, '--candidate', candidate, '--declared', declared, '--skip-version-check'], {encoding: 'utf8'});
    return {code: r.status, out: r.stdout};
}
const made = [];
const mk = (f) => { const t = tree(f); made.push(t); return t; };
test.after(() => { for (const t of made) rmSync(t, {recursive: true, force: true}); });

test('a clean declared change passes', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2'});
    const r = gate(live, cand, 'src/index.ts');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /GATE: PASS/);
});

test('an undeclared src file that differs fails and is named', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2', 'src/asr-meter.ts': 'asr-meter v2'});
    const r = gate(live, cand, 'src/index.ts');
    assert.equal(r.code, 1);
    assert.match(r.out, /UNDECLARED CHANGE: src\/asr-meter\.ts/);
});

test('the 11-07 case: live has B-167 in asr-meter.ts, the candidate lacks it, asr-meter.ts undeclared', () => {
    const live = mk({...BASE, 'src/asr-meter.ts': 'asr-meter WITH B-167'}), cand = mk({...BASE, 'src/index.ts': 'index iris slot'});
    const r = gate(live, cand, 'src/index.ts');
    assert.equal(r.code, 1);
    assert.match(r.out, /UNDECLARED CHANGE: src\/asr-meter\.ts/);
});

test('a declared file that did not change fails and is named', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2'});
    const r = gate(live, cand, 'src/index.ts src/asr-meter.ts');
    assert.equal(r.code, 1);
    assert.match(r.out, /DECLARED BUT UNCHANGED: src\/asr-meter\.ts/);
});

test('a new or deleted deployable file counts as a change; config files are deployable too', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/new.ts': 'n', 'wrangler.toml': 'name = "y"'});
    assert.deepEqual(changedFiles(live, cand), ['src/new.ts', 'wrangler.toml']);
    assert.equal(checkDiff({liveRoot: live, candidateRoot: cand, declared: ['src/new.ts']}).length, 1);
    const gone = mk({'src/index.ts': 'index v1'});
    assert.ok(changedFiles(live, gone).includes('src/asr-meter.ts'));
});

test('test/ and scripts/ changes are ignored', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2', 'test/a.test.mjs': 't2', 'test/new.test.mjs': 'n', 'scripts/s.mjs': 's2'});
    const r = gate(live, cand, 'src/index.ts');
    assert.equal(r.code, 0, r.out);
});

test('the version check reads the newest 100% version from wrangler deployments list output', () => {
    const out = `Created:     2026-10-13T09:51:31.828Z\nSource:      Unknown (deployment)\nVersion(s):  (100%) 131ce8ed-5b7c-48df-95d2-8467a58ae2f4\n   Created: x\n\nCreated:     2026-11-07T10:00:00.000Z\nVersion(s):  (100%) 177bbb8a-c1c6-495d-b27c-158e9c9371c4\n   Created: y\n`;
    assert.equal(latestDeployedVersion(out), '177bbb8a-c1c6-495d-b27c-158e9c9371c4');
    assert.equal(latestDeployedVersion('nothing'), null);
});

test('without --skip-version-check and without --expect-version the gate fails', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2'});
    const r = spawnSync(process.execPath, [GATE, '--live', live, '--candidate', cand, '--declared', 'src/index.ts'], {encoding: 'utf8'});
    assert.equal(r.status, 1);
    assert.match(r.stdout, /VERSION CHECK/);
});
