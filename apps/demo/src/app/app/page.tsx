"use client";

import { useState, useRef, useCallback } from "react";
import AvatarCanvas, { AvatarCanvasHandle } from "@/components/AvatarCanvas";
import ChatPanel from "@/components/ChatPanel";
import { useLiveVoice } from "@/lib/useLiveVoice";
import Link from "next/link";

const AVATARS = [
    { id: "haru", name: "Haru", modelUrl: "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@0.4.0/test/assets/haru/haru_greeter_t03.model3.json", emoji: "🧑‍🎤" },
    { id: "shizuku", name: "Shizuku", modelUrl: "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@0.4.0/test/assets/shizuku/shizuku.model.json", emoji: "👩" },
    { id: "koharu", name: "Koharu", modelUrl: "https://cdn.jsdelivr.net/npm/live2d-widget-model-koharu/assets/koharu.model.json", emoji: "🌸" },
];

export default function CompanionPage() {
    const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
    const [isAvatarReady, setIsAvatarReady] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [chatOpen, setChatOpen] = useState(true);
    const [currentEmotion, setCurrentEmotion] = useState("neutral");
    const [voiceOverride, setVoiceOverride] = useState<string | null>(null);
    const avatarRef = useRef<AvatarCanvasHandle>(null);
    const speechQueueRef = useRef<string[]>([]);
    const isProcessingQueueRef = useRef(false);

    // Live voice
    const handleLiveTranscript = useCallback(() => { }, []);
    const liveVoice = useLiveVoice(
        useCallback((pcmData: Float32Array) => {
            let sum = 0;
            for (let i = 0; i < pcmData.length; i += 4) sum += pcmData[i] * pcmData[i];
            const rms = Math.sqrt(sum / (pcmData.length / 4));
            const mouthOpen = Math.min(1, rms * 8);
            if (avatarRef.current && (avatarRef.current as any).setMouthOpen)
                (avatarRef.current as any).setMouthOpen(mouthOpen);
        }, []),
        handleLiveTranscript,
    );

    // Speech queue
    const processQueue = useCallback(async () => {
        if (isProcessingQueueRef.current) return;
        isProcessingQueueRef.current = true;
        setIsSpeaking(true);
        while (speechQueueRef.current.length > 0) {
            const sentence = speechQueueRef.current.shift()!;
            await avatarRef.current?.speak(sentence);
        }
        isProcessingQueueRef.current = false;
        setIsSpeaking(false);
    }, []);

    const handleSendMessage = useCallback(async (text: string) => {
        speechQueueRef.current.push(text);
        processQueue();
    }, [processQueue]);

    const handleInterrupt = useCallback(() => {
        speechQueueRef.current = [];
        isProcessingQueueRef.current = false;
        setIsSpeaking(false);
        avatarRef.current?.interrupt();
    }, []);

    const handleEmotionChange = useCallback((emotion: string) => {
        setCurrentEmotion(emotion);
    }, []);

    const emotionEmoji: Record<string, string> = {
        neutral: "😐", happy: "😊", sad: "😢", angry: "😠",
        surprised: "😲", thinking: "🤔", excited: "🤩",
    };

    return (
        <div className="fixed inset-0 bg-[#0a0f1a] overflow-hidden">
            {/* Full-screen avatar */}
            <div className="absolute inset-0 z-0">
                <AvatarCanvas
                    ref={avatarRef}
                    modelUrl={selectedAvatar.modelUrl}
                    onReady={() => setIsAvatarReady(true)}
                    onEmotionChange={handleEmotionChange}
                    voiceOverride={voiceOverride}
                />
            </div>

            {/* Top bar — glassmorphism */}
            <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-black/30 backdrop-blur-md border-b border-white/10">
                <div className="flex items-center gap-3">
                    <Link href="/" className="text-[#eae6df] hover:text-[#00d4aa] transition-colors text-sm">
                        ← Home
                    </Link>
                    <div className="w-px h-5 bg-white/10" />
                    <span className="text-[#eae6df] font-semibold text-sm">
                        {selectedAvatar.emoji} {selectedAvatar.name}
                    </span>
                    <span className="text-lg">{emotionEmoji[currentEmotion] || "😐"}</span>
                    {isSpeaking && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#00d4aa]/15 text-[#00d4aa] text-[10px] font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#00d4aa] animate-pulse" />
                            Speaking
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Avatar selector */}
                    {AVATARS.map(a => (
                        <button
                            key={a.id}
                            onClick={() => { setSelectedAvatar(a); setIsAvatarReady(false); }}
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${selectedAvatar.id === a.id
                                ? "bg-[#00d4aa]/20 border border-[#00d4aa]/40 scale-110"
                                : "bg-white/5 border border-white/10 hover:bg-white/10"
                                }`}
                            title={a.name}
                        >
                            {a.emoji}
                        </button>
                    ))}
                    <div className="w-px h-5 bg-white/10 mx-1" />
                    {/* Toggle chat */}
                    <button
                        onClick={() => setChatOpen(!chatOpen)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${chatOpen
                            ? "bg-[#00d4aa]/15 text-[#00d4aa] border border-[#00d4aa]/20"
                            : "bg-white/5 text-[#7a8a9d] border border-white/10 hover:text-[#eae6df]"
                            }`}
                    >
                        💬 Chat
                    </button>
                    {/* Marketplace */}
                    <Link
                        href="/marketplace"
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-[#7a8a9d] hover:text-[#eae6df] transition-all"
                    >
                        🛒 Market
                    </Link>
                </div>
            </div>

            {/* Chat overlay panel — right side */}
            {chatOpen && (
                <div className="absolute top-14 right-4 bottom-4 w-[380px] z-10 flex flex-col rounded-2xl overflow-hidden bg-black/40 backdrop-blur-xl border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.4)]">
                    <ChatPanel
                        onSendMessage={handleSendMessage}
                        onInterrupt={handleInterrupt}
                        isAvatarReady={isAvatarReady}
                        onVoiceChange={setVoiceOverride}
                        liveVoice={liveVoice}
                    />
                </div>
            )}

            {/* Emotion indicators — bottom left */}
            <div className="absolute bottom-4 left-4 z-10 flex gap-1.5">
                {Object.entries(emotionEmoji).map(([emotion, emoji]) => (
                    <button
                        key={emotion}
                        onClick={() => handleSendMessage(`I'm feeling ${emotion}!`)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition-all ${currentEmotion === emotion
                            ? "bg-[#00d4aa]/20 border-2 border-[#00d4aa]/40 scale-110"
                            : "bg-black/30 backdrop-blur-sm border border-white/10 hover:bg-white/10"
                            }`}
                        title={emotion}
                    >
                        {emoji}
                    </button>
                ))}
            </div>

            {/* Loading overlay */}
            {!isAvatarReady && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0a0f1a]/90 backdrop-blur-sm">
                    <div className="text-6xl mb-4 animate-bounce">{selectedAvatar.emoji}</div>
                    <div className="w-12 h-12 border-2 border-[#00d4aa] border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-[#a8b8d0] text-sm font-light">Loading {selectedAvatar.name}...</p>
                </div>
            )}
        </div>
    );
}
