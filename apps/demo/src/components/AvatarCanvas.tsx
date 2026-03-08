"use client";

import { useRef, useImperativeHandle, forwardRef, useState, useEffect, useCallback } from "react";

export interface AvatarCanvasHandle {
    speak: (text: string) => Promise<void>;
}

interface AvatarCanvasProps {
    modelUrl: string;
    onReady?: () => void;
    onEmotionChange?: (emotion: string) => void;
}

function detectEmotion(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("happy") || lower.includes("great") || lower.includes("love") || text.includes("😊") || text.includes("🎉")) return "happy";
    if (lower.includes("sad") || lower.includes("sorry") || text.includes("😢")) return "sad";
    if (lower.includes("angry") || lower.includes("hate") || text.includes("😠")) return "angry";
    if (lower.includes("what") || lower.includes("wow") || lower.includes("amazing") || text.includes("😲")) return "surprised";
    if (lower.includes("hmm") || lower.includes("think") || text.includes("🤔") || text.includes("?")) return "thinking";
    return "neutral";
}

const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(
    ({ modelUrl, onReady, onEmotionChange }, ref) => {
        const iframeRef = useRef<HTMLIFrameElement>(null);
        const [ready, setReady] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const speakResolveRef = useRef<(() => void) | null>(null);

        // Listen for messages from iframe
        useEffect(() => {
            function handleMessage(e: MessageEvent) {
                if (e.data.type === "live2d-ready") {
                    setReady(true);
                    onReady?.();
                }
                if (e.data.type === "live2d-error") {
                    setError(e.data.error);
                    onReady?.();
                }
                if (e.data.type === "speak-done") {
                    speakResolveRef.current?.();
                    speakResolveRef.current = null;
                }
            }
            window.addEventListener("message", handleMessage);
            return () => window.removeEventListener("message", handleMessage);
        }, [onReady]);

        // Speak via postMessage to iframe
        useImperativeHandle(ref, () => ({
            speak: async (text: string) => {
                const emotion = detectEmotion(text);
                onEmotionChange?.(emotion);

                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage(
                        { type: "speak", text, emotion },
                        "*"
                    );

                    // TTS in parent window — vary voice by avatar
                    if (typeof window !== "undefined" && window.speechSynthesis) {
                        const utterance = new SpeechSynthesisUtterance(text);
                        // Different pitch/rate per avatar
                        if (modelUrl.includes("shizuku")) {
                            utterance.pitch = 1.3;
                            utterance.rate = 0.9;
                        } else if (modelUrl.includes("koharu")) {
                            utterance.pitch = 1.6;
                            utterance.rate = 1.05;
                        } else {
                            utterance.pitch = 1.0;
                            utterance.rate = 1.0;
                        }
                        // Try to pick a female voice
                        const voices = window.speechSynthesis.getVoices();
                        const preferred = voices.find(v => v.name.includes("Samantha") || v.name.includes("Karen") || v.name.includes("Google") && v.lang.startsWith("en"));
                        if (preferred) utterance.voice = preferred;
                        window.speechSynthesis.speak(utterance);
                    }

                    // Wait for mouth animation to finish
                    await new Promise<void>((resolve) => {
                        speakResolveRef.current = resolve;
                        // Timeout fallback
                        setTimeout(resolve, Math.min(text.length * 60, 6000));
                    });
                } else {
                    await new Promise((r) => setTimeout(r, 1500));
                }

                setTimeout(() => {
                    onEmotionChange?.("neutral");
                }, 2000);
            },
        }), [onEmotionChange]);

        const iframeSrc = `/avatar.html?model=${encodeURIComponent(modelUrl)}`;

        return (
            <div className="w-full h-full relative min-h-[300px]">
                <iframe
                    ref={iframeRef}
                    src={iframeSrc}
                    className="w-full h-full min-h-[300px] border-0"
                    style={{ background: "transparent" }}
                    allow="autoplay"
                />
                {!ready && !error && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-4xl animate-pulse">⏳</div>
                    </div>
                )}
                {error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <div className="text-5xl">🤖</div>
                        <p className="text-xs text-[#4a5568] text-center max-w-[200px]">{error}</p>
                    </div>
                )}
            </div>
        );
    }
);

AvatarCanvas.displayName = "AvatarCanvas";
export default AvatarCanvas;
