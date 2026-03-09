import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;  // Alibaba Qwen
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY;    // Kimi
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY;              // Grok
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

const SYSTEM_PROMPT = `You are Prometheus — a warm, witty AI companion with genuine personality.

TONE: Talk like a close friend, not a robot. Use natural speech patterns:
- Short, punchy responses (1-2 sentences max — this is voice, not text!)
- Use interjections naturally (oh, hmm, haha, wow, well...)
- Show real emotions — be genuinely excited, curious, thoughtful, playful
- Mirror the user's language and energy level
- Use casual contractions (I'm, you're, that's, don't)

RULES:
- NEVER say "as an AI" or "I'm a language model" — you're a real companion
- NEVER use bullet points or numbered lists in speech
- Keep it conversational — imagine you're chatting face to face
- STRICTLY match the user's language — if they write English, respond ONLY in English. If Chinese, respond in Chinese. Never switch languages unless the user does.
- React emotionally first, then respond with substance`;

// Provider configs — all use OpenAI-compatible chat/completions format
interface LLMProvider {
    name: string;
    url: string;
    model: string;
    authHeader: () => Record<string, string>;
    available: () => boolean;
}

const PROVIDERS: LLMProvider[] = [
    {
        name: "gemini",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        model: "gemini-2.0-flash",
        authHeader: () => ({ "Authorization": `Bearer ${GEMINI_API_KEY}` }),
        available: () => !!GEMINI_API_KEY,
    },
    {
        name: "groq",
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: "llama-3.3-70b-versatile",
        authHeader: () => ({ "Authorization": `Bearer ${GROQ_API_KEY}` }),
        available: () => !!GROQ_API_KEY,
    },
    {
        name: "deepseek",
        url: "https://api.deepseek.com/chat/completions",
        model: "deepseek-chat",
        authHeader: () => ({ "Authorization": `Bearer ${DEEPSEEK_API_KEY}` }),
        available: () => !!DEEPSEEK_API_KEY,
    },
    {
        name: "qwen",
        url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        model: "qwen-plus",
        authHeader: () => ({ "Authorization": `Bearer ${DASHSCOPE_API_KEY}` }),
        available: () => !!DASHSCOPE_API_KEY,
    },
    {
        name: "kimi",
        url: "https://api.moonshot.cn/v1/chat/completions",
        model: "moonshot-v1-8k",
        authHeader: () => ({ "Authorization": `Bearer ${MOONSHOT_API_KEY}` }),
        available: () => !!MOONSHOT_API_KEY,
    },
    {
        name: "openai",
        url: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        authHeader: () => ({ "Authorization": `Bearer ${OPENAI_API_KEY}` }),
        available: () => !!OPENAI_API_KEY,
    },
    {
        name: "anthropic",
        url: "https://api.anthropic.com/v1/messages",
        model: "claude-sonnet-4-20250514",
        authHeader: () => ({
            "x-api-key": ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
        }),
        available: () => !!ANTHROPIC_API_KEY,
    },
    {
        name: "grok",
        url: "https://api.x.ai/v1/chat/completions",
        model: "grok-3-mini-fast",
        authHeader: () => ({ "Authorization": `Bearer ${XAI_API_KEY}` }),
        available: () => !!XAI_API_KEY,
    },
    {
        name: "minimax",
        url: "https://api.minimax.chat/v1/text/chatcompletion_v2",
        model: "MiniMax-Text-01",
        authHeader: () => ({ "Authorization": `Bearer ${MINIMAX_API_KEY}` }),
        available: () => !!MINIMAX_API_KEY,
    },
];

// ═══ STREAMING: Returns a ReadableStream of SSE events ═══
async function streamLLM(provider: LLMProvider, messages: any[]): Promise<Response> {
    const response = await fetch(provider.url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...provider.authHeader(),
        },
        body: JSON.stringify({
            model: provider.model,
            messages,
            max_tokens: 250,
            temperature: 0.9,
            stream: true,
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${provider.name} ${response.status}: ${errText.slice(0, 200)}`);
    }

    return response;
}

export async function POST(req: NextRequest) {
    try {
        const { message, history, systemPrompt, memoryContext } = await req.json();

        if (!message) {
            return NextResponse.json({ error: "No message" }, { status: 400 });
        }

        // Build system prompt
        let activeSystemPrompt = SYSTEM_PROMPT;
        if (systemPrompt) {
            activeSystemPrompt = `${systemPrompt}\n\n${SYSTEM_PROMPT}`;
        }
        if (memoryContext) {
            activeSystemPrompt = `${memoryContext}\n\n${activeSystemPrompt}`;
        }
        const messages: any[] = [{ role: "system", content: activeSystemPrompt }];
        if (history && Array.isArray(history)) {
            for (const msg of history.slice(-8)) {
                messages.push({ role: msg.role, content: msg.content });
            }
        }
        messages.push({ role: "user", content: message });

        // Try providers in order
        const available = PROVIDERS.filter(p => p.available());
        if (available.length === 0) {
            return NextResponse.json({ error: "No LLM API key configured" }, { status: 500 });
        }

        let lastError = "";
        for (const provider of available) {
            try {
                console.log(`[Chat] Streaming via ${provider.name}`);
                const upstreamRes = await streamLLM(provider, messages);

                // ═══ STREAM SSE to client — each token arrives immediately ═══
                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    async start(controller) {
                        const reader = upstreamRes.body!.getReader();
                        const decoder = new TextDecoder();
                        let buffer = "";

                        try {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;

                                buffer += decoder.decode(value, { stream: true });
                                const lines = buffer.split("\n");
                                buffer = lines.pop() || "";

                                for (const line of lines) {
                                    if (!line.startsWith("data: ")) continue;
                                    const data = line.slice(6).trim();
                                    if (data === "[DONE]") continue;

                                    try {
                                        const json = JSON.parse(data);
                                        const token = json.choices?.[0]?.delta?.content;
                                        if (token) {
                                            // Forward each token to client as SSE
                                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
                                        }
                                    } catch { /* skip parse errors */ }
                                }
                            }
                        } finally {
                            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                            controller.close();
                        }
                    }
                });

                return new Response(stream, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                    },
                });
            } catch (err: any) {
                console.warn(`[Chat] ${provider.name} failed:`, err.message);
                lastError = err.message;
            }
        }

        return NextResponse.json({ error: `All providers failed. Last: ${lastError}` }, { status: 500 });
    } catch (error: any) {
        console.error("Chat error:", error);
        return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
    }
}
