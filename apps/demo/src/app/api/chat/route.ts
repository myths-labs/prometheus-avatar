import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

        if (!GEMINI_API_KEY) {
            return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
        }

        // Build conversation for Gemini
        const contents = [];

        // Add history
        if (history && Array.isArray(history)) {
            for (const msg of history.slice(-8)) {
                contents.push({
                    role: msg.role === "assistant" ? "model" : "user",
                    parts: [{ text: msg.content }],
                });
            }
        }

        // Add current message
        contents.push({
            role: "user",
            parts: [{ text: message }],
        });

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents,
                    systemInstruction: {
                        parts: [{ text: SYSTEM_PROMPT }],
                    },
                    generationConfig: {
                        maxOutputTokens: 150,
                        temperature: 0.9,
                    },
                }),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            console.error("Gemini error:", error);
            return NextResponse.json({ error: "AI response failed" }, { status: 500 });
        }

        const data = await response.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Hmm, let me think about that...";

        return NextResponse.json({ reply });
    } catch (error) {
        console.error("Chat error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
