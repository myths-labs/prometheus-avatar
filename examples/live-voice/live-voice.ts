/**
 * Live Voice Example — Real-time voice conversation with avatar
 *
 * Uses Gemini Live API via WebSocket for ~200ms latency voice interaction.
 * This example shows the client-side hook pattern used in the demo app.
 */

// Step 1: Fetch ephemeral token from your backend
async function getEphemeralToken(): Promise<string> {
    const res = await fetch('/api/live-token');
    const data = await res.json();
    return data.token;
}

// Step 2: Capture microphone audio as 16kHz PCM
async function captureMicrophone(): Promise<{ stream: MediaStream; processor: ScriptProcessorNode; audioCtx: AudioContext }> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true } });
    const audioCtx = new AudioContext({ sampleRate: 48000 });
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioCtx.destination);

    return { stream, processor, audioCtx };
}

// Step 3: Downsample 48kHz → 16kHz for Gemini
function downsampleTo16k(buffer: Float32Array, fromRate: number): Int16Array {
    const ratio = fromRate / 16000;
    const length = Math.floor(buffer.length / ratio);
    const result = new Int16Array(length);

    for (let i = 0; i < length; i++) {
        const idx = Math.floor(i * ratio);
        result[i] = Math.max(-32768, Math.min(32767, Math.round(buffer[idx] * 32767)));
    }
    return result;
}

// Step 4: Connect to Gemini Live API
async function startLiveSession() {
    const token = await getEphemeralToken();
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${token}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        // Send setup message
        ws.send(JSON.stringify({
            setup: {
                model: `models/${model}`,
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
                },
                systemInstruction: { parts: [{ text: 'You are a friendly AI companion. Keep responses short (1-2 sentences).' }] },
            },
        }));
        console.log('✅ Connected to Gemini Live API');
    };

    // Capture mic and stream audio
    const { stream, processor, audioCtx } = await captureMicrophone();

    processor.onaudioprocess = (e) => {
        const pcm16 = downsampleTo16k(e.inputBuffer.getChannelData(0), audioCtx.sampleRate);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64 }] },
            }));
        }
    };

    // Receive and play audio response
    const playbackCtx = new AudioContext({ sampleRate: 24000 });

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const parts = msg.serverContent?.modelTurn?.parts;
        if (!parts) return;

        for (const part of parts) {
            if (part.inlineData?.mimeType?.includes('audio')) {
                // Decode base64 PCM and play
                const raw = atob(part.inlineData.data);
                const pcm = new Int16Array(raw.length / 2);
                for (let i = 0; i < pcm.length; i++) {
                    pcm[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
                }

                const float32 = new Float32Array(pcm.length);
                for (let i = 0; i < pcm.length; i++) float32[i] = pcm[i] / 32768;

                const buffer = playbackCtx.createBuffer(1, float32.length, 24000);
                buffer.getChannelData(0).set(float32);

                const source = playbackCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(playbackCtx.destination);
                source.start();
            }
        }
    };

    return { ws, stream, processor, audioCtx };
}

// Usage
startLiveSession().then(() => console.log('🎤 Live voice session started'));
