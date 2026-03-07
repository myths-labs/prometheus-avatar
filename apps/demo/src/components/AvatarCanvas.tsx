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

const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(
    ({ onReady, onEmotionChange }, ref) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const [hasSpoken, setHasSpoken] = useState(false);
        const [lastText, setLastText] = useState("");

        useState(() => { setTimeout(() => onReady?.(), 500); });

        useImperativeHandle(ref, () => ({
            speak: async (text: string) => {
                setLastText(text);
                setHasSpoken(true);
                const lower = text.toLowerCase();
                let emotion = "neutral";
                if (lower.includes("happy") || lower.includes("great") || text.includes("😊") || text.includes("🎉")) emotion = "happy";
                else if (lower.includes("sad") || lower.includes("sorry") || text.includes("😢")) emotion = "sad";
                else if (lower.includes("angry") || text.includes("😠")) emotion = "angry";
                else if (lower.includes("what") || lower.includes("wow") || text.includes("!") || text.includes("😲")) emotion = "surprised";
                else if (lower.includes("hmm") || lower.includes("think") || text.includes("🤔") || text.includes("?")) emotion = "thinking";
                onEmotionChange?.(emotion);
                await new Promise((r) => setTimeout(r, 1500));
            },
        }), [onEmotionChange]);

        return (
            <div ref={containerRef} className="w-full h-full relative min-h-[300px] flex flex-col items-center justify-center gap-4 p-6">
                <div className="text-7xl animate-bounce" style={{ animationDuration: "2s" }}>🤖</div>
                <p className="text-sm text-purple-400 text-center font-semibold">Avatar Preview</p>
                {hasSpoken ? (
                    <div className="glass px-4 py-3 max-w-xs text-center">
                        <p className="text-sm text-gray-300 italic">&ldquo;{lastText}&rdquo;</p>
                        <p className="text-xs text-gray-500 mt-2">✨ Live2D avatar will animate here once model files are added</p>
                    </div>
                ) : (
                    <div className="text-center max-w-xs">
                        <p className="text-xs text-gray-500">Live2D models not yet installed. The avatar will animate here with lip-sync and emotions.</p>
                        <p className="text-xs text-purple-400 mt-2">💬 Try sending a message in the chat panel →</p>
                    </div>
                )}
            </div>
        );
    }
);

AvatarCanvas.displayName = "AvatarCanvas";
export default AvatarCanvas;
