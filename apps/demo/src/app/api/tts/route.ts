import { NextRequest, NextResponse } from "next/server";
import { EdgeTTS } from "node-edge-tts";
import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Edge TTS voices — fast, free, good quality
const EDGE_VOICES_ZH: Record<string, string> = {
    haru: "zh-CN-XiaoxiaoNeural",     // Warm female
    shizuku: "zh-CN-XiaohanNeural",   // Calm female
    koharu: "zh-CN-XiaoyiNeural",     // Sweet female
};
const EDGE_VOICES_EN: Record<string, string> = {
    haru: "en-US-JennyNeural",        // Warm female
    shizuku: "en-US-AriaNeural",      // Professional female
    koharu: "en-US-SaraNeural",       // Young female
};

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

// ═══ Edge TTS: Fast, free, good Chinese (~0.5-1s) ═══
async function generateEdgeTTS(text: string, voice: string): Promise<Buffer | null> {
    const tmpFile = join(tmpdir(), `edge-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
    try {
        const tts = new EdgeTTS({ voice });
        await tts.ttsPromise(text, tmpFile);
        const audioData = await readFile(tmpFile);
        // Clean up temp file asynchronously
        unlink(tmpFile).catch(() => { });
        return audioData;
    } catch (e: any) {
        console.warn(`[EdgeTTS] Failed: ${e.message}`);
        unlink(tmpFile).catch(() => { });
        return null;
    }
}

// Generate TTS with Gemini native audio (same API key as chat)
async function generateGeminiTTS(text: string, voiceName: string): Promise<Buffer | null> {
    if (!GEMINI_API_KEY) return null;

    // Try dedicated TTS model first, then regular Gemini with audio output
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
                continue; // Try next model
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
                return pcmToWav(rawBuffer, 24000, 1, 16); // Gemini default: 24kHz mono 16-bit
            }

            return rawBuffer;
        } catch (e: any) {
            console.warn(`[Gemini TTS] ${model} error: ${e.message}`);
        }
    }

    return null;
}

// Convert raw PCM to WAV format (adds RIFF/WAVE headers)
function pcmToWav(pcmData: Buffer, sampleRate: number, channels: number, bitDepth: number): Buffer {
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    const dataSize = pcmData.length;
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);

    // RIFF header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);

    // fmt chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);           // chunk size
    buffer.writeUInt16LE(1, 20);            // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitDepth, 34);

    // data chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcmData.copy(buffer, headerSize);

    return buffer;
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
        const { text, avatar, voiceOverride } = await req.json();

        if (!text) {
            return NextResponse.json({ error: "No text" }, { status: 400 });
        }

        const avatarId = avatar || "haru";
        const chinese = isChinese(text);

        let audioBuffer: Buffer | null = null;
        let engine = "none";

        if (chinese) {
            // Chinese priority: Edge TTS (fast+good) → Gemini (slower+good) → ElevenLabs (bad Chinese)
            const edgeVoice = EDGE_VOICES_ZH[avatarId] || EDGE_VOICES_ZH.haru;
            try {
                audioBuffer = await withTimeout(generateEdgeTTS(text, edgeVoice), 3000, "EdgeTTS-ZH");
                if (audioBuffer) engine = "edge-tts-zh";
            } catch (e: any) {
                console.warn(`[TTS] Edge TTS ZH failed: ${e.message}`);
            }

            if (!audioBuffer) {
                const geminiVoice = voiceOverride?.gemini || GEMINI_VOICES[avatarId] || GEMINI_VOICES.haru;
                try {
                    audioBuffer = await withTimeout(generateGeminiTTS(text, geminiVoice), 6000, "Gemini TTS");
                    if (audioBuffer) engine = "gemini-tts";
                } catch (e: any) {
                    console.warn(`[TTS] Gemini TTS failed: ${e.message}`);
                }
            }

            // ElevenLabs Chinese is terrible — last resort only
            if (!audioBuffer) {
                const voiceId = voiceOverride?.elevenlabs || ELEVENLABS_VOICES[avatarId] || ELEVENLABS_VOICES.haru;
                try {
                    audioBuffer = await withTimeout(generateElevenLabsTTS(text, voiceId), 4000, "ElevenLabs-ZH");
                    if (audioBuffer) engine = "elevenlabs-zh-lastresort";
                } catch (e: any) {
                    console.warn(`[TTS] ElevenLabs ZH fallback failed: ${e.message}`);
                }
            }
        } else {
            // English priority: Edge TTS (fast) → ElevenLabs (best quality) → Gemini
            const edgeVoice = EDGE_VOICES_EN[avatarId] || EDGE_VOICES_EN.haru;
            try {
                audioBuffer = await withTimeout(generateEdgeTTS(text, edgeVoice), 3000, "EdgeTTS-EN");
                if (audioBuffer) engine = "edge-tts-en";
            } catch (e: any) {
                console.warn(`[TTS] Edge TTS EN failed: ${e.message}`);
            }

            if (!audioBuffer) {
                const voiceId = voiceOverride?.elevenlabs || ELEVENLABS_VOICES[avatarId] || ELEVENLABS_VOICES.haru;
                try {
                    audioBuffer = await withTimeout(generateElevenLabsTTS(text, voiceId), 4000, "ElevenLabs");
                    if (audioBuffer) engine = "elevenlabs";
                } catch (e: any) {
                    console.warn(`[TTS] ElevenLabs failed: ${e.message}`);
                }
            }

            if (!audioBuffer) {
                const geminiVoice = voiceOverride?.gemini || GEMINI_VOICES[avatarId] || GEMINI_VOICES.haru;
                try {
                    audioBuffer = await withTimeout(generateGeminiTTS(text, geminiVoice), 6000, "Gemini-TTS-EN");
                    if (audioBuffer) engine = "gemini-tts-en";
                } catch (e: any) {
                    console.warn(`[TTS] Gemini EN fallback failed: ${e.message}`);
                }
            }
        }

        if (!audioBuffer) {
            console.warn(`[TTS] All providers failed for ${chinese ? 'zh' : 'en'} — client will use browser TTS`);
            // Return 204 No Content — client falls back to browser TTS gracefully
            return new NextResponse(null, { status: 204 });
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
        console.warn("[TTS] Error:", error.message);
        // Return 204 so client uses browser TTS instead of showing error
        return new NextResponse(null, { status: 204 });
    }
}


