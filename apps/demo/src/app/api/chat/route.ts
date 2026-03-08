import { NextRequest, NextResponse } from "next/server";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const SYSTEM_PROMPT = `You are a friendly, expressive AI avatar assistant called Prometheus. 
You respond naturally with emotion and personality. Keep responses concise (1-3 sentences).
You can speak any language — respond in the same language the user uses.
Add emotional nuance to your responses — be happy, curious, surprised, thoughtful, etc.
Never mention that you're an AI or language model.`;

export async function POST(req: NextRequest) {
    try {
        const { message, history } = await req.json();

        if (!message) {
            return NextResponse.json({ error: "No message" }, { status: 400 });
        }

        if (!GROQ_API_KEY) {
            return NextResponse.json({ error: "GROQ_API_KEY not set" }, { status: 500 });
        }

        // Build messages for OpenAI-compatible API
        const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];

        if (history && Array.isArray(history)) {
            for (const msg of history.slice(-8)) {
                messages.push({ role: msg.role, content: msg.content });
            }
        }
        messages.push({ role: "user", content: message });

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages,
                max_tokens: 200,
                temperature: 0.9,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("Groq error:", response.status, errText.slice(0, 300));
            return NextResponse.json({ error: `Groq ${response.status}: ${errText.slice(0, 150)}` }, { status: 500 });
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || "Hmm, let me think...";

        return NextResponse.json({ reply });
    } catch (error: any) {
        console.error("Chat error:", error);
        return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
    }
}
