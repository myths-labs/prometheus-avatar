import { voicePromptSha256 } from './voice-prompt-sha256';

/** Admission for the exact uncompressed client protocol emitted by the App. */
type ClientFrame = { event: number; sessionId: string | null; json: Record<string, unknown> | null };
const sessionEvents = new Set([100, 102, 200, 400, 515]);
export { isPublicDoubaoSpeaker } from './live-voice-grant';
/** P-07: why a StartSession was refused by its prompt binding. The relay closes the client (and the provider) with 1008 and this reason. */
export const VOICE_PROMPT_NOT_APPROVED = 'Voice prompt not approved';
export const VOICE_PROMPT_BINDING_REQUIRED = 'Voice prompt binding required';
/**
 * P-07: how the platform path holds every StartSession to its live-voice grant. `promptSha256` is read at each StartSession (the lease's
 * CURRENT grant): an lv4 grant names the voicePromptSha256 of the four dialog fields it admits, and any other dialog is refused; an lv2 or
 * lv3 grant names none (null) and is admitted with a log line, or refused when `required` (LIVE_VOICE_REQUIRE_PROMPT is "1"). The own-key
 * path (?byok=1, doubao-byok-relay.ts; option B) passes its own-key grant's promptSha256 (required) when the socket opened with a grant,
 * and no binding when it opened without one (admitted only while LIVE_VOICE_REQUIRE_PROMPT is not "1").
 */
export interface DoubaoPromptBinding { promptSha256: () => string | null; required: boolean }
export function readDoubaoClientFrame(data: unknown): ClientFrame | null {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 12 || data.byteLength > 1024 * 1024) return null;
    const view = new DataView(data);
    const messageType = view.getUint8(1);
    if (view.getUint8(0) !== 0x11 || ![0x14, 0x24].includes(messageType) || view.getUint8(3) !== 0) return null;
    const encoding = view.getUint8(2);
    if (encoding !== 0x10 && encoding !== 0) return null;
    const event = view.getUint32(4);
    if (![1, 2].includes(event) && !sessionEvents.has(event)) return null;
    let offset = 8, sessionId: string | null = null;
    try {
        if (sessionEvents.has(event)) {
            const length = view.getUint32(offset); offset += 4;
            if (length < 1 || length > 128 || offset + length + 4 > data.byteLength) return null;
            sessionId = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(data, offset, length)); offset += length;
            if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
        }
        const length = view.getUint32(offset); offset += 4;
        if (offset + length !== data.byteLength) return null;
        // The original SDK marks audio-only PCM as JSON encoding (0x24/0x10).
        // Its message type, event, session and exact PCM byte bounds are authoritative.
        if (messageType === 0x24) return event === 200 && length > 0 && length % 2 === 0 ? { event, sessionId, json: null } : null;
        if (encoding === 0) return null;
        const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(data, offset, length));
        const json = JSON.parse(raw);
        // Reject ambiguous duplicate keys and noncanonical encodings before any upstream parser.
        if (!json || typeof json !== 'object' || Array.isArray(json) || JSON.stringify(json) !== raw) return null;
        if (event !== 100 && Object.keys(json).length !== 0) return null;
        return { event, sessionId, json };
    } catch { return null; }
}

export function createDoubaoFrameGuard(authorize: (speaker: string, model: string) => boolean | Promise<boolean>, binding?: DoubaoPromptBinding) {
    let connected = false, closed = false, sessionId: string | null = null, promptRefusal: string | null = null;
    return {
        close() { closed = true; connected = false; sessionId = null; },
        /** The close reason when a StartSession was refused by its prompt binding (the guard is closed from then on); null otherwise. */
        refusal(): string | null { return promptRefusal; },
        async admit(data: unknown): Promise<boolean> {
            if (closed) return false;
            const frame = readDoubaoClientFrame(data);
            if (!frame) return false;
            if (frame.event === 1) { if (connected) return false; connected = true; return true; }
            if (!connected) return false;
            if (frame.event === 2) { closed = true; connected = false; sessionId = null; return true; }
            if (frame.event === 100) {
                if (sessionId || !frame.json || Object.keys(frame.json).some(k => !['dialog', 'tts', 'asr'].includes(k))) return false;
                const tts = frame.json.tts, dialog = frame.json.dialog;
                if (!tts || typeof tts !== 'object' || Array.isArray(tts) || !dialog || typeof dialog !== 'object' || Array.isArray(dialog)) return false;
                const config = tts as Record<string, unknown>, extra = (dialog as Record<string, unknown>).extra;
                if (Object.keys(config).some(k => !['speaker', 'audio_config'].includes(k)) || typeof config.speaker !== 'string'
                    || !extra || typeof extra !== 'object' || Array.isArray(extra)) return false;
                const model = (extra as Record<string, unknown>).model;
                const audio = config.audio_config as Record<string, unknown> | undefined;
                const asr = frame.json.asr as Record<string, unknown> | undefined;
                const dialogConfig = dialog as Record<string, unknown>, extraConfig = extra as Record<string, unknown>;
                if (!audio || Object.keys(audio).sort().join(',') !== 'channel,format,sample_rate'
                    || audio.channel !== 1 || audio.format !== 'pcm_s16le' || audio.sample_rate !== 24000
                    || Object.keys(extraConfig).sort().join(',') !== 'input_mod,model' || !['keep_alive', 'push_to_talk'].includes(String(extraConfig.input_mod))
                    || !asr || Object.keys(asr).join(',') !== 'extra' || !asr.extra || typeof asr.extra !== 'object'
                    || Array.isArray(asr.extra) || Object.keys(asr.extra).length !== 0
                    || Object.keys(dialogConfig).some(k => !['character_manifest', 'bot_name', 'system_role', 'speaking_style', 'extra'].includes(k))
                    || Object.entries(dialogConfig).some(([k, v]) => k !== 'extra' && (typeof v !== 'string' || v.length > 65536))) return false;
                if (typeof model !== 'string' || !await authorize(config.speaker, model) || closed) return false;
                if (binding) {
                    // Every StartSession, the first or one after a FinishSession. No log line carries the prompt.
                    const bound = binding.promptSha256();
                    if (bound === null && binding.required) {
                        promptRefusal = VOICE_PROMPT_BINDING_REQUIRED; closed = true;
                        console.warn('[P-07] live voice refused: its ticket binds no prompt and LIVE_VOICE_REQUIRE_PROMPT is "1"');
                        return false;
                    }
                    if (bound === null) {
                        console.warn('[P-07] live voice without prompt binding');
                    } else {
                        const sent = await voicePromptSha256(dialogConfig);
                        if (closed) return false; // the socket ended while the prompt was hashed
                        if (sent !== bound) {
                            promptRefusal = VOICE_PROMPT_NOT_APPROVED; closed = true;
                            console.warn('[P-07] live voice refused: the StartSession prompt is not the one its ticket approved');
                            return false;
                        }
                    }
                }
                sessionId = frame.sessionId; return true;
            }
            if (!sessionId || sessionId !== frame.sessionId) return false;
            if (frame.event === 102) sessionId = null;
            return true;
        },
    };
}
