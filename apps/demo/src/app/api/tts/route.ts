import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Detect if text contains Chinese characters
function isChinese(text: string): boolean {
    return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

// ElevenLabs voices for English
const ELEVENLABS_VOICES: Record<string, string> = {
    haru: "EXAVITQu4vr4xnSDxMaL",    // Sarah — warm
    shizuku: "FGY2WhTYpPnrIDTdsKH5", // Laura — elegant
    koharu: "jBpfAIEiAKNebRVppxo4",  // Gigi — sweet
};

// Edge TTS voices for Chinese
const EDGE_VOICES: Record<string, string> = {
    haru: "zh-CN-XiaoxiaoNeural",     // 小晓 — 活泼可爱
    shizuku: "zh-CN-XiaoyiNeural",    // 小忆 — 温柔优雅
    koharu: "zh-CN-XiaohanNeural",    // 小涵 — 甜美
};

// Generate Chinese TTS with Microsoft Edge
async function generateEdgeTTS(text: string, voice: string): Promise<Buffer> {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const readable = tts.toStream(text);
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
        readable.on("data", (chunk: Buffer) => chunks.push(chunk));
        readable.on("end", () => resolve(Buffer.concat(chunks)));
        readable.on("error", reject);
    });
}

// Generate English TTS with ElevenLabs
async function generateElevenLabsTTS(text: string, voiceId: string): Promise<Buffer | null> {
    if (!ELEVENLABS_API_KEY) return null;

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
    });

    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

export async function POST(req: NextRequest) {
    try {
        const { text, avatar } = await req.json();

        if (!text) {
            return NextResponse.json({ error: "No text" }, { status: 400 });
        }

        const avatarId = avatar || "haru";
        const chinese = isChinese(text);

        let audioBuffer: Buffer | null = null;

        if (chinese) {
            // Chinese → Microsoft Edge TTS (much better quality)
            const voice = EDGE_VOICES[avatarId] || EDGE_VOICES.haru;
            try {
                audioBuffer = await generateEdgeTTS(text, voice);
            } catch (e) {
                console.error("Edge TTS error:", e);
            }
        } else {
            // English → ElevenLabs
            const voiceId = ELEVENLABS_VOICES[avatarId] || ELEVENLABS_VOICES.haru;
            try {
                audioBuffer = await generateElevenLabsTTS(text, voiceId);
            } catch (e) {
                console.error("ElevenLabs error:", e);
            }
        }

        // Fallback: try the other provider
        if (!audioBuffer) {
            if (chinese) {
                const voiceId = ELEVENLABS_VOICES[avatarId] || ELEVENLABS_VOICES.haru;
                audioBuffer = await generateElevenLabsTTS(text, voiceId).catch(() => null);
            } else {
                const voice = EDGE_VOICES[avatarId] || EDGE_VOICES.haru;
                audioBuffer = await generateEdgeTTS(text, voice).catch(() => null);
            }
        }

        if (!audioBuffer) {
            return NextResponse.json({ error: "TTS generation failed" }, { status: 500 });
        }

        return new NextResponse(audioBuffer, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch (error: any) {
        console.error("TTS error:", error);
        return NextResponse.json({ error: error.message || "TTS failed" }, { status: 500 });
    }
}
