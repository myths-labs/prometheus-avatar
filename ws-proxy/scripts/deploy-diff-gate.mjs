#!/usr/bin/env node
// Deploy diff gate for ws-relay-proxy: the files a deploy changes must be exactly the files it declares.
//
// Why: the 2026-11-07 deploy was built from a tree that lacked B-167 (src/asr-meter.ts) and silently reverted it,
// because nothing compared the candidate against what was live. This gate compares the deployable inputs of the
// candidate tree with the live tree (the source commit recorded for the live version) and fails when
//   - a deployable file differs and is not declared, or
//   - a declared file did not change.
// It then asks the PINNED wrangler (trusted-wrangler.mjs: version and file hashes; never a wrangler the candidate tree
// brings, never CI credentials in its environment) for the read-only `deployments list`, and stops if the latest version is
// not the recorded one (someone deployed in between). It reads no credentials: wrangler uses its own login.
//
// Usage: node scripts/deploy-diff-gate.mjs --live <dir> --candidate <dir> --declared "a b c"
//          --expect-version <full version id> [--skip-version-check]   (the flag is for tests only)
// <dir> is the ws-proxy directory of each tree (e.g. `git archive <sha> ws-proxy` extracted, then /ws-proxy).
import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { resolveTrustedWrangler, runTrustedWrangler } from './trusted-wrangler.mjs';
import { fileURLToPath } from 'node:url';

const DEPLOYABLE_FILES = ['wrangler.toml', 'package.json', 'package-lock.json', 'tsconfig.json'];
const DEPLOYABLE_DIRS = ['src'];

function walk(root, dir, out) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(root, full, out);
        else out.push(relative(root, full).split(sep).join('/'));
    }
}

/** The deployable inputs under a ws-proxy directory (src/**, wrangler.toml, package*.json, tsconfig.json). */
export function deployableFiles(root) {
    const files = [];
    for (const d of DEPLOYABLE_DIRS) walk(root, join(root, d), files);
    for (const f of DEPLOYABLE_FILES) if (existsSync(join(root, f))) files.push(f);
    return files.sort();
}

const read = (root, file) => (existsSync(join(root, file)) ? readFileSync(join(root, file)) : null);

/** Files whose bytes differ between the trees (added, removed or changed), among deployable inputs only. */
export function changedFiles(liveRoot, candidateRoot) {
    const all = new Set([...deployableFiles(liveRoot), ...deployableFiles(candidateRoot)]);
    const changed = [];
    for (const f of [...all].sort()) {
        const a = read(liveRoot, f), b = read(candidateRoot, f);
        if (a === null || b === null || !a.equals(b)) changed.push(f);
    }
    return changed;
}

/** Returns the list of problems (empty = pass). */
export function checkDiff({ liveRoot, candidateRoot, declared }) {
    const problems = [];
    const changed = new Set(changedFiles(liveRoot, candidateRoot));
    const declaredSet = new Set(declared);
    for (const f of [...changed].sort()) if (!declaredSet.has(f)) problems.push(`UNDECLARED CHANGE: ${f} differs from live and is not declared`);
    for (const f of [...declaredSet].sort()) {
        if (!changed.has(f)) problems.push(`DECLARED BUT UNCHANGED: ${f} is declared but is identical to live`);
    }
    return problems;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The version id serving ALL traffic from the newest deployment in `wrangler deployments list` (oldest first; each
 * deployment starts at a "Created:" line in column 0). Null when that deployment is a split (gradual rollout) or has no
 * readable version line: the gate cannot tell what is live, so it stops.
 */
export function latestDeployedVersion(wranglerOutput) {
    const starts = [...wranglerOutput.matchAll(/^Created:/gm)].map((m) => m.index);
    if (!starts.length) return null;
    const block = wranglerOutput.slice(starts[starts.length - 1]);
    const rows = [...block.matchAll(/\((\d+)%\)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)];
    return rows.length === 1 && rows[0][1] === '100' ? rows[0][2] : null;
}

/** A ws-proxy tree must look like one: an empty directory (or the wrong root) is not "no change". */
export function treeProblems(label, root) {
    return ['src/index.ts', 'wrangler.toml'].filter((f) => !existsSync(join(root, f))).map((f) => `NOT A WS-PROXY TREE: ${label} has no ${f} (${root})`);
}

function parseArgs(argv) {
    const a = { skipVersionCheck: false };
    const valued = ['--live', '--candidate', '--declared', '--expect-version', '--wrangler-root', '--wrangler-version', '--wrangler-bin-sha256', '--wrangler-cli-sha256'];
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--skip-version-check') a.skipVersionCheck = true;
        else if (valued.includes(k)) a[k.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
        else throw new Error(`unknown argument ${k}`);
    }
    return a;
}

/**
 * Runs the gate. Returns { code, lines }. The version check runs the PINNED wrangler (trusted-wrangler.mjs) with a whitelist
 * environment; --skip-version-check exists for tests and previews and is refused unless DEPLOY_GATE_ALLOW_SKIP=1 is set.
 */
export function runGate(a, env = process.env) {
    const lines = [];
    const say = (l) => lines.push(l);
    if (!a.live || !a.candidate || a.declared === undefined) { say('usage: --live <dir> --candidate <dir> --declared "<files>" --expect-version <full id> --wrangler-version V --wrangler-bin-sha256 H --wrangler-cli-sha256 H [--wrangler-root <dir>]'); return { code: 2, lines }; }
    const declared = a.declared.split(/\s+/).filter(Boolean);
    const shape = [...treeProblems('live', a.live), ...treeProblems('candidate', a.candidate)];
    const problems = shape.length ? shape : checkDiff({ liveRoot: a.live, candidateRoot: a.candidate, declared });
    const changed = changedFiles(a.live, a.candidate);
    say(`deployable files changed vs live: ${changed.join(' ') || '(none)'}`);
    say(`declared: ${declared.join(' ') || '(none)'}`);
    for (const p of problems) say(p);
    let failed = problems.length > 0;
    if (a.skipVersionCheck) {
        if (env.DEPLOY_GATE_ALLOW_SKIP === '1') say('version check skipped (tests / preview only)');
        else { say('VERSION CHECK: --skip-version-check is refused here (set DEPLOY_GATE_ALLOW_SKIP=1 only in tests or a preview)'); failed = true; }
    } else if (!UUID.test(a.expectVersion ?? '')) {
        say('VERSION CHECK: --expect-version must be the full version id (uuid)'); failed = true;
    } else {
        try {
            const trusted = resolveTrustedWrangler({ root: a.wranglerRoot ?? a.candidate, version: a.wranglerVersion, binSha256: a.wranglerBinSha256, cliSha256: a.wranglerCliSha256 });
            const r = runTrustedWrangler(trusted, ['deployments', 'list', '--name', 'ws-relay-proxy'], a.candidate);
            const latest = r.status === 0 ? latestDeployedVersion(r.stdout) : null;
            if (!latest) { say(`VERSION CHECK: could not read the latest version (wrangler exit ${r.status})`); failed = true; }
            else if (latest !== a.expectVersion) { say(`VERSION CHECK: latest deployed version is ${latest}, not the recorded ${a.expectVersion}; someone deployed since`); failed = true; }
            else say(`version check ok: latest is ${latest}`);
        } catch (e) { say(String(e.message ?? e)); failed = true; }
    }
    say(failed ? 'GATE: FAIL' : 'GATE: PASS');
    return { code: failed ? 1 : 0, lines };
}

function main() {
    let a;
    try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
    const { code, lines } = runGate(a);
    for (const l of lines) console.log(l);
    return code;
}

// Compare real paths: the ESM loader resolves symlinks in import.meta.url but argv[1] keeps the path as typed, so a
// symlinked checkout (macOS /tmp, a CI workspace, a bin link) used to skip main() and exit 0 without checking anything.
const entry = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (entry && realpathSync(fileURLToPath(import.meta.url)) === entry) process.exit(main());
