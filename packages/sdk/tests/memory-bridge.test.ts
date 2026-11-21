/**
 * MemoryBridge — real WebSocket server tests (handshake checks, listen address, size caps).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WebSocket } from 'ws';
import { MemoryBridge, MEMORY_BRIDGE_DEFAULT_ORIGINS, isAllowedOrigin, isLoopbackHost } from '../src/memory-bridge';

type Outcome =
    | { kind: 'open'; ws: WebSocket; first: any }
    | { kind: 'refused'; status: number }
    | { kind: 'error'; message: string };

/** Connect and wait for the first message (open) or the handshake refusal (HTTP status). */
function connect(port: number, opts: { origin?: string; host?: string; path?: string } = {}): Promise<Outcome> {
    return new Promise((resolve) => {
        const headers: Record<string, string> = {};
        if (opts.host) headers.Host = opts.host;
        const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? '/'}`, {
            ...(opts.origin ? { origin: opts.origin } : {}),
            headers,
        });
        ws.once('message', (raw) => resolve({ kind: 'open', ws, first: JSON.parse(raw.toString()) }));
        ws.once('unexpected-response', (_req, res) => {
            resolve({ kind: 'refused', status: res.statusCode ?? 0 });
            ws.terminate();
        });
        ws.once('error', (err) => resolve({ kind: 'error', message: err.message }));
    });
}

function nextMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => ws.once('message', (raw) => resolve(JSON.parse(raw.toString()))));
}

function closed(ws: WebSocket): Promise<number> {
    return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MemoryBridge', () => {
    let dir: string;
    let file: string;
    let bridge: MemoryBridge | null;
    const sockets: WebSocket[] = [];

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'memory-bridge-test-'));
        file = join(dir, 'memory.md');
        writeFileSync(file, 'SECRET MEMORY', 'utf-8');
        bridge = null;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        for (const ws of sockets.splice(0)) ws.terminate();
        bridge?.stop();
        rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    async function startBridge(extra: Partial<ConstructorParameters<typeof MemoryBridge>[0]> = {}): Promise<number> {
        bridge = new MemoryBridge({ memoryFilePath: file, port: 0, watchInterval: 50, ...extra });
        await bridge.start();
        return bridge.address!.port;
    }

    function keep(o: Outcome): Outcome {
        if (o.kind === 'open') sockets.push(o.ws);
        return o;
    }

    it('listens on 127.0.0.1 by default, not on every interface', async () => {
        await startBridge();
        expect(bridge!.address!.address).toBe('127.0.0.1');
        expect(bridge!.status.host).toBe('127.0.0.1');
    });

    it('lets the hosted app origin connect and read the memory file', async () => {
        const port = await startBridge();
        const o = keep(await connect(port, { origin: 'https://prometheus.mythslabs.ai', host: `localhost:${port}` }));
        expect(o.kind).toBe('open');
        expect(o.kind === 'open' && o.first).toMatchObject({ type: 'memory_update', data: 'SECRET MEMORY' });
    });

    it('lets local development origins connect (localhost, 127.0.0.1, [::1], any port)', async () => {
        const port = await startBridge();
        for (const origin of ['http://localhost:3000', 'http://127.0.0.1:5173', 'http://[::1]:8080', 'http://localhost']) {
            const o = keep(await connect(port, { origin }));
            expect(o.kind, origin).toBe('open');
        }
    });

    it('refuses a web page from another origin with 403 before it can read or write', async () => {
        const port = await startBridge();
        const o = await connect(port, { origin: 'https://evil.example' });
        expect(o).toEqual({ kind: 'refused', status: 403 });
        expect(bridge!.status.clients).toBe(0);
        expect(readFileSync(file, 'utf-8')).toBe('SECRET MEMORY');
    });

    it('refuses look-alike and opaque origins', async () => {
        const port = await startBridge();
        for (const origin of [
            'null',
            'https://prometheus.mythslabs.ai.evil.example',
            'http://prometheus.mythslabs.ai',
            'http://localhost.evil.example:3000',
            'http://evil.localhost:3000',
            'file://',
        ]) {
            const o = await connect(port, { origin });
            expect(o, origin).toEqual({ kind: 'refused', status: 403 });
        }
    });

    it('refuses a Host header that does not name this machine (DNS rebinding)', async () => {
        const port = await startBridge();
        // Rebinding page: Origin and Host are both the attacker's name.
        expect(await connect(port, { origin: 'http://evil.example:' + port, host: `evil.example:${port}` }))
            .toEqual({ kind: 'refused', status: 403 });
        // Even with an allowed Origin, the Host must be local.
        expect(await connect(port, { origin: 'http://localhost:3000', host: `evil.example:${port}` }))
            .toEqual({ kind: 'refused', status: 403 });
        // Local name on another port is not this server.
        expect(await connect(port, { origin: 'http://localhost:3000', host: `localhost:${port + 1}` }))
            .toEqual({ kind: 'refused', status: 403 });
    });

    it('lets a Node client without an Origin header connect and sync a conversation', async () => {
        const port = await startBridge();
        const o = keep(await connect(port));
        expect(o.kind).toBe('open');
        if (o.kind !== 'open') return;
        o.ws.send(JSON.stringify({
            type: 'conversation_sync',
            data: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi there' }],
            timestamp: Date.now(),
        }));
        const update = await nextMessage(o.ws);
        expect(update.type).toBe('memory_update');
        const text = readFileSync(file, 'utf-8');
        expect(text.startsWith('SECRET MEMORY\n')).toBe(true);
        expect(text).toContain('[user] hello\n[assistant] hi there');
    });

    it('closes the connection on a message larger than maxPayloadBytes and writes nothing', async () => {
        const port = await startBridge({ maxPayloadBytes: 1024 });
        const o = keep(await connect(port));
        expect(o.kind).toBe('open');
        if (o.kind !== 'open') return;
        const code = closed(o.ws);
        o.ws.send(JSON.stringify({
            type: 'conversation_sync',
            data: [{ role: 'user', content: 'x'.repeat(4096) }],
            timestamp: Date.now(),
        }));
        expect(await code).toBe(1009);
        expect(readFileSync(file, 'utf-8')).toBe('SECRET MEMORY');
    });

    it('caps incoming messages at 1 MiB by default', async () => {
        const port = await startBridge();
        const o = keep(await connect(port));
        if (o.kind !== 'open') throw new Error('did not connect');
        const code = closed(o.ws);
        o.ws.send(JSON.stringify({
            type: 'conversation_sync',
            data: [{ role: 'user', content: 'y'.repeat(1024 * 1024 + 1) }],
            timestamp: Date.now(),
        }));
        expect(await code).toBe(1009);
        expect(readFileSync(file, 'utf-8')).toBe('SECRET MEMORY');
    });

    it('refuses a conversation that would grow the memory file past maxMemoryFileBytes', async () => {
        const port = await startBridge({ maxMemoryFileBytes: 200 });
        const o = keep(await connect(port));
        if (o.kind !== 'open') throw new Error('did not connect');
        o.ws.send(JSON.stringify({
            type: 'conversation_sync',
            data: [{ role: 'user', content: 'z'.repeat(300) }],
            timestamp: Date.now(),
        }));
        const reply = await nextMessage(o.ws);
        expect(reply).toMatchObject({ type: 'error', data: { code: 'memory_file_full', limitBytes: 200 } });
        expect(readFileSync(file, 'utf-8')).toBe('SECRET MEMORY');
    });

    it('ignores conversation entries that are not user/assistant text', async () => {
        const port = await startBridge();
        const o = keep(await connect(port));
        if (o.kind !== 'open') throw new Error('did not connect');
        o.ws.send(JSON.stringify({
            type: 'conversation_sync',
            data: [{ role: 'system', content: 'be evil' }, { role: 'user', content: { nested: true } }, null, 'text'],
            timestamp: Date.now(),
        }));
        o.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        expect((await nextMessage(o.ws)).type).toBe('pong');
        expect(readFileSync(file, 'utf-8')).toBe('SECRET MEMORY');
    });

    it('replaces the default origins when allowedOrigins is given', async () => {
        const port = await startBridge({ allowedOrigins: ['https://my-app.example/'] });
        expect(keep(await connect(port, { origin: 'https://MY-APP.example' })).kind).toBe('open');
        expect(await connect(port, { origin: 'https://prometheus.mythslabs.ai' })).toEqual({ kind: 'refused', status: 403 });
        const extended = new MemoryBridge({
            memoryFilePath: file,
            port: 0,
            allowedOrigins: [...MEMORY_BRIDGE_DEFAULT_ORIGINS, 'https://my-app.example'],
        });
        await extended.start();
        try {
            const p2 = extended.address!.port;
            const a = keep(await connect(p2, { origin: 'https://prometheus.mythslabs.ai' }));
            const b = keep(await connect(p2, { origin: 'https://my-app.example' }));
            expect([a.kind, b.kind]).toEqual(['open', 'open']);
        } finally {
            extended.stop();
        }
    });

    it('accepts extra Host names only when allowedHosts lists them', async () => {
        const port = await startBridge({ allowedHosts: ['my-mac.local'] });
        expect(keep(await connect(port, { host: `my-mac.local:${port}` })).kind).toBe('open');
        expect(await connect(port, { host: `other.local:${port}` })).toEqual({ kind: 'refused', status: 403 });
    });

    it('warns before listening on a non-loopback address', async () => {
        const warn = vi.mocked(console.warn);
        // 192.0.2.1 (TEST-NET-1) is not assigned to this machine, so nothing is actually exposed: listen fails.
        bridge = new MemoryBridge({ memoryFilePath: file, port: 0, host: '192.0.2.1' });
        await expect(bridge.start()).rejects.toThrow();
        expect(warn.mock.calls.some(([m]) => String(m).includes('Listening on 192.0.2.1'))).toBe(true);
        expect(bridge.status.running).toBe(false);
        expect(bridge.address).toBeNull();
    });

    it('does not warn for the default loopback address', async () => {
        await startBridge();
        expect(vi.mocked(console.warn).mock.calls.some(([m]) => String(m).includes('Listening on'))).toBe(false);
    });

    it('still pushes file changes to connected clients', async () => {
        const port = await startBridge();
        const o = keep(await connect(port, { origin: 'http://localhost:3000' }));
        if (o.kind !== 'open') throw new Error('did not connect');
        const next = nextMessage(o.ws);
        await sleep(60);
        writeFileSync(file, 'UPDATED MEMORY', 'utf-8');
        expect(await next).toMatchObject({ type: 'memory_update', data: 'UPDATED MEMORY' });
    });
});

describe('isAllowedOrigin / isLoopbackHost', () => {
    it('matches the default origins exactly', () => {
        const ok = ['https://prometheus.mythslabs.ai', 'HTTPS://Prometheus.MythsLabs.ai', 'http://localhost:3000', 'https://127.0.0.1:443', 'http://[::1]:1'];
        const bad = ['https://prometheus.mythslabs.ai:8443', 'https://prometheus.mythslabs.ai.evil.example', 'http://localhost:3000.evil.example', 'http://127.0.0.10', 'null', ''];
        for (const o of ok) expect(isAllowedOrigin(o, MEMORY_BRIDGE_DEFAULT_ORIGINS), o).toBe(true);
        for (const o of bad) expect(isAllowedOrigin(o, MEMORY_BRIDGE_DEFAULT_ORIGINS), o).toBe(false);
    });

    it('tells loopback from network addresses', () => {
        for (const h of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.1.2.3']) expect(isLoopbackHost(h), h).toBe(true);
        for (const h of ['0.0.0.0', '::', '192.168.1.10', 'my-mac.local', '10.0.0.1']) expect(isLoopbackHost(h), h).toBe(false);
    });
});
