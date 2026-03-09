import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Timeout wrapper
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        ),
    ]);
}

// Gemini TTS voices
const GEMINI_VOICES: Record<string, string> = {
    haru: "Kore",      // Warm female
    shizuku: "Aoede",   // Elegant female
    koharu: "Leda",     // Sweet female
};

// Generate TTS with Gemini native audio
async function generateGeminiTTS(text: string, voiceName: string): Promise<Buffer | null> {
    if (!GEMINI_API_KEY) return null;

    const models = [
        "gemini-2.5-flash-preview-tts",
        "gemini-2.0-flash",
    ];

    for (const model of models) {
        try {
            console.log(`[Gemini TTS] Trying model: ${model}`);
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: `Please speak this text naturally: ${text}` }]
                        }],
                        generationConfig: {
                            responseModalities: ["AUDIO"],
                            speechConfig: {
                                voiceConfig: {
                                    prebuiltVoiceConfig: {
                                        voiceName: voiceName,
                                    }
                                }
                            }
                        },
                    }),
                }
            );

            if (!response.ok) {
                const errText = await response.text();
                console.warn(`[Gemini TTS] ${model} ${response.status}: ${errText.slice(0, 200)}`);
                continue;
            }

            const data = await response.json();
            const audioPart = data.candidates?.[0]?.content?.parts?.find(
                (p: any) => p.inlineData?.mimeType?.startsWith("audio/")
            );

            if (!audioPart?.inlineData?.data) {
                console.warn(`[Gemini TTS] ${model}: No audio data in response`);
                continue;
            }

            const mimeType = audioPart.inlineData.mimeType || "audio/pcm";
            console.log(`[Gemini TTS] ✅ Success with ${model}, mimeType=${mimeType}`);

            const rawBuffer = Buffer.from(audioPart.inlineData.data, "base64");

            // If it's raw PCM, wrap in WAV headers so browsers can play it
            if (mimeType.includes("pcm") || mimeType === "audio/L16") {
                return pcmToWav(rawBuffer, 24000, 1, 16);
            }

            return rawBuffer;
        } catch (e: any) {
            console.warn(`[Gemini TTS] ${model} error: ${e.message}`);
        }
    }

    return null;
}

// Convert raw PCM to WAV format
function pcmToWav(pcmData: Buffer, sampleRate: number, channels: number, bitDepth: number): Buffer {
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    const dataSize = pcmData.length;
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitDepth, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcmData.copy(buffer, headerSize);

    return buffer;
}

export async function POST(req: NextRequest) {
    try {
        const { text, avatar, voiceOverride } = await req.json();

        if (!text) {
            return NextResponse.json({ error: "No text" }, { status: 400 });
        }

        const avatarId = avatar || "haru";

        let audioBuffer: Buffer | null = null;

        // ═══ GEMINI ONLY — consistent voice ═══
        const geminiVoice = voiceOverride?.gemini || GEMINI_VOICES[avatarId] || GEMINI_VOICES.haru;
        try {
            audioBuffer = await withTimeout(
                generateGeminiTTS(text, geminiVoice),
                10000, "Gemini TTS"
            );
        } catch (e: any) {
            console.warn(`[TTS] Gemini TTS failed: ${e.message}`);
        }

        if (!audioBuffer) {
            // 204 = no audio, client falls back to browser TTS
            return new NextResponse(null, { status: 204 });
        }

        console.log(`[TTS] ✅ gemini-tts, bytes=${audioBuffer.length}`);

        return new NextResponse(new Uint8Array(audioBuffer), {
            headers: {
                "Content-Type": "audio/wav",
                "Cache-Control": "public, max-age=3600",
                "X-TTS-Engine": "gemini-tts",
            },
        });
    } catch (error: any) {
        console.warn("[TTS] Error:", error.message);
        return new NextResponse(null, { status: 204 });
    }
}
