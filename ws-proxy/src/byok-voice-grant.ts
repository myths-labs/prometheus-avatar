/**
 * Shared byte-for-byte with ws-proxy/src/byok-voice-grant.ts. Web Crypto only.
 *
 * P-07 option B (钱安全线 ⑨ 2026-11-10): a live-voice session on the caller's own Volcengine key opens through the relay only
 * with this grant, which /api/volcengine-realtime-token mints after the persona gate passed the session's prompt. It names the
 * account, the dialog model and voicePromptSha256 of the four StartSession dialog fields; the relay compares that hash with
 * every StartSession on the socket and closes 1008 on any other. It never carries the key (the key still arrives in-band, as
 * the relay's first frame). It is signed with the relay ticket secret under its own label ('prometheus-byok-voice'), so it
 * cannot be read as a platform live-voice grant ('prometheus-live-voice'), nor the other way round.
 */
export const BYOK_VOICE_GRANT_MS = 90_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface ByokVoiceGrant { aud: 'doubao-byok'; sub: string; model: string; promptSha256: string; iat: number; exp: number }
export type ByokVoiceSelection = Pick<ByokVoiceGrant, 'sub' | 'model' | 'promptSha256'>;
const KEYS = 'aud,exp,iat,model,promptSha256,sub';
const LABEL = 'prometheus-byok-voice\n';
function encode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array | null {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
        const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        return encode(bytes) === value ? bytes : null;
    } catch { return null; }
}
function validGrant(value: unknown, now: number): value is ByokVoiceGrant {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const g = value as ByokVoiceGrant;
    return Object.keys(g).sort().join(',') === KEYS
        && g.aud === 'doubao-byok' && typeof g.sub === 'string' && uuid.test(g.sub)
        && typeof g.model === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(g.model)
        && typeof g.promptSha256 === 'string' && /^[a-f0-9]{64}$/.test(g.promptSha256)
        && Number.isSafeInteger(g.iat) && Number.isSafeInteger(g.exp) && g.iat > 0
        && g.iat <= now + 5000 && g.exp > now && g.exp > g.iat && g.exp - g.iat <= BYOK_VOICE_GRANT_MS;
}
function key(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
/** The grant for `selection`: 'ob1.' + the claims + '.' + their HMAC under LABEL. Throws on a selection that is not valid. */
export async function mintByokVoiceGrant(secret: string, selection: ByokVoiceSelection, now = Date.now(), ttl = BYOK_VOICE_GRANT_MS): Promise<{ grant: string; claims: ByokVoiceGrant }> {
    const claims: ByokVoiceGrant = { aud: 'doubao-byok', sub: selection.sub, model: selection.model, promptSha256: selection.promptSha256, iat: now, exp: now + ttl };
    if (!secret || !validGrant(claims, now)) throw new Error('Invalid own-key voice grant');
    const payload = 'ob1.' + encode(new TextEncoder().encode(JSON.stringify(claims)));
    const signature = await crypto.subtle.sign('HMAC', await key(secret, 'sign'), new TextEncoder().encode(LABEL + payload));
    return { grant: payload + '.' + encode(new Uint8Array(signature)), claims };
}
/** The claims of a grant this secret signed that is valid now, or null. The claims must be exactly the canonical JSON that was signed. */
export async function verifyByokVoiceGrant(secret: string | undefined, grant: string, now = Date.now()): Promise<ByokVoiceGrant | null> {
    if (!secret || typeof grant !== 'string' || grant.length > 1024) return null;
    const parts = grant.split('.');
    if (parts.length !== 3 || parts[0] !== 'ob1') return null;
    const bytes = decode(parts[1]), signature = decode(parts[2]);
    if (!bytes || !signature || signature.length !== 32) return null;
    try {
        const valid = await crypto.subtle.verify('HMAC', await key(secret, 'verify'), new Uint8Array(signature),
            new TextEncoder().encode(LABEL + parts.slice(0, 2).join('.')));
        if (!valid) return null;
        const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), value: unknown = JSON.parse(raw);
        if (JSON.stringify(value) !== raw) return null;
        return validGrant(value, now) ? value : null;
    } catch { return null; }
}
