"use client";

import { useRef, useImperativeHandle, forwardRef, useState } from "react";

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

const EMOTION_EMOJI: Record<string, string> = {
    neutral: "😐",
    happy: "😊",
    sad: "😢",
    angry: "😠",
    surprised: "😲",
    thinking: "🤔",
};

const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(
    ({ onReady, onEmotionChange }, ref) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const [currentEmotion, setCurrentEmotion] = useState("neutral");
        const [isSpeaking, setIsSpeaking] = useState(false);
        const [lastText, setLastText] = useState("");
        const [hasSpoken, setHasSpoken] = useState(false);

        useState(() => { setTimeout(() => onReady?.(), 500); });

        useImperativeHandle(ref, () => ({
            speak: async (text: string) => {
                setLastText(text);
                setHasSpoken(true);
                setIsSpeaking(true);

                const emotion = detectEmotion(text);
                setCurrentEmotion(emotion);
                onEmotionChange?.(emotion);

                // TTS with Web Speech API
                if (typeof window !== "undefined" && window.speechSynthesis) {
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.rate = 1.0;
                    await new Promise<void>((resolve) => {
                        utterance.onend = () => resolve();
                        utterance.onerror = () => resolve();
                        window.speechSynthesis.speak(utterance);
                    });
                } else {
                    await new Promise((r) => setTimeout(r, Math.min(text.length * 60, 4000)));
                }

                setIsSpeaking(false);
                setTimeout(() => {
                    setCurrentEmotion("neutral");
                    onEmotionChange?.("neutral");
                }, 2000);
            },
        }), [onEmotionChange]);

        return (
            <div ref={containerRef} className="w-full h-full relative min-h-[300px] flex flex-col items-center justify-center gap-4 p-6">
                {/* Animated avatar face */}
                <div className={`text-8xl transition-all duration-300 ${isSpeaking ? "animate-bounce" : ""}`} style={{ animationDuration: "0.6s" }}>
                    {EMOTION_EMOJI[currentEmotion] || "😐"}
                </div>

                <p className="text-sm text-[#00d4aa] text-center font-semibold">
                    {isSpeaking ? "Speaking..." : "Avatar Preview"}
                </p>

                {hasSpoken ? (
                    <div className="card-dark px-4 py-3 max-w-xs text-center">
                        <p className="text-sm text-[#8a9ab5] italic">&ldquo;{lastText}&rdquo;</p>
                        <p className="text-xs text-[#4a5568] mt-2">
                            🎭 Emotion: {currentEmotion} • 🔊 TTS enabled
                        </p>
                    </div>
                ) : (
                    <div className="text-center max-w-xs">
                        <p className="text-xs text-[#4a5568]">
                            Live2D rendering coming soon. Chat works with TTS and emotion detection now!
                        </p>
                        <p className="text-xs text-[#00d4aa] mt-2">💬 Try sending a message in the chat panel →</p>
                    </div>
                )}
            </div>
        );
    }
);

AvatarCanvas.displayName = "AvatarCanvas";
export default AvatarCanvas;
