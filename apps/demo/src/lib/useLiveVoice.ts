"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { GoogleGenAI, Modality } from "@google/genai";

// ═══ AUDIO CONSTANTS ═══
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CHANNELS = 1;

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
 */
export function useLiveVoice(
    onAudioChunk?: (pcmData: Float32Array) => void,
    onTranscript?: (text: string, isFinal: boolean) => void,
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
    const playbackQueueRef = useRef<Float32Array[]>([]);
    const isPlayingRef = useRef(false);
    const nextPlayTimeRef = useRef(0);
    const cleanupRef = useRef(false);

    // ═══ AUDIO PLAYBACK: Queue and play PCM chunks ═══
    const playNextChunk = useCallback(() => {
        const ctx = audioContextRef.current;
        if (!ctx || playbackQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            return;
        }

        isPlayingRef.current = true;
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

        // Downsampling state
        const inputSampleRate = ctx.sampleRate;
        const ratio = inputSampleRate / INPUT_SAMPLE_RATE;

        processor.onaudioprocess = (e: AudioProcessingEvent) => {
            if (!sessionRef.current || cleanupRef.current) return;

            const input = e.inputBuffer.getChannelData(0);

            // Compute audio level for visualizer
            let sum = 0;
            for (let i = 0; i < input.length; i++) {
                sum += input[i] * input[i];
            }
            const rms = Math.sqrt(sum / input.length);
            setAudioLevel(Math.min(1, rms * 5));

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

            // Send to Gemini Live API
            try {
                sessionRef.current.sendRealtimeInput({
                    audio: {
                        data: base64,
                        mimeType: "audio/pcm;rate=16000",
                    },
                });
            } catch (err) {
                console.warn("[LiveVoice] Send error:", err);
            }
        };

        source.connect(processor);
        processor.connect(ctx.destination); // Required for ScriptProcessor to fire
        workletNodeRef.current = processor;
    }, []);

    // ═══ START SESSION ═══
    const startSession = useCallback(async (systemPrompt?: string, voiceName?: string) => {
        if (isLive || isConnecting) return;

        setIsConnecting(true);
        setError(null);
        setTranscript("");
        cleanupRef.current = false;
        playbackQueueRef.current = [];

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

            // 3. Connect to Gemini Live API (direct API key)
            const ai = new GoogleGenAI({ apiKey: token });

            const systemInstruction = systemPrompt
                ? `${systemPrompt}\n\nYou are Prometheus — a warm, witty AI companion. Keep responses short and conversational (1-2 sentences). STRICTLY match the user's language. React emotionally first, then respond.`
                : `You are Prometheus — a warm, witty AI companion with genuine personality. Talk like a close friend, not a robot. Keep responses short (1-2 sentences — this is real-time voice!). Use natural interjections (oh, hmm, haha, wow). STRICTLY match the user's language — if they speak English, respond in English. If Chinese, respond in Chinese. Never say "as an AI".`;

            const config: any = {
                responseModalities: [Modality.AUDIO],
                systemInstruction,
            };

            if (voiceName) {
                config.speechConfig = {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: voiceName,
                        },
                    },
                };
            }

            let currentTranscript = "";

            const session = await ai.live.connect({
                model: "gemini-2.0-flash-live-001",
                config,
                callbacks: {
                    onopen: () => {
                        console.log("[LiveVoice] ✅ Connected to Gemini Live API");
                    },
                    onmessage: (message: any) => {
                        // Handle interruption
                        if (message.serverContent?.interrupted) {
                            playbackQueueRef.current = [];
                            return;
                        }

                        // Handle audio response
                        if (message.serverContent?.modelTurn?.parts) {
                            for (const part of message.serverContent.modelTurn.parts) {
                                if (part.inlineData?.data) {
                                    enqueueAudio(part.inlineData.data);
                                }
                                // Text transcript (if model provides it)
                                if (part.text) {
                                    currentTranscript += part.text;
                                    setTranscript(currentTranscript);
                                    onTranscript?.(currentTranscript, false);
                                }
                            }
                        }

                        // Turn complete
                        if (message.serverContent?.turnComplete) {
                            if (currentTranscript) {
                                onTranscript?.(currentTranscript, true);
                                currentTranscript = "";
                            }
                        }
                    },
                    onerror: (e: any) => {
                        console.error("[LiveVoice] Error:", e.message || e);
                        setError(e.message || "Connection error");
                    },
                    onclose: (e: any) => {
                        console.log("[LiveVoice] Connection closed:", e?.reason || "unknown");
                        if (!cleanupRef.current) {
                            setIsLive(false);
                            setIsConnecting(false);
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
            const msg = err.name === "NotFoundError"
                ? "No microphone found. Please connect a mic and try again."
                : err.name === "NotAllowedError"
                    ? "Mic permission denied. Allow mic access and try again."
                    : err.message || "Failed to start";
            setError(msg);
            setIsConnecting(false);
            setIsLive(false);
        }
    }, [isLive, isConnecting, enqueueAudio, startMicCapture, onTranscript]);

    // ═══ END SESSION ═══
    const endSession = useCallback(() => {
        cleanupRef.current = true;

        // Stop mic
        if (workletNodeRef.current) {
            workletNodeRef.current.disconnect();
            workletNodeRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((t) => t.stop());
            mediaStreamRef.current = null;
        }

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
        setIsLive(false);
        setIsConnecting(false);
        setAudioLevel(0);
        console.log("[LiveVoice] Session ended");
    }, []);

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
