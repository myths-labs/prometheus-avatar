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
            return NextResponse.json({ error: "GEMINI_API_KEY not set on server" }, { status: 500 });
        }

        // Build conversation
        const contents = [];
        if (history && Array.isArray(history)) {
            for (const msg of history.slice(-8)) {
                contents.push({
                    role: msg.role === "assistant" ? "model" : "user",
                    parts: [{ text: msg.content }],
                });
            }
        }
        contents.push({ role: "user", parts: [{ text: message }] });

        // Try multiple model names
        const models = ["gemini-2.0-flash", "gemini-1.5-flash"];

        for (const model of models) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents,
                        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                        generationConfig: { maxOutputTokens: 200, temperature: 0.9 },
                    }),
                });

                if (response.ok) {
                    const data = await response.json();
                    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Hmm...";
                    return NextResponse.json({ reply });
                }

                const errText = await response.text();
                console.error(`Model ${model} failed (${response.status}):`, errText.slice(0, 300));

                // If 404 (model not found), try next model
                if (response.status === 404) continue;

                // Other errors — return details
                return NextResponse.json({
                    error: `Gemini ${model}: ${response.status} — ${errText.slice(0, 150)}`
                }, { status: 500 });

            } catch (fetchErr: any) {
                console.error(`Fetch error for ${model}:`, fetchErr.message);
                continue;
            }
        }

        return NextResponse.json({ error: "All Gemini models failed" }, { status: 500 });
    } catch (error: any) {
        console.error("Chat route error:", error);
        return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
    }
}
