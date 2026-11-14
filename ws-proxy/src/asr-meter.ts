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
 * A report that fails to answer (timeout at 5 s, under the 10 s lead; network error; 5xx; unreadable answer) lets ONE step
 * through unchecked (ASR_FAIL_OPEN_STEPS); the next consecutive failure stops the session (USAGE_UNAVAILABLE), because a
 * database outage must not hang up a conversation but must not make it free either. A start that failed has no
 * reservation to extend, so its end report carries none and that audio is not billed: that is bounded by the one step
 * (60 s) and logged by the relay. A 4xx answer (usageDoorClosed) is a refusal and stops at once; so does an answer whose
 * `seconds` is present but malformed. Only an absent `seconds` means an older marketplace (the whole ask). An answer
 * that says continue but grants nothing for a non-zero ask cannot come from the ledger; it is taken as the end of the
 * budget rather than asked again at once.
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
/**
 * Frames that may wait, whatever their size: the byte cap above never trips on frames that carry no audio, and an empty
 * audio packet is a valid frame. The marketplace client sends one 3,200-byte packet per 100 ms (ASR_PACKET_BYTES in
 * voiceAsrSession.ts), so 20 s of backlog is 20 s * 10 packets/s = 200 frames; twice that (400) leaves headroom for a
 * client that cuts smaller packets, and the request frame. A hostile client cannot queue more than this.
 */
export const ASR_BACKLOG_FRAMES = 400;
/**
 * Consecutive usage reports (start or ask) that may fail (timeout, network error, 5xx, unreadable answer) before the
 * audio goes on: each failure lets one step (ASR_STEP_SECONDS) through unchecked, the next consecutive failure stops the
 * session. One failure is a database hiccup; a run of them is not a conversation to keep paying for. A report that
 * answers resets the count. How long to fail open is a money decision (⑨): change the number here only.
 */
export const ASR_FAIL_OPEN_STEPS = 1;
/** The marketplace ledger's own code for "cannot answer now"; the client reads it as try again. */
export const ASR_USAGE_UNAVAILABLE_CODE = "USAGE_UNAVAILABLE";
/** Seconds a client should wait before it asks again after a USAGE_UNAVAILABLE close (sent as retry_after; the backoff itself lives in the client). */
export const ASR_RETRY_AFTER_SECONDS = 2;
/**
 * A usage endpoint that refuses us (any 4xx: bad secret, unknown or lapsed reservation, malformed report, rate limit) is a
 * closed door, not an outage (⑨ 11/14): the session stops and no audio is forwarded. Only a timeout, a network error or a
 * 5xx counts as a failed report. 2xx and 5xx are null here.
 */
export function usageDoorClosed(status: number): AsrUsageAnswer | null {
    return status >= 400 && status < 500 ? { continue: false, code: ASR_USAGE_UNAVAILABLE_CODE } : null;
}
/** Why a usage report failed to answer: logged with each unchecked step. */
export type AsrFailReason = "timeout" | "network" | "5xx" | "unreserved";
export class UsageReportError extends Error {
    reason: AsrFailReason;
    constructor(reason: AsrFailReason) { super(`usage report failed (${reason})`); this.reason = reason; }
}
/** After a failed start, how long before the start is tried again (same session key) while the unchecked step runs. */
export const ASR_START_RETRY_MS = 5_000;
/** A short stable digest of a subject for logs: never the subject itself. */
export async function asrSubjectHash(sub: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`asr-log\n${sub}`));
    return [...new Uint8Array(digest).slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** The log line for each unchecked step: subject hash, reason, and the seconds let through with no reservation behind them. */
export function formatFailOpenLog(i: { subjectHash: string; reason: AsrFailReason; unreservedSeconds: number; report: "start" | "tick" }): string {
    return `asr: usage report failed open subject_hash=${i.subjectHash} reason=${i.reason} report=${i.report} unreserved_seconds=${i.unreservedSeconds}`;
}
/** Platform recognition is metered only when both halves of the report path are configured. */
export function asrMeteringConfigured(usageUrl: string | undefined, usageSecret: string | undefined): boolean {
    return typeof usageUrl === "string" && usageUrl !== "" && typeof usageSecret === "string" && usageSecret !== "";
}
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

/** `session` is the idempotency key of this socket's reservation: every start attempt and the end carry the same one, so a
 *  retry after a timeout (the first attempt may already have created the reservation) never creates a second. */
type Report = { kind: "start"; session: string } | { kind: "tick"; reservation: string | null; seconds: number }
    | { kind: "end"; reservation: string | null; inputAudioSeconds: number; session: string };
/** The marketplace's answer. `seconds` is what it holds for the start or the ask (absent from an older marketplace:
 *  what was asked); a stop carries the ledger's refusal code, reset time and tier for the client. */
export type AsrUsageAnswer = { continue: boolean; reservation?: string | null; seconds?: number | null;
    code?: string | null; resets_at?: string | null; tier?: string | null };

/** A usage answer is an object that says continue or not; a 2xx whose body is null, a list or a string is not one. */
function isAnswer(a: unknown): a is AsrUsageAnswer {
    return typeof a === "object" && a !== null && !Array.isArray(a) && typeof (a as { continue?: unknown }).continue === "boolean";
}

export function createAsrMeter<F, T>(o: {
    schedule: (fn: () => void, ms: number) => T;
    cancel: (timer: T) => void;
    report: (r: Report) => Promise<AsrUsageAnswer>;
    /** Sends one client frame upstream; false when it could not be sent. */
    forward: (frame: F) => boolean;
    stop: (reason: "quota", answer: AsrUsageAnswer) => void;
    /** Called for each step let through unchecked after a failed report (see ASR_FAIL_OPEN_STEPS). */
    onFailOpen?: (info: { report: "start" | "tick"; reason: AsrFailReason; unreservedSeconds: number }) => void;
    /** False for a visitor (no account to settle with): a start that fails, or answers "continue" with no reservation, stops the
     *  session at once instead of letting an unchecked step through (marketplace B-230 P5). Default true. */
    failOpenStart?: boolean;
    /** Idempotency key of the reservation; default a random UUID, fixed for the life of this meter. */
    sessionKey?: () => string;
}) {
    const session = (o.sessionKey ?? (() => crypto.randomUUID()))();
    let active = false, ended = false, audioBytes = 0, reservation: string | null = null;
    // Audio seconds the ledger holds for this session: none until the start is answered.
    let held = 0;
    let asking = false;
    // Consecutive failed start/ask reports (see ASR_FAIL_OPEN_STEPS).
    let failures = 0;
    // The start failed and its step is running unchecked: the start is retried (same key) until it answers.
    let unreservedStep = false;
    let retry: T | null = null;
    // The start attempt on its way (the first or a retry). A close while one is out waits for it: it may have created the
    // reservation, and the end must carry it (else nobody ever releases it).
    let startInFlight: Promise<void> | null = null;
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
    // What an answer grants for an ask of `asked` seconds: its seconds, never more than asked. Only an absent field means
    // an older marketplace (the whole ask); a present but malformed one ("0", -5, null, 1.5) is not a grant: null.
    const grantedOf = (a: AsrUsageAnswer, asked: number): number | null => {
        if (a.seconds === undefined) return asked;
        return typeof a.seconds === "number" && Number.isInteger(a.seconds) && a.seconds >= 0 ? Math.min(a.seconds, asked) : null;
    };
    const send = (frame: F, bytes: number) => { if (o.forward(frame)) audioBytes += bytes; };
    const drain = () => {
        while (!ended && waiting.length > 0 && fits(waiting[0].bytes)) {
            const next = waiting.shift()!;
            waitingBytes -= next.bytes;
            send(next.frame, next.bytes);
        }
    };
    const disarmRetry = () => { if (retry !== null) o.cancel(retry); retry = null; };
    const disarm = () => { if (keepalive !== null) o.cancel(keepalive); keepalive = null; };
    const arm = () => {
        disarm();
        if (!ended && reservation !== null) keepalive = o.schedule(() => { keepalive = null; if (!ended && !asking) request(0); }, ASR_KEEPALIVE_MS);
    };
    // `then` runs as soon as this call has ended the session, before the end report (which may take up to 5 s).
    const end = async (then?: () => void): Promise<boolean> => {
        if (!active || ended) return false;
        ended = true;
        disarm(); disarmRetry();
        waiting = []; waitingBytes = 0; // never forwarded, so never billed
        then?.();
        await reservationKnown; // the end carries the reservation the start was given
        if (startInFlight) await startInFlight; // ... including one a retry is still fetching (bounded by the 5 s report timeout)
        try { await o.report({ kind: "end", reservation, inputAudioSeconds: Math.round(sent() * 1000) / 1000, session }); } catch { /* nothing more to do */ }
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
        if (granted === null) { void halt({ ...answer, continue: false, code: ASR_USAGE_UNAVAILABLE_CODE }); return; }
        // Never asked again at once for nothing: that would be a report loop, not a session.
        if (asked > 0 && granted <= 0) { void halt({ ...answer, continue: false, code: answer.code ?? "USAGE_BUDGET_EXHAUSTED" }); return; }
        held += granted;
        drain();
        arm();
        ask();
    };
    // A report that failed to answer. A renewal (0 s) lets nothing through, so it costs nothing. An ask or the start lets one
    // step through unchecked, up to ASR_FAIL_OPEN_STEPS in a row; the next one stops the session.
    function failedReport(asked: number, kind: "start" | "tick", error: unknown) {
        if (kind === "start" && o.failOpenStart === false) { asking = false; void halt({ continue: false, code: ASR_USAGE_UNAVAILABLE_CODE }); return; }
        if (asked > 0) {
            failures++;
            if (failures > ASR_FAIL_OPEN_STEPS) { asking = false; void halt({ continue: false, code: ASR_USAGE_UNAVAILABLE_CODE }); return; }
            const reason = error instanceof UsageReportError ? error.reason : "network";
            o.onFailOpen?.({ report: kind, reason, unreservedSeconds: asked });
            if (kind === "start") { unreservedStep = true; scheduleRetry(); }
        }
        answered({ continue: true }, asked);
    }
    // While the start's step runs unchecked, try the start again (same session key). A retry costs nothing extra: it lets
    // no more audio through; if it answers, the ledger holds seconds from now on (the unchecked ones are not back-billed).
    function scheduleRetry() {
        disarmRetry();
        if (ended || reservation !== null) return;
        retry = o.schedule(() => { retry = null; if (!ended && !asking && reservation === null) startAttempt(false); }, ASR_START_RETRY_MS);
    }
    function startAttempt(counted: boolean) {
        asking = true;
        const failed = (error: unknown) => {
            if (!counted && unreservedStep) { asking = false; scheduleRetry(); return; } // a free retry that failed: keep going
            markReservationKnown();
            failedReport(ASR_STEP_SECONDS, "start", error);
        };
        const attempt: Promise<void> = o.report({ kind: "start", session }).then((answer) => {
            // A body that is not an answer (null, a list) is a failed start, never a hang: end() waits for the start to settle.
            if (!isAnswer(answer)) { failed(new UsageReportError("5xx")); return; }
            // "Continue" with no reservation is the marketplace saying its ledger cannot be reached: nothing is held, so it is a
            // failed start (an unchecked step at most), never a success that resets the count.
            if (answer.continue && !answer.reservation) { failed(new UsageReportError("unreserved")); return; }
            reservation = answer.reservation ?? null; // kept even if the session ended meanwhile: the end reads it
            markReservationKnown();
            failures = 0;
            disarmRetry();
            if (unreservedStep && answer.continue) { held = sent(); unreservedStep = false; } // what the ledger now holds starts here
            answered(answer, ASR_STEP_SECONDS);
        }, failed).catch(() => { markReservationKnown(); /* a handler error must not leave end() waiting or escape as unhandled */ })
            .finally(() => { if (startInFlight === attempt) startInFlight = null; });
        startInFlight = attempt;
    }
    function request(seconds: number) {
        asking = true;
        disarm();
        void o.report({ kind: "tick", reservation, seconds }).then((a) => {
            if (!isAnswer(a)) { failedReport(seconds, "tick", new UsageReportError("5xx")); return; } // 2xx with a body that is not an answer
            // Only an ask for seconds that is answered clears the count: a renewal (0 s) that goes through says nothing about
            // the ledger's ability to grant, and must not hand the speaker a fresh unchecked step every minute.
            if (seconds > 0) failures = 0;
            answered(a, seconds);
        }, (error) => failedReport(seconds, "tick", error));
    }
    // Nothing is asked before the start (the request frame comes first and carries no audio) or while an answer is due.
    function ask() {
        if (!active || ended || asking || (audioBytes + waitingBytes) / ASR_INPUT_BYTES_PER_SECOND < held - ASR_LEAD_SECONDS) return;
        if (reservation === null && unreservedStep) startAttempt(true); else request(ASR_STEP_SECONDS);
    }
    const begin = () => {
        active = true;
        startAttempt(true); // a failed start: one unchecked step, retried meanwhile, then stop
    };
    return {
        /**
         * Each client frame that passed the guard, in order, with its audio bytes (0 for the request). Forwarded now
         * when the ledger holds its seconds and nothing is waiting, else kept until an answer makes room; the first
         * audio packet starts the meter. False when more than ASR_BACKLOG_SECONDS of audio, or ASR_BACKLOG_FRAMES frames, would be waiting: refuse the client.
         */
        offer(frame: F, bytes: number): boolean {
            if (ended) return true; // the session is over: nothing more goes upstream
            if (bytes > 0 && !active) begin();
            if (waiting.length === 0 && fits(bytes)) { send(frame, bytes); ask(); return true; }
            if (waiting.length >= ASR_BACKLOG_FRAMES) return false;
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

/**
 * What happens to each client frame on platform recognition, with no way to reach the upstream except the meter: the
 * guard checks the frame, the meter forwards it (when the ledger holds its seconds) or keeps it waiting. No meter means
 * no recognition (the relay refuses such a socket before it connects, so this is the last line), never an unmetered send.
 */
export function handleAsrClientFrame(data: unknown, o: {
    guard: { inspect(data: unknown): AsrFrameVerdict };
    meter: { offer(frame: ArrayBuffer, bytes: number): boolean } | null;
    reject: (why: string) => void;
}): void {
    const verdict = o.guard.inspect(data);
    if (!verdict.ok) { o.reject(`refused a client frame (${verdict.reason})`); return; }
    if (!o.meter) { o.reject("no usage meter"); return; }
    if (!o.meter.offer(data as ArrayBuffer, verdict.audioBytes)) o.reject("too much audio waiting for the ledger");
}

/** The ticket purpose for recognition: a v1 ticket whose subject starts with this may open /asr and nothing else. */
export const ASR_TICKET_PREFIX = "asr:";

/**
 * A v1 ticket opens /asr only, and only when it was minted for recognition ("asr:" subject). Every other platform path
 * refuses v1 tickets: /doubao takes lv2/lv3 live-voice grants (liveGrantFitsPath), and /volcengine, /minimax and the
 * /test probe take no ticket at all. The marketplace minted unprefixed v1 tickets for /api/volcengine-realtime-token
 * from 2026-08-15 (35b9b425b) to 2026-09-25 (0cf3c44a0), and a deployment built in that window keeps the signing
 * secret it was built with, so the relay must not trust a v1 ticket anywhere but /asr. None of these paths is metered.
 */
export function ticketFitsPath(sub: string, engineName: string): boolean {
    return engineName === "asr" && sub.startsWith(ASR_TICKET_PREFIX);
}

/** An lv2/lv3 live-voice grant opens /doubao only, and never with a recognition subject. */
export function liveGrantFitsPath(sub: string, engineName: string): boolean {
    return engineName === "doubao" && !sub.startsWith(ASR_TICKET_PREFIX);
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
