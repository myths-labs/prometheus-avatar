// The only supported way to deploy this worker: `npm run deploy` (package.json "deploy" = this file).
// It runs the deploy diff gate against the live tree first and starts `wrangler deploy` only if the gate passes. `--check-only`
// stops after the gate (used by the pre-deploy script).
// What it guards against: operator mistakes (a stale tree, an undeclared change, a wrangler other than the pinned version and
// hashes, CI credentials in the environment). Not a hostile tree: the manifest (live commit, declared files, wrangler pin) and the
// wrangler package are both read from the candidate tree, so a tree that edits them passes its own check. That is why a change to
// scripts/deploy-manifest.json, and the scripts section of package.json, are items a person reads on the deploy checklist
// (acceptance/from-B/RELAY_B167_1114/PRECONDITIONS.md). Fetching wrangler from outside the tree is an after-launch item.
// Deploying is still the operator's decision (the coordinator's number and JC's approval); this file only refuses unsafe deploys.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runGate } from './deploy-diff-gate.mjs';
import { resolveTrustedWrangler, whitelistedEnv } from './trusted-wrangler.mjs';

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
    // Whitelist environment, as for the gate's read-only call: no NODE_OPTIONS, GITHUB_TOKEN, npm_config_*, CLOUDFLARE_* / CF_*.
    // The one credential the deploy uses is the operator's wrangler login, which wrangler reads from HOME (whitelisted).
    const r = d.spawn(process.execPath, [trusted.entry, 'deploy'], { cwd: candidate, stdio: 'inherit', env: whitelistedEnv() });
    return r.status === 0 ? 0 : 1;
}

/** The live commit is a git object name only: 7 to 40 lowercase hex characters. Anything else is refused before any command runs. */
export function assertCommitId(commit) {
    if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`DEPLOY REFUSED: liveCommit ${JSON.stringify(commit)} is not a 7-40 hex commit id`);
    return commit;
}

function extractLiveTree(commit, candidate) {
    assertCommitId(commit);
    // Argument arrays only, no shell: nothing in the manifest or the path is ever parsed as a command.
    const top = spawnSync('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (top.status !== 0) throw new Error(`cannot find the repository of ${candidate}`);
    const archive = spawnSync('git', ['-C', top.stdout.trim(), 'archive', commit, 'ws-proxy'], { maxBuffer: 256 * 1024 * 1024 });
    if (archive.status !== 0) throw new Error(`cannot extract live commit ${commit}`);
    const dir = mkdtempSync(join(tmpdir(), 'ws-live-'));
    const untar = spawnSync('tar', ['-x', '-C', dir, '--strip-components=1'], { input: archive.stdout });
    if (untar.status !== 0) { rmSync(dir, { recursive: true, force: true }); throw new Error(`cannot extract live commit ${commit}`); }
    return dir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exit(deploy({ checkOnly: process.argv.includes('--check-only') }));
}
