"use client";

import {
    useEffect,
    useRef,
    useImperativeHandle,
    forwardRef,
    useState,
    useCallback,
} from "react";

export interface AvatarCanvasHandle {
    speak: (text: string) => Promise<void>;
}

interface AvatarCanvasProps {
    modelUrl: string;
    onReady?: () => void;
    onEmotionChange?: (emotion: string) => void;
}

const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(
    ({ modelUrl, onReady, onEmotionChange }, ref) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const avatarInstanceRef = useRef<any>(null);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);

        // Initialize avatar
        useEffect(() => {
            if (!containerRef.current) return;

            let destroyed = false;
            const container = containerRef.current;

            const initAvatar = async () => {
                setLoading(true);
                setError(null);

                try {
                    // Dynamic import of SDK to avoid SSR issues
                    const { createAvatar } = await import("@prometheus-avatar/core");

                    if (destroyed) return;

                    // Destroy previous instance
                    if (avatarInstanceRef.current) {
                        avatarInstanceRef.current.destroy();
                    }

                    // Clear container
                    container.innerHTML = "";

                    const avatar = await createAvatar({
                        container,
                        modelUrl,
                        width: container.clientWidth || 600,
                        height: container.clientHeight || 450,
                        debug: true,
                    });

                    if (destroyed) {
                        avatar.destroy();
                        return;
                    }

                    avatarInstanceRef.current = avatar;

                    // Listen for emotion changes
                    avatar.on("emotion:change", ({ result }: any) => {
                        onEmotionChange?.(result.emotion);
                    });

                    setLoading(false);
                    onReady?.();
                } catch (err) {
                    if (destroyed) return;
                    console.error("[AvatarCanvas] Failed to init:", err);
                    setError("Failed to load avatar model. Make sure Live2D Cubism Core is loaded.");
                    setLoading(false);
                }
            };

            initAvatar();

            return () => {
                destroyed = true;
                if (avatarInstanceRef.current) {
                    avatarInstanceRef.current.destroy();
                    avatarInstanceRef.current = null;
                }
            };
        }, [modelUrl, onReady, onEmotionChange]);

        // Expose speak method to parent
        useImperativeHandle(
            ref,
            () => ({
                speak: async (text: string) => {
                    if (avatarInstanceRef.current) {
                        await avatarInstanceRef.current.speak(text);
                    }
                },
            }),
            []
        );

        return (
            <div ref={containerRef} className="w-full h-full relative min-h-[300px]">
                {/* Loading state */}
                {loading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                        <div className="w-12 h-12 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                        <p className="text-sm text-gray-400">Loading avatar...</p>
                    </div>
                )}

                {/* Error state */}
                {error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
                        <div className="text-4xl">⚠️</div>
                        <p className="text-sm text-red-400 text-center">{error}</p>
                        <p className="text-xs text-gray-500 text-center">
                            Tip: Add the Live2D Cubism Core script to your page. See the README for instructions.
                        </p>
                    </div>
                )}
            </div>
        );
    }
);

AvatarCanvas.displayName = "AvatarCanvas";
export default AvatarCanvas;
