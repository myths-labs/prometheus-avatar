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

async function callLLM(provider: LLMProvider, messages: any[]): Promise<string> {
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
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${provider.name} ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Hmm, let me think...";
}

export async function POST(req: NextRequest) {
    try {
        const { message, history, systemPrompt } = await req.json();

        if (!message) {
            return NextResponse.json({ error: "No message" }, { status: 400 });
        }

        // Build messages — use marketplace persona prompt if provided, otherwise default
        const activeSystemPrompt = systemPrompt
            ? `${systemPrompt}\n\n${SYSTEM_PROMPT}`
            : SYSTEM_PROMPT;
        const messages: any[] = [{ role: "system", content: activeSystemPrompt }];
        if (history && Array.isArray(history)) {
            for (const msg of history.slice(-8)) {
                messages.push({ role: msg.role, content: msg.content });
            }
        }
        messages.push({ role: "user", content: message });

        // Try providers in order: Gemini → Groq
        const available = PROVIDERS.filter(p => p.available());
        if (available.length === 0) {
            return NextResponse.json({ error: "No LLM API key configured (set GEMINI_API_KEY or GROQ_API_KEY)" }, { status: 500 });
        }

        let lastError = "";
        for (const provider of available) {
            try {
                console.log(`[Chat] Trying ${provider.name} (${provider.model})`);
                const reply = await callLLM(provider, messages);
                console.log(`[Chat] Success via ${provider.name}`);
                return NextResponse.json({ reply, provider: provider.name });
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

