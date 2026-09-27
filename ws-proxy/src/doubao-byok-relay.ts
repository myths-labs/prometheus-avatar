import { createDoubaoFrameGuard } from './doubao-frame-guard';
import { isLiveDoubaoSpeaker } from './live-voice-grant';

const RESOURCE = 'volc.speech.dialog';
const APP_KEY = 'PlgvMymc7f3tQnJ6';

/** This path never receives platform secrets. Only a complete private frame can open the fixed provider. */
export function createDoubaoByokRelay(request: Request, cors: Record<string, string>): Response {
    const url = new URL(request.url), params = url.searchParams;
    if (url.pathname !== '/doubao' || params.get('byok') !== '1'
        || Array.from(params.keys()).some(k => !['byok', 'resourceId', 'appKey'].includes(k) || params.getAll(k).length !== 1)
        || params.has('resourceId') && params.get('resourceId') !== RESOURCE
        || params.has('appKey') && params.get('appKey') !== APP_KEY) {
        return Response.json({ error: 'Invalid own-key voice connection' }, { status: 400, headers: cors });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return Response.json({ error: 'Expected WebSocket upgrade' }, { status: 426, headers: cors });
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.accept(); server.binaryType = 'arraybuffer';
    let upstream: WebSocket | null = null, closed = false, authenticated = false;
    let pendingBytes = 0, pendingMessages = 0, queue = Promise.resolve();
    const controller = new AbortController();
    const guard = createDoubaoFrameGuard(async (speaker, model) => isLiveDoubaoSpeaker(speaker)
        && /^\d+\.\d+\.\d+\.\d+$/.test(model) && (!speaker.startsWith('S_') || model === '2.2.0.0'));
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
        if (typeof data === 'string' || !(await guard.admit(data))) return close(1008, 'Invalid voice session frame');
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
