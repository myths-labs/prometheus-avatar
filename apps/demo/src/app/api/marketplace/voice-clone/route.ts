import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

/**
 * Voice Cloning API — Creates a custom ElevenLabs voice from audio samples
 * 
 * Flow:
 * 1. Creator uploads voice sample(s) (.mp3/.wav)
 * 2. This API sends samples to ElevenLabs Voice Cloning (Instant Voice Clone)
 * 3. ElevenLabs returns a voiceId
 * 4. voiceId is stored as the marketplace voice asset
 * 5. When a buyer applies this voice, TTS API uses this voiceId → avatar speaks in that voice
 */

export async function POST(req: NextRequest) {
    try {
        if (!ELEVENLABS_API_KEY) {
            return NextResponse.json(
                { error: "ElevenLabs API key not configured. Set ELEVENLABS_API_KEY env var." },
                { status: 500 }
            );
        }

        const formData = await req.formData();
        const name = formData.get("name") as string;
        const description = formData.get("description") as string || "";
        const audioFile = formData.get("audio") as File;

        if (!name) {
            return NextResponse.json({ error: "Voice name is required" }, { status: 400 });
        }
        if (!audioFile) {
            return NextResponse.json({ error: "Audio sample file is required" }, { status: 400 });
        }

        // Validate audio file
        const validTypes = ["audio/mpeg", "audio/wav", "audio/mp3", "audio/x-wav", "audio/webm", "audio/ogg"];
        if (!validTypes.some(t => audioFile.type.includes(t) || audioFile.name.match(/\.(mp3|wav|webm|ogg|m4a)$/i))) {
            return NextResponse.json(
                { error: "Invalid audio format. Accepted: .mp3, .wav, .webm, .ogg, .m4a" },
                { status: 400 }
            );
        }

        // Check file size (max 10MB for ElevenLabs)
        if (audioFile.size > 10 * 1024 * 1024) {
            return NextResponse.json({ error: "Audio file must be under 10MB" }, { status: 400 });
        }

        console.log(`[VoiceClone] Cloning voice "${name}" from ${audioFile.name} (${(audioFile.size / 1024).toFixed(1)}KB)`);

        // Build FormData for ElevenLabs API
        const elevenLabsForm = new FormData();
        elevenLabsForm.append("name", `Prometheus_${name}`);
        elevenLabsForm.append("description", description || `Marketplace voice: ${name}`);

        // Convert File to Blob for ElevenLabs
        const audioBuffer = await audioFile.arrayBuffer();
        const audioBlob = new Blob([audioBuffer], { type: audioFile.type });
        elevenLabsForm.append("files", audioBlob, audioFile.name);

        // Call ElevenLabs Instant Voice Cloning API
        const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
            method: "POST",
            headers: {
                "xi-api-key": ELEVENLABS_API_KEY,
            },
            body: elevenLabsForm,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[VoiceClone] ElevenLabs error ${response.status}:`, errorText);
            return NextResponse.json(
                { error: `Voice cloning failed: ${response.status} — ${errorText.slice(0, 200)}` },
                { status: response.status }
            );
        }

        const result = await response.json();
        const voiceId = result.voice_id;

        console.log(`[VoiceClone] ✅ Voice "${name}" cloned successfully. voiceId: ${voiceId}`);

        // Return the voice config JSON that will be stored as the marketplace asset
        const voiceConfig = {
            voiceId,
            name,
            description,
            provider: "elevenlabs",
            model: "eleven_multilingual_v2",
            clonedFrom: audioFile.name,
            createdAt: new Date().toISOString(),
        };

        return NextResponse.json({
            success: true,
            voiceId,
            voiceConfig,
            message: `Voice "${name}" cloned successfully! This voiceId will be used for TTS.`,
        });

    } catch (error: any) {
        console.error("[VoiceClone] Error:", error);
        return NextResponse.json(
            { error: error.message || "Voice cloning failed" },
            { status: 500 }
        );
    }
}
