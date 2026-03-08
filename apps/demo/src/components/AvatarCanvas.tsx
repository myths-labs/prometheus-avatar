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
    if (lower.includes("happy") || lower.includes("great") || lower.includes("wonderful") || lower.includes("love") || text.includes("😊") || text.includes("🎉") || text.includes("❤️")) return "happy";
    if (lower.includes("sad") || lower.includes("sorry") || lower.includes("miss") || text.includes("😢") || text.includes("😞")) return "sad";
    if (lower.includes("angry") || lower.includes("hate") || lower.includes("furious") || text.includes("😠") || text.includes("🤬")) return "angry";
    if (lower.includes("what") || lower.includes("wow") || lower.includes("incredible") || lower.includes("amazing") || text.includes("😲") || text.includes("!!")) return "surprised";
    if (lower.includes("hmm") || lower.includes("think") || lower.includes("wonder") || lower.includes("maybe") || text.includes("🤔") || text.includes("?")) return "thinking";
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

        // Initialize PIXI + Live2D
        useEffect(() => {
            let cancelled = false;

            async function init() {
                if (!containerRef.current) return;

                try {
                    // Dynamic import — these libs need `window`
                    const PIXI = await import("pixi.js");
                    const { Live2DModel } = await import("pixi-live2d-display");

                    // Register PIXI for live2d-display
                    (window as any).PIXI = PIXI;

                    if (cancelled) return;

                    // Create PIXI app
                    const app = new PIXI.Application({
                        view: undefined,
                        backgroundAlpha: 0,
                        autoStart: true,
                        resizeTo: containerRef.current,
                    });
                    appRef.current = app;

                    containerRef.current.innerHTML = "";
                    containerRef.current.appendChild(app.view as HTMLCanvasElement);

                    // Load model
                    const model = await Live2DModel.from(modelUrl, { autoInteract: false });
                    if (cancelled) return;

                    modelRef.current = model;

                    // Scale & position to fit container
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
                    // Still mark as ready so chat panel works
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

        // Apply emotion to Live2D model
        const applyEmotion = useCallback((emotion: string) => {
            const model = modelRef.current;
            if (!model) return;

            // Try to set expression — model may have different expression names
            const expressionMap: Record<string, string[]> = {
                happy: ["happy", "smile", "f01"],
                sad: ["sad", "cry", "f04"],
                angry: ["angry", "f03"],
                surprised: ["surprised", "shock", "f02"],
                thinking: ["thinking", "doubt"],
                neutral: ["neutral", "idle", "f00"],
            };

            const candidates = expressionMap[emotion] || ["neutral"];
            for (const expr of candidates) {
                try {
                    model.expression(expr);
                    break;
                } catch { }
            }
        }, []);

        // Speak with lip-sync simulation
        useImperativeHandle(ref, () => ({
            speak: async (text: string) => {
                setLastText(text);
                setHasSpoken(true);

                const emotion = detectEmotion(text);
                onEmotionChange?.(emotion);
                applyEmotion(emotion);

                const model = modelRef.current;

                // TTS with Web Speech API
                if (typeof window !== "undefined" && window.speechSynthesis) {
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.rate = 1.0;
                    utterance.pitch = 1.0;

                    // Lip-sync: animate mouth parameter during speech
                    let mouthAnimFrame: number;
                    const animateMouth = () => {
                        if (model) {
                            try {
                                // Simulate mouth movement with sine wave
                                const value = Math.abs(Math.sin(Date.now() / 100)) * 0.8 + 0.2;
                                model.internalModel?.coreModel?.setParameterValueById?.("ParamMouthOpenY", value);
                            } catch { }
                        }
                        mouthAnimFrame = requestAnimationFrame(animateMouth);
                    };

                    return new Promise<void>((resolve) => {
                        utterance.onstart = () => { animateMouth(); };
                        utterance.onend = () => {
                            cancelAnimationFrame(mouthAnimFrame);
                            // Close mouth
                            try { model?.internalModel?.coreModel?.setParameterValueById?.("ParamMouthOpenY", 0); } catch { }
                            // Reset to neutral after delay
                            setTimeout(() => {
                                onEmotionChange?.("neutral");
                                applyEmotion("neutral");
                            }, 2000);
                            resolve();
                        };
                        utterance.onerror = () => {
                            cancelAnimationFrame(mouthAnimFrame);
                            resolve();
                        };
                        window.speechSynthesis.speak(utterance);
                    });
                } else {
                    // Fallback: simulate speaking duration
                    if (model) {
                        const duration = Math.min(text.length * 80, 5000);
                        const start = Date.now();
                        const animate = () => {
                            const elapsed = Date.now() - start;
                            if (elapsed < duration) {
                                try {
                                    const value = Math.abs(Math.sin(elapsed / 100)) * 0.8;
                                    model.internalModel?.coreModel?.setParameterValueById?.("ParamMouthOpenY", value);
                                } catch { }
                                requestAnimationFrame(animate);
                            } else {
                                try { model.internalModel?.coreModel?.setParameterValueById?.("ParamMouthOpenY", 0); } catch { }
                                setTimeout(() => { onEmotionChange?.("neutral"); applyEmotion("neutral"); }, 2000);
                            }
                        };
                        animate();
                        await new Promise((r) => setTimeout(r, duration));
                    } else {
                        await new Promise((r) => setTimeout(r, 1500));
                    }
                }
            },
        }), [onEmotionChange, applyEmotion]);

        // Placeholder UI when model isn't loaded
        if (!loaded) {
            return (
                <div ref={containerRef} className="w-full h-full relative min-h-[300px] flex flex-col items-center justify-center gap-4 p-6">
                    {error ? (
                        <>
                            <div className="text-5xl">🤖</div>
                            <p className="text-sm text-[#00d4aa] text-center font-semibold">Avatar Preview</p>
                            <div className="text-center max-w-xs">
                                <p className="text-xs text-[#4a5568]">Live2D models not yet installed. The avatar will animate here with lip-sync and emotions.</p>
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
