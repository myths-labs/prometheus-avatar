/**
 * P-07: the relay's port of the marketplace's voicePromptSha256 (src/lib/personaContentGate.ts), the one canonical form of a live-voice
 * prompt's hash: lower-case hex SHA-256 of the UTF-8 bytes of JSON.stringify([bot_name, character_manifest, system_role, speaking_style]),
 * a missing field being "", with no trimming and no normalising. Web Crypto, as the Worker has no node:crypto. Both sides test against the
 * same vectors (test/fixtures/voice-prompt-sha256-vectors.json, a copy of the marketplace's). Only those four fields count (the frame's
 * dialog.extra is not hashed). A field that is present and not text throws TypeError, as in the marketplace; the frame guard has refused
 * such a StartSession before it is hashed.
 */
const VOICE_FIELDS = ['bot_name', 'character_manifest', 'system_role', 'speaking_style'] as const;

export async function voicePromptSha256(dialog: Record<string, unknown>): Promise<string> {
    const values = VOICE_FIELDS.map((field) => {
        const value = dialog[field];
        if (value !== undefined && typeof value !== 'string') throw new TypeError(`voice dialog field ${field} must be a string`);
        return value ?? '';
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
