// Wire selection codec, matched against the App contract by the Lane B acceptance tests.
export const HOST_AUDIO_BUILTIN_VOICES = [
    'saturn_zh_female_tiexinnvyou_tob', 'saturn_zh_female_keainvsheng_tob', 'saturn_zh_male_cixingnansang_tob',
] as const;
export const HOST_AUDIO_LEGACY_VOICES = [
    'Kore', 'Aoede', 'Leda', 'Despina', 'Laomedeia', 'Callirrhoe', 'Puck', 'Charon', 'Fenrir', 'Achird', 'Zephyr', 'Algenib',
] as const;
export type HostAudioVoice = Readonly<
    { kind: 'builtin'; voiceId: typeof HOST_AUDIO_BUILTIN_VOICES[number] }
    | { kind: 'legacy'; voice: typeof HOST_AUDIO_LEGACY_VOICES[number] }
    | { kind: 'asset'; assetId: string }
>;
const member = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value);
/** Public selection metadata only. Asset ownership and private speaker resolution stay on the server. */
export function readHostAudioVoice(value: unknown): HostAudioVoice {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('unsupported_host_voice');
    const row = value as Record<string, unknown>;
    if (row.kind === 'builtin' && Object.keys(row).every(k => ['kind', 'voiceId'].includes(k))
        && member(HOST_AUDIO_BUILTIN_VOICES, row.voiceId)) return Object.freeze({ kind: 'builtin', voiceId: row.voiceId });
    if (row.kind === 'legacy' && Object.keys(row).every(k => ['kind', 'voice'].includes(k))
        && member(HOST_AUDIO_LEGACY_VOICES, row.voice)) return Object.freeze({ kind: 'legacy', voice: row.voice });
    if (row.kind === 'asset' && Object.keys(row).every(k => ['kind', 'assetId'].includes(k))
        && typeof row.assetId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.assetId)) {
        return Object.freeze({ kind: 'asset', assetId: row.assetId.toLowerCase() });
    }
    throw Error('unsupported_host_voice');
}
