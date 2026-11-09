import { createDoubaoFrameGuard } from './doubao-frame-guard';
import { isLiveDoubaoSpeaker } from './live-voice-grant';
import { verifyByokVoiceGrant } from './byok-voice-grant';

const RESOURCE = 'volc.speech.dialog';
const APP_KEY = 'PlgvMymc7f3tQnJ6';

/**
 * P-07 option B (钱安全线 ⑨ 2026-11-10). `secret` verifies the own-key grant (WS_TICKET_SECRET); `requireGrant` is
 * LIVE_VOICE_REQUIRE_PROMPT === "1", which refuses an own-key connection that carries no grant.
 */
export interface DoubaoByokRelayOptions { secret: string | undefined; requireGrant: boolean }

/**
 * This path never receives platform secrets. Only a complete private frame can open the fixed provider.
 *
 * P-07 option B: the relay carries no persona prompt the marketplace's persona gate did not pass, own key or not. The app opens this
 * socket with the own-key grant (?grant=ob1..., byok-voice-grant.ts) that /api/volcengine-realtime-token mints after the gate passed the
 * session's prompt. A grant that is present must verify, whatever the switch says: otherwise 403 before the provider is dialled. With
 * one, every StartSession on the socket (the first, and any after a FinishSession) must be on the grant's model and hash to its
 * promptSha256; any other prompt closes both sides 1008 'Voice prompt not approved' and none of it reaches the provider. With no grant,
 * requireGrant refuses the upgrade (403); otherwise the socket is admitted as before (no prompt binding) with one log line, for the
 * rollout count. The key still arrives in-band as the first frame, and only the frames after it reach the guard. No log line carries
 * the grant, the key or the prompt.
 */
export async function createDoubaoByokRelay(request: Request, cors: Record<string, string>, options: DoubaoByokRelayOptions): Promise<Response> {
    const url = new URL(request.url), params = url.searchParams;
    if (url.pathname !== '/doubao' || params.get('byok') !== '1'
        || Array.from(params.keys()).some(k => !['byok', 'resourceId', 'appKey', 'grant'].includes(k) || params.getAll(k).length !== 1)
        || params.has('resourceId') && params.get('resourceId') !== RESOURCE
        || params.has('appKey') && params.get('appKey') !== APP_KEY) {
        return Response.json({ error: 'Invalid own-key voice connection' }, { status: 400, headers: cors });
    }
    const presented = params.get('grant');
    const grant = presented === null ? null : await verifyByokVoiceGrant(options.secret, presented);
    // A grant that is present and does not verify is never read as "no grant".
    const refusal = presented !== null ? (!options.secret ? 'unconfigured' : grant ? null : 'bad-grant')
        : options.requireGrant ? 'grant-required' : null;
    if (refusal) {
        console.warn(`[WS-Relay] 🎫 doubao (byok): rejected own-key request (${refusal})`);
        return Response.json({ error: `doubao: own-key relay access requires a valid grant (${refusal})` }, { status: 403, headers: cors });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return Response.json({ error: 'Expected WebSocket upgrade' }, { status: 426, headers: cors });
    }
    if (!grant) console.warn('[P-07] own-key live voice without a grant');
    const [client, server] = Object.values(new WebSocketPair());
    server.accept(); server.binaryType = 'arraybuffer';
    let upstream: WebSocket | null = null, closed = false, authenticated = false;
    let pendingBytes = 0, pendingMessages = 0, queue = Promise.resolve();
    const controller = new AbortController();
    // The voices this path has always taken; with a grant, only on the grant's model and held to its prompt.
    const guard = createDoubaoFrameGuard(async (speaker, model) => isLiveDoubaoSpeaker(speaker)
        && /^\d+\.\d+\.\d+\.\d+$/.test(model) && (!speaker.startsWith('S_') || model === '2.2.0.0') && (!grant || model === grant.model),
        grant ? { promptSha256: () => grant.promptSha256, required: true } : undefined);
    const close = (code: number, reason: string) => {
        if (closed) return;
        closed = true; controller.abort(); guard.close();
        clearTimeout(authTimer); clearTimeout(lifetimeTimer);
        try { server.close(code, reason); } catch { }
        try { upstream?.close(code, reason); } catch { }
    };
    const authTimer = setTimeout(() => close(1008, 'Voice credentials required'), 5000);
    const lifetimeTimer = setTimeout(() => close(1000, 'Voice session time limit reached'), 15 * 60_000);
    const handle = async (data: string | ArrayBuffer) => {
        if (closed) return;
        if (!authenticated) {
            if (typeof data !== 'string' || data.length > 8192) return close(1008, 'Invalid voice credentials');
            let value: { type: string; accessKey: string; appId: string };
            try {
                value = JSON.parse(data);
                if (!value || Array.isArray(value) || JSON.stringify(value) !== data
                    || Object.keys(value).sort().join(',') !== 'accessKey,appId,type'
                    || value.type !== 'byok' || typeof value.appId !== 'string' || !/^\d{1,32}$/.test(value.appId)
                    || typeof value.accessKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value.accessKey)) {
                    return close(1008, 'Invalid voice credentials');
                }
            } catch { return close(1008, 'Invalid voice credentials'); }
            authenticated = true; clearTimeout(authTimer);
            let response: Response;
            const connectTimer = setTimeout(() => controller.abort(), 10000);
            try {
                response = await fetch('https://openspeech.bytedance.com/api/v3/realtime/dialogue', {
                    headers: { Upgrade: 'websocket', 'X-Api-App-ID': value.appId, 'X-Api-Access-Key': value.accessKey,
                        'X-Api-Resource-Id': RESOURCE, 'X-Api-App-Key': APP_KEY, 'X-Api-Connect-Id': crypto.randomUUID() },
                    signal: controller.signal,
                });
            } catch { return close(1011, 'Voice provider unavailable'); }
            finally { clearTimeout(connectTimer); }
            const socket = response.webSocket;
            if (!socket) {
                try { await response.body?.cancel(); } catch { }
                return close(1011, 'Voice provider refused credentials');
            }
            socket.accept(); socket.binaryType = 'arraybuffer';
            if (closed || controller.signal.aborted) { try { socket.close(1000, 'Voice session closed'); } catch { } return; }
            upstream = socket;
            socket.addEventListener('message', event => {
                if (!closed && server.readyState === 1) {
                    try { server.send(event.data); } catch { close(1011, 'Voice connection closed'); }
                }
            });
            socket.addEventListener('close', () => close(1000, 'Voice provider closed'));
            socket.addEventListener('error', () => close(1011, 'Voice provider unavailable'));
            return;
        }
        // A StartSession refused by the grant's prompt closes with the guard's reason ('Voice prompt not approved'); any other refusal as before.
        if (typeof data === 'string' || !(await guard.admit(data))) return close(1008, guard.refusal() ?? 'Invalid voice session frame');
        if (!closed && upstream?.readyState === 1) upstream.send(data);
    };
    server.addEventListener('message', event => {
        if (closed) return;
        const data = event.data, bytes = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
        if (bytes > 1024 * 1024 || pendingBytes + bytes > 4 * 1024 * 1024 || pendingMessages >= 256) return close(1008, 'Voice frame limit exceeded');
        pendingBytes += bytes; pendingMessages++;
        queue = queue.then(() => handle(data)).catch(() => close(1011, 'Voice connection unavailable'))
            .finally(() => { pendingBytes -= bytes; pendingMessages--; });
    });
    server.addEventListener('close', () => close(1000, 'Voice client closed'));
    server.addEventListener('error', () => close(1011, 'Voice client unavailable'));
    return new Response(null, { status: 101, webSocket: client, headers: cors });
}
