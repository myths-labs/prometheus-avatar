import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { validateMpegAudio } from "./mpeg-audio.js";

/** Validate the WAV container returned by the base64 speech endpoint. */
function validateWav(bytes: Buffer): void {
    if (bytes.length < 12 || bytes.toString("latin1", 0, 4) !== "RIFF"
        || bytes.toString("latin1", 8, 12) !== "WAVE"
        || bytes.readUInt32LE(4) + 8 !== bytes.length) {
        throw new Error("Speech endpoint returned an invalid WAV container");
    }

    let offset = 12;
    let blockAlign = 0;
    let dataBytes = 0;
    let audioFormat = 0;
    let sampleBytes = 0;
    const dataChunks: Array<{ start: number; size: number }> = [];
    while (offset < bytes.length) {
        if (offset + 8 > bytes.length) throw new Error("Truncated WAV chunk header");
        const kind = bytes.toString("latin1", offset, offset + 4);
        const size = bytes.readUInt32LE(offset + 4);
        const start = offset + 8;
        const end = start + size;
        const paddedEnd = end + (size % 2);
        if (paddedEnd > bytes.length) throw new Error("Truncated WAV chunk data");

        if (kind === "fmt ") {
            if (size < 16 || blockAlign) throw new Error("Invalid WAV format chunk");
            const format = bytes.readUInt16LE(start);
            const channels = bytes.readUInt16LE(start + 2);
            const sampleRate = bytes.readUInt32LE(start + 4);
            const byteRate = bytes.readUInt32LE(start + 8);
            blockAlign = bytes.readUInt16LE(start + 12);
            const bits = bytes.readUInt16LE(start + 14);
            const supported = (format === 1 && [8, 16, 24, 32].includes(bits))
                || (format === 3 && [32, 64].includes(bits));
            if (!supported || !channels || !sampleRate || !blockAlign
                || blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign) {
                throw new Error("Unsupported or inconsistent WAV sample format");
            }
            audioFormat = format;
            sampleBytes = bits / 8;
        } else if (kind === "data") {
            dataBytes += size;
            dataChunks.push({ start, size });
        }
        offset = paddedEnd;
    }
    if (!blockAlign || !dataBytes || dataBytes % blockAlign) {
        throw new Error("Speech WAV has no complete audio frames");
    }
    for (const chunk of dataChunks) {
        if (chunk.size % blockAlign) {
            throw new Error("Speech WAV contains a partial audio frame");
        }
        if (audioFormat === 3) {
            for (let sample = chunk.start; sample < chunk.start + chunk.size; sample += sampleBytes) {
                const value = sampleBytes === 4 ? bytes.readFloatLE(sample) : bytes.readDoubleLE(sample);
                if (!Number.isFinite(value)) {
                    throw new Error("Speech WAV contains non-finite audio samples");
                }
            }
        }
    }
}

/** Return generated audio; playback can only be confirmed by the playing host. */
export function speechResult(response: unknown, text: string): CallToolResult {
    if (!response || typeof response !== "object" || Array.isArray(response)) {
        throw new Error("Speech endpoint returned an invalid response");
    }
    const result = response as { audio?: unknown; mimeType?: unknown; voice?: unknown; voiceAssetId?: unknown; engine?: unknown };
    if (typeof result.audio !== "string" || !result.audio.length) {
        throw new Error("Speech endpoint returned no audio");
    }
    const bytes = Buffer.from(result.audio, "base64");
    if (!bytes.length || bytes.toString("base64") !== result.audio) {
        throw new Error("Speech endpoint returned invalid base64 audio");
    }
    const mimeType = result.mimeType === undefined ? "audio/wav" : result.mimeType;
    if (mimeType === "audio/wav") {
        validateWav(bytes);
    } else if (mimeType === "audio/mpeg") {
        validateMpegAudio(bytes);
    } else {
        throw new Error("Speech endpoint returned an unsupported audio format");
    }

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    status: "audio_generated",
                    text,
                    voice: typeof result.voiceAssetId === "string" ? null : typeof result.voice === "string" ? result.voice : null,
                    voice_asset_id: typeof result.voiceAssetId === "string" ? result.voiceAssetId : null,
                    engine: typeof result.engine === "string" ? result.engine : null,
                    audio_generated: true,
                    audio_format: mimeType,
                    audio_bytes: bytes.length,
                    delivery: "mcp_audio_content",
                    playback_confirmed: false,
                    emotion_control: "unsupported",
                    instructions: "Play the audio content in a capable client. Avatar playback and lip-sync require a connected host and its playback receipts.",
                }, null, 2),
            },
            { type: "audio", data: result.audio, mimeType },
        ],
    };
}
