import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Voice IDs for each avatar personality
const VOICE_MAP: Record<string, string> = {
    haru: "EXAVITQu4vr4xnSDxMaL",      // Sarah — warm, friendly
    shizuku: "FGY2WhTYpPnrIDTdsKH5",    // Laura — calm, elegant
    koharu: "jBpfuIE2acCO8z3wKNLl",     // Gigi — sweet, young
    default: "EXAVITQu4vr4xnSDxMaL",
};

export async function POST(req: NextRequest) {
    try {
        const { text, avatar } = await req.json();

        if (!text) {
            return NextResponse.json({ error: "No text provided" }, { status: 400 });
        }

        if (!ELEVENLABS_API_KEY) {
            return NextResponse.json({ error: "ElevenLabs API key not configured" }, { status: 500 });
        }

        const voiceId = VOICE_MAP[avatar] || VOICE_MAP.default;

        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
                body: JSON.stringify({
                    text: text.slice(0, 500), // Limit to save credits
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0.3,
                    },
                }),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            console.error("ElevenLabs error:", error);
            return NextResponse.json({ error: "TTS failed" }, { status: 500 });
        }

        const audioBuffer = await response.arrayBuffer();

        return new NextResponse(audioBuffer, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch (error) {
        console.error("TTS error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
