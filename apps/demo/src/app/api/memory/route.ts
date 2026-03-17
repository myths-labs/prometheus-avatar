import { NextRequest, NextResponse } from "next/server";

/**
 * Conversation Memory API — Enables cross-session memory for avatar personas
 * 
 * Like my-neuro's long-term memory:
 * - Saves conversation summaries after each session
 * - Loads memory context for returning users
 * - Passes accumulated memory to chat API as context
 * 
 * Uses localStorage for now (no auth required), upgradeable to Supabase
 */

// In-memory store (In production, use Supabase/Redis)
// For demo, we use a simple Map keyed by sessionId
const memoryStore = new Map<string, {
    memories: string[];
    lastSeen: string;
    totalMessages: number;
    personality?: string;
}>();

export async function POST(req: NextRequest) {
    try {
        const { action, sessionId, data } = await req.json();

        if (!sessionId) {
            return NextResponse.json({ error: "sessionId required" }, { status: 400 });
        }

        switch (action) {
            case "save": {
                // Save a memory after a conversation
                const existing = memoryStore.get(sessionId) || {
                    memories: [],
                    lastSeen: new Date().toISOString(),
                    totalMessages: 0,
                };

                if (data?.summary) {
                    existing.memories.push(data.summary);
                    // Keep only last 20 memories to prevent context overflow
                    if (existing.memories.length > 20) {
                        existing.memories = existing.memories.slice(-20);
                    }
                }

                existing.lastSeen = new Date().toISOString();
                existing.totalMessages += data?.messageCount || 0;
                if (data?.personality) existing.personality = data.personality;

                memoryStore.set(sessionId, existing);

                console.log(`[Memory] Saved memory for session ${sessionId}. Total memories: ${existing.memories.length}`);

                return NextResponse.json({
                    success: true,
                    memoriesCount: existing.memories.length,
                });
            }

            case "load": {
                // Load memories for a returning session
                const memory = memoryStore.get(sessionId);

                if (!memory || memory.memories.length === 0) {
                    return NextResponse.json({
                        found: false,
                        context: "",
                        message: "No previous memories found. Starting fresh!",
                    });
                }

                // Build context from memories
                const timeSinceLastSeen = getTimeSince(memory.lastSeen);
                const context = [
                    `[MEMORY CONTEXT - You have met this user before]`,
                    `Last seen: ${timeSinceLastSeen}`,
                    `Total past messages: ${memory.totalMessages}`,
                    ``,
                    `Your memories from past conversations:`,
                    ...memory.memories.map((m, i) => `${i + 1}. ${m}`),
                    ``,
                    `Use these memories naturally. Reference past topics when relevant.`,
                    `Show warmth through recognizing their return. Don't list all memories at once.`,
                ].join("\n");

                console.log(`[Memory] Loaded ${memory.memories.length} memories for session ${sessionId}`);

                return NextResponse.json({
                    found: true,
                    context,
                    memoriesCount: memory.memories.length,
                    lastSeen: memory.lastSeen,
                    totalMessages: memory.totalMessages,
                });
            }

            case "summarize": {
                // Auto-summarize a conversation into a memory
                const messages = data?.messages;
                if (!messages || !Array.isArray(messages) || messages.length < 2) {
                    return NextResponse.json({ summary: null, reason: "Not enough messages to summarize" });
                }

                // Simple summarization: extract key topics and user preferences
                const userMsgs = messages.filter((m: any) => m.role === "user").map((m: any) => m.content);
                const topics = userMsgs.join(" ").slice(0, 500);

                const summary = `User discussed: ${topics.slice(0, 200)}`;

                return NextResponse.json({ summary });
            }

            case "clear": {
                memoryStore.delete(sessionId);
                return NextResponse.json({ success: true, message: "Memory cleared" });
            }

            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }

    } catch (error: any) {
        console.error("[Memory] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

function getTimeSince(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return `${days} days ago`;
}
