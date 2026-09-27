/** Admission for the exact uncompressed client protocol emitted by the App. */
type ClientFrame = { event: number; sessionId: string | null; json: Record<string, unknown> | null };
const sessionEvents = new Set([100, 102, 200, 400, 515]);
export { isPublicDoubaoSpeaker } from './live-voice-grant';
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

export function createDoubaoFrameGuard(authorize: (speaker: string, model: string) => boolean | Promise<boolean>) {
    let connected = false, closed = false, sessionId: string | null = null;
    return {
        close() { closed = true; connected = false; sessionId = null; },
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
                sessionId = frame.sessionId; return true;
            }
            if (!sessionId || sessionId !== frame.sessionId) return false;
            if (frame.event === 102) sessionId = null;
            return true;
        },
    };
}
