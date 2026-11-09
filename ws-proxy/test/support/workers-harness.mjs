// Test support, not a test file (npm test runs test/*.test.mjs only).
//
// loadSrc: imports a module of ws-proxy/src from a fresh temporary copy of src/, optionally with text mutations. The wiring tests read
// src/*.ts as text; this runs it, so a test can carry its reverse proof: the same scenario against the source with the rule removed must
// fail. A mutation whose text is not found exactly once throws, so a proof can never silently run the unmutated source.
//
// installWorkersRuntime: just enough of the Workers runtime for index.ts to run under Node: WebSocketPair, a Response that may be a 101
// upgrade carrying a webSocket, and a fetch that never leaves the process (a provider upgrade gets an in-memory socket; anything else throws).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = new URL('../../src/', import.meta.url);

export const source = (name) => fs.readFileSync(new URL(name, SRC), 'utf8');

export async function loadSrc(entry, mutations = {}) {
    const names = fs.readdirSync(SRC).filter((name) => name.endsWith('.ts'));
    for (const name of Object.keys(mutations)) assert.ok(names.includes(name), `no such source file: ${name}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-proxy-src-'));
    try {
        fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
        for (const name of names) {
            let text = source(name);
            for (const [from, to] of mutations[name] ?? []) {
                assert.equal(text.split(from).length, 2, `a mutation of ${name} must match exactly once: ${from}`);
                text = text.replace(from, () => to);
            }
            // Node resolves no extensionless specifier (wrangler's bundler does): name each relative import's .ts file.
            text = text.replace(/(\bfrom\s+')(\.\/[^']+)(')/g, (all, head, spec, tail) => spec.endsWith('.ts') ? all : `${head}${spec}.ts${tail}`);
            fs.writeFileSync(path.join(dir, name), text);
        }
        return await import(pathToFileURL(path.join(dir, entry)).href);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** One end of an in-memory WebSocket: records what is sent and how it was closed; `dispatch` delivers an event to its listeners. */
export class FakeSocket {
    constructor(name) {
        this.name = name;
        this.readyState = 1;
        this.sent = [];
        this.closed = null;
        this.listeners = new Map();
    }
    accept() {}
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    send(data) {
        if (this.closed) throw new Error(`${this.name}: send after close`);
        this.sent.push(data);
    }
    close(code, reason) {
        if (this.closed) throw new Error(`${this.name}: already closed`);
        this.closed = { code, reason };
        this.readyState = 3;
    }
    dispatch(type, event) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

export function installWorkersRuntime() {
    const runtime = { pairs: [], upstreams: [], fetches: [] };
    globalThis.WebSocketPair = class {
        constructor() {
            const pair = { client: new FakeSocket('client'), server: new FakeSocket('server') };
            runtime.pairs.push(pair);
            this[0] = pair.client;
            this[1] = pair.server;
        }
    };
    const NodeResponse = globalThis.Response;
    globalThis.Response = class extends NodeResponse {
        constructor(body, init = {}) {
            if (init.status !== 101) { super(body, init); return; }
            const { status, webSocket, ...rest } = init;
            super(body, { ...rest, status: 200 }); // Node refuses 101; the Workers runtime returns it with the client's socket
            Object.defineProperty(this, 'status', { value: status });
            this.webSocket = webSocket;
        }
    };
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        runtime.fetches.push({ url, headers: { ...init.headers } });
        if (!url.startsWith('https://openspeech.bytedance.com/')) throw new Error(`test runtime: unexpected fetch ${url}`);
        const upstream = new FakeSocket('upstream');
        runtime.upstreams.push(upstream);
        return { status: 101, webSocket: upstream, headers: new Headers(), body: null };
    };
    return runtime;
}

const encoder = new TextEncoder();

/**
 * A Doubao client frame as the app sends it: header 0x11, full client request with an event (0x14), JSON (0x10), no compression. The
 * payload is an object (sent as its JSON) or raw JSON text, sent byte for byte.
 */
export function clientFrame(event, session, payload) {
    const id = session === null ? null : encoder.encode(session);
    const body = encoder.encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
    const bytes = new Uint8Array(8 + (id ? 4 + id.length : 0) + 4 + body.length), view = new DataView(bytes.buffer);
    bytes.set([0x11, 0x14, 0x10, 0x00]);
    view.setUint32(4, event);
    let at = 8;
    if (id) { view.setUint32(at, id.length); bytes.set(id, at + 4); at += 4 + id.length; }
    view.setUint32(at, body.length);
    bytes.set(body, at + 4);
    return bytes.buffer;
}
export const startConnection = () => clientFrame(1, null, {});
export const finishSession = (session) => clientFrame(102, session, {});
/** The StartSession payload the app sends: the dialog's text fields as given, plus extra, tts and asr. A fresh object each call. */
export const startSessionPayload = (dialog, { speaker, model }) => ({
    dialog: { ...dialog, extra: { input_mod: 'keep_alive', model } },
    tts: { speaker, audio_config: { channel: 1, format: 'pcm_s16le', sample_rate: 24000 } },
    asr: { extra: {} },
});
/** StartSession (event 100) with that payload. */
export const startSession = (session, dialog, voice) => clientFrame(100, session, startSessionPayload(dialog, voice));

/** Waits (macrotask by macrotask, so Web Crypto and the relay's queues can finish) until `predicate` holds. */
export async function until(label, predicate, ms = 15_000) {
    const deadline = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > deadline) assert.fail(`timed out waiting: ${label}`);
        await new Promise((resolve) => setImmediate(resolve));
    }
}
