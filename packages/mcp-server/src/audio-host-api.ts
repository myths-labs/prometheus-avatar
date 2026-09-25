import { digest, AudioHostCacheError } from './audio-host-preparation.js';
import type { HostAudioVoice } from './audio-host-voice.js';

const MAX_RESPONSE_BYTES = Math.ceil(32 * 1024 * 1024 / 3) * 4 + 16384;
/** One bounded attempt. No retry, redirect or credential-bearing diagnostics. */
export function audioSpeechApi(apiBase: string, apiKey: string, version: string) {
    const base = new URL(apiBase);
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/'
        || !(base.protocol === 'https:' || base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) throw new AudioHostCacheError('invalid_audio_api_url');
    const principal = digest(JSON.stringify([base.origin, apiKey]));
    return {
        principal,
        requireKey() { if (!apiKey) throw new AudioHostCacheError('agent_api_key_required'); },
        async generate(text: string, voice: HostAudioVoice, signal: AbortSignal): Promise<unknown> {
            if (!apiKey) throw new AudioHostCacheError('agent_api_key_required');
            const controller = new AbortController(), abort = () => controller.abort();
            if (signal.aborted) controller.abort(); else signal.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(abort, 60000);
            try {
                const selection = voice.kind === 'builtin' ? { builtinVoiceId: voice.voiceId }
                    : voice.kind === 'asset' ? { voiceAssetId: voice.assetId } : { voice: voice.voice };
                const response = await fetch(new URL('/api/agent/speak', base), {
                    method: 'POST', redirect: 'error', signal: controller.signal,
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': `PrometheusAvatar-MCP/${version}` },
                    body: JSON.stringify({ text: text.trim(), ...selection, format: 'base64' }),
                });
                if (!response.ok) { await response.body?.cancel(); throw new AudioHostCacheError(`speech_http_${response.status}`); }
                const declared = response.headers.get('content-length');
                if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
                    await response.body?.cancel(); throw new AudioHostCacheError('speech_response_limit');
                }
                if (!response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
                    await response.body?.cancel(); throw new AudioHostCacheError('speech_response_invalid');
                }
                const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
                try {
                    for (;;) {
                        const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
                        if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new AudioHostCacheError('speech_response_limit'); }
                        chunks.push(next.value);
                    }
                } finally { reader.releaseLock(); }
                return JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
        },
    };
}
