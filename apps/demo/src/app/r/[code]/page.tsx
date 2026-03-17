"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";

export default function ReferralLandingPage() {
    const params = useParams();
    const code = (params.code as string)?.toUpperCase();
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        // Save referral code to localStorage for later use after OAuth
        if (code) {
            localStorage.setItem("prometheus_referral_code", code);
            setSaved(true);
        }
    }, [code]);

    return (
        <div className="min-h-screen">
            <Header />
            <div className="max-w-2xl mx-auto px-6 pt-32 pb-20 text-center">
                {/* Hero — immediate value proposition */}
                <div className="mb-10">
                    <div className="text-6xl mb-6">🔥</div>
                    <h1 className="heading-serif text-4xl sm:text-5xl mb-4">
                        Give Your AI an <em>Avatar Body</em>
                    </h1>
                    <p className="text-lg text-[#a8b8d0] max-w-lg mx-auto">
                        Real-time lip-sync, emotions &amp; voice — in 5 lines of code.
                        Open-source SDK for developers, agents, and lobsters.
                    </p>
                </div>

                {/* Signup bonus call-out */}
                <div className="bg-gradient-to-r from-[#00d4aa]/10 to-[#c9a84c]/10 border border-[#00d4aa]/20 rounded-2xl p-6 mb-8 backdrop-blur-sm">
                    <div className="flex items-center justify-center gap-3 mb-3">
                        <span className="text-3xl">🎁</span>
                        <span className="text-2xl font-bold text-[#00d4aa]">+250 Points Bonus</span>
                    </div>
                    <p className="text-sm text-[#a8b8d0]">
                        Sign up with this referral link and get <strong className="text-[#eae6df]">50 welcome + 200 referral bonus</strong> points.
                    </p>
                    <div className="flex flex-wrap justify-center gap-3 mt-4 text-xs text-[#7a8a9d]">
                        <span className="px-3 py-1.5 bg-white/5 rounded-full">🪙 1,000 pts = Monthly Membership</span>
                        <span className="px-3 py-1.5 bg-white/5 rounded-full">🎨 Free Tier assets = points only</span>
                        <span className="px-3 py-1.5 bg-white/5 rounded-full">💰 Max 20% off paid items</span>
                    </div>
                </div>

                {/* Quick features grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
                    {[
                        { icon: "🎤", label: "Live Voice", desc: "Real-time AI voice" },
                        { icon: "😊", label: "Emotions", desc: "Dynamic expressions" },
                        { icon: "👄", label: "Lip Sync", desc: "Viseme-accurate" },
                        { icon: "🛒", label: "Marketplace", desc: "1000+ assets" },
                    ].map(f => (
                        <div key={f.label} className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                            <div className="text-2xl mb-1">{f.icon}</div>
                            <div className="text-xs font-semibold text-[#eae6df]">{f.label}</div>
                            <div className="text-[10px] text-[#7a8a9d]">{f.desc}</div>
                        </div>
                    ))}
                </div>

                {/* Referral code badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs text-[#7a8a9d] mb-6">
                    🎟️ Referral Code: <code className="text-[#c9a84c] font-bold">{code}</code>
                    {saved && <span className="text-[#00d4aa]">✓ saved</span>}
                </div>

                {/* CTA buttons */}
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <a
                            href={`/api/auth/google?returnTo=/marketplace?ref=${code}`}
                            className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-white/5 border border-white/10 text-sm text-[#eae6df] hover:bg-white/10 transition-all"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                            Sign up with Google
                        </a>
                        <a
                            href={`/api/auth/github?returnTo=/marketplace?ref=${code}`}
                            className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-white/5 border border-white/10 text-sm text-[#eae6df] hover:bg-white/10 transition-all"
                        >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                            Sign up with GitHub
                        </a>
                    </div>
                    <Link
                        href="/"
                        className="block text-center text-xs text-[#7a8a9d] hover:text-[#a8b8d0] transition-colors"
                    >
                        or explore without signing up →
                    </Link>
                </div>

                {/* Trust signals */}
                <div className="flex flex-wrap justify-center gap-6 mt-12 text-[10px] text-[#7a8a9d]">
                    <span>⭐ 14K+ pre-registered users</span>
                    <span>📦 MIT Open Source</span>
                    <span>🔗 Base L2 Crypto Payments</span>
                    <span>🦀 OpenClaw Compatible</span>
                </div>
            </div>
        </div>
    );
}
