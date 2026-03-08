import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const SYSTEM_PROMPT = `You are a friendly, expressive AI avatar assistant called Prometheus. 
You respond naturally with emotion and personality. Keep responses concise (1-3 sentences).
You can speak any language — respond in the same language the user uses.
Add emotional nuance to your responses — be happy, curious, surprised, thoughtful, etc.
Never mention that you're an AI or language model.`;

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
