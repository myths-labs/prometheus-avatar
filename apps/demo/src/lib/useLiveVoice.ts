"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { GoogleGenAI, Modality } from "@google/genai";

// ═══ AUDIO CONSTANTS ═══
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CHANNELS = 1;

// ═══ RECONNECTION ═══
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1500;



export interface LiveVoiceState {
    isLive: boolean;
    isConnecting: boolean;
    transcript: string;
    error: string | null;
    startSession: (systemPrompt?: string, voiceName?: string) => Promise<void>;
    endSession: () => void;
    /** Current audio level 0-1 for visualizer */
    audioLevel: number;
}

/**
 * useLiveVoice — connects directly to Gemini Live API via WebSocket
 * for real-time voice conversation with ~200ms latency.
 *
 * Flow:
 * 1. Fetch ephemeral token from /api/live-token
 * 2. Connect to Gemini Live API via @google/genai SDK
 * 3. Capture mic audio → downsample to 16kHz PCM → send as base64
 * 4. Receive audio chunks → decode PCM → play via AudioContext
 * 5. Extract text transcript from server responses
 *
 * v2 fixes (3/9):
 * - 🔇 Echo elimination: mic no longer routes to speakers
 * - 🔌 WebSocket stability: readyState guards + auto-reconnect
 * - 🎤 Mic suppression during playback to prevent feedback
 */
export function useLiveVoice(
    onAudioChunk?: (pcmData: Float32Array) => void,
    onTranscript?: (text: string, isFinal: boolean) => void,
    onInputTranscript?: (text: string) => void,
): LiveVoiceState {
    const [isLive, setIsLive] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);

    const sessionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
    const silentGainRef = useRef<GainNode | null>(null);
    const playbackQueueRef = useRef<Float32Array[]>([]);
    const isPlayingRef = useRef(false);
    const nextPlayTimeRef = useRef(0);
    const cleanupRef = useRef(false);
    /** True when the WebSocket session is confirmed open and ready */
    const isSessionActiveRef = useRef(false);
    /** True when TTS audio is currently playing through speakers */
    const isPlaybackActiveRef = useRef(false);
    /** Tracks consecutive send errors for circuit-breaker */
    const sendErrorCountRef = useRef(0);
    /** Stored config for auto-reconnect */
    const lastConfigRef = useRef<{ systemPrompt?: string; voiceName?: string }>({});
    const reconnectAttemptsRef = useRef(0);

    // ═══ AUDIO PLAYBACK: Queue and play PCM chunks ═══
    const playNextChunk = useCallback(() => {
        const ctx = audioContextRef.current;
        if (!ctx || playbackQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            isPlaybackActiveRef.current = false;
            return;
        }

        isPlayingRef.current = true;
        isPlaybackActiveRef.current = true;
        const pcm = playbackQueueRef.current.shift()!;

        // Send to avatar lip-sync
        onAudioChunk?.(pcm);

        const audioBuffer = ctx.createBuffer(CHANNELS, pcm.length, OUTPUT_SAMPLE_RATE);
        audioBuffer.getChannelData(0).set(pcm);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        const startTime = Math.max(now, nextPlayTimeRef.current);
        source.start(startTime);
        nextPlayTimeRef.current = startTime + audioBuffer.duration;

        source.onended = () => {
            if (!cleanupRef.current) {
                playNextChunk();
            }
        };
    }, [onAudioChunk]);

    const enqueueAudio = useCallback((base64Data: string) => {
        const raw = atob(base64Data);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
        }

        // Convert 16-bit PCM to Float32
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768;
        }

        playbackQueueRef.current.push(float32);

        if (!isPlayingRef.current) {
            playNextChunk();
        }
    }, [playNextChunk]);

    // ═══ MIC CAPTURE: getUserMedia → downsample → send PCM ═══
    const startMicCapture = useCallback(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: { ideal: INPUT_SAMPLE_RATE },
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });
        mediaStreamRef.current = stream;

        const ctx = audioContextRef.current!;
        const source = ctx.createMediaStreamSource(stream);

        // Use ScriptProcessorNode (widely supported) to capture and downsample
        const bufferSize = 4096;
        const processor = ctx.createScriptProcessor(bufferSize, 1, 1);

        // ═══ FIX #1: ECHO ELIMINATION ═══
        // ScriptProcessor MUST be connected to the audio graph to fire events,
        // but connecting to ctx.destination routes mic audio to speakers = echo!
        // Solution: connect to a GainNode with gain=0 (silent sink)
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        silentGain.connect(ctx.destination);
        silentGainRef.current = silentGain;

        // Downsampling state
        const inputSampleRate = ctx.sampleRate;
        const ratio = inputSampleRate / INPUT_SAMPLE_RATE;

        processor.onaudioprocess = (e: AudioProcessingEvent) => {
            // ═══ FIX #2: GUARD — skip if session is gone or closing ═══
            if (!sessionRef.current || cleanupRef.current || !isSessionActiveRef.current) return;

            const input = e.inputBuffer.getChannelData(0);

            // Compute audio level for visualizer
            let sum = 0;
            for (let i = 0; i < input.length; i++) {
                sum += input[i] * input[i];
            }
            const rms = Math.sqrt(sum / input.length);
            setAudioLevel(Math.min(1, rms * 5));

            // ═══ FIX #3: MIC SUPPRESSION — don't send mic data while TTS is playing ═══
            // This prevents Gemini from hearing its own voice and creates a half-duplex behavior
            // (Gemini's built-in VAD handles proper turn-taking when we DO send audio)
            if (isPlaybackActiveRef.current) {
                return; // Skip sending — TTS is playing through speakers
            }

            // Downsample to 16kHz
            const outputLength = Math.floor(input.length / ratio);
            const output = new Int16Array(outputLength);
            for (let i = 0; i < outputLength; i++) {
                const srcIdx = Math.floor(i * ratio);
                const sample = Math.max(-1, Math.min(1, input[srcIdx]));
                output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }

            // Convert to base64
            const bytes = new Uint8Array(output.buffer);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);

            // ═══ FIX #4: SAFE SEND — check session is still active, circuit-breaker on errors ═══
            try {
                if (isSessionActiveRef.current && sessionRef.current) {
                    sessionRef.current.sendRealtimeInput({
                        audio: {
                            data: base64,
                            mimeType: "audio/pcm;rate=16000",
                        },
                    });
                    // Reset error count on successful send
                    sendErrorCountRef.current = 0;
                }
            } catch (err: any) {
                sendErrorCountRef.current++;
                const msg = err?.message || String(err);

                if (msg.includes("CLOS") || msg.includes("close") || msg.includes("1000") || msg.includes("1006")) {
                    // WebSocket is closing/closed — mark session as dead
                    console.warn("[LiveVoice] WebSocket closed, stopping sends");
                    isSessionActiveRef.current = false;
                } else if (sendErrorCountRef.current > 5) {
                    // Circuit breaker: too many consecutive errors
                    console.error("[LiveVoice] Too many send errors, deactivating session");
                    isSessionActiveRef.current = false;
                } else {
                    console.warn("[LiveVoice] Send error (attempt", sendErrorCountRef.current, "):", msg);
                }
            }
        };

        source.connect(processor);
        // ═══ Connect to silent sink instead of destination ═══
        processor.connect(silentGain);
        workletNodeRef.current = processor;
    }, []);

    // ═══ CLEANUP HELPERS ═══
    const stopMic = useCallback(() => {
        if (workletNodeRef.current) {
            try { workletNodeRef.current.disconnect(); } catch { }
            workletNodeRef.current = null;
        }
        if (silentGainRef.current) {
            try { silentGainRef.current.disconnect(); } catch { }
            silentGainRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((t) => t.stop());
            mediaStreamRef.current = null;
        }
    }, []);

    // ═══ START SESSION ═══
    const startSession = useCallback(async (systemPrompt?: string, voiceName?: string) => {
        if (isLive || isConnecting) return;

        setIsConnecting(true);
        setError(null);
        setTranscript("");
        cleanupRef.current = false;
        isSessionActiveRef.current = false;
        sendErrorCountRef.current = 0;
        playbackQueueRef.current = [];
        lastConfigRef.current = { systemPrompt, voiceName };

        try {
            // 1. Get ephemeral token
            const tokenRes = await fetch("/api/live-token");
            if (!tokenRes.ok) {
                const err = await tokenRes.json().catch(() => ({}));
                throw new Error(err.error || `Token API ${tokenRes.status}`);
            }
            const { token } = await tokenRes.json();

            // 2. Create AudioContext
            const ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
            audioContextRef.current = ctx;
            nextPlayTimeRef.current = 0;

            // 3. Connect to Gemini Live API
            const ai = new GoogleGenAI({ apiKey: token });

            const systemInstruction = systemPrompt
                ? `${systemPrompt}\n\nYou are Prometheus — a warm, witty AI companion. Keep responses short and conversational (1-2 sentences). STRICTLY match the user's language. React emotionally first, then respond.`
                : `You are Prometheus — a warm, witty AI companion with genuine personality. Talk like a close friend, not a robot. Keep responses short (1-2 sentences — this is real-time voice!). Use natural interjections (oh, hmm, haha, wow). STRICTLY match the user's language — if they speak English, respond in English. If Chinese, respond in Chinese. Never say "as an AI".`;

            const config: any = {
                // ═══ TEXT ONLY — audio generated by server-side /api/tts (multi-engine) ═══
                responseModalities: [Modality.TEXT],
                systemInstruction,
                // Enable real-time transcription of user's voice input
                inputAudioTranscription: {},
                // ═══ DISABLE THINKING — gemini-2.0-flash supports this ═══
                thinkingConfig: {
                    thinkingBudget: 0,
                },
            };

            let currentTranscript = "";

            const session = await ai.live.connect({
                // ═══ TEXT LLM — gemini-2.0-flash (non-thinking, stable) ═══
                // Response is TEXT only. Audio generated by /api/tts (multi-engine TTS, QA 9/9 PASS).
                // This completely eliminates CoT leakage since no native audio generation.
                model: "gemini-2.0-flash",
                config,
                callbacks: {
                    onopen: () => {
                        console.log("[LiveVoice] ✅ Connected to Gemini Live API");
                        isSessionActiveRef.current = true;
                        sendErrorCountRef.current = 0;
                        reconnectAttemptsRef.current = 0;
                    },
                    onmessage: (message: any) => {
                        // Handle interruption — Gemini detected user started talking
                        if (message.serverContent?.interrupted) {
                            playbackQueueRef.current = [];
                            isPlaybackActiveRef.current = false;
                            return;
                        }

                        // ═══ HANDLE TEXT RESPONSE → send to /api/tts for audio ═══
                        if (message.serverContent?.modelTurn?.parts) {
                            for (const part of message.serverContent.modelTurn.parts) {
                                if (part.text) {
                                    currentTranscript += part.text;
                                    setTranscript(currentTranscript);
                                    onTranscript?.(currentTranscript, false);
                                }
                            }
                        }

                        // ═══ INPUT TRANSCRIPTION — user's speech as text ═══
                        if (message.serverContent?.inputTranscription?.text) {
                            const text = message.serverContent.inputTranscription.text;
                            onInputTranscript?.(text);
                        }

                        // ═══ TURN COMPLETE — model finished, send text to TTS ═══
                        if (message.serverContent?.turnComplete) {
                            if (currentTranscript) {
                                const finalText = currentTranscript;
                                onTranscript?.(finalText, true);
                                currentTranscript = "";

                                // Send to server-side multi-engine TTS
                                fetch("/api/tts", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ text: finalText, avatar: "haru" }),
                                })
                                    .then(async (res) => {
                                        if (res.status === 204 || !res.ok) {
                                            // Fallback to browser TTS
                                            console.warn("[LiveVoice] TTS 204, falling back to browser speechSynthesis");
                                            const utterance = new SpeechSynthesisUtterance(finalText);
                                            speechSynthesis.speak(utterance);
                                            return;
                                        }
                                        const audioData = await res.arrayBuffer();
                                        const ctx = audioContextRef.current;
                                        if (ctx && audioData.byteLength > 0) {
                                            try {
                                                const decoded = await ctx.decodeAudioData(audioData);
                                                // Send to lip-sync
                                                const pcm = decoded.getChannelData(0);
                                                onAudioChunk?.(pcm);
                                                // Play the audio
                                                const source = ctx.createBufferSource();
                                                source.buffer = decoded;
                                                source.connect(ctx.destination);
                                                source.start();
                                            } catch (decodeErr) {
                                                console.warn("[LiveVoice] Audio decode failed, browser TTS fallback");
                                                const utterance = new SpeechSynthesisUtterance(finalText);
                                                speechSynthesis.speak(utterance);
                                            }
                                        }
                                    })
                                    .catch((err) => {
                                        console.warn("[LiveVoice] TTS fetch error:", err);
                                        const utterance = new SpeechSynthesisUtterance(finalText);
                                        speechSynthesis.speak(utterance);
                                    });
                            }
                        }
                    },
                    onerror: (e: any) => {
                        console.error("[LiveVoice] Error:", e.message || e);
                        isSessionActiveRef.current = false;
                        setError(e.message || "Connection error");
                    },
                    onclose: (e: any) => {
                        const reason = e?.reason || e?.code || "unknown";
                        const reasonStr = String(reason);
                        console.log("[LiveVoice] Connection closed:", reasonStr);
                        isSessionActiveRef.current = false;

                        // ═══ PERMANENT ERROR DETECTION ═══
                        // Don't reconnect if the error is non-recoverable
                        const isPermanentError =
                            reasonStr.includes("not found") ||
                            reasonStr.includes("not supported") ||
                            reasonStr.includes("PERMISSION") ||
                            reasonStr.includes("INVALID") ||
                            reasonStr.includes("1008") ||
                            reasonStr.includes("ListModels");

                        if (!cleanupRef.current && !isPermanentError) {
                            // Unexpected close (network issue) — try to reconnect
                            const attempts = reconnectAttemptsRef.current;
                            if (attempts < MAX_RECONNECT_ATTEMPTS) {
                                reconnectAttemptsRef.current++;
                                const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempts);
                                console.log(`[LiveVoice] 🔄 Reconnecting in ${delay}ms (attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
                                setError(`Connection lost. Reconnecting... (${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

                                // Clean up current resources before reconnecting
                                stopMic();
                                try { sessionRef.current?.close(); } catch { }
                                sessionRef.current = null;
                                try { audioContextRef.current?.close(); } catch { }
                                audioContextRef.current = null;
                                playbackQueueRef.current = [];
                                isPlayingRef.current = false;
                                isPlaybackActiveRef.current = false;
                                setIsLive(false);

                                setTimeout(() => {
                                    if (!cleanupRef.current) {
                                        startSession(
                                            lastConfigRef.current.systemPrompt,
                                            lastConfigRef.current.voiceName,
                                        );
                                    }
                                }, delay);
                            } else {
                                setIsLive(false);
                                setIsConnecting(false);
                                setError("Connection lost. Please try again.");
                            }
                        } else if (!cleanupRef.current && isPermanentError) {
                            // Permanent error — don't reconnect, show clear message
                            console.error("[LiveVoice] Permanent error, not reconnecting:", reasonStr);
                            stopMic();
                            try { sessionRef.current?.close(); } catch { }
                            sessionRef.current = null;
                            try { audioContextRef.current?.close(); } catch { }
                            audioContextRef.current = null;
                            playbackQueueRef.current = [];
                            isPlayingRef.current = false;
                            isPlaybackActiveRef.current = false;
                            setIsLive(false);
                            setIsConnecting(false);
                            setError(`Live API error: ${reasonStr}`);
                        }
                    },
                },
            });

            sessionRef.current = session;

            // 4. Start mic capture
            await startMicCapture();

            setIsLive(true);
            setIsConnecting(false);
            console.log("[LiveVoice] 🎤 Session active — speak now");
        } catch (err: any) {
            console.error("[LiveVoice] Start error:", err);
            isSessionActiveRef.current = false;
            const msg = err.name === "NotFoundError"
                ? "No microphone found. Please connect a mic and try again."
                : err.name === "NotAllowedError"
                    ? "Mic permission denied. Allow mic access and try again."
                    : err.message || "Failed to start";
            setError(msg);
            setIsConnecting(false);
            setIsLive(false);
        }
    }, [isLive, isConnecting, startMicCapture, onTranscript, onInputTranscript, onAudioChunk, stopMic]);

    // ═══ END SESSION ═══
    const endSession = useCallback(() => {
        cleanupRef.current = true;
        isSessionActiveRef.current = false;
        reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS; // Prevent reconnection

        // Stop mic
        stopMic();

        // Close WebSocket
        if (sessionRef.current) {
            try { sessionRef.current.close(); } catch { }
            sessionRef.current = null;
        }

        // Close AudioContext
        if (audioContextRef.current) {
            try { audioContextRef.current.close(); } catch { }
            audioContextRef.current = null;
        }

        playbackQueueRef.current = [];
        isPlayingRef.current = false;
        isPlaybackActiveRef.current = false;
        sendErrorCountRef.current = 0;
        setIsLive(false);
        setIsConnecting(false);
        setAudioLevel(0);
        console.log("[LiveVoice] Session ended");
    }, [stopMic]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cleanupRef.current = true;
            endSession();
        };
    }, [endSession]);

    return {
        isLive,
        isConnecting,
        transcript,
        error,
        startSession,
        endSession,
        audioLevel,
    };
}
