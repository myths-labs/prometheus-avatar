// The only supported way to deploy this worker: `npm run deploy` (package.json "deploy" = this file).
// It runs the deploy diff gate against the live tree first and starts `wrangler deploy` only if the gate passes. wrangler is the
// pinned one (trusted-wrangler.mjs), never one from the tree. `--check-only` stops after the gate (used by the pre-deploy script).
// Deploying is still the operator's decision (the coordinator's number and JC's approval); this file only refuses unsafe deploys.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runGate } from './deploy-diff-gate.mjs';
import { resolveTrustedWrangler } from './trusted-wrangler.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** deps are injectable so a test can prove the order: gate first, deploy only after a pass. */
export function deploy({ checkOnly = false, manifest, candidate = ROOT, deps = {} } = {}) {
    const d = {
        gate: runGate,
        liveTree: (commit) => extractLiveTree(commit, candidate),
        wrangler: (m, root) => resolveTrustedWrangler({ root, version: m.wrangler.version, binSha256: m.wrangler.binSha256, cliSha256: m.wrangler.cliSha256 }),
        spawn: (cmd, args, opts) => spawnSync(cmd, args, opts),
        log: (l) => console.log(l),
        ...deps,
    };
    const m = manifest ?? JSON.parse(readFileSync(join(HERE, 'deploy-manifest.json'), 'utf8'));
    const live = d.liveTree(m.liveCommit);
    const { code, lines } = d.gate({
        live, candidate, declared: m.declared.join(' '), expectVersion: m.liveVersion,
        wranglerRoot: candidate, wranglerVersion: m.wrangler.version, wranglerBinSha256: m.wrangler.binSha256, wranglerCliSha256: m.wrangler.cliSha256,
        skipVersionCheck: false,
    });
    for (const l of lines) d.log(l);
    if (code !== 0) { d.log('DEPLOY REFUSED: the gate did not pass'); return 1; }
    if (checkOnly) { d.log('check-only: gate passed, nothing deployed'); return 0; }
    const trusted = d.wrangler(m, candidate);
    const r = d.spawn(process.execPath, [trusted.entry, 'deploy'], { cwd: candidate, stdio: 'inherit' });
    return r.status === 0 ? 0 : 1;
}

function extractLiveTree(commit, candidate) {
    const dir = mkdtempSync(join(tmpdir(), 'ws-live-'));
    const r = spawnSync('sh', ['-c', `top=$(git -C "${candidate}" rev-parse --show-toplevel) && git -C "$top" archive ${commit} ws-proxy | tar -x -C "${dir}" --strip-components=1`], { encoding: 'utf8' });
    if (r.status !== 0) { rmSync(dir, { recursive: true, force: true }); throw new Error(`cannot extract live commit ${commit}`); }
    return dir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exit(deploy({ checkOnly: process.argv.includes('--check-only') }));
}
