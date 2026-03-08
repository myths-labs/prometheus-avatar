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
    onInterrupt?: () => void;
    isAvatarReady: boolean;
}

const QUICK_PROMPTS = [
    { label: "👋 Say hello", text: "Hello! How are you doing today?" },
    { label: "😊 Something happy", text: "I just got promoted at work!" },
    { label: "🤔 Ask a question", text: "What's the meaning of life?" },
    { label: "😲 Be surprised", text: "I just won the lottery!!!" },
    { label: "😢 Something sad", text: "My best friend is moving away..." },
];

export default function ChatPanel({ onSendMessage, onInterrupt, isAvatarReady }: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [mode, setMode] = useState<"direct" | "llm">("llm");
    const [showSettings, setShowSettings] = useState(false);
    const [isPTT, setIsPTT] = useState(false); // Push-to-talk active (holding)
    const [pttText, setPttText] = useState(""); // Accumulated PTT text
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<any>(null);
    const isProcessingRef = useRef(false);

    useEffect(() => {
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

    // Core send — uses browser TTS in voice mode for speed, ElevenLabs for text mode
    const sendMessage = useCallback(async (text: string, skipTTS = false) => {
        if (!text.trim() || isProcessingRef.current) return;
        isProcessingRef.current = true;
        setIsProcessing(true);
        addMessage("user", text);
        setInput("");

        try {
            if (mode === "direct") {
                await onSendMessage(text);
            } else {
                const response = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: text,
                        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
                    }),
                });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || "API failed");
                }
                const data = await response.json();
                addMessage("assistant", data.reply);
                await onSendMessage(data.reply);
            }
        } catch (err: any) {
            console.error("Chat error:", err);
            addMessage("assistant", `⚠️ ${err.message || "Error"}`);
            await onSendMessage(text);
        } finally {
            isProcessingRef.current = false;
            setIsProcessing(false);
        }
    }, [mode, messages, onSendMessage, addMessage]);

    // Interrupt avatar
    const handleInterrupt = useCallback(() => {
        onInterrupt?.();
    }, [onInterrupt]);

    // ========== PUSH-TO-TALK ==========
    const startPTT = useCallback(() => {
        if (isProcessingRef.current) {
            // If AI is talking, interrupt first
            handleInterrupt();
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Your browser doesn't support voice. Try Chrome.");
            return;
        }

        setIsPTT(true);
        setPttText("");

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "";

        recognition.onresult = (event: any) => {
            let transcript = "";
            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            setPttText(transcript);
        };

        recognition.onerror = () => { };
        recognition.onend = () => { };

        recognitionRef.current = recognition;
        try { recognition.start(); } catch { }
    }, [handleInterrupt]);

    const stopPTT = useCallback(() => {
        setIsPTT(false);

        // Stop recognition
        try { recognitionRef.current?.stop(); } catch { }
        recognitionRef.current = null;

        // Get the text and send
        // Use setTimeout to get the latest pttText from state
        setTimeout(() => {
            const textEl = document.getElementById("ptt-text-holder");
            const text = textEl?.getAttribute("data-text") || "";
            if (text.trim()) {
                sendMessage(text.trim());
            }
            setPttText("");
        }, 300);
    }, [sendMessage]);

    // Text mode send
    const handleSend = useCallback(() => {
        const text = input.trim();
        if (!text) return;
        setInput("");
        sendMessage(text);
    }, [input, sendMessage]);

    const handleQuickPrompt = useCallback((text: string) => {
        sendMessage(text);
    }, [sendMessage]);

    return (
        <div className="glass-strong flex flex-col h-[500px]">
            {/* Hidden element to pass PTT text */}
            <div id="ptt-text-holder" data-text={pttText} style={{ display: "none" }} />

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(0,212,170,0.06)]">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-[#eae6df]">Chat</h3>
                    <div className="flex items-center bg-black/30 rounded-lg p-0.5 text-xs">
                        <button
                            className={`px-3 py-1 rounded-md transition-all ${mode === "direct" ? "bg-[#00d4aa]/15 text-[#00f0c8]" : "text-[#5a6a80] hover:text-[#8a9ab5]"}`}
                            onClick={() => setMode("direct")}
                        >Direct</button>
                        <button
                            className={`px-3 py-1 rounded-md transition-all ${mode === "llm" ? "bg-[#00d4aa]/15 text-[#00f0c8]" : "text-[#5a6a80] hover:text-[#8a9ab5]"}`}
                            onClick={() => setMode("llm")}
                        >LLM Chat</button>
                    </div>
                </div>
                <button className="text-[#5a6a80] hover:text-[#8a9ab5] text-xs" onClick={() => setShowSettings(!showSettings)}>
                    ⚙️ Settings
                </button>
            </div>

            {showSettings && (
                <div className="px-5 py-3 border-b border-[rgba(0,212,170,0.06)] bg-black/20">
                    <p className="text-xs text-[#8a9ab5]"><strong>LLM Chat:</strong> AI responds intelligently</p>
                    <p className="text-xs text-[#5a6a80] mt-1"><strong>Direct:</strong> Avatar speaks your text</p>
                    <p className="text-xs text-[#5a6a80] mt-1"><strong>🎤 Hold mic:</strong> Push-to-talk — hold to speak, release to send</p>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4">
                        <p className="text-[#5a6a80] text-sm text-center">
                            Chat with AI — type or hold 🎤 to speak
                        </p>
                        <div className="flex flex-wrap justify-center gap-2">
                            {QUICK_PROMPTS.map((prompt) => (
                                <button key={prompt.label} onClick={() => handleQuickPrompt(prompt.text)}
                                    disabled={!isAvatarReady || isProcessing}
                                    className="text-xs px-3 py-1.5 rounded-full bg-[#00d4aa]/8 border border-[#00d4aa]/15 text-[#00f0c8] hover:bg-[#00d4aa]/15 transition-all disabled:opacity-40"
                                >{prompt.label}</button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <div key={msg.id} className={`message-enter flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === "user" ? "bg-[#00d4aa]/15 text-[#c5f5e8] rounded-br-md" : "bg-white/5 text-[#c5cfe0] rounded-bl-md"
                                }`}>{msg.content}</div>
                        </div>
                    ))
                )}

                {isProcessing && (
                    <div className="flex justify-start message-enter">
                        <div className="bg-white/5 px-4 py-3 rounded-2xl rounded-bl-md flex gap-1.5">
                            <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* PTT overlay */}
            {isPTT && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-2xl">
                    <div className="text-6xl mb-4 animate-pulse">🎤</div>
                    <p className="text-white text-lg font-medium mb-2">Listening...</p>
                    <p className="text-[#00d4aa] text-sm max-w-[80%] text-center min-h-[40px]">
                        {pttText || "Start speaking..."}
                    </p>
                    <p className="text-[#5a6a80] text-xs mt-4">Release to send</p>
                </div>
            )}

            {/* Input */}
            <div className="px-5 py-3 border-t border-[rgba(0,212,170,0.06)]">
                <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2">
                    {/* Push-to-talk button */}
                    <button
                        type="button"
                        onMouseDown={startPTT}
                        onMouseUp={stopPTT}
                        onMouseLeave={() => { if (isPTT) stopPTT(); }}
                        onTouchStart={(e) => { e.preventDefault(); startPTT(); }}
                        onTouchEnd={(e) => { e.preventDefault(); stopPTT(); }}
                        className={`p-2.5 rounded-xl transition-all flex-shrink-0 select-none ${isPTT
                                ? "bg-red-500/30 text-red-400 scale-110 shadow-lg shadow-red-500/30"
                                : isProcessing
                                    ? "bg-orange-500/20 text-orange-400 cursor-pointer"
                                    : "bg-black/30 text-[#5a6a80] hover:text-[#00d4aa] hover:bg-black/40 active:scale-95"
                            }`}
                        title={isProcessing ? "Tap to interrupt" : "Hold to speak"}
                    >
                        {isPTT ? "🔴" : isProcessing ? "⏹️" : "🎤"}
                    </button>

                    <input ref={inputRef} type="text" value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={isProcessing ? "AI is responding..." : isAvatarReady ? "Type or hold 🎤 to speak..." : "Loading..."}
                        disabled={!isAvatarReady || isProcessing}
                        className="flex-1 bg-black/30 border border-[rgba(0,212,170,0.08)] rounded-xl px-4 py-2.5 text-sm text-white placeholder-[#5a6a80] focus:outline-none focus:border-[#00d4aa]/30 transition-colors disabled:opacity-40"
                    />

                    <button type="submit" disabled={!input.trim() || !isAvatarReady || isProcessing}
                        className="btn-primary !py-2.5 !px-5 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    >Send</button>
                </form>
            </div>
        </div>
    );
}
