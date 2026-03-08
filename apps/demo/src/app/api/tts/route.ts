import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Detect if text contains Chinese characters
function isChinese(text: string): boolean {
    return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

// Timeout wrapper — prevents any single TTS call from hanging
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        ),
    ]);
}

// ElevenLabs voices (works for both English and Chinese with multilingual_v2)
const ELEVENLABS_VOICES: Record<string, string> = {
    haru: "EXAVITQu4vr4xnSDxMaL",    // Sarah — warm
    shizuku: "FGY2WhTYpPnrIDTdsKH5", // Laura — elegant
    koharu: "jBpfAIEiAKNebRVppxo4",  // Gigi — sweet
};

// Gemini native TTS voices (supports Chinese natively)
const GEMINI_VOICES: Record<string, string> = {
    haru: "Kore",      // Warm female
    shizuku: "Aoede",   // Elegant female
    koharu: "Leda",     // Sweet female
};

// Generate TTS with Gemini native audio (same API key as chat)
async function generateGeminiTTS(text: string, voiceName: string): Promise<Buffer | null> {
    if (!GEMINI_API_KEY) return null;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text }]
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
        console.error(`[Gemini TTS] ${response.status}: ${errText.slice(0, 200)}`);
        return null;
    }

    const data = await response.json();

    // Extract audio from Gemini response
    const audioPart = data.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("audio/")
    );

    if (!audioPart?.inlineData?.data) {
        console.error("[Gemini TTS] No audio data in response");
        return null;
    }

    return Buffer.from(audioPart.inlineData.data, "base64");
}

// ElevenLabs TTS (reliable REST API)
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

    if (!response.ok) {
        console.error(`[ElevenLabs] ${response.status}`);
        return null;
    }
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
        let engine = "none";

        if (chinese) {
            // Chinese: Gemini native TTS (8s) → ElevenLabs (4s)
            const geminiVoice = GEMINI_VOICES[avatarId] || GEMINI_VOICES.haru;
            try {
                audioBuffer = await withTimeout(
                    generateGeminiTTS(text, geminiVoice),
                    8000, "Gemini TTS"
                );
                if (audioBuffer) engine = "gemini-tts";
            } catch (e: any) {
                console.warn(`[TTS] Gemini TTS failed: ${e.message}`);
            }

            // Fallback: ElevenLabs (sounds accented but works)
            if (!audioBuffer) {
                const voiceId = ELEVENLABS_VOICES[avatarId] || ELEVENLABS_VOICES.haru;
                try {
                    audioBuffer = await withTimeout(
                        generateElevenLabsTTS(text, voiceId),
                        4000, "ElevenLabs"
                    );
                    if (audioBuffer) engine = "elevenlabs-zh-fallback";
                } catch (e: any) {
                    console.warn(`[TTS] ElevenLabs fallback failed: ${e.message}`);
                }
            }
        } else {
            // English: ElevenLabs (4s) → Google (4s)
            const voiceId = ELEVENLABS_VOICES[avatarId] || ELEVENLABS_VOICES.haru;
            try {
                audioBuffer = await withTimeout(
                    generateElevenLabsTTS(text, voiceId),
                    4000, "ElevenLabs"
                );
                if (audioBuffer) engine = "elevenlabs";
            } catch (e: any) {
                console.warn(`[TTS] ElevenLabs failed: ${e.message}`);
            }
        }

        if (!audioBuffer) {
            console.error(`[TTS] All providers failed for ${chinese ? 'zh' : 'en'}`);
            return NextResponse.json({ error: "TTS generation failed" }, { status: 500 });
        }

        console.log(`[TTS] ✅ engine=${engine}, lang=${chinese ? 'zh' : 'en'}, bytes=${audioBuffer.length}`);

        return new NextResponse(new Uint8Array(audioBuffer), {
            headers: {
                "Content-Type": engine.startsWith("gemini") ? "audio/wav" : "audio/mpeg",
                "Cache-Control": "public, max-age=3600",
                "X-TTS-Engine": engine,
                "X-TTS-Language": chinese ? "zh" : "en",
            },
        });
    } catch (error: any) {
        console.error("[TTS] Fatal:", error);
        return NextResponse.json({ error: error.message || "TTS failed" }, { status: 500 });
    }
}


