/**
 * The Call recognition lease ticket ("ac1"): a short, renewable authorization for ONE streaming-recognition socket
 * (/asr on platform credentials) that belongs to one Call (the free minute).
 *
 * A v1 ticket is checked once, at the WebSocket upgrade, so a client holding one can keep a recognition socket open for
 * as long as it likes. The free minute grants time in short windows, so its recognition socket must end when the window
 * does and may only continue by presenting a fresh ticket the server issued for the next window (call-asr-lease.ts).
 *
 * Shape: "ac1." + b64url(JSON {aud,sub,call,iat,exp}) + "." + b64url(HMAC-SHA256(secret, DOMAIN + "ac1." + payload))
 *   aud  always "asr-call"; sub  the metering subject (what follows "asr:" in the v1 ticket this replaces);
 *   call the Call's id (uuid); iat/exp  epoch ms, exp - iat <= 30 s.
 * The HMAC input carries a domain prefix, so no v1 or lv2/lv3 signature (all made with the same secret) can be replayed
 * as an ac1 ticket, nor the reverse. Web Crypto only, no imports.
 *
 * Shared with the marketplace app (src/lib/callAsrTicket.ts); the fixed vector in the tests pins both copies to the same
 * string. Changing the format means changing both and the vector.
 */
export const CALL_ASR_TICKET_PREFIX = 'ac1';
export const CALL_ASR_MAX_TTL_MS = 30_000;
const DOMAIN = 'prometheus-call-asr\n';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface CallAsrGrant { aud: 'asr-call'; sub: string; call: string; iat: number; exp: number }

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
function validGrant(value: unknown, now: number): value is CallAsrGrant {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const g = value as CallAsrGrant;
    return Object.keys(g).sort().join(',') === 'aud,call,exp,iat,sub'
        && g.aud === 'asr-call'
        && typeof g.sub === 'string' && g.sub.length >= 1 && g.sub.length <= 200 && !/[\u0000-\u001f\u007f]/.test(g.sub)
        && typeof g.call === 'string' && uuid.test(g.call)
        && Number.isSafeInteger(g.iat) && Number.isSafeInteger(g.exp) && g.iat > 0
        && g.iat <= now + 5000 && g.exp > now && g.exp > g.iat && g.exp - g.iat <= CALL_ASR_MAX_TTL_MS;
}
function key(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** Mints a ticket for `sub` and `call` valid from `now` for `ttl` ms (at most 30 s). Throws on anything out of shape. */
export async function mintCallAsrTicket(secret: string, sub: string, call: string, now = Date.now(), ttl = CALL_ASR_MAX_TTL_MS): Promise<{ ticket: string; grant: CallAsrGrant }> {
    const grant: CallAsrGrant = { aud: 'asr-call', sub, call, iat: now, exp: now + ttl };
    if (!secret || !validGrant(grant, now)) throw new Error('Invalid call recognition ticket');
    const payload = CALL_ASR_TICKET_PREFIX + '.' + encode(new TextEncoder().encode(JSON.stringify(grant)));
    const signature = await crypto.subtle.sign('HMAC', await key(secret, 'sign'), new TextEncoder().encode(DOMAIN + payload));
    return { ticket: payload + '.' + encode(new Uint8Array(signature)), grant };
}

/** Returns the grant of a genuine, unexpired ticket, or null for anything else. */
export async function verifyCallAsrTicket(secret: string | undefined, ticket: string, now = Date.now()): Promise<CallAsrGrant | null> {
    if (!secret || typeof ticket !== 'string' || ticket.length > 1024) return null;
    const parts = ticket.split('.');
    if (parts.length !== 3 || parts[0] !== CALL_ASR_TICKET_PREFIX) return null;
    const bytes = decode(parts[1]), signature = decode(parts[2]);
    if (!bytes || !signature || signature.length !== 32) return null;
    try {
        const valid = await crypto.subtle.verify('HMAC', await key(secret, 'verify'), new Uint8Array(signature),
            new TextEncoder().encode(DOMAIN + parts.slice(0, 2).join('.')));
        if (!valid) return null;
        const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), value: unknown = JSON.parse(raw);
        if (JSON.stringify(value) !== raw) return null;
        return validGrant(value, now) ? value : null;
    } catch { return null; }
}

/** The same call and the same subject: the only thing a renewal may keep. */
export function sameCallAsr(a: CallAsrGrant, b: CallAsrGrant): boolean { return a.sub === b.sub && a.call === b.call; }
