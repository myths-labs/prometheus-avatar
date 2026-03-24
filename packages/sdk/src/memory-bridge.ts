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
 */

import { readFileSync, writeFileSync, watchFile, unwatchFile, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { WebSocket, WebSocketServer } from "ws";
import { EventEmitter } from "events";

export interface MemoryBridgeOptions {
    /** Absolute path to the local memory file */
    memoryFilePath: string;
    /** WebSocket server port (default: 8765) */
    port?: number;
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
    type: "memory_update" | "conversation_sync" | "memory_request" | "ping" | "pong";
    data?: any;
    timestamp: number;
}

export class MemoryBridge extends EventEmitter {
    private memoryFilePath: string;
    private port: number;
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
        this.watchInterval = options.watchInterval ?? 1000;
        this.onConversation = options.onConversation;
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

            // Start WebSocket server
            this.wss = new WebSocketServer({ port: this.port }, () => {
                this.isRunning = true;
                console.log(`[MemoryBridge] 🟢 WebSocket server listening on ws://localhost:${this.port}`);
                resolve();
            });

            this.wss.on("error", (err) => {
                console.error("[MemoryBridge] WebSocket server error:", err.message);
                if (!this.isRunning) reject(err);
            });

            this.wss.on("connection", (ws) => {
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

            // Start file watcher
            watchFile(this.memoryFilePath, { interval: this.watchInterval }, () => {
                const newContent = this.readMemoryFile();
                if (newContent !== this.lastMemoryHash) {
                    this.lastMemoryHash = newContent;
                    console.log("[MemoryBridge] 📁 Memory file changed, broadcasting...");
                    this.broadcast({ type: "memory_update", data: newContent, timestamp: Date.now() });
                    this.emit("memory_changed", newContent);
                }
            });
        });
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
                    const messages = msg.data as ConversationMessage[];
                    this.onConversation?.(messages);
                    this.emit("conversation", messages);

                    // Append conversation summary to memory file
                    const summary = messages
                        .map((m) => `[${m.role}] ${m.content}`)
                        .join("\n");
                    this.appendMemory(`\n--- Conversation ${new Date().toISOString()} ---\n${summary}`);
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
            port: this.port,
            memoryFilePath: this.memoryFilePath,
        };
    }
}
