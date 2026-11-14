// The wrangler the deploy gate and the deploy entry are allowed to run: a pinned version whose two files hash to the
// pinned values. A wrangler found in the candidate tree is just a program the candidate chose; it is run only if it IS the
// pinned one. It is started with a whitelist environment, so CI credentials (CLOUDFLARE_*, tokens) never reach it from the
// gate. (The deploy itself needs the operator's login, which wrangler takes from HOME, not from the environment.)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Environment variables a gate-time wrangler call may see. Nothing else is passed (no CLOUDFLARE_*, no CF_*, no NODE_OPTIONS). */
export const WRANGLER_ENV_WHITELIST = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_CONFIG_HOME'];
export function whitelistedEnv(env = process.env) {
    const out = {};
    for (const k of WRANGLER_ENV_WHITELIST) if (env[k] !== undefined) out[k] = env[k];
    return out;
}

/** Throws unless root/node_modules/wrangler is the pinned wrangler (version and the hashes of bin/wrangler.js and wrangler-dist/cli.js). */
export function resolveTrustedWrangler({ root, version, binSha256, cliSha256 }) {
    if (!root || !version || !/^[0-9a-f]{64}$/.test(binSha256 ?? '') || !/^[0-9a-f]{64}$/.test(cliSha256 ?? '')) {
        throw new Error('WRANGLER NOT TRUSTED: the wrangler pin (version, bin sha256, cli sha256) is missing');
    }
    let dir;
    try { dir = realpathSync(join(root, 'node_modules', 'wrangler')); } catch { throw new Error(`WRANGLER NOT TRUSTED: no wrangler under ${root}/node_modules`); }
    const bin = join(dir, 'bin', 'wrangler.js'), cli = join(dir, 'wrangler-dist', 'cli.js'), pkg = join(dir, 'package.json');
    if (![bin, cli, pkg].every(existsSync)) throw new Error('WRANGLER NOT TRUSTED: the wrangler package is incomplete');
    const installed = JSON.parse(readFileSync(pkg, 'utf8')).version;
    if (installed !== version) throw new Error(`WRANGLER NOT TRUSTED: version ${installed}, pinned ${version}`);
    if (sha256(bin) !== binSha256) throw new Error('WRANGLER NOT TRUSTED: bin/wrangler.js does not match the pinned hash');
    if (sha256(cli) !== cliSha256) throw new Error('WRANGLER NOT TRUSTED: wrangler-dist/cli.js does not match the pinned hash');
    return { entry: bin };
}

/** Read-only calls (deployments list): whitelist environment. */
export function runTrustedWrangler(trusted, args, cwd) {
    return spawnSync(process.execPath, [trusted.entry, ...args], { cwd, encoding: 'utf8', env: whitelistedEnv(), timeout: 90_000 });
}
