export interface AudioHostTarget {
    readonly accountId: string;
    readonly avatarId: string;
    readonly hostSessionId: string;
    readonly selectionId: string;
}
export type AudioHostFrame = Readonly<Record<string, unknown> & { type: string; target: AudioHostTarget }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function wireObject(value: unknown, keys: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_host_frame');
    const object = value as Record<string, unknown>;
    if (Object.keys(object).some(key => !keys.includes(key))) throw new Error('invalid_host_frame');
    return object;
}
export function wireTarget(value: unknown): AudioHostTarget {
    const raw = wireObject(value, ['accountId', 'avatarId', 'hostSessionId', 'selectionId']);
    for (const key of ['accountId', 'avatarId']) {
        if (typeof raw[key] !== 'string' || !/^[a-zA-Z0-9._:-]{1,200}$/.test(raw[key] as string)) throw new Error('invalid_host_target');
    }
    for (const key of ['hostSessionId', 'selectionId']) {
        if (typeof raw[key] !== 'string' || !UUID.test(raw[key] as string)) throw new Error('invalid_host_target');
    }
    return Object.freeze({ accountId: raw.accountId as string, avatarId: raw.avatarId as string,
        hostSessionId: raw.hostSessionId as string, selectionId: raw.selectionId as string });
}
export function sameWireTarget(a: AudioHostTarget, b: AudioHostTarget): boolean {
    return a.accountId === b.accountId && a.avatarId === b.avatarId
        && a.hostSessionId === b.hostSessionId && a.selectionId === b.selectionId;
}
const rejectedCodes = ['invalid_command', 'target_mismatch', 'session_closed', 'command_conflict', 'playback_conflict',
    'audio_invalid', 'audio_hash_mismatch', 'audio_too_large', 'superseded', 'session_capacity', 'player_unavailable',
    'cancelled', 'authentication_required', 'session_changed'];
export function parseHostFrame(value: unknown, expected: AudioHostTarget): AudioHostFrame {
    const raw = wireObject(value, ['version', 'type', 'target', 'commandId', 'playbackId', 'audioSha256', 'sequence', 'status', 'at', 'code']);
    const target = wireTarget(raw.target);
    if (raw.version !== 1 || !sameWireTarget(target, expected)) throw new Error('invalid_host_frame');
    for (const key of ['commandId', 'playbackId']) {
        if (typeof raw[key] !== 'string' || !UUID.test(raw[key] as string)) throw new Error('invalid_host_frame');
    }
    if (raw.type === 'prometheus.audio.rejected') {
        if (!rejectedCodes.includes(raw.code as string)
            || ['audioSha256', 'sequence', 'status', 'at'].some(key => key in raw)) throw new Error('invalid_host_frame');
    } else if (raw.type === 'prometheus.audio.receipt') {
        if (typeof raw.audioSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.audioSha256)
            || !Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 1 || (raw.sequence as number) > 3
            || !['accepted', 'started', 'completed', 'interrupted', 'failed'].includes(raw.status as string)
            || !Number.isSafeInteger(raw.at) || (raw.at as number) < 0
            || (raw.code !== undefined && (raw.status !== 'failed'
                || !['playback_failed', 'playback_timeout', 'player_protocol_error'].includes(raw.code as string)))) {
            throw new Error('invalid_host_frame');
        }
    } else throw new Error('invalid_host_frame');
    return Object.freeze({ ...raw, type: raw.type as string, target });
}
