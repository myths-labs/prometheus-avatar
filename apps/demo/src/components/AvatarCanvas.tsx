"use client";

import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from "react";

export interface AvatarCanvasHandle {
    speak: (text: string) => Promise<void>;
    interrupt: () => void;
}

interface AvatarCanvasProps {
    modelUrl: string;
    onReady?: () => void;
    onEmotionChange?: (emotion: string) => void;
    voiceOverride?: string | null;
}

function detectEmotion(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("happy") || lower.includes("great") || lower.includes("love") || text.includes("😊") || text.includes("🎉") || lower.includes("开心") || lower.includes("高兴") || lower.includes("太好了") || lower.includes("哈哈")) return "happy";
    if (lower.includes("sad") || lower.includes("sorry") || text.includes("😢") || lower.includes("难过") || lower.includes("伤心") || lower.includes("抱歉")) return "sad";
    if (lower.includes("angry") || lower.includes("hate") || text.includes("😠") || lower.includes("生气") || lower.includes("愤怒")) return "angry";
    if (lower.includes("what") || lower.includes("wow") || lower.includes("amazing") || text.includes("😲") || lower.includes("什么") || lower.includes("哇") || text.includes("!!")) return "surprised";
    if (lower.includes("hmm") || lower.includes("think") || text.includes("🤔") || text.includes("?") || text.includes("？") || lower.includes("想") || lower.includes("嗯")) return "thinking";
    return "neutral";
}

function getAvatarId(modelUrl: string): string {
    if (modelUrl.includes("shizuku")) return "shizuku";
    if (modelUrl.includes("koharu")) return "koharu";
    return "haru";
}

const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(
    ({ modelUrl, onReady, onEmotionChange, voiceOverride }, ref) => {
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
                const avatarId = getAvatarId(modelUrl);

                // Try server-side TTS (Google TTS for Chinese, ElevenLabs for English)
                let audioUrl: string | null = null;
                try {
                    const res = await fetch("/api/tts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text, avatar: avatarId, voiceOverride: voiceOverride ? { gemini: voiceOverride } : undefined }),
                    });
                    if (res.ok) {
                        const blob = await res.blob();
                        audioUrl = URL.createObjectURL(blob);
                        console.log(`[TTS] ✅ engine=${res.headers.get('X-TTS-Engine')}, lang=${res.headers.get('X-TTS-Language')}`);
                    } else {
                        const errBody = await res.text().catch(() => "");
                        console.error(`[TTS] ❌ API returned ${res.status}: ${errBody.slice(0, 200)}`);
                    }
                } catch (e) {
                    console.error("[TTS] ❌ Fetch failed (using browser fallback):", e);
                }

                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage(
                        {
                            type: "speak",
                            text,
                            emotion,
                            audioUrl,
                            useBrowserTTS: !audioUrl,
                        },
                        "*"
                    );

                    await new Promise<void>((resolve) => {
                        speakResolveRef.current = resolve;
                        setTimeout(resolve, Math.min(text.length * 120, 15000));
                    });
                } else {
                    await new Promise((r) => setTimeout(r, 1500));
                }

                setTimeout(() => onEmotionChange?.("neutral"), 2000);
            },

            interrupt: () => {
                // Stop current speech immediately
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "stop-speaking" }, "*");
                }
                // Resolve any pending speak promise
                speakResolveRef.current?.();
                speakResolveRef.current = null;
                onEmotionChange?.("neutral");
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
                        <p className="text-xs text-[#a8b8d0]">Loading avatar...</p>
                    </div>
                )}
                {error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <div className="text-5xl">🤖</div>
                        <p className="text-xs text-[#6b7a8d] text-center max-w-[200px]">{error}</p>
                    </div>
                )}
            </div>
        );
    }
);

AvatarCanvas.displayName = "AvatarCanvas";
export default AvatarCanvas;
