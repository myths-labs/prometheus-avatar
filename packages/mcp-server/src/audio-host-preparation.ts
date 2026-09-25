import { createHash } from 'node:crypto';
import { wireObject } from './audio-host-wire.js';
import { readHostAudioVoice, type HostAudioVoice } from './audio-host-voice.js';
import { speechResult } from './speech-result.js';

export interface PreparedScope { principal: string; accountId: string; avatarId: string; voice: HostAudioVoice }
export interface PreparedRow {
    schema: 1; audioId: string; requestId: string; scope: PreparedScope; textSha256: string; textLength: number;
    fingerprint: string; createdAt: number; state: 'pending' | 'ready' | 'uncertain';
    audio?: { sha256: string; mimeType: 'audio/wav' | 'audio/mpeg'; bytes: number };
    response?: Record<string, unknown>;
}
export class AudioHostCacheError extends Error {
    constructor(readonly code: string) { super(code); this.name = 'AudioHostCacheError'; }
}
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function uuid(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new AudioHostCacheError('invalid_preparation');
    return value.toLowerCase();
}
export function preparedScope(value: unknown): PreparedScope {
    const row = wireObject(value, ['principal', 'accountId', 'avatarId', 'voice']);
    if (typeof row.principal !== 'string' || !/^[0-9a-f]{64}$/.test(row.principal)
        || ['accountId', 'avatarId'].some(key => typeof row[key] !== 'string' || !/^[a-zA-Z0-9._:-]{1,200}$/.test(row[key] as string))) {
        throw new AudioHostCacheError('invalid_preparation');
    }
    return { principal: row.principal, accountId: row.accountId as string, avatarId: row.avatarId as string, voice: readHostAudioVoice(row.voice) };
}
export const fingerprint = (scope: PreparedScope, textSha256: string, textLength: number) => digest(JSON.stringify({ schema: 1, scope, textSha256, textLength }));
export function preparation(value: unknown) {
    const raw = wireObject(value, ['requestId', 'scope', 'text']), requestId = uuid(raw.requestId), scope = preparedScope(raw.scope);
    if (typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 2000) throw new AudioHostCacheError('invalid_preparation');
    const text = raw.text.trim(), textSha256 = digest(text), textLength = text.length;
    return { requestId, scope, textSha256, textLength, fingerprint: fingerprint(scope, textSha256, textLength) };
}
function metadata(value: unknown, row: Pick<PreparedRow, 'scope' | 'textLength'>) {
    const raw = wireObject(value, ['mimeType', 'engine', 'voice', 'voiceAssetId', 'builtinVoiceId', 'textLength']);
    const voice = row.scope.voice;
    if (!['audio/wav', 'audio/mpeg'].includes(raw.mimeType as string) || raw.textLength !== row.textLength
        || !['volcengine', 'volcengine-v1', 'volcengine-v3', 'gemini-tts-fixed', 'openai-tts-fixed', 'gcloud-tts-fixed'].includes(raw.engine as string)
        || raw.voice !== (voice.kind === 'legacy' ? voice.voice : null)
        || raw.voiceAssetId !== (voice.kind === 'asset' ? voice.assetId : null)
        || raw.builtinVoiceId !== (voice.kind === 'builtin' ? voice.voiceId : undefined)
        || voice.kind === 'builtin' && !(raw.engine as string).startsWith('volcengine')
        || voice.kind === 'legacy' && raw.engine !== 'gemini-tts-fixed') throw new AudioHostCacheError('speech_selection_mismatch');
    return { ...raw };
}
export function verifiedSpeech(value: unknown, row: PreparedRow, maxBytes: number) {
    const raw = wireObject(value, ['audio', 'mimeType', 'engine', 'voice', 'voiceAssetId', 'builtinVoiceId', 'textLength']);
    const { audio, ...fields } = raw, response = metadata(fields, row);
    if (typeof audio !== 'string' || audio.length > Math.ceil(maxBytes / 3) * 4) throw new AudioHostCacheError('speech_audio_limit');
    const result = speechResult(raw, ''), content = result.content.find(part => part.type === 'audio');
    if (!content || content.type !== 'audio') throw new AudioHostCacheError('invalid_prepared_audio');
    const bytes = Buffer.from(content.data, 'base64');
    if (bytes.length > maxBytes) throw new AudioHostCacheError('speech_audio_limit');
    return { bytes, response, audio: { mimeType: content.mimeType as 'audio/wav' | 'audio/mpeg', bytes: bytes.length, sha256: digest(bytes) } };
}
export function preparedRow(value: unknown, maxBytes: number): PreparedRow {
    const raw = wireObject(value, ['schema', 'audioId', 'requestId', 'scope', 'textSha256', 'textLength', 'fingerprint', 'createdAt', 'state', 'audio', 'response']);
    const scope = preparedScope(raw.scope), audioId = uuid(raw.audioId), requestId = uuid(raw.requestId);
    if (raw.schema !== 1 || !Number.isSafeInteger(raw.createdAt) || (raw.createdAt as number) < 0
        || typeof raw.textSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.textSha256)
        || !Number.isSafeInteger(raw.textLength) || (raw.textLength as number) < 1 || (raw.textLength as number) > 2000
        || raw.fingerprint !== fingerprint(scope, raw.textSha256, raw.textLength as number)
        || !['pending', 'ready', 'uncertain'].includes(raw.state as string)) throw new AudioHostCacheError('cache_corrupt');
    const row: PreparedRow = { schema: 1, audioId, requestId, scope, textSha256: raw.textSha256, textLength: raw.textLength as number,
        fingerprint: raw.fingerprint as string, createdAt: raw.createdAt as number, state: raw.state as PreparedRow['state'] };
    if (row.state === 'ready') {
        const audio = wireObject(raw.audio, ['sha256', 'mimeType', 'bytes']);
        if (typeof audio.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(audio.sha256)
            || !['audio/wav', 'audio/mpeg'].includes(audio.mimeType as string)
            || !Number.isSafeInteger(audio.bytes) || (audio.bytes as number) < 1 || (audio.bytes as number) > maxBytes) throw new AudioHostCacheError('cache_corrupt');
        row.audio = audio as PreparedRow['audio']; row.response = metadata(raw.response, row);
        if (row.response.mimeType !== row.audio!.mimeType) throw new AudioHostCacheError('cache_corrupt');
    } else if ('audio' in raw || 'response' in raw) throw new AudioHostCacheError('cache_corrupt');
    return row;
}
