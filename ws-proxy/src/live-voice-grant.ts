/** Shared byte-for-byte with ws-proxy/src/live-voice-grant.ts. Web Crypto only. */
export const LIVE_VOICE_LEASE_MS = 90_000;
export const DEFAULT_LIVE_SPEAKER = 'saturn_zh_female_tiexinnvyou_tob';
const publicSpeakers = new Set([DEFAULT_LIVE_SPEAKER, 'saturn_zh_female_keainvsheng_tob', 'saturn_zh_male_cixingnansang_tob']);
export function isPublicDoubaoSpeaker(value: string): boolean { return publicSpeakers.has(value); }
export function isLiveDoubaoSpeaker(value: string): boolean { return isPublicDoubaoSpeaker(value) || /^S_[A-Za-z0-9_]{1,126}$/.test(value); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface LiveVoiceGrant {
    aud: 'doubao-live'; sub: string; assetId: string | null; speakerId: string; model: string;
    providerAppSha256:string|null; iat: number; exp: number;
}
export type LiveVoiceSelection = Pick<LiveVoiceGrant, 'sub' | 'assetId' | 'speakerId' | 'model' | 'providerAppSha256'>;
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
function validGrant(value: unknown, now: number): value is LiveVoiceGrant {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const g = value as LiveVoiceGrant;
    return Object.keys(g).sort().join(',') === 'assetId,aud,exp,iat,model,providerAppSha256,speakerId,sub'
        && g.aud === 'doubao-live' && typeof g.sub === 'string' && uuid.test(g.sub)
        && (g.assetId === null || typeof g.assetId === 'string' && uuid.test(g.assetId))
        && typeof g.speakerId === 'string' && isLiveDoubaoSpeaker(g.speakerId)
        && (g.assetId !== null || isPublicDoubaoSpeaker(g.speakerId))
        && typeof g.model === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(g.model)
        && (!g.speakerId.startsWith('S_') || g.model === '2.2.0.0')
        && (g.speakerId.startsWith('S_') ? typeof g.providerAppSha256==='string'&&/^[a-f0-9]{64}$/.test(g.providerAppSha256) : g.providerAppSha256===null)
        && Number.isSafeInteger(g.iat) && Number.isSafeInteger(g.exp) && g.iat > 0
        && g.iat <= now + 5000 && g.exp > now && g.exp > g.iat && g.exp - g.iat <= LIVE_VOICE_LEASE_MS;
}
function key(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
export async function mintLiveVoiceGrant(secret: string, selection: LiveVoiceSelection, now = Date.now(), ttl = LIVE_VOICE_LEASE_MS): Promise<{ ticket: string; grant: LiveVoiceGrant }> {
    const grant: LiveVoiceGrant = { aud: 'doubao-live', ...selection, iat: now, exp: now + ttl };
    if (!secret || !validGrant(grant, now)) throw new Error('Invalid live voice grant');
    const payload = 'lv3.' + encode(new TextEncoder().encode(JSON.stringify(grant)));
    const signature = await crypto.subtle.sign('HMAC', await key(secret, 'sign'), new TextEncoder().encode('prometheus-live-voice\n' + payload));
    return { ticket: payload + '.' + encode(new Uint8Array(signature)), grant };
}
export async function verifyLiveVoiceGrant(secret: string | undefined, ticket: string, now = Date.now()): Promise<LiveVoiceGrant | null> {
    if (!secret || typeof ticket !== 'string' || ticket.length > 2048) return null;
    const parts = ticket.split('.');
    if (parts.length !== 3 || !['lv2','lv3'].includes(parts[0])) return null;
    const bytes = decode(parts[1]), signature = decode(parts[2]);
    if (!bytes || !signature || signature.length !== 32) return null;
    try {
        const valid = await crypto.subtle.verify('HMAC', await key(secret, 'verify'), new Uint8Array(signature),
            new TextEncoder().encode('prometheus-live-voice\n' + parts.slice(0, 2).join('.')));
        if (!valid) return null;
        const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), value: any = JSON.parse(raw);
        if(JSON.stringify(value)!==raw)return null;
        // Old public leases are safe during rollout. An old private lease has
        // no provider-application authority and must be restored by the server.
        if(parts[0]==='lv2'){
            if(!value||Object.keys(value).sort().join(',')!=='assetId,aud,exp,iat,model,speakerId,sub'
                ||!isPublicDoubaoSpeaker(value.speakerId))return null;
            const grant={...value,providerAppSha256:null};return validGrant(grant,now)?grant:null;
        }
        return validGrant(value,now)?value:null;
    } catch { return null; }
}
export function sameLiveVoiceSelection(a: LiveVoiceGrant, b: LiveVoiceGrant): boolean {
    return a.sub === b.sub && a.assetId === b.assetId && a.speakerId === b.speakerId && a.model === b.model
        && a.providerAppSha256===b.providerAppSha256;
}
