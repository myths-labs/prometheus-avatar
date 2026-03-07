import { NextResponse } from "next/server";

/**
 * Chat API route — proxies messages to Claude or OpenAI
 * Keeps API key server-side for security
 */
export async function POST(req: Request) {
    try {
        const { message, apiKey, history } = await req.json();

        if (!message) {
            return NextResponse.json({ error: "No message provided" }, { status: 400 });
        }

        if (!apiKey) {
            return NextResponse.json({ error: "No API key provided" }, { status: 400 });
        }

        // Detect API type from key format
        const isAnthropic = apiKey.startsWith("sk-ant-");
        const isOpenAI = apiKey.startsWith("sk-");

        let reply: string;

        if (isAnthropic) {
            // Claude API
            const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                    model: "claude-sonnet-4-20250514",
                    max_tokens: 300,
                    system:
                        "You are speaking through a Live2D avatar. Keep responses short, expressive, and conversational. Use emojis and punctuation to convey emotion (the avatar will react to these). Stay under 2-3 sentences.",
                    messages: [
                        ...history.map((m: any) => ({ role: m.role, content: m.content })),
                        { role: "user", content: message },
                    ],
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Anthropic API error: ${response.status} ${errText}`);
            }

            const data = await response.json();
            reply = data.content?.[0]?.text || "I couldn't generate a response.";
        } else if (isOpenAI) {
            // OpenAI API
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    max_tokens: 300,
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are speaking through a Live2D avatar. Keep responses short, expressive, and conversational. Use emojis and punctuation to convey emotion (the avatar will react to these). Stay under 2-3 sentences.",
                        },
                        ...history.map((m: any) => ({ role: m.role, content: m.content })),
                        { role: "user", content: message },
                    ],
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OpenAI API error: ${response.status} ${errText}`);
            }

            const data = await response.json();
            reply = data.choices?.[0]?.message?.content || "I couldn't generate a response.";
        } else {
            return NextResponse.json(
                { error: "Unsupported API key format. Use a Claude or OpenAI key." },
                { status: 400 }
            );
        }

        return NextResponse.json({ reply });
    } catch (error) {
        console.error("[/api/chat] Error:", error);
        return NextResponse.json(
            { error: (error as Error).message || "Internal server error" },
            { status: 500 }
        );
    }
}
