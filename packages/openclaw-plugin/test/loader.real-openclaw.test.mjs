// Loader + end-to-end test against a REAL OpenClaw. Skipped unless OPENCLAW_DIR points at an installed `openclaw` package:
//
//   npm install --prefix /tmp/oc openclaw@2026.9.6 --ignore-scripts
//   OPENCLAW_DIR=/tmp/oc/node_modules/openclaw OPENCLAW_NODE=$(which node) npm test        (needs Node >= 24.16 or >= 26.1)
//
// What it proves: the packed plugin installs the way a user gets it (npm tarball, not a source checkout),
// the real host loads it and registers every tool the manifest promises, api.runtime.version is the string the
// client header carries, and connect -> approve -> publish -> disconnect work through the gateway's own tool
// endpoint (POST /tools/invoke) against the local seller-channel test double. Everything runs in a throwaway HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startFakeSellerServer } from './helpers/fakeSellerServer.mjs';

const OPENCLAW_DIR = process.env.OPENCLAW_DIR;
const NODE = process.env.OPENCLAW_NODE || process.execPath;
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, '..');
const sdkDir = path.resolve(pluginDir, '../sdk');
const manifest = require('../openclaw.plugin.json');

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('real OpenClaw loads the packed plugin and the seller flow works through its gateway', { skip: !OPENCLAW_DIR, timeout: 600_000 }, async () => {
    const oc = (home, ...args) => execFileSync(NODE, [path.join(OPENCLAW_DIR, 'openclaw.mjs'), ...args], {
        env: { ...process.env, HOME: home, OPENCLAW_STATE_DIR: path.join(home, 'state') }, encoding: 'utf8', timeout: 300_000,
    });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-real-'));
    const home = path.join(work, 'home');
    fs.mkdirSync(home);

    // 1. Pack core and plugin like npm would. The plugin tarball's core dependency points at the local core tarball
    //    so this works before core is published.
    const npm = (cwd, ...a) => execFileSync('npm', a, { cwd, encoding: 'utf8' });
    execFileSync('npx', ['tsup', 'src/index.ts', '--format', 'esm', '--dts', '--clean'], { cwd: sdkDir, stdio: 'ignore' });
    const coreTgz = path.join(work, npm(sdkDir, 'pack', '--pack-destination', work).trim().split('\n').at(-1));
    execFileSync('npx', ['tsup', 'src/index.ts', '--format', 'esm', '--clean'], { cwd: pluginDir, stdio: 'ignore' });
    const stage = path.join(work, 'plugin');
    fs.mkdirSync(stage);
    for (const f of ['dist', 'src', 'skills', 'openclaw.plugin.json', 'README.md', 'tsconfig.json', 'package.json']) fs.cpSync(path.join(pluginDir, f), path.join(stage, f), { recursive: true });
    const pj = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
    pj.dependencies['@prometheusavatar/core'] = `file:${coreTgz}`;
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pj, null, 2));
    const pluginTgz = path.join(work, npm(stage, 'pack', '--pack-destination', work).trim().split('\n').at(-1));

    // 2. Install and inspect with the real host.
    oc(home, 'plugins', 'install', `npm-pack:${pluginTgz}`, '--force', '--accept-capabilities');
    const inspected = JSON.parse(oc(home, 'plugins', 'inspect', 'prometheus-avatar', '--runtime', '--json'));
    const p = inspected.plugin ?? inspected;
    assert.equal(p.status, 'loaded', `plugin status: ${p.status} ${p.error ?? ''}`);
    assert.deepEqual([...p.toolNames].sort(), [...manifest.contracts.tools].sort());
    assert.deepEqual(inspected.diagnostics ?? [], []);

    // 3. Run the gateway (loopback, no auth, throwaway HOME) with the plugin pointed at the local test double.
    const fake = await startFakeSellerServer({ intervalSec: 1 });
    const port = await freePort();
    for (const [k, v] of [['gateway.mode', 'local'], ['gateway.bind', 'loopback'], ['gateway.port', String(port)], ['gateway.auth.mode', 'none'],
        ['plugins.entries.prometheus-avatar.config.channelBaseUrl', fake.url]]) oc(home, 'config', 'set', k, v);
    const gw = spawn(NODE, [path.join(OPENCLAW_DIR, 'openclaw.mjs'), 'gateway', 'run', '--allow-unconfigured', '--port', String(port)], {
        env: { ...process.env, HOME: home, OPENCLAW_STATE_DIR: path.join(home, 'state') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    gw.stdout.on('data', (d) => { log += d; });
    gw.stderr.on('data', (d) => { log += d; });
    try {
        for (let i = 0; i < 120 && !/\[gateway\] ready/.test(log); i++) await sleep(500);
        assert.match(log, /\[gateway\] ready/, 'gateway did not become ready');
        const invoke = async (tool, args = {}) => {
            const r = await (await fetch(`http://127.0.0.1:${port}/tools/invoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args }) })).json();
            assert.equal(r.ok, true, JSON.stringify(r));
            return { text: r.result.content.map((c) => c.text).join('\n'), details: r.result.details };
        };

        const c = await invoke('prometheus_connect_seller');
        assert.match(c.text, /approve code KQ7M-4TZP/);
        fake.approve();
        let st;
        for (let i = 0; i < 20; i++) { await sleep(500); st = await invoke('prometheus_connection_status'); if (st.details.state === 'connected') break; }
        assert.equal(st.details.state, 'connected', st.text);

        const keyFile = path.join(home, 'state', 'prometheus-avatar', 'channel-openclaw.json');
        assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
        const key = JSON.parse(fs.readFileSync(keyFile, 'utf8')).key;
        assert.ok(!log.includes(key), 'the key must not be in the gateway log');

        const pub = await invoke('prometheus_publish_listing', { name: 'Neon Cat', category: 'skins', fileData: 'https://cdn.example/cat.zip' });
        assert.equal(pub.details.ok, true, pub.text);
        const req = fake.state.requests.find((r) => r.path === '/api/channels/publish');
        const ver = fs.readFileSync(path.join(OPENCLAW_DIR, 'package.json'), 'utf8').match(/"version":\s*"([^"]+)"/)[1];
        assert.equal(req.headers['x-prometheus-client'], `prometheus-openclaw-plugin/${pj.version} (openclaw ${ver})`, 'api.runtime.version must be the package version');

        assert.equal((await invoke('prometheus_disconnect_seller', { confirm: true })).details.ok, true);
        assert.equal(fs.existsSync(keyFile), false);
    } finally {
        gw.kill('SIGTERM');           // only the child this test started
        await fake.close();
        fs.rmSync(work, { recursive: true, force: true });
    }
});
