// A stand-in for the OpenClaw plugin API, shaped after what OpenClaw 2026.9.6 hands to register(api)
// (checked against the real host by test/loader.real-openclaw.test.mjs).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const made = [];
/** Remove the state folders (they hold saved test keys) that makeApi created. */
export function cleanupDirs() { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); }

export function makeApi({ trusted = false, pluginConfig = {}, version = '2026.9.6', stateDir } = {}) {
    const dir = stateDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'oc-plugin-test-'));
    if (!stateDir) made.push(dir);
    const logs = [];
    const tools = new Map();
    const hooks = [];
    const kv = new Map();
    const api = {
        pluginConfig,
        logger: {
            info: (m) => logs.push(['info', m]),
            warn: (m) => logs.push(['warn', m]),
            error: (m) => logs.push(['error', m]),
        },
        runtime: {
            version,
            state: {
                resolveStateDir: () => dir,
                openKeyedStore: () => {
                    if (!trusted) throw new Error('openKeyedStore is only available for trusted plugins in this release. Plugin "x" loaded with reason=origin-path');
                    return {
                        async lookup(k) { return kv.get(k); },
                        async register(k, v) { kv.set(k, v); },
                        async consume(k) { kv.delete(k); },
                    };
                },
            },
        },
        registerTool: (t) => { tools.set(t.name, t); },
        on: (h, fn) => { hooks.push([h, fn]); },
    };
    return { api, logs, tools, hooks, kv, dir, keyFile: path.join(dir, 'prometheus-avatar', 'channel-openclaw.json') };
}

export async function call(tools, name, params = {}) {
    const r = await tools.get(name).execute('call-1', params);
    return { text: r.content.map((c) => c.text).join('\n'), details: r.details, raw: r };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, ms = 10000, step = 20) {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error('timed out waiting');
        await sleep(step);
    }
}
