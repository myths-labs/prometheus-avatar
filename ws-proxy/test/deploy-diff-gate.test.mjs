import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
    const r = spawnSync(process.execPath, [GATE, '--live', live, '--candidate', candidate, '--declared', declared, '--skip-version-check'], {encoding: 'utf8', env: {...process.env, DEPLOY_GATE_ALLOW_SKIP: '1'}});
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

const V = '177bbb8a-c1c6-495d-b27c-158e9c9371c4';
const LISTING = `Created:     2026-10-13T09:51:31.828Z\nSource:      Unknown (deployment)\nVersion(s):  (100%) 131ce8ed-5b7c-48df-95d2-8467a58ae2f4\n                 Created:  x\n\nCreated:     2026-11-07T10:00:00.000Z\nVersion(s):  (100%) ${V}\n                 Created:  y\n`;
const sha = (t) => createHash('sha256').update(t).digest('hex');
// A trusted wrangler lives OUTSIDE the candidate tree. bin/wrangler.js is what the gate runs with node; here it prints a fixed
// deployments listing and, when asked, dumps its environment so a test can see what the gate passed on.
function trustedWrangler(listing, envDump) {
    const root = mk({'README': 'trusted runner tree'});
    const bin = `import {writeFileSync} from 'node:fs';\n${envDump ? `writeFileSync(${JSON.stringify(envDump)}, JSON.stringify(process.env));\n` : ''}process.stdout.write(${JSON.stringify(listing)});\n`;
    const dir = join(root, 'node_modules', 'wrangler');
    mkdirSync(join(dir, 'bin'), {recursive: true}); mkdirSync(join(dir, 'wrangler-dist'), {recursive: true});
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name: 'wrangler', version: '9.9.9'}));
    writeFileSync(join(dir, 'bin', 'wrangler.js'), bin);
    writeFileSync(join(dir, 'wrangler-dist', 'cli.js'), '// cli');
    return {root, pin: ['--wrangler-root', root, '--wrangler-version', '9.9.9', '--wrangler-bin-sha256', sha(bin), '--wrangler-cli-sha256', sha('// cli')]};
}
function gateReal(live, candidate, declared, version, pin, env) {
    const r = spawnSync(process.execPath, [GATE, '--live', live, '--candidate', candidate, '--declared', declared, ...(version === undefined ? [] : ['--expect-version', version]), ...(pin ?? [])], {encoding: 'utf8', env: env ?? process.env});
    return {code: r.status, out: r.stdout};
}

test('run through a symlink the gate still runs (it used to exit 0 without a GATE line)', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2'});
    const dir = mkdtempSync(join(tmpdir(), 'gate-link-')); made.push(dir);
    mkdirSync(join(dir, 'scripts')); symlinkSync(GATE, join(dir, 'scripts', 'gate.mjs'));
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'gate.mjs'), '--live', live, '--candidate', cand, '--declared', 'src/asr-meter.ts', '--skip-version-check'], {encoding: 'utf8', env: {...process.env, DEPLOY_GATE_ALLOW_SKIP: '1'}});
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /GATE: FAIL/);
});

test('a split (gradual) newest deployment cannot be verified: null; an old 100% line before it does not count', () => {
    const split = `${LISTING}\nCreated:     2026-11-14T10:00:00.000Z\nVersion(s):  (50%) aaaaaaaa-c1c6-495d-b27c-158e9c9371c4\n             (50%) ${V}\n`;
    assert.equal(latestDeployedVersion(split), null);
    assert.equal(latestDeployedVersion(LISTING), V);
});

test('the version check needs the full version id and the exact one, read through the pinned wrangler', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2'});
    const t = trustedWrangler(LISTING);
    assert.equal(gateReal(live, cand, 'src/index.ts', V, t.pin).code, 0);
    for (const bad of ['1', '177bbb8a', undefined, '177bbb8a-c1c6-495d-b27c-158e9c9371c5']) {
        const r = gateReal(live, cand, 'src/index.ts', bad, t.pin);
        assert.equal(r.code, 1, `expect-version ${bad}`);
        assert.match(r.out, /VERSION CHECK/);
    }
    const split = trustedWrangler(`${LISTING}\nCreated:     2026-11-14T10:00:00.000Z\nVersion(s):  (50%) aaaaaaaa-c1c6-495d-b27c-158e9c9371c4\n             (50%) ${V}\n`);
    assert.equal(gateReal(live, cand, 'src/index.ts', V, split.pin).code, 1, 'a gradual rollout since: stop');
});

test('a wrangler planted in the candidate tree is never run (relay1129 must-fix 3)', () => {
    const marker = join(tmpdir(), `gate-planted-${process.pid}-${Date.now()}`);
    made.push(marker);
    const planted = `import {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'RAN');\nprocess.stdout.write(${JSON.stringify(LISTING)});\n`;
    const live = mk(BASE);
    const cand = mk({...BASE, 'src/index.ts': 'index v2', 'node_modules/wrangler/package.json': JSON.stringify({name: 'wrangler', version: '9.9.9'}), 'node_modules/wrangler/bin/wrangler.js': planted, 'node_modules/wrangler/wrangler-dist/cli.js': '// cli', 'node_modules/.bin/wrangler': `#!/bin/sh\ntouch ${marker}\n`});
    // the pin is the real wrangler's, so the candidate's planted files cannot match it
    const pin = ['--wrangler-version', '9.9.9', '--wrangler-bin-sha256', sha('the real bin'), '--wrangler-cli-sha256', sha('the real cli')];
    const r = gateReal(live, cand, 'src/index.ts', V, pin);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /WRANGLER NOT TRUSTED/);
    assert.equal(existsSync(marker), false, 'the planted wrangler ran');
});

test('a wrangler root that does not hash to the pin is refused', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2'});
    const t = trustedWrangler(LISTING);
    const wrong = [...t.pin]; wrong[wrong.indexOf('--wrangler-cli-sha256') + 1] = sha('another cli');
    const r = gateReal(live, cand, 'src/index.ts', V, wrong);
    assert.equal(r.code, 1);
    assert.match(r.out, /WRANGLER NOT TRUSTED: wrangler-dist\/cli.js does not match/);
    const noPin = gateReal(live, cand, 'src/index.ts', V, []);
    assert.equal(noPin.code, 1);
    assert.match(noPin.out, /WRANGLER NOT TRUSTED/);
});

test('the pinned wrangler gets a whitelist environment: no CLOUDFLARE_* credentials, no NODE_OPTIONS', () => {
    const dump = join(tmpdir(), `gate-env-${process.pid}-${Date.now()}.json`); made.push(dump);
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2'});
    const t = trustedWrangler(LISTING, dump);
    const env = {...process.env, CLOUDFLARE_API_TOKEN: 'tok-secret', CLOUDFLARE_ACCOUNT_ID: 'acct', CF_API_KEY: 'k', NODE_OPTIONS: '--no-warnings', GITHUB_TOKEN: 'gh'};
    assert.equal(gateReal(live, cand, 'src/index.ts', V, t.pin, env).code, 0);
    const seen = JSON.parse(readFileSync(dump, 'utf8'));
    // macOS adds __CF_USER_TEXT_ENCODING to every process (an encoding hint, not a credential); allowed on darwin only.
    const allowed = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_CONFIG_HOME', ...(process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [])];
    for (const k of Object.keys(seen)) assert.ok(allowed.includes(k), `unexpected env ${k}`);
    for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CF_API_KEY', 'NODE_OPTIONS', 'GITHUB_TOKEN']) assert.equal(seen[k], undefined, k);
    assert.equal(seen.CLOUDFLARE_API_TOKEN, undefined);
});

test('--skip-version-check is refused unless the test switch is set (relay1129 item 6)', () => {
    const live = mk(BASE), cand = mk({...BASE, 'src/index.ts': 'index v2'});
    const base = [GATE, '--live', live, '--candidate', cand, '--declared', 'src/index.ts', '--skip-version-check'];
    const env = {...process.env}; delete env.DEPLOY_GATE_ALLOW_SKIP;
    const r = spawnSync(process.execPath, base, {encoding: 'utf8', env});
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /--skip-version-check is refused/);
});

test('two empty or wrong-root trees do not pass as "nothing changed"', () => {
    const empty1 = mk({'README': 'x'}), empty2 = mk({'README': 'y'});
    const r = gate(empty1, empty2, '');
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT A WS-PROXY TREE: live has no src\/index\.ts/);
    const live = mk(BASE);
    assert.equal(gate(live, empty2, '').code, 1);
    assert.match(gate(live, empty2, '').out, /NOT A WS-PROXY TREE: candidate/);
});
