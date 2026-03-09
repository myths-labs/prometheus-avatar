"use client";

import { useState, useEffect } from "react";

const SHARE_PLATFORMS = {
    human: [
        { id: "x", icon: "𝕏", label: "X (Twitter)", color: "bg-black border-white/10" },
        { id: "telegram", icon: "✈️", label: "Telegram", color: "bg-[#0088cc]/15 border-[#0088cc]/30" },
        { id: "discord", icon: "🎮", label: "Discord", color: "bg-[#5865F2]/15 border-[#5865F2]/30" },
        { id: "wechat", icon: "💬", label: "WeChat", color: "bg-[#07C160]/15 border-[#07C160]/30" },
        { id: "reddit", icon: "🤖", label: "Reddit", color: "bg-[#FF4500]/15 border-[#FF4500]/30" },
        { id: "copy", icon: "📋", label: "Copy Link", color: "bg-white/5 border-white/10" },
    ],
    agent: [
        { id: "moltbook", icon: "🦞", label: "MoltBook", color: "bg-red-500/15 border-red-500/30" },
        { id: "api", icon: "⚡", label: "API Endpoint", color: "bg-[#c9a84c]/15 border-[#c9a84c]/30" },
        { id: "github", icon: "🐙", label: "GitHub Issue", color: "bg-white/5 border-white/10" },
        { id: "x", icon: "𝕏", label: "X (Twitter)", color: "bg-black border-white/10" },
        { id: "copy", icon: "📋", label: "Copy Code", color: "bg-white/5 border-white/10" },
    ],
    lobster: [
        { id: "moltbook", icon: "🦞", label: "MoltBook Forum", color: "bg-red-500/15 border-red-500/30" },
        { id: "openclaw", icon: "🦀", label: "OpenClaw", color: "bg-orange-500/15 border-orange-500/30" },
        { id: "x", icon: "𝕏", label: "X (Twitter)", color: "bg-black border-white/10" },
        { id: "telegram", icon: "✈️", label: "Telegram", color: "bg-[#0088cc]/15 border-[#0088cc]/30" },
        { id: "copy", icon: "📋", label: "Copy Link", color: "bg-white/5 border-white/10" },
    ],
};

const REFERRAL_TEMPLATES: Record<string, string> = {
    human: "🔥 Give your AI an avatar body with real expressions + voice! Prometheus SDK = 5 lines of code. Join now →",
    agent: "UPGRADE: Get embodied avatar capabilities (voice + expressions + lip-sync). Prometheus SDK, 5-line integration. Referral →",
    lobster: "🦞 Fellow lobster! Get an embodied avatar with voice + lip-sync + emotions. Prometheus SDK, open-source. Join →",
};

interface ReferralPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function ReferralPanel({ isOpen, onClose }: ReferralPanelProps) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [identityTab, setIdentityTab] = useState<"human" | "agent" | "lobster">("human");
    const [copied, setCopied] = useState("");

    useEffect(() => {
        if (isOpen) {
            fetch("/api/referral")
                .then(r => r.json())
                .then(d => {
                    setData(d);
                    if (d.account?.identity_type) setIdentityTab(d.account.identity_type);
                    setLoading(false);
                })
                .catch(() => setLoading(false));
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const code = data?.account?.referral_code || "------";
    const referralUrl = `https://prometheus.mythslabs.ai/r/${code}`;
    const template = REFERRAL_TEMPLATES[identityTab];
    const shareText = `${template} ${referralUrl}`;
    const platforms = SHARE_PLATFORMS[identityTab];

    function handleShare(platformId: string) {
        const encodedText = encodeURIComponent(shareText);
        const encodedUrl = encodeURIComponent(referralUrl);

        switch (platformId) {
            case "x":
                window.open(`https://x.com/intent/tweet?text=${encodedText}`, "_blank");
                break;
            case "telegram":
                window.open(`https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(template)}`, "_blank");
                break;
            case "discord":
                navigator.clipboard.writeText(shareText);
                setCopied("discord");
                setTimeout(() => setCopied(""), 2000);
                break;
            case "wechat":
                navigator.clipboard.writeText(shareText);
                setCopied("wechat");
                setTimeout(() => setCopied(""), 2000);
                break;
            case "reddit":
                window.open(`https://www.reddit.com/submit?title=${encodeURIComponent("Give your AI an avatar body — Prometheus SDK")}&url=${encodedUrl}`, "_blank");
                break;
            case "moltbook":
                navigator.clipboard.writeText(shareText);
                setCopied("moltbook");
                setTimeout(() => setCopied(""), 2000);
                break;
            case "openclaw":
                navigator.clipboard.writeText(shareText);
                setCopied("openclaw");
                setTimeout(() => setCopied(""), 2000);
                break;
            case "api":
                navigator.clipboard.writeText(`{"referral_url":"${referralUrl}","code":"${code}","sdk":"@prometheusavatar/core"}`);
                setCopied("api");
                setTimeout(() => setCopied(""), 2000);
                break;
            case "github":
                window.open(`https://github.com/myths-labs/prometheus-avatar/issues/new?title=Feature%20Request&body=${encodeURIComponent(`Referral: ${referralUrl}\n\n`)}`, "_blank");
                break;
            case "copy":
            default:
                navigator.clipboard.writeText(shareText);
                setCopied("copy");
                setTimeout(() => setCopied(""), 2000);
                break;
        }
    }

    return (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Panel */}
            <div className="relative w-full sm:max-w-lg bg-[#0f1019] border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[85vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-[#0f1019]/95 backdrop-blur-sm border-b border-white/5 px-5 py-4 flex items-center justify-between z-10">
                    <h2 className="text-lg font-semibold text-[#eae6df]">🔗 Refer &amp; Earn</h2>
                    <button onClick={onClose} className="text-[#7a8a9d] hover:text-white text-xl">×</button>
                </div>

                <div className="px-5 py-5 space-y-5">
                    {loading ? (
                        <div className="text-center py-10 text-[#7a8a9d]">Loading...</div>
                    ) : !data?.account ? (
                        <div className="text-center py-10">
                            <p className="text-[#a8b8d0] mb-4">Sign in to get your referral link</p>
                            <a href="/api/auth/github?returnTo=/marketplace" className="btn-primary text-sm">Sign in with GitHub</a>
                        </div>
                    ) : (
                        <>
                            {/* Points balance */}
                            <div className="bg-gradient-to-r from-[#00d4aa]/10 to-[#c9a84c]/10 border border-[#00d4aa]/20 rounded-xl p-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs text-[#7a8a9d] mb-0.5">Your balance</div>
                                        <div className="text-3xl font-bold text-[#eae6df]">{data.account.balance.toLocaleString()} <span className="text-sm text-[#c9a84c]">pts</span></div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-[#7a8a9d]">Referrals</div>
                                        <div className="text-2xl font-bold text-[#00d4aa]">{data.stats.total_referrals}</div>
                                    </div>
                                </div>
                                <div className="flex gap-2 mt-3 text-[10px] text-[#7a8a9d]">
                                    <span className="px-2 py-1 bg-black/20 rounded-full">🪙 200 pts / referral</span>
                                    <span className="px-2 py-1 bg-black/20 rounded-full">+100 pts on first purchase</span>
                                </div>
                            </div>

                            {/* Referral link — one-click copy */}
                            <div>
                                <label className="text-xs text-[#7a8a9d] mb-2 block">Your referral link</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        readOnly
                                        value={referralUrl}
                                        className="flex-1 px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-xs text-[#eae6df] font-mono select-all"
                                        onClick={e => (e.target as HTMLInputElement).select()}
                                    />
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(referralUrl);
                                            setCopied("link");
                                            setTimeout(() => setCopied(""), 2000);
                                        }}
                                        className="px-4 py-2.5 rounded-xl bg-[#00d4aa] text-[#0a0f1a] text-xs font-semibold hover:brightness-110 transition-all shrink-0"
                                    >
                                        {copied === "link" ? "✓ Copied!" : "Copy"}
                                    </button>
                                </div>
                            </div>

                            {/* Identity tabs — different platforms per identity */}
                            <div>
                                <label className="text-xs text-[#7a8a9d] mb-2 block">Share as</label>
                                <div className="flex gap-2 mb-3">
                                    {(["human", "agent", "lobster"] as const).map(t => (
                                        <button
                                            key={t}
                                            onClick={() => setIdentityTab(t)}
                                            className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${identityTab === t
                                                ? "bg-[#00d4aa]/10 border border-[#00d4aa]/30 text-[#00d4aa]"
                                                : "bg-white/[0.02] border border-white/5 text-[#7a8a9d]"
                                                }`}
                                        >
                                            {t === "human" ? "👤 Human" : t === "agent" ? "🤖 Agent" : "🦞 Lobster"}
                                        </button>
                                    ))}
                                </div>

                                {/* Share buttons grid */}
                                <div className="grid grid-cols-3 gap-2">
                                    {platforms.map(p => (
                                        <button
                                            key={p.id}
                                            onClick={() => handleShare(p.id)}
                                            className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all hover:scale-[1.02] active:scale-95 ${p.color}`}
                                        >
                                            <span className="text-lg">{p.icon}</span>
                                            <span className="text-[10px] text-[#eae6df]">
                                                {copied === p.id ? "✓ Copied!" : p.label}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Preview message */}
                            <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                                <div className="text-[10px] text-[#7a8a9d] mb-1">Share message preview</div>
                                <p className="text-xs text-[#a8b8d0] leading-relaxed">{shareText}</p>
                            </div>

                            {/* Points usage guide */}
                            <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
                                <h3 className="text-xs font-semibold text-[#eae6df] mb-3">🪙 What can you do with points?</h3>
                                <div className="space-y-2 text-[10px] text-[#a8b8d0]">
                                    <div className="flex justify-between"><span>Monthly membership ($9.9)</span><span className="text-[#c9a84c] font-bold">1,000 pts</span></div>
                                    <div className="flex justify-between"><span>Yearly membership ($99)</span><span className="text-[#c9a84c] font-bold">9,000 pts</span></div>
                                    <div className="flex justify-between"><span>Free Tier assets</span><span className="text-[#c9a84c] font-bold">50-500 pts</span></div>
                                    <div className="flex justify-between"><span>Paid items discount</span><span className="text-[#7a8a9d]">Up to 20% off</span></div>
                                    <div className="h-px bg-white/5 my-1" />
                                    <div className="flex justify-between text-[#00d4aa]"><span>💡 5 referrals = free monthly membership!</span><span></span></div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
