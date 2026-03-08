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
    const [voiceMode, setVoiceMode] = useState(false);
    const [voiceStatus, setVoiceStatus] = useState<"idle" | "listening" | "processing">("idle");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<any>(null);
    const voiceModeRef = useRef(false);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const accumulatedTextRef = useRef("");
    const isProcessingRef = useRef(false);
    const isBusyRef = useRef(false); // Prevents restart during speaking/processing

    useEffect(() => {
        const el = messagesEndRef.current;
        if (el?.parentElement) {
            el.parentElement.scrollTop = el.parentElement.scrollHeight;
        }
    }, [messages]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            voiceModeRef.current = false;
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
            try { recognitionRef.current?.stop(); } catch { }
        };
    }, []);

    const addMessage = useCallback((role: "user" | "assistant", content: string) => {
        setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-${Math.random()}`, role, content, timestamp: Date.now() },
        ]);
    }, []);

    const interrupt = useCallback(() => {
        isBusyRef.current = false;
        onInterrupt?.();
    }, [onInterrupt]);

    // Stop recognition cleanly
    const stopRecognition = useCallback(() => {
        if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
        try { recognitionRef.current?.abort?.(); } catch { }
        try { recognitionRef.current?.stop(); } catch { }
        recognitionRef.current = null;
        setVoiceStatus("idle");
    }, []);

    // Start recognition
    const startRecognition = useCallback(() => {
        // Guard: don't start if busy or already running
        if (isBusyRef.current || !voiceModeRef.current) return;
        if (recognitionRef.current) return; // Already running

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        const recognition = new SpeechRecognition();
        recognition.continuous = false; // Single utterance — prevents feedback loops
        recognition.interimResults = true;
        recognition.lang = "";

        let hasResult = false;

        recognition.onstart = () => {
            if (voiceModeRef.current) setVoiceStatus("listening");
        };

        recognition.onresult = (event: any) => {
            hasResult = true;
            let transcript = "";
            let isFinal = false;

            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
                if (event.results[i].isFinal) isFinal = true;
            }

            setInput(transcript);
            accumulatedTextRef.current = transcript;

            if (isFinal) {
                // Got final result — wait for silence then send
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = setTimeout(() => {
                    const text = accumulatedTextRef.current.trim();
                    if (text && !isProcessingRef.current) {
                        stopRecognition();
                        sendMessage(text);
                    }
                }, 1500);
            }
        };

        recognition.onerror = (event: any) => {
            if (event.error === "aborted" || event.error === "no-speech") {
                // Normal — will restart via onend
            } else {
                console.warn("Speech error:", event.error);
            }
        };

        recognition.onend = () => {
            recognitionRef.current = null;

            // If we got a result and timer is running, don't restart yet
            if (silenceTimerRef.current) return;

            // Auto-restart if voice mode is on and not busy
            if (voiceModeRef.current && !isBusyRef.current && !isProcessingRef.current) {
                setVoiceStatus("idle");
                if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
                restartTimerRef.current = setTimeout(() => {
                    if (voiceModeRef.current && !isBusyRef.current) {
                        startRecognition();
                    }
                }, 800); // Delay prevents rapid cycling
            } else {
                setVoiceStatus(isBusyRef.current ? "processing" : "idle");
            }
        };

        recognitionRef.current = recognition;
        try {
            recognition.start();
        } catch (e) {
            recognitionRef.current = null;
            // Retry after delay
            if (voiceModeRef.current && !isBusyRef.current) {
                restartTimerRef.current = setTimeout(() => startRecognition(), 1000);
            }
        }
    }, [stopRecognition]);

    // Core send logic
    const sendMessage = useCallback(async (text: string) => {
        if (!text.trim() || isProcessingRef.current) return;

        // If avatar is speaking, interrupt
        if (isBusyRef.current) {
            interrupt();
            await new Promise(r => setTimeout(r, 200));
        }

        isProcessingRef.current = true;
        isBusyRef.current = true;
        setIsProcessing(true);
        setVoiceStatus("processing");
        addMessage("user", text);
        setInput("");
        accumulatedTextRef.current = "";

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
            isBusyRef.current = false;
            setIsProcessing(false);

            // Resume listening after AI finishes speaking
            if (voiceModeRef.current) {
                // Wait a bit for TTS audio to fully stop before resuming mic
                setTimeout(() => {
                    if (voiceModeRef.current) {
                        setVoiceStatus("idle");
                        startRecognition();
                    }
                }, 1500); // 1.5s delay to avoid picking up tail-end of TTS
            }
        }
    }, [mode, messages, onSendMessage, addMessage, interrupt, startRecognition]);

    // Toggle voice mode
    const toggleVoiceMode = useCallback(() => {
        if (voiceMode) {
            // Turn OFF
            voiceModeRef.current = false;
            setVoiceMode(false);
            stopRecognition();
        } else {
            // Turn ON
            voiceModeRef.current = true;
            isBusyRef.current = false;
            setVoiceMode(true);
            accumulatedTextRef.current = "";
            setInput("");
            startRecognition();
        }
    }, [voiceMode, startRecognition, stopRecognition]);

    const handleSend = useCallback(() => {
        const text = input.trim();
        if (!text) return;
        setInput("");
        sendMessage(text);
    }, [input, sendMessage]);

    const handleQuickPrompt = useCallback((text: string) => {
        sendMessage(text);
    }, [sendMessage]);

    const isListening = voiceStatus === "listening";

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
                    <p className="text-xs text-[#8a9ab5]"><strong>LLM Chat:</strong> AI responds intelligently (Groq Llama 3.3)</p>
                    <p className="text-xs text-[#5a6a80] mt-1"><strong>Direct:</strong> Avatar speaks your text exactly</p>
                    <p className="text-xs text-[#5a6a80] mt-1"><strong>🎤 Voice:</strong> Hands-free conversation — pauses mic while AI speaks</p>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4">
                        <p className="text-[#5a6a80] text-sm text-center">
                            {mode === "llm" ? "Chat with AI — type or tap 🎤 for voice" : "Type a message or try a quick prompt ↓"}
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

            {/* Input */}
            <div className="px-5 py-3 border-t border-[rgba(0,212,170,0.06)]">
                <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2">
                    <button type="button" onClick={toggleVoiceMode}
                        className={`p-2.5 rounded-xl transition-all flex-shrink-0 ${voiceMode
                                ? isListening
                                    ? "bg-red-500/20 text-red-400 shadow-lg shadow-red-500/20"
                                    : voiceStatus === "processing"
                                        ? "bg-orange-500/20 text-orange-400"
                                        : "bg-yellow-500/20 text-yellow-400"
                                : "bg-black/30 text-[#5a6a80] hover:text-[#00d4aa] hover:bg-black/40"
                            }`}
                        title={voiceMode ? "Exit voice mode" : "Start voice conversation"}
                    >{voiceMode ? (isListening ? "🔴" : voiceStatus === "processing" ? "⏳" : "🟡") : "🎤"}</button>

                    <input ref={inputRef} type="text" value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={
                            voiceMode
                                ? isListening ? "🎤 Listening..." : voiceStatus === "processing" ? "⏳ AI is thinking..." : "🟡 Waiting..."
                                : isAvatarReady ? "Type a message..." : "Loading..."
                        }
                        disabled={!isAvatarReady || isProcessing}
                        className="flex-1 bg-black/30 border border-[rgba(0,212,170,0.08)] rounded-xl px-4 py-2.5 text-sm text-white placeholder-[#5a6a80] focus:outline-none focus:border-[#00d4aa]/30 transition-colors disabled:opacity-40"
                    />

                    <button type="submit" disabled={!input.trim() || !isAvatarReady || isProcessing}
                        className="btn-primary !py-2.5 !px-5 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    >Send</button>
                </form>
                {voiceMode && (
                    <p className="text-xs text-center mt-2" style={{ color: isListening ? "#ef4444" : "#6b7280" }}>
                        {isListening ? "🔴 Listening — speak, auto-sends on pause"
                            : voiceStatus === "processing" ? "⏳ AI responding... mic paused"
                                : "🟡 Ready — mic will start shortly"}
                    </p>
                )}
            </div>
        </div>
    );
}
