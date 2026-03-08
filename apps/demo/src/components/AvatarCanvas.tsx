"use client";

import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from "react";

export interface AvatarCanvasHandle {
    speak: (text: string) => Promise<void>;
    interrupt: () => void;
    /** Load a motion from marketplace (motion3.json URL) */
    loadMotion: (url: string) => void;
    /** Load an expression preset from marketplace */
    loadExpression: (url: string) => void;
    /** Add an accessory overlay */
    addAccessory: (url: string) => void;
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
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "stop-speaking" }, "*");
                }
                speakResolveRef.current?.();
                speakResolveRef.current = null;
                onEmotionChange?.("neutral");
            },

            loadMotion: (url: string) => {
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "load-motion", url }, "*");
                }
            },

            loadExpression: (url: string) => {
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "load-expression", url }, "*");
                }
            },

            addAccessory: (url: string) => {
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "add-accessory", url }, "*");
                }
            },
        }), [onEmotionChange, modelUrl]);

        // Listen for marketplace asset events and forward to iframe
        useEffect(() => {
            function onMotion(e: Event) {
                const detail = (e as CustomEvent).detail;
                if (iframeRef.current?.contentWindow && detail?.url) {
                    iframeRef.current.contentWindow.postMessage({ type: "load-motion", url: detail.url }, "*");
                }
            }
            function onExpression(e: Event) {
                const detail = (e as CustomEvent).detail;
                if (iframeRef.current?.contentWindow && detail?.url) {
                    iframeRef.current.contentWindow.postMessage({ type: "load-expression", url: detail.url }, "*");
                }
            }
            function onAccessory(e: Event) {
                const detail = (e as CustomEvent).detail;
                if (iframeRef.current?.contentWindow && detail?.url) {
                    iframeRef.current.contentWindow.postMessage({ type: "add-accessory", url: detail.url }, "*");
                }
            }

            window.addEventListener("prometheus:motion", onMotion);
            window.addEventListener("prometheus:expression", onExpression);
            window.addEventListener("prometheus:accessory", onAccessory);
            return () => {
                window.removeEventListener("prometheus:motion", onMotion);
                window.removeEventListener("prometheus:expression", onExpression);
                window.removeEventListener("prometheus:accessory", onAccessory);
            };
        }, []);

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
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0f1a]/80 backdrop-blur-sm rounded-xl">
                        <div className="relative">
                            <div className="w-16 h-16 rounded-full border-2 border-[#00d4aa]/30 animate-spin" style={{ borderTopColor: '#00d4aa' }} />
                            <div className="absolute inset-0 flex items-center justify-center text-2xl">🎭</div>
                        </div>
                        <p className="text-sm text-[#a8b8d0] font-light">Loading avatar...</p>
                    </div>
                )}
                {error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0f1a]/80 backdrop-blur-sm rounded-xl">
                        <div className="text-5xl">😵</div>
                        <p className="text-sm text-[#c94c4c] text-center max-w-[240px]">{error}</p>
                        <button
                            onClick={() => { setError(null); setReady(false); iframeRef.current?.contentWindow?.location.reload(); }}
                            className="px-4 py-1.5 text-xs rounded-full bg-[#00d4aa]/15 text-[#00f0c8] border border-[#00d4aa]/20 hover:bg-[#00d4aa]/25 transition-all"
                        >🔄 Retry</button>
                    </div>
                )}
            </div>
        );
    }
);

AvatarCanvas.displayName = "AvatarCanvas";
export default AvatarCanvas;
