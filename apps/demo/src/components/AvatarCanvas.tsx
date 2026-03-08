"use client";

import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from "react";

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
    if (lower.includes("happy") || lower.includes("great") || lower.includes("love") || text.includes("😊") || text.includes("🎉") || lower.includes("开心") || lower.includes("高兴") || lower.includes("好")) return "happy";
    if (lower.includes("sad") || lower.includes("sorry") || text.includes("😢") || lower.includes("难过") || lower.includes("伤心")) return "sad";
    if (lower.includes("angry") || lower.includes("hate") || text.includes("😠") || lower.includes("生气") || lower.includes("愤怒")) return "angry";
    if (lower.includes("what") || lower.includes("wow") || lower.includes("amazing") || text.includes("😲") || lower.includes("什么") || lower.includes("哇")) return "surprised";
    if (lower.includes("hmm") || lower.includes("think") || text.includes("🤔") || text.includes("?") || text.includes("？") || lower.includes("想")) return "thinking";
    return "neutral";
}

// Voice params per avatar for personality
function getVoiceParams(modelUrl: string): { pitch: number; rate: number } {
    if (modelUrl.includes("shizuku")) return { pitch: 1.2, rate: 0.9 };
    if (modelUrl.includes("koharu")) return { pitch: 1.5, rate: 1.05 };
    return { pitch: 1.0, rate: 1.0 }; // Haru — standard
}

const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(
    ({ modelUrl, onReady, onEmotionChange }, ref) => {
        const iframeRef = useRef<HTMLIFrameElement>(null);
        const [ready, setReady] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const speakResolveRef = useRef<(() => void) | null>(null);

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

        useImperativeHandle(ref, () => ({
            speak: async (text: string) => {
                const emotion = detectEmotion(text);
                onEmotionChange?.(emotion);
                const { pitch, rate } = getVoiceParams(modelUrl);

                if (iframeRef.current?.contentWindow) {
                    // Send speak command — TTS + mouth sync happen INSIDE iframe
                    iframeRef.current.contentWindow.postMessage(
                        { type: "speak", text, emotion, pitch, rate },
                        "*"
                    );

                    await new Promise<void>((resolve) => {
                        speakResolveRef.current = resolve;
                        setTimeout(resolve, Math.min(text.length * 100, 8000));
                    });
                } else {
                    await new Promise((r) => setTimeout(r, 1500));
                }

                setTimeout(() => {
                    onEmotionChange?.("neutral");
                }, 2000);
            },
        }), [onEmotionChange, modelUrl]);

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
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <div className="text-4xl animate-pulse">⏳</div>
                        <p className="text-xs text-[#8a9ab5]">Loading avatar...</p>
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
