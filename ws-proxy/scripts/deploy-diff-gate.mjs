#!/usr/bin/env node
// Deploy diff gate for ws-relay-proxy: the files a deploy changes must be exactly the files it declares.
//
// Why: the 2026-11-07 deploy was built from a tree that lacked B-167 (src/asr-meter.ts) and silently reverted it,
// because nothing compared the candidate against what was live. This gate compares the deployable inputs of the
// candidate tree with the live tree (the source commit recorded for the live version) and fails when
//   - a deployable file differs and is not declared, or
//   - a declared file did not change.
// It then asks wrangler (read-only `deployments list`) whether the latest version is the recorded one, and stops if
// not (someone deployed in between). It reads no credentials: wrangler uses its own login.
//
// Usage: node scripts/deploy-diff-gate.mjs --live <dir> --candidate <dir> --declared "a b c"
//          --expect-version <id-prefix> [--skip-version-check]   (the flag is for tests only)
// <dir> is the ws-proxy directory of each tree (e.g. `git archive <sha> ws-proxy` extracted, then /ws-proxy).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
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

/** Reads the newest 100% version id from `wrangler deployments list` (read-only; oldest deployment first). */
export function latestDeployedVersion(wranglerOutput) {
    const ids = [...wranglerOutput.matchAll(/Version\(s\):\s+\(100%\)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)].map((m) => m[1]);
    return ids.length ? ids[ids.length - 1] : null;
}

function parseArgs(argv) {
    const a = { skipVersionCheck: false };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--skip-version-check') a.skipVersionCheck = true;
        else if (['--live', '--candidate', '--declared', '--expect-version', '--wrangler-cwd'].includes(k)) a[k.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
        else throw new Error(`unknown argument ${k}`);
    }
    return a;
}

function main() {
    const a = parseArgs(process.argv.slice(2));
    if (!a.live || !a.candidate || a.declared === undefined) { console.error('usage: --live <dir> --candidate <dir> --declared "<files>" --expect-version <id> [--skip-version-check]'); return 2; }
    const declared = a.declared.split(/\s+/).filter(Boolean);
    const problems = checkDiff({ liveRoot: a.live, candidateRoot: a.candidate, declared });
    const changed = changedFiles(a.live, a.candidate);
    console.log(`deployable files changed vs live: ${changed.join(' ') || '(none)'}`);
    console.log(`declared: ${declared.join(' ') || '(none)'}`);
    for (const p of problems) console.log(p);
    let failed = problems.length > 0;
    if (!a.skipVersionCheck) {
        if (!a.expectVersion) { console.log('VERSION CHECK: --expect-version is required'); failed = true; }
        else {
            // The candidate's own wrangler when installed (it is not on PATH in a worktree), else the one on PATH.
            const local = join(a.candidate, 'node_modules', '.bin', 'wrangler');
            const r = spawnSync(existsSync(local) ? local : 'wrangler', ['deployments', 'list', '--name', 'ws-relay-proxy'], { cwd: a.wranglerCwd ?? a.candidate, encoding: 'utf8' });
            const latest = r.status === 0 ? latestDeployedVersion(r.stdout) : null;
            if (!latest) { console.log(`VERSION CHECK: could not read the latest version (wrangler exit ${r.status})`); failed = true; }
            else if (!latest.startsWith(a.expectVersion)) { console.log(`VERSION CHECK: latest deployed version is ${latest}, not the recorded ${a.expectVersion}; someone deployed since`); failed = true; }
            else console.log(`version check ok: latest is ${latest}`);
        }
    } else console.log('version check skipped (tests only)');
    console.log(failed ? 'GATE: FAIL' : 'GATE: PASS');
    return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
