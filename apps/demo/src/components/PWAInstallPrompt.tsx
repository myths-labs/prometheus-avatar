"use client";

import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: string }>;
}

export default function PWAInstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        // Check if already dismissed in this session
        if (sessionStorage.getItem("pwa-dismissed")) return;

        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            // Show after a 3s delay so it doesn't interrupt the user immediately
            setTimeout(() => setShowPrompt(true), 3000);
        };

        window.addEventListener("beforeinstallprompt", handler);
        return () => window.removeEventListener("beforeinstallprompt", handler);
    }, []);

    async function handleInstall() {
        if (!deferredPrompt) return;
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
            setShowPrompt(false);
        }
        setDeferredPrompt(null);
    }

    function handleDismiss() {
        setDismissed(true);
        setShowPrompt(false);
        sessionStorage.setItem("pwa-dismissed", "1");
    }

    if (!showPrompt || dismissed) return null;

    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[90vw] max-w-sm animate-in slide-in-from-bottom-4">
            <div className="bg-[#0f1019] border border-[#00d4aa]/20 rounded-2xl p-4 shadow-[0_0_30px_rgba(0,212,170,0.15)]">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00d4aa]/20 to-[#c9a84c]/20 flex items-center justify-center text-xl shrink-0">
                        📲
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-[#eae6df] mb-0.5">Install Prometheus</h3>
                        <p className="text-xs text-[#7a8a9d]">Add to your home screen for the full experience — faster launch, offline access.</p>
                    </div>
                    <button
                        onClick={handleDismiss}
                        className="text-[#7a8a9d] hover:text-white transition-colors shrink-0 text-lg leading-none"
                    >
                        ×
                    </button>
                </div>
                <div className="flex gap-2 mt-3">
                    <button
                        onClick={handleDismiss}
                        className="flex-1 py-2 rounded-xl text-xs text-[#7a8a9d] border border-white/5 hover:bg-white/5 transition-all"
                    >
                        Later
                    </button>
                    <button
                        onClick={handleInstall}
                        className="flex-1 py-2 rounded-xl text-xs font-semibold bg-[#00d4aa] text-[#0a0f1a] hover:brightness-110 transition-all"
                    >
                        Install App
                    </button>
                </div>
            </div>
        </div>
    );
}
