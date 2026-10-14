/**
 * MemoryBridge — Local memory file ↔ Web App real-time sync
 *
 * Architecture:
 *   Local memory file (JSON/TXT/MD)
 *     ↕ fs.watch()
 *   MemoryBridge (Node process)
 *     ↕ WebSocket (ws://localhost:8765)
 *   Prometheus Web App
 *
 * The Web App connects to the local MemoryBridge via WebSocket.
 * When the memory file changes on disk, the bridge pushes updates.
 * When the Web App produces new conversation data, it sends it
 * to the bridge, which writes back to the memory file.
 *
 * Security model:
 *   - The server listens on 127.0.0.1 only unless `host` is set explicitly.
 *   - A browser always sends an Origin header on a WebSocket handshake and page
 *     scripts cannot change it, so a connection that carries an Origin must come
 *     from an allowed origin (`allowedOrigins`). Any other web page is refused
 *     with HTTP 403 before it can read or write the memory file.
 *   - A connection without an Origin header is a non-browser client (a Node
 *     process on this machine). It is allowed: a local process can already read
 *     the memory file directly.
 *   - The Host header must name this machine (localhost / 127.0.0.1 / [::1], the
 *     explicit `host`, or `allowedHosts`), which defeats DNS rebinding.
 *   - Incoming messages are capped (`maxPayloadBytes`) and the memory file never
 *     grows past `maxMemoryFileBytes` through client writes.
 */

import { readFileSync, writeFileSync, watchFile, unwatchFile, existsSync, mkdirSync, statSync } from "fs";
import { dirname } from "path";
import { WebSocket, WebSocketServer } from "ws";
import type { AddressInfo } from "net";
import type { IncomingMessage } from "http";
import { EventEmitter } from "events";

/**
 * Origins allowed by default: the hosted Prometheus app and any page served
 * from this machine (local development).
 */
export const MEMORY_BRIDGE_DEFAULT_ORIGINS: ReadonlyArray<string | RegExp> = Object.freeze([
    "https://prometheus.mythslabs.ai",
    /^https?:\/\/localhost(:\d{1,5})?$/,
    /^https?:\/\/127\.0\.0\.1(:\d{1,5})?$/,
    /^https?:\/\/\[::1\](:\d{1,5})?$/,
]);

/** Default cap for one incoming WebSocket message (1 MiB). */
export const MEMORY_BRIDGE_DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
/** Default cap for the memory file size reachable through client writes (10 MiB). */
export const MEMORY_BRIDGE_DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

export interface MemoryBridgeOptions {
    /** Absolute path to the local memory file */
    memoryFilePath: string;
    /** WebSocket server port (default: 8765) */
    port?: number;
    /**
     * Interface to listen on (default: "127.0.0.1", this machine only).
     * A non-loopback value such as "0.0.0.0" exposes the memory file to your
     * network and prints a warning; set it only on a network you trust.
     */
    host?: string;
    /**
     * Browser origins allowed to connect. Strings match the whole Origin exactly
     * (case-insensitive), RegExps are tested against it. Replaces the default list
     * (MEMORY_BRIDGE_DEFAULT_ORIGINS); spread that list to extend it.
     * Connections without an Origin header (non-browser clients) are always allowed.
     */
    allowedOrigins?: ReadonlyArray<string | RegExp>;
    /**
     * Extra hostnames accepted in the Host header, in addition to localhost,
     * 127.0.0.1, [::1] and an explicit non-wildcard `host`. Needed only when
     * clients reach the bridge by another name (e.g. a LAN address with host "0.0.0.0").
     */
    allowedHosts?: ReadonlyArray<string>;
    /** Largest accepted incoming message in bytes (default: 1 MiB). Larger messages close the connection (1009). */
    maxPayloadBytes?: number;
    /** Client writes that would grow the memory file past this many bytes are refused (default: 10 MiB). */
    maxMemoryFileBytes?: number;
    /** File poll interval in ms (default: 1000) */
    watchInterval?: number;
    /** Callback when a conversation message arrives from the Web App */
    onConversation?: (messages: ConversationMessage[]) => void;
}

export interface ConversationMessage {
    role: "user" | "assistant";
    content: string;
    timestamp?: number;
}

export interface MemoryBridgeMessage {
    type: "memory_update" | "conversation_sync" | "memory_request" | "ping" | "pong" | "error";
    data?: any;
    timestamp: number;
}

/** True when `host` only reaches this machine. */
export function isLoopbackHost(host: string): boolean {
    const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h) || /^::ffff:127(\.\d{1,3}){3}$/.test(h);
}

/** True when `origin` (an Origin header value) matches one of `allowed`. */
export function isAllowedOrigin(origin: string, allowed: ReadonlyArray<string | RegExp>): boolean {
    const o = origin.trim().toLowerCase();
    return allowed.some((rule) =>
        typeof rule === "string" ? rule.trim().toLowerCase().replace(/\/+$/, "") === o : rule.test(o),
    );
}

export class MemoryBridge extends EventEmitter {
    private memoryFilePath: string;
    private port: number;
    private host: string;
    private allowedOrigins: ReadonlyArray<string | RegExp>;
    private allowedHostnames: Set<string>;
    private maxPayloadBytes: number;
    private maxMemoryFileBytes: number;
    private watchInterval: number;
    private wss: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();
    private lastMemoryHash: string = "";
    private isRunning: boolean = false;
    private onConversation?: (messages: ConversationMessage[]) => void;

    constructor(options: MemoryBridgeOptions) {
        super();
        this.memoryFilePath = options.memoryFilePath;
        this.port = options.port ?? 8765;
        this.host = options.host ?? "127.0.0.1";
        this.allowedOrigins = options.allowedOrigins ?? MEMORY_BRIDGE_DEFAULT_ORIGINS;
        this.allowedHostnames = new Set(LOOPBACK_HOSTNAMES);
        if (options.host && !["0.0.0.0", "::", "[::]"].includes(options.host.trim())) {
            const h = options.host.trim().toLowerCase();
            this.allowedHostnames.add(h.includes(":") && !h.startsWith("[") ? `[${h}]` : h);
        }
        for (const h of options.allowedHosts ?? []) this.allowedHostnames.add(h.trim().toLowerCase());
        this.maxPayloadBytes = options.maxPayloadBytes ?? MEMORY_BRIDGE_DEFAULT_MAX_PAYLOAD_BYTES;
        this.maxMemoryFileBytes = options.maxMemoryFileBytes ?? MEMORY_BRIDGE_DEFAULT_MAX_FILE_BYTES;
        this.watchInterval = options.watchInterval ?? 1000;
        this.onConversation = options.onConversation;
    }

    /**
     * Handshake check (ws `verifyClient`): refuse browsers from other origins and
     * Host headers that do not name this machine (DNS rebinding).
     */
    private verifyHandshake(origin: string | undefined, req: IncomingMessage): { ok: true } | { ok: false; reason: string } {
        const hostHeader = (req.headers.host ?? "").trim().toLowerCase();
        const m = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(hostHeader);
        if (!m || !this.allowedHostnames.has(m[1])) return { ok: false, reason: `host ${JSON.stringify(hostHeader.slice(0, 100))}` };
        if (m[2] !== undefined && Number(m[2]) !== this.port) return { ok: false, reason: `host port ${m[2]}` };
        // No Origin header = not a browser (a local Node client). Browsers always send it.
        if (origin === undefined) return { ok: true };
        if (!isAllowedOrigin(origin, this.allowedOrigins)) return { ok: false, reason: `origin ${JSON.stringify(origin.slice(0, 100))}` };
        return { ok: true };
    }

    /** Start the WebSocket server and file watcher */
    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.isRunning) {
                reject(new Error("MemoryBridge is already running"));
                return;
            }

            // Ensure memory file exists
            if (!existsSync(this.memoryFilePath)) {
                const dir = dirname(this.memoryFilePath);
                if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                writeFileSync(this.memoryFilePath, "{}", "utf-8");
            }

            // Read initial memory
            this.lastMemoryHash = this.readMemoryFile();

            if (!isLoopbackHost(this.host)) {
                console.warn(
                    `[MemoryBridge] ⚠️ Listening on ${this.host}, not on this machine only. Other devices that can reach ` +
                    `port ${this.port} may read and append to ${this.memoryFilePath} (non-browser clients send no Origin ` +
                    `and are allowed). Use this only on a network you trust.`,
                );
            }

            // Start WebSocket server
            const wss = new WebSocketServer({
                host: this.host,
                port: this.port,
                maxPayload: this.maxPayloadBytes,
                verifyClient: (info, done) => {
                    const verdict = this.verifyHandshake(info.origin, info.req);
                    if (verdict.ok) return done(true);
                    console.warn(`[MemoryBridge] ⛔ Refused connection (${verdict.reason})`);
                    done(false, 403, "Forbidden");
                },
            }, () => {
                const address = wss.address();
                if (address && typeof address === "object") this.port = address.port;
                this.isRunning = true;
                this.startWatcher();
                const shownHost = this.host.includes(":") ? `[${this.host}]` : this.host;
                console.log(`[MemoryBridge] 🟢 WebSocket server listening on ws://${shownHost}:${this.port}`);
                resolve();
            });
            this.wss = wss;

            wss.on("error", (err) => {
                console.error("[MemoryBridge] WebSocket server error:", err.message);
                if (!this.isRunning) {
                    wss.close();
                    if (this.wss === wss) this.wss = null;
                    reject(err);
                }
            });

            wss.on("connection", (ws) => {
                this.clients.add(ws);
                console.log(`[MemoryBridge] 🔗 Client connected (${this.clients.size} total)`);

                // Send current memory on connect
                const memory = this.readMemoryFile();
                this.sendTo(ws, { type: "memory_update", data: memory, timestamp: Date.now() });

                ws.on("message", (raw) => {
                    try {
                        const msg: MemoryBridgeMessage = JSON.parse(raw.toString());
                        this.handleMessage(ws, msg);
                    } catch (e: any) {
                        console.warn("[MemoryBridge] Invalid message:", e.message);
                    }
                });

                ws.on("close", () => {
                    this.clients.delete(ws);
                    console.log(`[MemoryBridge] 🔌 Client disconnected (${this.clients.size} remaining)`);
                });

                ws.on("error", (err) => {
                    console.warn("[MemoryBridge] Client error:", err.message);
                    this.clients.delete(ws);
                });
            });
        });
    }

    /** Watch the memory file and broadcast changes (started once the server listens). */
    private startWatcher(): void {
        watchFile(this.memoryFilePath, { interval: this.watchInterval }, () => {
            const newContent = this.readMemoryFile();
            if (newContent !== this.lastMemoryHash) {
                this.lastMemoryHash = newContent;
                console.log("[MemoryBridge] 📁 Memory file changed, broadcasting...");
                this.broadcast({ type: "memory_update", data: newContent, timestamp: Date.now() });
                this.emit("memory_changed", newContent);
            }
        });
    }

    /** The address the server listens on (null before start / after stop). */
    get address(): AddressInfo | null {
        const address = this.wss?.address();
        return address && typeof address === "object" ? address : null;
    }

    /** Stop the WebSocket server and file watcher */
    stop(): void {
        if (!this.isRunning) return;
        this.isRunning = false;

        unwatchFile(this.memoryFilePath);

        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();

        this.wss?.close();
        this.wss = null;
        console.log("[MemoryBridge] 🔴 Stopped");
    }

    /** Update memory file and broadcast to all connected clients */
    updateMemory(data: string | object): void {
        const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        writeFileSync(this.memoryFilePath, content, "utf-8");
        this.lastMemoryHash = content;
        this.broadcast({ type: "memory_update", data: content, timestamp: Date.now() });
        console.log("[MemoryBridge] 📝 Memory updated and broadcast");
    }

    /** Append to memory file (for conversation logs) */
    appendMemory(text: string): void {
        const current = this.readMemoryFile();
        const updated = current + "\n" + text;
        this.updateMemory(updated);
    }

    /** Current size of the memory file in bytes (0 when missing). */
    private memoryFileBytes(): number {
        try {
            return statSync(this.memoryFilePath).size;
        } catch {
            return 0;
        }
    }

    /** Read the memory file */
    private readMemoryFile(): string {
        try {
            return readFileSync(this.memoryFilePath, "utf-8");
        } catch {
            return "";
        }
    }

    /** Handle incoming WebSocket message */
    private handleMessage(ws: WebSocket, msg: MemoryBridgeMessage): void {
        switch (msg.type) {
            case "conversation_sync":
                // Web App sending conversation data → write to memory
                if (msg.data && Array.isArray(msg.data)) {
                    const messages = (msg.data as unknown[]).filter(isConversationMessage);
                    if (messages.length === 0) break;

                    // Append conversation summary to memory file, unless it would grow past the cap
                    const summary = messages
                        .map((m) => `[${m.role}] ${m.content}`)
                        .join("\n");
                    const entry = `\n--- Conversation ${new Date().toISOString()} ---\n${summary}`;
                    const projected = this.memoryFileBytes() + Buffer.byteLength("\n" + entry, "utf-8");
                    if (projected > this.maxMemoryFileBytes) {
                        console.warn(
                            `[MemoryBridge] ⛔ Conversation not saved: the memory file would reach ${projected} bytes ` +
                            `(limit ${this.maxMemoryFileBytes}). Trim the file or raise maxMemoryFileBytes.`,
                        );
                        this.sendTo(ws, {
                            type: "error",
                            data: { code: "memory_file_full", limitBytes: this.maxMemoryFileBytes },
                            timestamp: Date.now(),
                        });
                        break;
                    }
                    this.onConversation?.(messages);
                    this.emit("conversation", messages);
                    this.appendMemory(entry);
                }
                break;

            case "memory_request":
                // Web App requesting current memory
                const memory = this.readMemoryFile();
                this.sendTo(ws, { type: "memory_update", data: memory, timestamp: Date.now() });
                break;

            case "ping":
                this.sendTo(ws, { type: "pong", timestamp: Date.now() });
                break;

            default:
                console.warn("[MemoryBridge] Unknown message type:", msg.type);
        }
    }

    /** Send message to a specific client */
    private sendTo(ws: WebSocket, msg: MemoryBridgeMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    /** Broadcast message to all connected clients */
    private broadcast(msg: MemoryBridgeMessage): void {
        const data = JSON.stringify(msg);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        }
    }

    /** Get connection status */
    get status() {
        return {
            running: this.isRunning,
            clients: this.clients.size,
            host: this.host,
            port: this.port,
            memoryFilePath: this.memoryFilePath,
        };
    }
}

function isConversationMessage(m: unknown): m is ConversationMessage {
    if (!m || typeof m !== "object") return false;
    const { role, content } = m as { role?: unknown; content?: unknown };
    return (role === "user" || role === "assistant") && typeof content === "string";
}
