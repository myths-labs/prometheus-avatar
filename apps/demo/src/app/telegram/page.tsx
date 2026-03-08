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
    const [userName, setUserName] = useState("Friend");
    const avatarRef = useRef<any>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const isSpeakingRef = useRef(false);

    // ═══ Telegram Web App SDK ═══
    useEffect(() => {
        // Load Telegram Web App SDK
        const script = document.createElement("script");
        script.src = "https://telegram.org/js/telegram-web-app.js";
        script.onload = () => {
            const tg = (window as any).Telegram?.WebApp;
            if (tg) {
                tg.ready();
                tg.expand(); // Full screen
                // Get user name
                const user = tg.initDataUnsafe?.user;
                if (user?.first_name) {
                    setUserName(user.first_name);
                }
                // Apply Telegram theme
                document.documentElement.style.setProperty("--tg-bg", tg.themeParams?.bg_color || "#0a0f1c");
                document.documentElement.style.setProperty("--tg-text", tg.themeParams?.text_color || "#ffffff");
            }
        };
        document.head.appendChild(script);
    }, []);

    // Scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Greet user on load
    useEffect(() => {
        const timer = setTimeout(() => {
            const greeting = `Hey ${userName}! 👋`;
            setMessages([{ id: "greeting", role: "assistant", content: greeting, timestamp: Date.now() }]);
        }, 1500);
        return () => clearTimeout(timer);
    }, [userName]);

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

        if (isSpeakingRef.current) {
            handleInterrupt();
        }

        setIsProcessing(true);
        setMessages(prev => [...prev, {
            id: `user-${Date.now()}`,
            role: "user",
            content: text,
            timestamp: Date.now(),
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

            // Consume SSE stream for typing effect
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

            // Speak complete reply
            if (fullReply.trim()) {
                setMessages(prev => prev.map(m =>
                    m.id === thinkingId ? { ...m, content: fullReply } : m
                ));
                await handleSpeak(fullReply.trim());
            }
        } catch (err: any) {
            setMessages(prev => prev.filter(m => m.id !== thinkingId));
            setMessages(prev => [...prev, {
                id: `err-${Date.now()}`,
                role: "assistant",
                content: `⚠️ ${err.message || "Error"}`,
                timestamp: Date.now(),
            }]);
        } finally {
            setIsProcessing(false);
        }
    }, [messages, userName, isProcessing, handleSpeak, handleInterrupt]);

    return (
        <div className="fixed inset-0 flex flex-col" style={{ background: "var(--tg-bg, #0a0f1c)", color: "var(--tg-text, #fff)" }}>
            {/* Avatar — top 40% */}
            <div className="relative flex-shrink-0" style={{ height: "40vh" }}>
                <div className={`absolute inset-0 flex items-center justify-center transition-all ${isSpeaking ? "ring-2 ring-[#00d4aa]/40" : ""}`}>
                    <AvatarCanvas
                        ref={avatarRef}
                        avatarId="haru"
                        onEmotionChange={() => { }}
                    />
                </div>
                {/* Name tag */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-center">
                    <div className="text-sm font-medium text-white/70">Prometheus</div>
                </div>
            </div>

            {/* Chat — bottom 60% */}
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

                {/* Input */}
                <div className="px-4 py-3 border-t border-white/5" style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}>
                    <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} className="flex items-center gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder={isProcessing ? "Thinking..." : "Message..."}
                            disabled={isProcessing}
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
