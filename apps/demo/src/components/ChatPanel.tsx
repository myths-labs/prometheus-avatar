"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}

interface ChatPanelProps {
    onSendMessage: (text: string) => Promise<void>;
    isAvatarReady: boolean;
}

const QUICK_PROMPTS = [
    { label: "👋 Say hello", text: "Hello! How are you doing today?" },
    { label: "😊 Something happy", text: "That's wonderful news! I'm so happy for you! 🎉" },
    { label: "🤔 Ask a question", text: "Hmm, that's interesting... could you tell me more?" },
    { label: "😲 Be surprised", text: "Wait, WHAT?! That's absolutely incredible!!" },
    { label: "😢 Something sad", text: "I'm sorry to hear that... it must be really hard." },
];

export default function ChatPanel({ onSendMessage, isAvatarReady }: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [mode, setMode] = useState<"direct" | "llm">("direct");
    const [apiKey, setApiKey] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Scroll only within the messages container, not the whole page
        const el = messagesEndRef.current;
        if (el?.parentElement) {
            el.parentElement.scrollTop = el.parentElement.scrollHeight;
        }
    }, [messages]);

    const addMessage = useCallback((role: "user" | "assistant", content: string) => {
        setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-${Math.random()}`, role, content, timestamp: Date.now() },
        ]);
    }, []);

    const handleSend = useCallback(async () => {
        const text = input.trim();
        if (!text || isProcessing) return;
        setInput("");
        addMessage("user", text);
        setIsProcessing(true);
        try {
            if (mode === "direct") {
                await onSendMessage(text);
            } else {
                const response = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: text,
                        apiKey,
                        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
                    }),
                });
                if (!response.ok) throw new Error("API request failed");
                const data = await response.json();
                addMessage("assistant", data.reply);
                await onSendMessage(data.reply);
            }
        } catch (err) {
            console.error("Chat error:", err);
            addMessage("assistant", "Something went wrong. Please try again.");
        } finally {
            setIsProcessing(false);
        }
    }, [input, isProcessing, mode, apiKey, messages, onSendMessage, addMessage]);

    const handleQuickPrompt = useCallback(
        async (text: string) => {
            if (isProcessing) return;
            addMessage("user", text);
            setIsProcessing(true);
            try {
                await onSendMessage(text);
            } finally {
                setIsProcessing(false);
            }
        },
        [isProcessing, onSendMessage, addMessage]
    );

    return (
        <div className="glass-strong flex flex-col h-[500px]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(0,212,170,0.06)]">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-[#eae6df]">Chat</h3>
                    <div className="flex items-center bg-black/30 rounded-lg p-0.5 text-xs">
                        <button
                            className={`px-3 py-1 rounded-md transition-all ${mode === "direct" ? "bg-[#00d4aa]/15 text-[#00f0c8]" : "text-[#5a6a80] hover:text-[#8a9ab5]"}`}
                            onClick={() => setMode("direct")}
                        >
                            Direct
                        </button>
                        <button
                            className={`px-3 py-1 rounded-md transition-all ${mode === "llm" ? "bg-[#00d4aa]/15 text-[#00f0c8]" : "text-[#5a6a80] hover:text-[#8a9ab5]"}`}
                            onClick={() => setMode("llm")}
                        >
                            LLM Chat
                        </button>
                    </div>
                </div>
                <button className="text-[#5a6a80] hover:text-[#8a9ab5] text-xs" onClick={() => setShowSettings(!showSettings)}>
                    ⚙️ Settings
                </button>
            </div>

            {/* Settings */}
            {showSettings && (
                <div className="px-5 py-3 border-b border-[rgba(0,212,170,0.06)] bg-black/20">
                    <label className="text-xs text-[#8a9ab5] block mb-1">API Key (Claude or OpenAI)</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full bg-black/40 border border-[rgba(0,212,170,0.1)] rounded-lg px-3 py-2 text-sm text-white placeholder-[#5a6a80] focus:outline-none focus:border-[#00d4aa]/30"
                    />
                    <p className="text-[10px] text-[#5a6a80] mt-1">Key stays in your browser. Never sent to our servers.</p>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4">
                        <p className="text-[#5a6a80] text-sm text-center">Type a message or try a quick prompt ↓</p>
                        <div className="flex flex-wrap justify-center gap-2">
                            {QUICK_PROMPTS.map((prompt) => (
                                <button
                                    key={prompt.label}
                                    onClick={() => handleQuickPrompt(prompt.text)}
                                    disabled={!isAvatarReady || isProcessing}
                                    className="text-xs px-3 py-1.5 rounded-full bg-[#00d4aa]/8 border border-[#00d4aa]/15 text-[#00f0c8] hover:bg-[#00d4aa]/15 transition-all disabled:opacity-40"
                                >
                                    {prompt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <div key={msg.id} className={`message-enter flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div
                                className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === "user"
                                    ? "bg-[#00d4aa]/15 text-[#c5f5e8] rounded-br-md"
                                    : "bg-white/5 text-[#c5cfe0] rounded-bl-md"
                                    }`}
                            >
                                {msg.content}
                            </div>
                        </div>
                    ))
                )}

                {isProcessing && (
                    <div className="flex justify-start message-enter">
                        <div className="bg-white/5 px-4 py-3 rounded-2xl rounded-bl-md flex gap-1.5">
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-5 py-3 border-t border-[rgba(0,212,170,0.06)]">
                <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-3">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={isAvatarReady ? "Type a message..." : "Loading avatar..."}
                        disabled={!isAvatarReady || isProcessing}
                        className="flex-1 bg-black/30 border border-[rgba(0,212,170,0.08)] rounded-xl px-4 py-2.5 text-sm text-white placeholder-[#5a6a80] focus:outline-none focus:border-[#00d4aa]/30 transition-colors disabled:opacity-40"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || !isAvatarReady || isProcessing}
                        className="btn-primary !py-2.5 !px-5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Send
                    </button>
                </form>
            </div>
        </div>
    );
}
