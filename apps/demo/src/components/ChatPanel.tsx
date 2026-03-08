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
    onVoiceChange?: (voice: string) => void;
    /** System prompt from marketplace persona — changes the AI's behavior */
    systemPrompt?: string;
}

const QUICK_PROMPTS = [
    { label: "👋 Say hello", text: "Hello! How are you doing today?" },
    { label: "😊 Something happy", text: "I just got promoted at work!" },
    { label: "🤔 Ask a question", text: "What's the meaning of life?" },
    { label: "😲 Be surprised", text: "I just won the lottery!!!" },
    { label: "😢 Something sad", text: "My best friend is moving away..." },
];

export default function ChatPanel({ onSendMessage, onInterrupt, isAvatarReady, onVoiceChange, systemPrompt }: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [mode, setMode] = useState<"direct" | "llm">("llm");
    const [selectedVoice, setSelectedVoice] = useState("Kore");
    const [showSettings, setShowSettings] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [recordText, setRecordText] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<any>(null);
    const isProcessingRef = useRef(false);
    const isSpeakingRef = useRef(false);

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

    const sendMessage = useCallback(async (text: string) => {
        if (!text.trim() || isProcessingRef.current) return;

        // ═══ AUTO-INTERRUPT: Stop current speech immediately when user sends new message ═══
        if (isSpeakingRef.current) {
            onInterrupt?.();
            isSpeakingRef.current = false;
        }

        isProcessingRef.current = true;
        setIsProcessing(true);
        addMessage("user", text);
        setInput("");

        try {
            if (mode === "direct") {
                isSpeakingRef.current = true;
                await onSendMessage(text);
            } else {
                // ═══ THINKING PHASE: Show typing indicator ═══
                const thinkingId = `thinking-${Date.now()}`;
                setMessages(prev => [...prev, { id: thinkingId, role: "assistant", content: "◆◆◆THINKING◆◆◆", timestamp: Date.now() }]);

                const response = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: text,
                        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
                        ...(systemPrompt ? { systemPrompt } : {}),
                    }),
                });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || "API error");
                }
                const data = await response.json();

                // ═══ SPEAKING PHASE: Replace thinking indicator with real reply ═══
                setMessages(prev => prev.map(m => m.id === thinkingId ? { ...m, content: data.reply } : m));
                isSpeakingRef.current = true;
                await onSendMessage(data.reply);
            }
        } catch (err: any) {
            console.error("Chat error:", err);
            // Remove thinking indicator and show error
            setMessages(prev => prev.filter(m => !m.content.includes("◆◆◆THINKING◆◆◆")));
            addMessage("assistant", `⚠️ ${err.message || "Error"}`);
            await onSendMessage(text);
        } finally {
            isProcessingRef.current = false;
            isSpeakingRef.current = false;
            setIsProcessing(false);
        }
    }, [mode, messages, onSendMessage, onInterrupt, addMessage]);


    // Start speech recognition helper
    const startRecording = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Your browser doesn't support voice input. Use Chrome.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "";

        recognition.onresult = (event: any) => {
            let transcript = "";
            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            setRecordText(transcript);
        };

        recognition.onerror = (event: any) => {
            console.warn("Speech error:", event.error);
            if (event.error !== "aborted") {
                setIsRecording(false);
            }
        };

        recognition.onend = () => {
            // Don't auto-restart — user controls via button
        };

        recognitionRef.current = recognition;
        setIsRecording(true);
        setRecordText("");
        try { recognition.start(); } catch { }
    }, []);

    // Toggle recording on/off
    const toggleRecording = useCallback(() => {
        if (isRecording) {
            // STOP recording → send
            try { recognitionRef.current?.stop(); } catch { }
            recognitionRef.current = null;
            setIsRecording(false);

            const text = recordText.trim();
            setRecordText("");
            if (text) {
                sendMessage(text);
            }
            return;
        }

        // If AI is currently speaking or processing, interrupt FIRST
        if (isProcessingRef.current || isSpeakingRef.current) {
            onInterrupt?.();
            isSpeakingRef.current = false;

            // Wait for audio to fully stop before starting mic
            // This prevents recording the avatar's voice
            setTimeout(() => {
                startRecording();
            }, 600);
            return;
        }

        // Normal start recording
        startRecording();
    }, [isRecording, recordText, sendMessage, onInterrupt, startRecording]);

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
        <div className="glass-strong flex flex-col h-[500px] relative">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(0,212,170,0.06)]">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-[#eae6df]">Chat</h3>
                    <div className="flex items-center bg-black/30 rounded-lg p-0.5 text-xs">
                        <button
                            className={`px-3 py-1 rounded-md transition-all ${mode === "direct" ? "bg-[#00d4aa]/15 text-[#00f0c8]" : "text-[#7a8a9d] hover:text-[#a8b8d0]"}`}
                            onClick={() => setMode("direct")}
                        >Direct</button>
                        <button
                            className={`px-3 py-1 rounded-md transition-all ${mode === "llm" ? "bg-[#00d4aa]/15 text-[#00f0c8]" : "text-[#7a8a9d] hover:text-[#a8b8d0]"}`}
                            onClick={() => setMode("llm")}
                        >LLM Chat</button>
                    </div>
                </div>
                {/* Speaking indicator */}
                {isProcessing && (
                    <div className="flex items-center gap-1.5 text-[10px] text-[#00d4aa]">
                        <div className="flex gap-[2px] items-end h-3">
                            <span className="w-[3px] bg-[#00d4aa] rounded-full animate-pulse" style={{ height: '40%', animationDelay: '0ms' }} />
                            <span className="w-[3px] bg-[#00d4aa] rounded-full animate-pulse" style={{ height: '80%', animationDelay: '150ms' }} />
                            <span className="w-[3px] bg-[#00d4aa] rounded-full animate-pulse" style={{ height: '55%', animationDelay: '300ms' }} />
                            <span className="w-[3px] bg-[#00d4aa] rounded-full animate-pulse" style={{ height: '90%', animationDelay: '450ms' }} />
                        </div>
                        Speaking...
                    </div>
                )}
            </div>

            {/* Always-visible voice selector */}
            <div className="px-4 py-2 border-b border-[rgba(0,212,170,0.04)] flex items-center gap-2">
                <span className="text-[10px] text-[#7a8a9d] whitespace-nowrap">🎤</span>
                <select
                    value={selectedVoice}
                    onChange={(e) => { setSelectedVoice(e.target.value); onVoiceChange?.(e.target.value); }}
                    className="flex-1 bg-black/20 border border-white/[0.06] rounded-lg px-2.5 py-1 text-[11px] text-[#a8b8d0] focus:border-[#00d4aa]/30 focus:outline-none transition-colors appearance-none cursor-pointer hover:border-white/10"
                >
                    <optgroup label="🇨🇳 Chinese Optimized">
                        <option value="Kore">Kore — Energetic ♀</option>
                        <option value="Aoede">Aoede — Clear ♀</option>
                        <option value="Leda">Leda — Sweet ♀</option>
                        <option value="Zephyr">Zephyr — Bright ♀</option>
                        <option value="Achird">Achird — Breathy ♀</option>
                    </optgroup>
                    <optgroup label="♀ Female">
                        <option value="Despina">Despina — Warm</option>
                        <option value="Callirrhoe">Callirrhoe — Confident</option>
                        <option value="Algenib">Algenib — Authoritative</option>
                        <option value="Laomedeia">Laomedeia — Engaging</option>
                    </optgroup>
                    <optgroup label="♂ Male">
                        <option value="Puck">Puck — Upbeat</option>
                        <option value="Charon">Charon — Smooth</option>
                        <option value="Fenrir">Fenrir — Energetic</option>
                    </optgroup>
                </select>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4">
                        <p className="text-[#7a8a9d] text-sm text-center">
                            Chat with AI — type or tap 🎤
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
                            {msg.content === "◆◆◆THINKING◆◆◆" ? (
                                <div className="bg-white/5 px-4 py-3 rounded-2xl rounded-bl-md flex gap-1.5 items-center">
                                    <span className="w-2 h-2 rounded-full bg-[#00d4aa] animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-2 h-2 rounded-full bg-[#00d4aa] animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-2 h-2 rounded-full bg-[#00d4aa] animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                            ) : (
                                <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === "user" ? "bg-[#00d4aa]/15 text-[#c5f5e8] rounded-br-md" : "bg-white/5 text-[#c5cfe0] rounded-bl-md"
                                    }`}>{msg.content}</div>
                            )}
                        </div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Recording overlay */}
            {isRecording && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-2xl"
                    style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
                    onClick={toggleRecording}
                >
                    <div className="text-6xl mb-6" style={{ animation: "pulse 1.5s ease-in-out infinite" }}>🎤</div>
                    <p className="text-white text-lg font-medium mb-3">Listening...</p>
                    <p className="text-[#00f0c8] text-base max-w-[80%] text-center min-h-[50px] px-4">
                        {recordText || "Start speaking..."}
                    </p>
                    <button
                        className="mt-6 px-6 py-2 bg-red-500/20 border border-red-500/30 rounded-full text-red-400 text-sm hover:bg-red-500/30 transition-all"
                        onClick={(e) => { e.stopPropagation(); toggleRecording(); }}
                    >
                        ⏹ Stop & Send
                    </button>
                </div>
            )}

            {/* Input */}
            <div className="px-5 py-3 border-t border-[rgba(0,212,170,0.06)]">
                <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={toggleRecording}
                        className={`p-2.5 rounded-xl transition-all flex-shrink-0 ${isProcessing
                            ? "bg-orange-500/20 text-orange-400"
                            : "bg-black/30 text-[#7a8a9d] hover:text-[#00d4aa] hover:bg-black/40 active:scale-90"
                            }`}
                        title={isProcessing ? "Tap to interrupt" : "Tap to record voice"}
                    >
                        {isProcessing ? "⏹️" : "🎤"}
                    </button>

                    <input ref={inputRef} type="text" value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={isProcessing ? "AI responding..." : isAvatarReady ? "Type a message..." : "Loading..."}
                        disabled={!isAvatarReady || isProcessing}
                        className="flex-1 bg-black/30 border border-[rgba(0,212,170,0.08)] rounded-xl px-4 py-2.5 text-sm text-white placeholder-[#7a8a9d] focus:outline-none focus:border-[#00d4aa]/30 transition-colors disabled:opacity-40"
                    />

                    <button type="submit" disabled={!input.trim() || !isAvatarReady || isProcessing}
                        className="btn-primary !py-2.5 !px-5 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    >Send</button>
                </form>
            </div>
        </div>
    );
}
