import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer, type ServerOptions } from 'ws';
import { parseHostFrame, wireObject, wireTarget, type AudioHostFrame, type AudioHostTarget } from './audio-host-wire.js';
import { readHostAudioVoice, type HostAudioVoice } from './audio-host-voice.js';

interface Options {
    port?: number;
    allowedOrigin: string;
    pairingKey: string;
    authTimeoutMs?: number;
    onFrame: (host: AudioHostTarget, frame: AudioHostFrame) => void;
    onDisconnect?: (host: AudioHostTarget) => void;
}
interface Peer { host?: AudioHostTarget; voice?: HostAudioVoice; timer?: ReturnType<typeof setTimeout>; connectedAt?: number }
// ws 8.21 supports this bound; @types/ws 8.18 does not declare it yet.
const socketOptions: ServerOptions & { closeTimeout: number } = {
    noServer: true, maxPayload: 8192, perMessageDeflate: false, closeTimeout: 1000,
};

/** Explicit local pairing only. Account/selection claims must still come from the authenticated App. */
export class LocalAudioHostTransport {
    private readonly server = createServer((_req, res) => { res.writeHead(404); res.end(); });
    private readonly wss = new WebSocketServer(socketOptions);
    private readonly peers = new Map<WebSocket, Peer>();
    private readonly hostsById = new Map<string, WebSocket>();
    private readonly sockets = new Set<Socket>();
    private readonly keyHash: Buffer;
    private port = 0;
    private started = false;
    private closed = false;
    private closing?: Promise<void>;
    private readonly options: Omit<Options, 'pairingKey'>;

    constructor(options: Options) {
        const { pairingKey, ...runtimeOptions } = options;
        this.options = Object.freeze(runtimeOptions);
        let origin: URL;
        try { origin = new URL(options.allowedOrigin); } catch { throw new Error('invalid_host_origin'); }
        if (origin.origin !== options.allowedOrigin || origin.username || origin.password
            || !(origin.protocol === 'https:' || origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) {
            throw new Error('invalid_host_origin');
        }
        if (typeof pairingKey !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(pairingKey)) throw new Error('invalid_pairing_key');
        if (options.port !== undefined && (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535)) throw new Error('invalid_host_port');
        if (options.authTimeoutMs !== undefined && (!Number.isFinite(options.authTimeoutMs) || options.authTimeoutMs <= 0)) throw new Error('invalid_auth_timeout');
        this.keyHash = createHash('sha256').update(pairingKey).digest();
        this.server.maxConnections = 64;
        this.server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
        this.server.on('upgrade', (req, socket, head) => {
            if (this.closed || req.method !== 'GET' || req.url !== '/audio' || req.headers.origin !== this.options.allowedOrigin
                || ![`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(req.headers.host ?? '') || this.peers.size >= 32) {
                socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
            }
            this.wss.handleUpgrade(req, socket, head, ws => this.attach(ws));
        });
    }

    get url(): string { return `ws://127.0.0.1:${this.port}/audio`; }

    async start(): Promise<void> {
        if (this.started || this.closed) throw new Error('host_already_started');
        this.started = true;
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.options.port ?? 8766, '127.0.0.1', () => {
                const address = this.server.address();
                if (!address || typeof address === 'string') { reject(new Error('host_listen_failed')); return; }
                this.port = address.port; resolve();
            });
        });
    }

    hosts(): readonly { target: AudioHostTarget; connectedAt: number; voice?: HostAudioVoice }[] {
        return Object.freeze(Array.from(this.peers.values()).filter(p => p.host).map(p => Object.freeze({ target: p.host!, connectedAt: p.connectedAt!, ...(p.voice ? { voice: p.voice } : {}) })));
    }

    send(hostSessionId: string, frame: unknown): Promise<void> {
        const ws = this.hostsById.get(hostSessionId);
        if (!ws || ws.readyState !== WebSocket.OPEN || this.closed) return Promise.reject(new Error('host_unavailable'));
        return new Promise((resolve, reject) => {
            try { ws.send(JSON.stringify(frame), error => error ? reject(new Error('host_send_failed')) : resolve()); }
            catch { reject(new Error('host_send_failed')); }
        });
    }

    state(): { listening: boolean; clients: number; hosts: number; authTimers: number } {
        return { listening: this.server.listening, clients: this.peers.size, hosts: this.hostsById.size,
            authTimers: Array.from(this.peers.values()).filter(peer => peer.timer !== undefined).length };
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        this.closed = true;
        this.closing = Promise.resolve().then(async () => {
            for (const [ws, peer] of Array.from(this.peers)) { this.drop(ws, peer); ws.terminate(); }
            for (const socket of this.sockets) socket.destroy();
            await new Promise<void>(resolve => this.wss.close(() => resolve()));
            if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()));
        });
        return this.closing;
    }

    private drop(ws: WebSocket, peer: Peer): void {
        if (!this.peers.has(ws)) return;
        clearTimeout(peer.timer); peer.timer = undefined; this.peers.delete(ws);
        if (peer.host && this.hostsById.get(peer.host.hostSessionId) === ws) {
            this.hostsById.delete(peer.host.hostSessionId);
            try { this.options.onDisconnect?.(peer.host); } catch { /* Consumer failures cannot retain sockets. */ }
        }
    }

    private attach(ws: WebSocket): void {
        const peer: Peer = {};
        this.peers.set(ws, peer);
        peer.timer = setTimeout(() => { this.drop(ws, peer); ws.close(1008, 'Pairing required'); }, this.options.authTimeoutMs ?? 5000);
        ws.on('close', () => this.drop(ws, peer));
        ws.on('error', () => this.drop(ws, peer));
        ws.on('message', (raw, binary) => {
            if (!this.peers.has(ws)) return;
            try {
                if (binary) throw new Error('invalid_host_frame');
                const data: unknown = JSON.parse(raw.toString());
                if (!peer.host) {
                    const auth = wireObject(data, ['version', 'type', 'key', 'target', 'voice']);
                    if (auth.version !== 1 || auth.type !== 'prometheus.audio.authorize' || typeof auth.key !== 'string' || auth.key.length > 256
                        || !timingSafeEqual(createHash('sha256').update(auth.key as string).digest(), this.keyHash)) throw new Error('pairing_failed');
                    const host = wireTarget(auth.target);
                    const voice = auth.voice === undefined ? undefined : readHostAudioVoice(auth.voice);
                    if (this.hostsById.has(host.hostSessionId)) throw new Error('host_conflict');
                    clearTimeout(peer.timer); peer.timer = undefined; peer.host = host; peer.voice = voice; peer.connectedAt = Date.now();
                    this.hostsById.set(host.hostSessionId, ws);
                    ws.send(JSON.stringify({ version: 1, type: 'prometheus.audio.authorized', target: host, ...(voice ? { voice } : {}) }));
                } else {
                    const frame = parseHostFrame(data, peer.host);
                    try { this.options.onFrame(peer.host, frame); } catch { /* The command ledger owns consumer failures. */ }
                }
            } catch {
                this.drop(ws, peer); ws.close(1008, 'Invalid host frame');
            }
        });
    }
}
