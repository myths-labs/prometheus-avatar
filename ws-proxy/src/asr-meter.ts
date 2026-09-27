/**
 * Streaming speech recognition on platform credentials: a frame guard and a usage meter.
 *
 * Volcengine bills streaming recognition by the audio it receives (volc.seedasr.sauc.duration), so the meter counts
 * the audio bytes the client sends upstream, not the time the socket is open. That count is only a duration if the
 * audio is what it claims to be, so the guard first holds the client to the one shape the marketplace client sends:
 *   - the first frame is a full request: JSON, uncompressed, audio {format "pcm", rate 16000, bits 16, channel 1};
 *   - every later frame is an uncompressed audio-only packet, and nothing follows the packet with the last flag.
 * A compressed codec or a gzip payload would carry minutes of speech in a few bytes; anything else closes the socket.
 *
 * The clock starts with the first audio packet; a socket that sends none reports nothing. The meter reports start,
 * each minute, and the end with the audio seconds sent (16 kHz, 16-bit mono: 32,000 bytes a second), through the
 * same signed report path as realtime (realtime-meter.ts signUsageReport). A "stop" answer closes the session.
 *
 * Frame layout (SAUC v3, marketplace-app src/lib/voiceAsrProtocol.ts): [4B header][4B big-endian payload size][payload]
 *   header byte 0 = 0x11, byte 1 = type << 4 | flags, byte 2 = serialization << 4 | compression, byte 3 = 0.
 *
 * No imports, so node --test can load it directly.
 */
export const ASR_INPUT_BYTES_PER_SECOND = 32_000;
const TICK_MS = 60_000;
const MAX_FRAME_BYTES = 64 * 1024; // 100 ms of audio is 3,200 bytes; a request is well under 4 KB
const TYPE_FULL_REQUEST = 0b0001, TYPE_AUDIO = 0b0010;
const FLAG_LAST = 0b0010;
const SERIALIZATION_JSON = 1, COMPRESSION_NONE = 0;

export type AsrFrameVerdict = { ok: true; audioBytes: number } | { ok: false; reason: string };

/** Checks each client frame in order; one instance per socket. */
export function createAsrFrameGuard() {
    let stage: "request" | "audio" | "done" = "request";
    const refuse = (reason: string): AsrFrameVerdict => { stage = "done"; return { ok: false, reason }; };
    return {
        inspect(data: unknown): AsrFrameVerdict {
            if (stage === "done") return refuse("frame after the last packet");
            if (!(data instanceof ArrayBuffer)) return refuse("text frame");
            if (data.byteLength < 8 || data.byteLength > MAX_FRAME_BYTES) return refuse("frame size");
            const bytes = new Uint8Array(data), view = new DataView(data);
            if (bytes[0] !== 0x11 || bytes[3] !== 0) return refuse("header");
            if ((bytes[2] & 0x0f) !== COMPRESSION_NONE) return refuse("compressed frame");
            if (view.getUint32(4) !== data.byteLength - 8) return refuse("payload size");
            const type = bytes[1] >> 4, flags = bytes[1] & 0x0f;
            if (stage === "request") {
                if (type !== TYPE_FULL_REQUEST || flags !== 0 || (bytes[2] >> 4) !== SERIALIZATION_JSON) return refuse("first frame is not a request");
                let body: any;
                try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(8))); } catch { return refuse("request is not JSON"); }
                const audio = body?.audio;
                if (!audio || audio.format !== "pcm" || audio.rate !== 16000 || audio.bits !== 16 || audio.channel !== 1
                    || (audio.codec !== undefined && audio.codec !== "raw")) return refuse("audio is not 16 kHz 16-bit mono PCM");
                stage = "audio";
                return { ok: true, audioBytes: 0 };
            }
            if (type !== TYPE_AUDIO || (flags !== 0 && flags !== FLAG_LAST)) return refuse("not an audio packet");
            if (flags === FLAG_LAST) stage = "done";
            return { ok: true, audioBytes: data.byteLength - 8 };
        },
    };
}

type Report = { kind: "start" } | { kind: "tick"; reservation: string | null }
    | { kind: "end"; reservation: string | null; inputAudioSeconds: number };

export function createAsrMeter<T>(o: {
    schedule: (fn: () => Promise<void> | void, ms: number) => T;
    cancel: (timer: T) => void;
    report: (r: Report) => Promise<{ continue: boolean; reservation?: string | null }>;
    stop: (reason: "quota") => void;
}) {
    let active = false, ended = false, audioBytes = 0, reservation: string | null = null, tick: T | null = null;
    // Settles once the start answer is in (or failed), before any halt it triggers, so an end can wait for it without
    // waiting on itself.
    let markReservationKnown: () => void = () => {};
    const reservationKnown = new Promise<void>((resolve) => { markReservationKnown = resolve; });
    const end = async (): Promise<boolean> => {
        if (!active || ended) return false;
        ended = true;
        if (tick) o.cancel(tick);
        tick = null;
        await reservationKnown; // the end carries the reservation the start was given
        await o.report({ kind: "end", reservation, inputAudioSeconds: Math.round((audioBytes / ASR_INPUT_BYTES_PER_SECOND) * 1000) / 1000 });
        return true;
    };
    const halt = async () => { if (await end()) o.stop("quota"); };
    const armTick = () => {
        tick = o.schedule(async () => {
            if (ended) return;
            const answer = await o.report({ kind: "tick", reservation });
            if (!answer.continue) return halt();
            armTick();
        }, TICK_MS);
    };
    return {
        /** Called for each audio packet forwarded upstream, with its audio bytes. Does not delay the packet. */
        onAudio(bytes: number) {
            if (ended || bytes <= 0) return;
            audioBytes += bytes;
            if (active) return;
            active = true;
            void o.report({ kind: "start" }).then(async (answer) => {
                reservation = answer.reservation ?? null;
                markReservationKnown();
                if (!answer.continue) { await halt(); return; }
                if (!ended) armTick();
            }, () => { markReservationKnown(); if (!ended) armTick(); }); // a failed report fails open, like realtime
        },
        audioSeconds: () => audioBytes / ASR_INPUT_BYTES_PER_SECOND,
        close() { void end(); },
    };
}

/** The ticket purpose for recognition: a v1 ticket whose subject starts with this may open /asr and nothing else. */
export const ASR_TICKET_PREFIX = "asr:";

/**
 * A v1 ticket minted for recognition ("asr:" subject) opens /asr only, and /asr accepts no other v1 ticket. Without
 * this any v1 ticket would open every platform path (fish-rest, test, ...) with the same subject.
 */
export function ticketFitsPath(sub: string, engineName: string): boolean {
    return (engineName === "asr") === sub.startsWith(ASR_TICKET_PREFIX);
}

/** Streaming recognition resources and their endpoints; anything else falls back to ASR 2.0. */
export const ASR_RESOURCES: Record<string, string> = {
    "volc.seedasr.sauc.duration": "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
    "volc.bigasr.sauc.duration": "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel",
};
export function asrResource(params?: URLSearchParams): string {
    const requested = params?.get("resourceId");
    return requested && Object.hasOwn(ASR_RESOURCES, requested) ? requested : "volc.seedasr.sauc.duration";
}
