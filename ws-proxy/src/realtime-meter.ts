/**
 * Realtime usage metering for the Doubao relay.
 *
 * The clock starts when Doubao confirms a session (server event 150,
 * SessionStarted). Pre-connections that never start one -- /app opens them on
 * a 3.5 s loop while nobody is talking -- cost nothing and report nothing. The
 * meter reports start, then each minute, then the end (connected seconds, and
 * output audio seconds for bill reconciliation). A "stop" answer or 60 s with
 * neither side speaking ends the session.
 *
 * Reports are signed exactly like marketplace-app/src/lib/usage/internalCall.ts;
 * a Worker cannot import across repositories, so keep the two in sync BY HAND
 * (both test suites pin the same fixed vector).
 *
 * No imports, so node --test can load it directly.
 */
// Doubao realtime dialogue server events as the production service sends them (the numbers marketplace
// src/lib/useLiveVoice.ts handles; seen live 2026-09-27: 150, 350, 352, 450, 451, 459, 550).
export const SERVER_EVENT = { SESSION_STARTED: 150, SESSION_FINISHED: 152, SESSION_FAILED: 153, TTS_RESPONSE: 352 } as const;
/** Conversation: user speech (ASR 450/451/459) or bot output (TTS 350-359, chat 550/559). */
const ACTIVITY_EVENTS = new Set([350, 351, 352, 353, 359, 450, 451, 459, 550, 559,
    // An older numbering of the same events, still listed in doubaoProtocol.ts; counted in case the service uses it.
    200, 201, 202, 203, 300, 301, 302]);
const AUDIO_EVENTS = new Set([SERVER_EVENT.TTS_RESPONSE, 202]);
const OUTPUT_BYTES_PER_SECOND = 48_000; // pcm_s16le, 24 kHz, mono (marketplace doubaoProtocol.ts buildStartSession)
const TICK_MS = 60_000;
const IDLE_MS = 60_000;
export const USAGE_REPORT_PATH = "/api/internal/realtime-usage";

export function frameEvent(data: unknown): { event: number; payloadBytes: number } | null {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 8) return null;
    const v = new DataView(data);
    const headerSize = (v.getUint8(0) & 0x0f) * 4;
    const type = (v.getUint8(1) >> 4) & 0x0f, flags = v.getUint8(1) & 0x0f;
    if ((v.getUint8(0) >> 4) !== 1 || flags !== 4 || type === 0xf || headerSize + 4 > data.byteLength) return null;
    const event = v.getUint32(headerSize);
    let offset = headerSize + 4, payloadBytes = 0;
    if (offset + 4 <= data.byteLength) {
        const idSize = v.getUint32(offset);
        offset += 4 + idSize;
        if (offset + 4 <= data.byteLength) payloadBytes = v.getUint32(offset);
    }
    return { event, payloadBytes };
}

type Report = { kind: "start" } | { kind: "tick"; reservation: string | null }
    | { kind: "end"; reservation: string | null; connectedSeconds: number; outputAudioSeconds: number };

export function createSessionMeter<T>(o: {
    now: () => number;
    schedule: (fn: () => Promise<void> | void, ms: number) => T;
    cancel: (timer: T) => void;
    report: (r: Report) => Promise<{ continue: boolean; reservation?: string | null }>;
    stop: (reason: "quota" | "idle") => void;
}) {
    let active = false, startedAt = 0, lastActivity = 0, outputBytes = 0, reservation: string | null = null;
    let tick: T | null = null, idle: T | null = null;
    const clear = () => { if (tick) o.cancel(tick); if (idle) o.cancel(idle); tick = idle = null; };
    const end = async (): Promise<boolean> => {
        if (!active) return false;
        active = false;
        clear();
        await o.report({ kind: "end", reservation, connectedSeconds: Math.round((o.now() - startedAt) / 1000),
            outputAudioSeconds: Math.round((outputBytes / OUTPUT_BYTES_PER_SECOND) * 1000) / 1000 });
        return true;
    };
    // Stop only a session this call actually ended: a quota stop and an idle
    // timer due at the same instant must not close the socket twice.
    const halt = async (reason: "quota" | "idle") => { if (await end()) o.stop(reason); };
    const armIdle = () => {
        if (idle) o.cancel(idle);
        idle = o.schedule(() => (o.now() - lastActivity >= IDLE_MS ? halt("idle") : armIdle()), IDLE_MS - (o.now() - lastActivity));
    };
    const armTick = () => {
        tick = o.schedule(async () => {
            if (!active) return;
            const answer = await o.report({ kind: "tick", reservation });
            if (!answer.continue) return halt("quota");
            armTick();
        }, TICK_MS);
    };
    return {
        async onServerFrame(data: unknown) {
            const f = frameEvent(data);
            if (!f) return;
            if (f.event === SERVER_EVENT.SESSION_STARTED && !active) {
                active = true; startedAt = lastActivity = o.now(); outputBytes = 0;
                const answer = await o.report({ kind: "start" });
                reservation = answer.reservation ?? null;
                if (!answer.continue) return halt("quota");
                armTick(); armIdle();
            } else if (!active) {
                return;
            } else if (ACTIVITY_EVENTS.has(f.event)) {
                if (AUDIO_EVENTS.has(f.event)) outputBytes += f.payloadBytes;
                lastActivity = o.now();
            } else if (f.event === SERVER_EVENT.SESSION_FINISHED || f.event === SERVER_EVENT.SESSION_FAILED) {
                await end();
            }
        },
        close() { void end(); },
    };
}

const encoder = new TextEncoder();
export async function signUsageReport(secret: string, body: string, now = Date.now()): Promise<string> {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${now}\nPOST\n${USAGE_REPORT_PATH}\n${body}`));
    return `${now}.${Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
