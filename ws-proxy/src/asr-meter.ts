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
 * then asks for more seconds as the audio uses them up, and reports the end with the audio seconds sent (16 kHz,
 * 16-bit mono: 32,000 bytes a second), through the same signed report path as realtime (realtime-meter.ts
 * signUsageReport). A "stop" answer closes the session.
 *
 * Budget (B-167). Recognition draws on the personal voice budget, and the ledger now grants each ask what the budget
 * still pays for (marketplace usage_extend, 20261010142000). So the meter counts audio seconds, not wall-clock
 * minutes, and it forwards only audio the ledger already holds:
 *   - Nothing is forwarded before the start is answered: the client's audio waits, in order, and goes out when the
 *     start holds ASR_STEP_SECONDS. A start the ledger refuses (budget or pool used up) forwards none of it.
 *   - Each time the audio (sent and waiting) comes within ASR_LEAD_SECONDS of what is held, the meter asks for another
 *     ASR_STEP_SECONDS ({event: "tick", seconds}) and adds what was granted. A short grant is the budget's last
 *     stretch; the next ask is answered USAGE_BUDGET_EXHAUSTED and the session stops at once, inside what is held.
 *   - Audio past what is held waits for the answer instead of going upstream, so a client that sends faster than
 *     real time cannot outrun the ledger, and an honest one whose packets arrive in a burst (after a network stall)
 *     loses nothing. More than ASR_BACKLOG_SECONDS waiting is not a microphone: that client is refused (1008).
 *   - The ledger lets a hold lapse 120 s after its last extension. A hands-free client may send nothing for longer
 *     (voice activity gating, or muted while the avatar speaks), so ASR_KEEPALIVE_MS (50 s) after the last answer the
 *     meter asks for 0 seconds, which only renews the hold; two renewals fit in the 120 s, so one lost report is not a
 *     lapsed hold. The renewal is never refused for the budget (what is held is already paid for), only by the pool
 *     switches, which stop the session as an ask would.
 * A report that fails or times out (5 s, under the 10 s lead) fails open with what it asked for, as before: a
 * database outage must not hang up a conversation. Each such answer lets one step through unchecked, and a start that
 * fails open leaves the whole session unmetered (it has no reservation to extend). An answer that says continue but
 * grants nothing for a non-zero ask cannot come from the ledger; it is taken as the end of the budget rather than asked
 * again at once.
 *
 * Frame layout (SAUC v3, marketplace-app src/lib/voiceAsrProtocol.ts): [4B header][4B big-endian payload size][payload]
 *   header byte 0 = 0x11, byte 1 = type << 4 | flags, byte 2 = serialization << 4 | compression, byte 3 = 0.
 *
 * No imports, so node --test can load it directly.
 */
export const ASR_INPUT_BYTES_PER_SECOND = 32_000;
/** Audio seconds the start reserves (marketplace realtime-usage route) and each ask asks for. */
export const ASR_STEP_SECONDS = 60;
/** Ask for the next stretch when this many held audio seconds are left: well over the 5 s report timeout. */
export const ASR_LEAD_SECONDS = 10;
/** Audio that may wait for the ledger's answer: a client's connect buffer plus a 5 s report timeout, with room. */
export const ASR_BACKLOG_SECONDS = 20;
/** Renew the hold this long after the last answer: twice inside the route's 120 s TTL, each with 5 s to answer. */
export const ASR_KEEPALIVE_MS = 50_000;
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

type Report = { kind: "start" } | { kind: "tick"; reservation: string | null; seconds: number }
    | { kind: "end"; reservation: string | null; inputAudioSeconds: number };
/** The marketplace's answer. `seconds` is what it holds for the start or the ask (absent from an older marketplace:
 *  what was asked); a stop carries the ledger's refusal code, reset time and tier for the client. */
export type AsrUsageAnswer = { continue: boolean; reservation?: string | null; seconds?: number | null;
    code?: string | null; resets_at?: string | null; tier?: string | null };

export function createAsrMeter<F, T>(o: {
    schedule: (fn: () => void, ms: number) => T;
    cancel: (timer: T) => void;
    report: (r: Report) => Promise<AsrUsageAnswer>;
    /** Sends one client frame upstream; false when it could not be sent. */
    forward: (frame: F) => boolean;
    stop: (reason: "quota", answer: AsrUsageAnswer) => void;
}) {
    let active = false, ended = false, audioBytes = 0, reservation: string | null = null;
    // Audio seconds the ledger holds for this session: none until the start is answered.
    let held = 0;
    let asking = false;
    let keepalive: T | null = null;
    // Client frames waiting for the ledger to hold their seconds, in the order they came.
    let waiting: { frame: F; bytes: number }[] = [];
    let waitingBytes = 0;
    // Settles once the start answer is in (or failed), before any halt it triggers, so an end can wait for it without
    // waiting on itself.
    let markReservationKnown: () => void = () => {};
    const reservationKnown = new Promise<void>((resolve) => { markReservationKnown = resolve; });
    const sent = () => audioBytes / ASR_INPUT_BYTES_PER_SECOND;
    const fits = (bytes: number) => (audioBytes + bytes) / ASR_INPUT_BYTES_PER_SECOND <= held;
    // What an answer grants for an ask of `asked` seconds: its seconds, never more than asked; an answer without them
    // (an older marketplace, or a failed report answered "continue") counts as the whole ask.
    const grantedOf = (a: AsrUsageAnswer, asked: number) =>
        typeof a.seconds === "number" && Number.isFinite(a.seconds) && a.seconds >= 0 ? Math.min(a.seconds, asked) : asked;
    const send = (frame: F, bytes: number) => { if (o.forward(frame)) audioBytes += bytes; };
    const drain = () => {
        while (!ended && waiting.length > 0 && fits(waiting[0].bytes)) {
            const next = waiting.shift()!;
            waitingBytes -= next.bytes;
            send(next.frame, next.bytes);
        }
    };
    const disarm = () => { if (keepalive !== null) o.cancel(keepalive); keepalive = null; };
    const arm = () => {
        disarm();
        if (!ended && reservation !== null) keepalive = o.schedule(() => { keepalive = null; if (!ended && !asking) request(0); }, ASR_KEEPALIVE_MS);
    };
    // `then` runs as soon as this call has ended the session, before the end report (which may take up to 5 s).
    const end = async (then?: () => void): Promise<boolean> => {
        if (!active || ended) return false;
        ended = true;
        disarm();
        waiting = []; waitingBytes = 0; // never forwarded, so never billed
        then?.();
        await reservationKnown; // the end carries the reservation the start was given
        await o.report({ kind: "end", reservation, inputAudioSeconds: Math.round(sent() * 1000) / 1000 });
        return true;
    };
    // A stop closes the session at once: no audio is forwarded while the end report is on its way.
    const halt = async (answer: AsrUsageAnswer) => { await end(() => o.stop("quota", answer)); };
    // Every answer, the start's included: a stop ends the session; otherwise what was granted is added, the audio that
    // now fits goes out, the hold's renewal is rearmed, and the next stretch is asked for if the audio is already near.
    const answered = (answer: AsrUsageAnswer, asked: number) => {
        asking = false;
        if (ended) return;
        if (!answer.continue) { void halt(answer); return; }
        const granted = grantedOf(answer, asked);
        // Never asked again at once for nothing: that would be a report loop, not a session.
        if (asked > 0 && granted <= 0) { void halt({ ...answer, continue: false, code: answer.code ?? "USAGE_BUDGET_EXHAUSTED" }); return; }
        held += granted;
        drain();
        arm();
        ask();
    };
    function request(seconds: number) {
        asking = true;
        disarm();
        void o.report({ kind: "tick", reservation, seconds }).then((a) => answered(a, seconds), () => answered({ continue: true }, seconds));
    }
    // Nothing is asked before the start (the request frame comes first and carries no audio) or while an answer is due.
    function ask() {
        if (!active || ended || asking || (audioBytes + waitingBytes) / ASR_INPUT_BYTES_PER_SECOND < held - ASR_LEAD_SECONDS) return;
        request(ASR_STEP_SECONDS);
    }
    const begin = () => {
        active = true;
        asking = true;
        void o.report({ kind: "start" }).then((answer) => {
            reservation = answer.reservation ?? null;
            markReservationKnown();
            answered(answer, ASR_STEP_SECONDS);
        }, () => { markReservationKnown(); answered({ continue: true }, ASR_STEP_SECONDS); }); // a failed report fails open, like realtime
    };
    return {
        /**
         * Each client frame that passed the guard, in order, with its audio bytes (0 for the request). Forwarded now
         * when the ledger holds its seconds and nothing is waiting, else kept until an answer makes room; the first
         * audio packet starts the meter. False when more than ASR_BACKLOG_SECONDS would be waiting: refuse the client.
         */
        offer(frame: F, bytes: number): boolean {
            if (ended) return true; // the session is over: nothing more goes upstream
            if (bytes > 0 && !active) begin();
            if (waiting.length === 0 && fits(bytes)) { send(frame, bytes); ask(); return true; }
            if (waitingBytes + bytes > ASR_BACKLOG_SECONDS * ASR_INPUT_BYTES_PER_SECOND) return false;
            waiting.push({ frame, bytes });
            waitingBytes += bytes;
            ask();
            return true;
        },
        audioSeconds: () => sent(),
        heldSeconds: () => held,
        waitingSeconds: () => waitingBytes / ASR_INPUT_BYTES_PER_SECOND,
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
