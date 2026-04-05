"use client";

import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from "react";

export interface AvatarCanvasHandle {
    speak: (text: string) => Promise<void>;
    interrupt: () => void;
    /** Load a motion from marketplace (motion3.json URL) */
    loadMotion: (url: string) => void;
    /** Load an expression preset from marketplace */
    loadExpression: (url: string) => void;
    /** Add an accessory overlay anchored to model drawable (S106) */
    addAccessory: (url: string, slotType?: string) => void;
    /** Hot-swap skin texture without reloading model (S107a) */
    swapSkinTexture: (textureUrl: string, textureIndex?: number) => void;
}

interface AvatarCanvasProps {
    modelUrl: string;
    onReady?: () => void;
    onEmotionChange?: (emotion: string) => void;
    voiceOverride?: string | null;
}

function detectEmotion(text: string): string {
    const lower = text.toLowerCase();
    // Happy / positive
    if (/happy|great|love|awesome|excellent|wonderful|fantastic|glad|excited|fun|hilarious|laugh|haha|lol|yay|nice|cool|perfect/i.test(lower)
        || /开心|高兴|太好了|哈哈|棒|好的|太棒了|喜欢|可爱|厉害|不错|赞|美|甜|爽|笑|嘻嘻|耶/.test(text)
        || /😊|🎉|😄|🥰|❤️|😁|🤣|💕|✨|👍|🥳/.test(text)) return "happy";
    // Sad / empathetic
    if (/sad|sorry|miss|unfortunate|disappointed|lonely|regret|painful|heartbreak|cry/i.test(lower)
        || /难过|伤心|抱歉|对不起|遗憾|可惜|痛|哭|失望|孤独|舍不得/.test(text)
        || /😢|😭|💔|🥺/.test(text)) return "sad";
    // Angry / frustrated
    if (/angry|hate|furious|annoying|frustrated|terrible|awful|stupid|ridiculous|outrageous/i.test(lower)
        || /生气|愤怒|讨厌|烦|气死|恶心|可恶|混蛋|无语|崩溃/.test(text)
        || /😠|😡|🤬|💢/.test(text)) return "angry";
    // Surprised / amazed
    if (/what|wow|amazing|incredible|unbelievable|omg|seriously|no way|oh my|insane/i.test(lower)
        || /什么|哇|天哪|不可思议|太神了|真的吗|居然|震惊|没想到|厉害/.test(text)
        || /😲|😱|🤯|!!/.test(text)) return "surprised";
    // Thinking / curious
    if (/hmm|think|consider|wonder|maybe|perhaps|interesting|curious|question|let me/i.test(lower)
        || /想|嗯|可能|也许|有意思|好奇|考虑|不知道|为什么|怎么/.test(text)
        || /🤔|？|\?/.test(text)) return "thinking";
    return "neutral";
}

function getAvatarId(modelUrl: string): string {
    if (modelUrl.includes("shizuku")) return "shizuku";
    if (modelUrl.includes("koharu")) return "koharu";
    return "haru";
}

const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(
    ({ modelUrl, onReady, onEmotionChange, voiceOverride }, ref) => {
        const iframeRef = useRef<HTMLIFrameElement>(null);
        const [ready, setReady] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const speakResolveRef = useRef<(() => void) | null>(null);

        useEffect(() => {
            function handleMessage(e: MessageEvent) {
                if (e.data.type === "live2d-ready") {
                    setReady(true);
                    onReady?.();
                }
                if (e.data.type === "live2d-error") {
                    setError(e.data.error);
                    onReady?.();
                }
                if (e.data.type === "speak-done") {
                    speakResolveRef.current?.();
                    speakResolveRef.current = null;
                }
            }
            window.addEventListener("message", handleMessage);
            return () => window.removeEventListener("message", handleMessage);
        }, [onReady]);

        useImperativeHandle(ref, () => ({
            speak: async (text: string) => {
                const emotion = detectEmotion(text);
                onEmotionChange?.(emotion);
                const avatarId = getAvatarId(modelUrl);

                // Voice mapping
                const VOICE_MAP: Record<string, { gemini: string; elevenlabs: string }> = {
                    "Kore": { gemini: "Kore", elevenlabs: "EXAVITQu4vr4xnSDxMaL" },
                    "Aoede": { gemini: "Aoede", elevenlabs: "jBpfAIEiAKNebRVppxo4" },
                    "Leda": { gemini: "Leda", elevenlabs: "FGY2WhTYpPnrIDTdsKH5" },
                    "Zephyr": { gemini: "Zephyr", elevenlabs: "bIHbv24MWmeRgasZH58o" },
                    "Achird": { gemini: "Achird", elevenlabs: "nPczCjzI2devNBz1zQrb" },
                    "Despina": { gemini: "Despina", elevenlabs: "ThT5KcBeYPX3keUQqHPh" },
                    "Callirrhoe": { gemini: "Callirrhoe", elevenlabs: "XB0fDUnXU5powFXDhCwa" },
                    "Algenib": { gemini: "Algenib", elevenlabs: "Xb7hH8MSUJpSbSDYk0k2" },
                    "Laomedeia": { gemini: "Laomedeia", elevenlabs: "pFZP5JQG7iQjIQuC4Bku" },
                    "Puck": { gemini: "Puck", elevenlabs: "nPczCjzI2devNBz1zQrb" },
                    "Charon": { gemini: "Charon", elevenlabs: "IKne3meq5aSn9XLyUdCD" },
                    "Fenrir": { gemini: "Fenrir", elevenlabs: "JBFqnCBsd6RMkjVDRZzb" },
                };
                const voiceMapping = voiceOverride ? VOICE_MAP[voiceOverride] : undefined;

                // Fetch TTS audio (returns audioUrl or null)
                const fetchTTS = async (sentenceText: string): Promise<string | null> => {
                    try {
                        const res = await fetch("/api/tts", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ text: sentenceText, avatar: avatarId, voiceOverride: voiceMapping }),
                        });
                        if (res.ok && res.status !== 204) {
                            const blob = await res.blob();
                            if (blob.size > 0) return URL.createObjectURL(blob);
                        }
                    } catch (e) {
                        console.error("[TTS] fetch failed:", e);
                    }
                    return null;
                };

                // Play audio in avatar iframe (waits for completion)
                const playInAvatar = async (sentenceText: string, sentenceEmotion: string, audioUrl: string | null) => {
                    if (iframeRef.current?.contentWindow) {
                        iframeRef.current.contentWindow.postMessage(
                            { type: "speak", text: sentenceText, emotion: sentenceEmotion, audioUrl, useBrowserTTS: !audioUrl },
                            "*"
                        );
                        await new Promise<void>((resolve) => {
                            const prev = speakResolveRef.current;
                            speakResolveRef.current = () => { prev?.(); resolve(); };
                            setTimeout(resolve, Math.min(sentenceText.length * 100, 12000));
                        });
                    } else {
                        await new Promise(r => setTimeout(r, 800));
                    }
                };

                // ═══ STREAMING TTS WITH PARALLEL PREFETCH ═══
                const sentences = text
                    .split(/(?<=[.!?。！？\n])\s*/)
                    .map(s => s.trim())
                    .filter(s => s.length > 0);

                if (sentences.length <= 1) {
                    const audio = await fetchTTS(text);
                    await playInAvatar(text, emotion, audio);
                } else {
                    let interrupted = false;

                    // Start fetching first sentence's TTS immediately
                    let nextAudioPromise: Promise<string | null> = fetchTTS(sentences[0]);

                    for (let i = 0; i < sentences.length; i++) {
                        if (interrupted) break;

                        const sentenceEmotion = detectEmotion(sentences[i]);
                        if (sentenceEmotion !== "neutral") {
                            onEmotionChange?.(sentenceEmotion);
                        }

                        // Wait for THIS sentence's TTS (was prefetched)
                        const audioUrl = await nextAudioPromise;

                        // PREFETCH next sentence's TTS while this one plays!
                        if (i + 1 < sentences.length) {
                            nextAudioPromise = fetchTTS(sentences[i + 1]);
                        }

                        // Play current sentence
                        const wasInterrupted = await new Promise<boolean>((resolve) => {
                            speakResolveRef.current = () => {
                                interrupted = true;
                                resolve(true);
                            };
                            playInAvatar(sentences[i], sentenceEmotion, audioUrl).then(() => resolve(false));
                        });

                        if (wasInterrupted) break;
                    }
                }

                setTimeout(() => onEmotionChange?.("neutral"), 1500);
            },

            interrupt: () => {
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "stop-speaking" }, "*");
                }
                speakResolveRef.current?.();
                speakResolveRef.current = null;
                onEmotionChange?.("neutral");
            },

            loadMotion: (url: string) => {
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "load-motion", url }, "*");
                }
            },

            loadExpression: (url: string) => {
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "load-expression", url }, "*");
                }
            },

            addAccessory: (url: string, slotType?: string) => {
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "add-accessory", url, slotType: slotType || "headwear" }, "*");
                }
            },

            swapSkinTexture: (textureUrl: string, textureIndex?: number) => {
                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({ type: "swap-skin-texture", textureUrl, textureIndex: textureIndex || 0 }, "*");
                }
            },
        }), [onEmotionChange, modelUrl, voiceOverride]);

        // Listen for marketplace asset events and forward to iframe
        useEffect(() => {
            function onMotion(e: Event) {
                const detail = (e as CustomEvent).detail;
                if (iframeRef.current?.contentWindow && detail?.url) {
                    iframeRef.current.contentWindow.postMessage({ type: "load-motion", url: detail.url }, "*");
                }
            }
            function onExpression(e: Event) {
                const detail = (e as CustomEvent).detail;
                if (iframeRef.current?.contentWindow && detail?.url) {
                    iframeRef.current.contentWindow.postMessage({ type: "load-expression", url: detail.url }, "*");
                }
            }
            function onAccessory(e: Event) {
                const detail = (e as CustomEvent).detail;
                if (iframeRef.current?.contentWindow && detail?.url) {
                    iframeRef.current.contentWindow.postMessage({ type: "add-accessory", url: detail.url, slotType: detail.slotType || "headwear" }, "*");
                }
            }

            window.addEventListener("prometheus:motion", onMotion);
            window.addEventListener("prometheus:expression", onExpression);
            window.addEventListener("prometheus:accessory", onAccessory);
            return () => {
                window.removeEventListener("prometheus:motion", onMotion);
                window.removeEventListener("prometheus:expression", onExpression);
                window.removeEventListener("prometheus:accessory", onAccessory);
            };
        }, []);

        const iframeSrc = `/avatar.html?model=${encodeURIComponent(modelUrl)}`;

        return (
            <div className="w-full h-full relative min-h-[300px]">
                <iframe
                    ref={iframeRef}
                    src={iframeSrc}
                    className="w-full h-full min-h-[300px] border-0"
                    style={{ background: "transparent" }}
                    allow="autoplay"
                />
                {!ready && !error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0f1a]/80 backdrop-blur-sm rounded-xl">
                        <div className="relative">
                            <div className="w-16 h-16 rounded-full border-2 border-[#00d4aa]/30 animate-spin" style={{ borderTopColor: '#00d4aa' }} />
                            <div className="absolute inset-0 flex items-center justify-center text-2xl">🎭</div>
                        </div>
                        <p className="text-sm text-[#a8b8d0] font-light">Loading avatar...</p>
                    </div>
                )}
                {error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0f1a]/80 backdrop-blur-sm rounded-xl">
                        <div className="text-5xl">😵</div>
                        <p className="text-sm text-[#c94c4c] text-center max-w-[240px]">{error}</p>
                        <button
                            onClick={() => { setError(null); setReady(false); iframeRef.current?.contentWindow?.location.reload(); }}
                            className="px-4 py-1.5 text-xs rounded-full bg-[#00d4aa]/15 text-[#00f0c8] border border-[#00d4aa]/20 hover:bg-[#00d4aa]/25 transition-all"
                        >🔄 Retry</button>
                    </div>
                )}
            </div>
        );
    }
);

AvatarCanvas.displayName = "AvatarCanvas";
export default AvatarCanvas;
