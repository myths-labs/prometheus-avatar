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

// Dynamically load external scripts
function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load: ${src}`));
        document.head.appendChild(script);
    });
}

function detectEmotion(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("happy") || lower.includes("great") || lower.includes("wonderful") || lower.includes("love") || text.includes("😊") || text.includes("🎉")) return "happy";
    if (lower.includes("sad") || lower.includes("sorry") || lower.includes("miss") || text.includes("😢")) return "sad";
    if (lower.includes("angry") || lower.includes("hate") || text.includes("😠")) return "angry";
    if (lower.includes("what") || lower.includes("wow") || lower.includes("amazing") || text.includes("😲") || text.includes("!!")) return "surprised";
    if (lower.includes("hmm") || lower.includes("think") || lower.includes("wonder") || text.includes("🤔") || text.includes("?")) return "thinking";
    return "neutral";
}

const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(
    ({ modelUrl, onReady, onEmotionChange }, ref) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const appRef = useRef<any>(null);
        const modelRef = useRef<any>(null);
        const [loaded, setLoaded] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const [hasSpoken, setHasSpoken] = useState(false);
        const [lastText, setLastText] = useState("");

        useEffect(() => {
            let cancelled = false;

            async function init() {
                if (!containerRef.current) return;

                try {
                    // 1. Load Live2D runtimes first
                    await Promise.all([
                        loadScript("https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js"),
                        loadScript("https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"),
                    ]);

                    if (cancelled) return;

                    // 2. Dynamic import PIXI + Live2D display
                    const PIXI = await import("pixi.js");
                    (window as any).PIXI = PIXI;

                    const { Live2DModel } = await import("pixi-live2d-display");

                    if (cancelled) return;

                    // 3. Create PIXI app
                    const app = new PIXI.Application({
                        backgroundAlpha: 0,
                        autoStart: true,
                        resizeTo: containerRef.current,
                    });
                    appRef.current = app;

                    containerRef.current.innerHTML = "";
                    containerRef.current.appendChild(app.view as HTMLCanvasElement);

                    // 4. Load model
                    const model = await Live2DModel.from(modelUrl, { autoInteract: false });
                    if (cancelled) return;
                    modelRef.current = model;

                    // Scale & position
                    const containerW = containerRef.current.clientWidth;
                    const containerH = containerRef.current.clientHeight;
                    const scale = Math.min(containerW / model.width, containerH / model.height) * 0.8;
                    model.scale.set(scale);
                    model.x = (containerW - model.width * scale) / 2;
                    model.y = (containerH - model.height * scale) / 2;

                    app.stage.addChild(model);
                    setLoaded(true);
                    onReady?.();
                } catch (e: any) {
                    console.warn("Live2D load failed:", e);
                    setError(e.message || "Failed to load model");
                    onReady?.();
                }
            }

            init();

            return () => {
                cancelled = true;
                if (appRef.current) {
                    try { appRef.current.destroy(true); } catch { }
                    appRef.current = null;
                }
                modelRef.current = null;
                setLoaded(false);
            };
        }, [modelUrl, onReady]);

        const applyEmotion = useCallback((emotion: string) => {
            const model = modelRef.current;
            if (!model) return;
            const map: Record<string, string[]> = {
                happy: ["happy", "smile", "f01"],
                sad: ["sad", "cry", "f04"],
                angry: ["angry", "f03"],
                surprised: ["surprised", "shock", "f02"],
                thinking: ["thinking", "doubt"],
                neutral: ["neutral", "idle", "f00"],
            };
            for (const expr of (map[emotion] || ["neutral"])) {
                try { model.expression(expr); break; } catch { }
            }
        }, []);

        useImperativeHandle(ref, () => ({
            speak: async (text: string) => {
                setLastText(text);
                setHasSpoken(true);
                const emotion = detectEmotion(text);
                onEmotionChange?.(emotion);
                applyEmotion(emotion);

                const model = modelRef.current;

                // TTS
                if (typeof window !== "undefined" && window.speechSynthesis) {
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.rate = 1.0;
                    let mouthFrame: number;
                    const animMouth = () => {
                        if (model) {
                            try {
                                const v = Math.abs(Math.sin(Date.now() / 100)) * 0.8 + 0.2;
                                model.internalModel?.coreModel?.setParameterValueById?.("ParamMouthOpenY", v);
                            } catch { }
                        }
                        mouthFrame = requestAnimationFrame(animMouth);
                    };
                    return new Promise<void>((resolve) => {
                        utterance.onstart = () => animMouth();
                        utterance.onend = () => {
                            cancelAnimationFrame(mouthFrame);
                            try { model?.internalModel?.coreModel?.setParameterValueById?.("ParamMouthOpenY", 0); } catch { }
                            setTimeout(() => { onEmotionChange?.("neutral"); applyEmotion("neutral"); }, 2000);
                            resolve();
                        };
                        utterance.onerror = () => { cancelAnimationFrame(mouthFrame); resolve(); };
                        window.speechSynthesis.speak(utterance);
                    });
                } else {
                    await new Promise((r) => setTimeout(r, 1500));
                }
            },
        }), [onEmotionChange, applyEmotion]);

        if (!loaded) {
            return (
                <div ref={containerRef} className="w-full h-full relative min-h-[300px] flex flex-col items-center justify-center gap-4 p-6">
                    {error ? (
                        <>
                            <div className="text-5xl">🤖</div>
                            <p className="text-sm text-[#00d4aa] text-center font-semibold">Avatar Preview</p>
                            <div className="text-center max-w-xs">
                                <p className="text-xs text-[#4a5568]">{error}</p>
                                <p className="text-xs text-[#00d4aa] mt-2">💬 Try sending a message in the chat panel →</p>
                            </div>
                            {hasSpoken && (
                                <div className="glass px-4 py-3 max-w-xs text-center">
                                    <p className="text-sm text-[#8a9ab5] italic">&ldquo;{lastText}&rdquo;</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="text-4xl animate-pulse">⏳</div>
                            <p className="text-sm text-[#8a9ab5]">Loading avatar...</p>
                        </>
                    )}
                </div>
            );
        }

        return <div ref={containerRef} className="w-full h-full min-h-[300px]" />;
    }
);

AvatarCanvas.displayName = "AvatarCanvas";
export default AvatarCanvas;
