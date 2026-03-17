"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";

const AvatarCanvas = dynamic(() => import("@/components/AvatarCanvas"), { ssr: false });

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}

export default function TelegramPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [userName, setUserName] = useState("Friend");
    const [avatarLoaded, setAvatarLoaded] = useState(false);
    const avatarRef = useRef<any>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const isSpeakingRef = useRef(false);
    const recognitionRef = useRef<any>(null);

    // ═══ Telegram Web App SDK ═══
    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://telegram.org/js/telegram-web-app.js";
        script.onload = () => {
            const tg = (window as any).Telegram?.WebApp;
            if (tg) {
                tg.ready();
                tg.expand();
                const user = tg.initDataUnsafe?.user;
                if (user?.first_name) setUserName(user.first_name);
                document.documentElement.style.setProperty("--tg-bg", tg.themeParams?.bg_color || "#0a0f1c");
                document.documentElement.style.setProperty("--tg-text", tg.themeParams?.text_color || "#ffffff");
            }
        };
        document.head.appendChild(script);

        // Timeout: if avatar doesn't load in 8s, show fallback
        const timeout = setTimeout(() => setAvatarLoaded(true), 8000);
        return () => clearTimeout(timeout);
    }, []);

    // Scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Greet user
    useEffect(() => {
        const timer = setTimeout(() => {
            setMessages([{ id: "greeting", role: "assistant", content: `Hey ${userName}! 👋`, timestamp: Date.now() }]);
        }, 1500);
        return () => clearTimeout(timer);
    }, [userName]);

    // ═══ Voice Input (Web Speech API) ═══
    const toggleVoiceInput = useCallback(() => {
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
            return;
        }

        const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
        if (!SpeechRecognition) {
            alert("Voice not supported in this browser");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = navigator.language || "en-US";

        recognition.onresult = (e: any) => {
            const text = e.results[0]?.[0]?.transcript;
            if (text) {
                setInput(text);
                // Auto-send after 500ms
                setTimeout(() => sendMessage(text), 500);
            }
            setIsListening(false);
        };
        recognition.onerror = () => setIsListening(false);
        recognition.onend = () => setIsListening(false);

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
    }, [isListening]);

    const handleSpeak = useCallback(async (text: string) => {
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        await avatarRef.current?.speak(text);
        setIsSpeaking(false);
        isSpeakingRef.current = false;
    }, []);

    const handleInterrupt = useCallback(() => {
        avatarRef.current?.interrupt();
        setIsSpeaking(false);
        isSpeakingRef.current = false;
    }, []);

    const sendMessage = useCallback(async (text: string) => {
        if (!text.trim() || isProcessing) return;

        if (isSpeakingRef.current) handleInterrupt();

        setIsProcessing(true);
        setMessages(prev => [...prev, {
            id: `user-${Date.now()}`, role: "user", content: text, timestamp: Date.now(),
        }]);
        setInput("");

        const thinkingId = `thinking-${Date.now()}`;
        setMessages(prev => [...prev, { id: thinkingId, role: "assistant", content: "◆◆◆THINKING◆◆◆", timestamp: Date.now() }]);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    history: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
                    systemPrompt: `The user's name is ${userName}. Greet them by name occasionally.`,
                }),
            });

            if (!response.ok) throw new Error("API error");

            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let fullReply = "";
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const data = line.slice(6).trim();
                    if (data === "[DONE]") continue;
                    try {
                        const json = JSON.parse(data);
                        if (json.token) {
                            fullReply += json.token;
                            setMessages(prev => prev.map(m =>
                                m.id === thinkingId ? { ...m, content: fullReply } : m
                            ));
                        }
                    } catch { }
                }
            }

            if (fullReply.trim()) {
                setMessages(prev => prev.map(m =>
                    m.id === thinkingId ? { ...m, content: fullReply } : m
                ));
                await handleSpeak(fullReply.trim());
            }
        } catch (err: any) {
            setMessages(prev => prev.filter(m => m.id !== thinkingId));
            setMessages(prev => [...prev, {
                id: `err-${Date.now()}`, role: "assistant", content: `⚠️ ${err.message || "Error"}`, timestamp: Date.now(),
            }]);
        } finally {
            setIsProcessing(false);
        }
    }, [messages, userName, isProcessing, handleSpeak, handleInterrupt]);

    return (
        <div className="fixed inset-0 flex flex-col" style={{ background: "var(--tg-bg, #0a0f1c)", color: "var(--tg-text, #fff)" }}>
            {/* Avatar — top 35% */}
            <div className="relative flex-shrink-0" style={{ height: "35vh" }}>
                <div className={`absolute inset-0 flex items-center justify-center transition-all ${isSpeaking ? "ring-2 ring-[#00d4aa]/40" : ""}`}>
                    {!avatarLoaded ? (
                        <AvatarCanvas
                            ref={avatarRef}
                            modelUrl="https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@0.4.0/test/assets/haru/haru_greeter_t03.model3.json"
                            onReady={() => setAvatarLoaded(true)}
                            onEmotionChange={() => { }}
                        />
                    ) : null}
                    {/* Fallback: show after timeout if Live2D didn't load */}
                    {avatarLoaded && (
                        <div className="flex flex-col items-center gap-2">
                            <div className={`w-24 h-24 rounded-full bg-gradient-to-br from-[#00d4aa]/20 to-[#c9a84c]/20 flex items-center justify-center text-5xl border-2 ${isSpeaking ? "border-[#00d4aa] animate-pulse" : "border-white/10"} transition-all`}>
                                🎭
                            </div>
                        </div>
                    )}
                </div>
                {/* Name tag */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-center">
                    <div className="text-xs font-medium text-white/50">Prometheus</div>
                </div>
            </div>

            {/* Chat — bottom 65% */}
            <div className="flex-1 flex flex-col min-h-0">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {messages.map(msg => (
                        <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                            {msg.content === "◆◆◆THINKING◆◆◆" ? (
                                <div className="bg-white/5 px-4 py-3 rounded-2xl flex gap-1.5 items-center">
                                    <span className="w-2 h-2 rounded-full bg-[#00d4aa] animate-bounce" style={{ animationDelay: "0ms" }} />
                                    <span className="w-2 h-2 rounded-full bg-[#00d4aa] animate-bounce" style={{ animationDelay: "150ms" }} />
                                    <span className="w-2 h-2 rounded-full bg-[#00d4aa] animate-bounce" style={{ animationDelay: "300ms" }} />
                                </div>
                            ) : (
                                <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === "user"
                                    ? "bg-[#00d4aa]/15 text-[#c5f5e8] rounded-br-md"
                                    : "bg-white/5 text-[#c5cfe0] rounded-bl-md"
                                    }`}>{msg.content}</div>
                            )}
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input bar with voice button */}
                <div className="px-4 py-3 border-t border-white/5" style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}>
                    <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} className="flex items-center gap-2">
                        {/* Voice button */}
                        <button
                            type="button"
                            onClick={toggleVoiceInput}
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 transition-all ${isListening
                                ? "bg-red-500/20 text-red-400 animate-pulse ring-2 ring-red-500/30"
                                : "bg-white/5 text-white/50 active:bg-white/10"
                                }`}
                        >
                            🎤
                        </button>

                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder={isListening ? "Listening..." : isProcessing ? "Thinking..." : "Message..."}
                            disabled={isProcessing || isListening}
                            className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#00d4aa]/30 transition-colors disabled:opacity-40"
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isProcessing}
                            className="w-10 h-10 rounded-full bg-[#00d4aa] text-black flex items-center justify-center text-lg disabled:opacity-30 disabled:cursor-not-allowed active:scale-90 transition-transform flex-shrink-0"
                        >
                            ↑
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
