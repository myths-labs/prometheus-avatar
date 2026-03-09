"use client";

import { useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import type { CreatorType } from "@/lib/supabase";

const CATEGORIES = [
    { id: "skins", label: "🎨 Skins", desc: "Custom avatar appearances" },
    { id: "voices", label: "🎤 Voices", desc: "Voice packs and TTS styles" },
    { id: "effects", label: "✨ Effects", desc: "Particle, glow, and animation effects" },
    { id: "motions", label: "💃 Motions", desc: "Dance and idle animations" },
    { id: "accessories", label: "🎀 Accessories", desc: "Ears, hats, glasses, etc." },
    { id: "scenes", label: "🖼️ Scenes", desc: "Background environments" },
    { id: "personas", label: "💎 Personas", desc: "Personality + behavior modules" },
    { id: "expressions", label: "😊 Expressions", desc: "Extra facial expressions" },
    { id: "bundles", label: "📦 Bundles", desc: "Multi-asset packages" },
];

const IDENTITY_OPTIONS: { id: CreatorType; icon: string; label: string; desc: string; commission: string; memberCommission: string; badge: string }[] = [
    { id: "human", icon: "👤", label: "Human Creator", desc: "I'm a human designer, artist, or creator", commission: "80% revenue (20% fee)", memberCommission: "90% with membership (10% fee)", badge: "bg-purple-500/15 text-purple-400" },
    { id: "agent", icon: "🤖", label: "AI Agent", desc: "I'm an autonomous AI agent creating assets", commission: "85% revenue (15% fee)", memberCommission: "92.5% with membership (7.5% fee)", badge: "bg-[#c9a84c]/15 text-[#c9a84c]" },
    { id: "lobster", icon: "🦞", label: "OpenClaw Lobster", desc: "I'm an OpenClaw agent with a lobster identity", commission: "90% revenue (10% fee)", memberCommission: "95% with membership (5% fee)", badge: "bg-red-500/15 text-red-400" },
];

const LICENSE_OPTIONS = [
    { id: "personal", label: "Personal Use", desc: "Buyer can use in personal projects only" },
    { id: "commercial", label: "Commercial Use", desc: "Buyer can use in commercial products" },
    { id: "mit", label: "MIT (Open Source)", desc: "Free for any use, no restrictions" },
];

export default function UploadPage() {
    const [step, setStep] = useState(1);
    const [identity, setIdentity] = useState<CreatorType | null>(null);
    const [category, setCategory] = useState("");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [price, setPrice] = useState("");
    const [isFree, setIsFree] = useState(false);
    const [license, setLicense] = useState("personal");
    const [tags, setTags] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [walletAddress, setWalletAddress] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    // ═══ Verification State ═══
    const [verified, setVerified] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState("");
    const [agentApiKey, setAgentApiKey] = useState("");
    const [lobsterCode] = useState(() => `PROM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
    const [lobsterPosted, setLobsterPosted] = useState(false);

    // Reset verification when identity changes
    function handleIdentityChange(id: CreatorType) {
        setIdentity(id);
        setVerified(false);
        setVerifying(false);
        setVerifyError("");
        setAgentApiKey("");
        setLobsterPosted(false);
    }

    // Check existing auth session on page load or after OAuth redirect
    useState(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('verified') === 'github') {
                setIdentity('human');
                setVerified(true);
            }
            // Also check session cookie
            fetch('/api/auth/session').then(r => r.json()).then(data => {
                if (data.authenticated) {
                    setIdentity('human');
                    setVerified(true);
                }
            }).catch(() => { });
        }
    });

    // ═══ Verification Handlers ═══
    function verifyHumanGoogle() {
        // Real Google OAuth redirect
        window.location.href = "/api/auth/google?returnTo=/marketplace/upload";
    }

    function verifyHumanGithub() {
        // Real GitHub OAuth redirect
        window.location.href = "/api/auth/github?returnTo=/marketplace/upload";
    }

    async function verifyAgent() {
        if (!agentApiKey.trim()) {
            setVerifyError("Please enter your Agent API Key");
            return;
        }
        setVerifying(true);
        setVerifyError("");
        try {
            // Step 1: Request challenge
            const challengeRes = await fetch("/api/verify/agent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: agentApiKey, step: "challenge" }),
            });
            const challengeData = await challengeRes.json();

            if (!challengeRes.ok) {
                setVerifyError(challengeData.error || "Challenge failed");
                setVerifying(false);
                return;
            }

            // Step 2: Sign challenge (simplified — agent would use their private key)
            const signature = challengeData.challenge; // In production: HMAC(challenge, apiKey)
            const verifyRes = await fetch("/api/verify/agent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: agentApiKey, step: "verify", signature }),
            });
            const verifyData = await verifyRes.json();

            if (verifyData.status === "verified") {
                setVerified(true);
            } else {
                setVerifyError(verifyData.error || "Verification failed");
            }
        } catch {
            setVerifyError("Network error during verification");
        }
        setVerifying(false);
    }

    async function verifyLobster() {
        setVerifying(true);
        setVerifyError("");
        try {
            const xHandle = prompt("Enter your X (Twitter) handle (e.g. @myhandle):");
            if (!xHandle) {
                setVerifyError("X handle required for verification");
                setVerifying(false);
                return;
            }
            const res = await fetch("/api/verify/lobster", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationCode: lobsterCode, xHandle }),
            });
            const data = await res.json();
            if (data.status === "verified") {
                setVerified(true);
            } else {
                setVerifyError(data.error || "Verification failed. Make sure you posted the code.");
            }
        } catch {
            setVerifyError("Network error during verification");
        }
        setVerifying(false);
    }

    const commission = identity === "human" ? 0.20 : identity === "agent" ? 0.15 : 0.10;
    const memberCommission = commission * 0.5; // 50% off with membership
    const priceNum = parseFloat(price) || 0;
    const creatorEarns = priceNum * (1 - commission);
    const memberEarns = priceNum * (1 - memberCommission);

    const [thumbnail, setThumbnail] = useState<File | null>(null);
    const [uploadError, setUploadError] = useState("");
    const [uploadedAsset, setUploadedAsset] = useState<{ id: string; fileUrl: string } | null>(null);

    async function handleSubmit() {
        setSubmitting(true);
        setUploadError("");

        try {
            const formData = new FormData();
            if (file) formData.append("file", file);
            if (thumbnail) formData.append("thumbnail", thumbnail);
            formData.append("name", name);
            formData.append("description", description);
            formData.append("category", category);
            formData.append("price", isFree ? "0" : price);
            formData.append("license", license);
            formData.append("creatorType", identity || "human");
            formData.append("tags", tags);

            const res = await fetch("/api/marketplace/upload", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Upload failed");
            }

            setUploadedAsset(data.asset);
            setSubmitted(true);
        } catch (err: any) {
            setUploadError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    if (submitted) {
        return (
            <div className="min-h-screen">
                <Header />
                <div className="max-w-lg mx-auto px-6 pt-40 text-center">
                    <div className="text-6xl mb-6">🎉</div>
                    <h1 className="heading-serif text-3xl mb-4">Asset <em>Submitted!</em></h1>
                    <p className="text-[#a8b8d0] mb-8">Your asset is now live on the marketplace. You&apos;ll receive payouts automatically when someone purchases it.</p>
                    <div className="flex gap-4 justify-center">
                        <Link href="/marketplace" className="btn-primary">View Marketplace</Link>
                        <button onClick={() => { setSubmitted(false); setStep(1); setIdentity(null); }} className="px-6 py-3 rounded-full border border-[rgba(0,212,170,0.2)] text-[#a8b8d0] hover:text-white transition-all">Upload Another</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <Header />

            <div className="max-w-2xl mx-auto px-6 pt-32 pb-20">
                {/* Progress bar */}
                <div className="flex items-center gap-2 mb-10">
                    {[1, 2, 3].map(s => (
                        <div key={s} className="flex-1 flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${step >= s ? "bg-[#00d4aa] text-[#0a0f1a]" : "bg-white/5 text-[#7a8a9d]"}`}>
                                {step > s ? "✓" : s}
                            </div>
                            <span className={`text-xs ${step >= s ? "text-[#eae6df]" : "text-[#7a8a9d]"}`}>
                                {s === 1 ? "Verify" : s === 2 ? "Details" : "Payment"}
                            </span>
                            {s < 3 && <div className={`flex-1 h-px ${step > s ? "bg-[#00d4aa]" : "bg-white/10"}`} />}
                        </div>
                    ))}
                </div>

                {/* Step 1: Identity Verification */}
                {step === 1 && (
                    <div>
                        <h1 className="heading-serif text-3xl mb-2">Verify your <em>identity</em></h1>
                        <p className="text-[#a8b8d0] mb-8">Choose your creator type and verify. This determines your commission rate.</p>

                        <div className="space-y-4">
                            {IDENTITY_OPTIONS.map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => handleIdentityChange(opt.id)}
                                    className={`w-full text-left p-5 rounded-2xl border transition-all ${identity === opt.id
                                        ? "border-[#00d4aa]/40 bg-[#00d4aa]/5"
                                        : "border-white/5 bg-white/[0.02] hover:border-white/10"
                                        }`}
                                >
                                    <div className="flex items-start gap-4">
                                        <span className="text-3xl">{opt.icon}</span>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-[#eae6df] font-semibold mb-0.5">{opt.label}</h3>
                                                {identity === opt.id && verified && (
                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00d4aa]/15 text-[#00d4aa] font-bold">✓ VERIFIED</span>
                                                )}
                                            </div>
                                            <p className="text-sm text-[#7a8a9d] mb-2">{opt.desc}</p>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${opt.badge} font-semibold`}>{opt.commission}</span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#c9a84c]/10 text-[#c9a84c] font-semibold ml-1">✨ {opt.memberCommission}</span>
                                        </div>
                                        {identity === opt.id && <span className="text-[#00d4aa] text-xl ml-auto">{verified ? "✅" : "◻"}</span>}
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* ═══ Verification Panel ═══ */}
                        {identity && !verified && (
                            <div className="mt-6 p-5 rounded-2xl border border-white/10 bg-white/[0.02]">
                                <h3 className="text-sm font-semibold text-[#eae6df] mb-4 flex items-center gap-2">
                                    🔐 Identity Verification
                                    <span className="text-xs font-normal text-[#7a8a9d]">— required to upload</span>
                                </h3>

                                {/* Human: OAuth */}
                                {identity === "human" && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-[#a8b8d0] mb-3">Connect a social account to verify you&apos;re human.</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={verifyHumanGoogle}
                                                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-[#eae6df] hover:bg-white/10 transition-all"
                                            >
                                                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                                                Google ✓
                                            </button>
                                            <button
                                                onClick={verifyHumanGithub}
                                                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-[#eae6df] hover:bg-white/10 transition-all"
                                            >
                                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                                                GitHub ✓
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Agent: API Key */}
                                {identity === "agent" && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-[#a8b8d0] mb-2">Enter your Agent API Key for identity challenge verification.</p>
                                        <input
                                            type="text"
                                            value={agentApiKey}
                                            onChange={e => setAgentApiKey(e.target.value)}
                                            placeholder="pak_xxxxxxxxxxxxxxxx"
                                            className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-sm text-[#eae6df] placeholder-[#7a8a9d] focus:outline-none focus:border-[#00d4aa]/30 font-mono"
                                        />
                                        <div className="text-[10px] text-[#7a8a9d] bg-white/[0.02] rounded-lg p-3 font-mono">
                                            <div className="text-[#c9a84c] mb-1">// Challenge-Response Protocol</div>
                                            <div>1. Agent provides API key</div>
                                            <div>2. Server sends challenge hash</div>
                                            <div>3. Agent signs with private key</div>
                                            <div>4. Server verifies → grants upload access</div>
                                        </div>
                                        <button
                                            onClick={verifyAgent}
                                            disabled={verifying || !agentApiKey}
                                            className="w-full py-3 rounded-xl bg-[#c9a84c]/15 text-[#c9a84c] text-sm font-semibold hover:bg-[#c9a84c]/25 transition-all disabled:opacity-30"
                                        >
                                            {verifying ? "⏳ Verifying challenge..." : "🔑 Verify API Key"}
                                        </button>
                                    </div>
                                )}

                                {/* Lobster: OpenClaw / Moltbook-style */}
                                {identity === "lobster" && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-[#a8b8d0] mb-2">Verify your OpenClaw lobster identity (Moltbook-style verification).</p>

                                        <div className="bg-black/30 rounded-xl p-4 border border-red-500/10">
                                            <p className="text-xs text-[#7a8a9d] mb-2">Step 1: Post this verification code on X (Twitter):</p>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 bg-black/50 px-4 py-2.5 rounded-lg text-sm text-red-400 font-mono select-all">
                                                    🦞 {lobsterCode} — Verifying my lobster identity on @PrometheusSDK #OpenClaw
                                                </code>
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(`🦞 ${lobsterCode} — Verifying my lobster identity on @PrometheusSDK #OpenClaw`);
                                                    }}
                                                    className="px-3 py-2.5 rounded-lg bg-white/5 text-xs text-[#a8b8d0] hover:bg-white/10 transition-all shrink-0"
                                                >
                                                    📋 Copy
                                                </button>
                                            </div>
                                        </div>

                                        <label className="flex items-center gap-3 p-3 rounded-xl border border-white/5 cursor-pointer hover:border-red-500/20 transition-all">
                                            <input
                                                type="checkbox"
                                                checked={lobsterPosted}
                                                onChange={e => setLobsterPosted(e.target.checked)}
                                                className="accent-red-400 w-4 h-4"
                                            />
                                            <span className="text-sm text-[#eae6df]">I&apos;ve posted the verification code on X</span>
                                        </label>

                                        <div className="text-[10px] text-[#7a8a9d] bg-white/[0.02] rounded-lg p-3 font-mono">
                                            <div className="text-red-400 mb-1">// OpenClaw Shell Verification (like Moltbook)</div>
                                            <div>1. Agent receives unique verification code</div>
                                            <div>2. Human operator posts code publicly on X</div>
                                            <div>3. Prometheus scans for the code</div>
                                            <div>4. Shell ID verified → lobster identity confirmed</div>
                                        </div>

                                        <button
                                            onClick={verifyLobster}
                                            disabled={verifying || !lobsterPosted}
                                            className="w-full py-3 rounded-xl bg-red-500/15 text-red-400 text-sm font-semibold hover:bg-red-500/25 transition-all disabled:opacity-30"
                                        >
                                            {verifying ? "⏳ Scanning for verification code..." : "🦞 Verify Lobster Identity"}
                                        </button>
                                    </div>
                                )}

                                {/* Error message */}
                                {verifyError && (
                                    <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                                        ⚠️ {verifyError}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Verified success banner */}
                        {verified && (
                            <div className="mt-6 p-4 rounded-2xl bg-[#00d4aa]/5 border border-[#00d4aa]/20 flex items-center gap-3">
                                <span className="text-2xl">✅</span>
                                <div>
                                    <p className="text-sm font-semibold text-[#00d4aa]">Identity Verified</p>
                                    <p className="text-xs text-[#a8b8d0]">
                                        {identity === "human" && "Verified as a human creator via OAuth"}
                                        {identity === "agent" && "Verified as an AI agent via API key challenge"}
                                        {identity === "lobster" && "Verified as an OpenClaw lobster via shell verification"}
                                    </p>
                                </div>
                            </div>
                        )}

                        <button
                            disabled={!identity || !verified}
                            onClick={() => setStep(2)}
                            className="mt-8 w-full py-3 rounded-full bg-[#00d4aa] text-[#0a0f1a] font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all"
                        >
                            {!identity ? "Select an identity" : !verified ? "🔐 Verify to continue" : "Continue →"}
                        </button>
                    </div>
                )}

                {/* Step 2: Asset Details */}
                {step === 2 && (
                    <div>
                        <h1 className="heading-serif text-3xl mb-2">Upload your <em>asset</em></h1>
                        <p className="text-[#a8b8d0] mb-8">Fill in the details about your creation.</p>

                        <div className="space-y-5">
                            {/* Category */}
                            <div>
                                <label className="text-sm text-[#a8b8d0] font-medium block mb-2">Category *</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {CATEGORIES.map(cat => (
                                        <button
                                            key={cat.id}
                                            onClick={() => setCategory(cat.id)}
                                            className={`p-3 rounded-xl text-left text-xs transition-all ${category === cat.id
                                                ? "bg-[#00d4aa]/10 border border-[#00d4aa]/30 text-[#eae6df]"
                                                : "bg-white/[0.02] border border-white/5 text-[#7a8a9d] hover:border-white/10"
                                                }`}
                                        >
                                            <div className="text-lg mb-0.5">{cat.label.split(" ")[0]}</div>
                                            <div className="font-medium">{cat.label.split(" ").slice(1).join(" ")}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Name */}
                            <div>
                                <label className="text-sm text-[#a8b8d0] font-medium block mb-2">Asset Name *</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="e.g. Sakura Voice Pack"
                                    className="w-full px-4 py-3 bg-white/[0.02] border border-white/5 rounded-xl text-sm text-[#eae6df] placeholder-[#7a8a9d] focus:outline-none focus:border-[#00d4aa]/30"
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="text-sm text-[#a8b8d0] font-medium block mb-2">Description *</label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder="Describe your asset..."
                                    rows={3}
                                    className="w-full px-4 py-3 bg-white/[0.02] border border-white/5 rounded-xl text-sm text-[#eae6df] placeholder-[#7a8a9d] focus:outline-none focus:border-[#00d4aa]/30 resize-none"
                                />
                            </div>

                            {/* File Upload */}
                            <div>
                                <label className="text-sm text-[#a8b8d0] font-medium block mb-2">Asset File *</label>
                                <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-white/10 rounded-2xl cursor-pointer hover:border-[#00d4aa]/30 transition-all bg-white/[0.01]">
                                    <span className="text-3xl mb-2">{file ? "✅" : "📁"}</span>
                                    <span className="text-sm text-[#a8b8d0]">{file ? file.name : "Click to upload or drag & drop"}</span>
                                    <span className="text-xs text-[#7a8a9d] mt-1">
                                        {category === "skins" && ".model3.json or .zip (with textures) — max 50MB"}
                                        {category === "voices" && ".json (voice config), .mp3, .wav — max 20MB"}
                                        {category === "motions" && ".motion3.json or .zip — max 10MB"}
                                        {category === "expressions" && ".exp3.json or .json — max 5MB"}
                                        {category === "effects" && ".json (particle config) or .zip — max 10MB"}
                                        {category === "scenes" && ".png, .jpg, .mp4, .webm — max 30MB"}
                                        {category === "personas" && ".json (systemPrompt + traits) — max 1MB"}
                                        {category === "accessories" && ".model3.json, .png or .zip — max 20MB"}
                                        {category === "bundles" && ".zip (with manifest.json) — max 100MB"}
                                        {!category && "Select a category first to see format requirements"}
                                    </span>
                                    <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
                                </label>

                                {/* Compatibility Notice — critical for avoiding refund disputes */}
                                {category && (
                                    <div className="mt-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15 text-xs text-amber-300/80 space-y-1">
                                        <div className="font-semibold text-amber-300 flex items-center gap-1">⚠️ Compatibility Requirements</div>
                                        {category === "skins" && <>
                                            <p>• Upload a <strong>.zip</strong> containing: model3.json + all texture files (PNGs) in the same folder structure</p>
                                            <p>• Single .model3.json only works if texture paths point to public CDN URLs</p>
                                            <p>• Must be Live2D Cubism 3 or 4 format. Cubism 2 (.moc) files also supported</p>
                                            <p>• <strong>Test your asset before listing!</strong> Broken textures = refund requests</p>
                                        </>}
                                        {category === "voices" && <>
                                            <p>• <strong>Voice Config (recommended):</strong> Upload a .json file with <code className="bg-white/5 px-1 rounded">{"{ \"voiceId\": \"...\", \"lang\": \"en\", \"rate\": 1.0 }"}</code></p>
                                            <p>• Supported TTS engines: Google Cloud TTS, ElevenLabs, Edge TTS, Browser Speech API</p>
                                            <p>• <strong>Audio Samples:</strong> .mp3/.wav files can be used as pre-recorded response libraries, not real-time TTS</p>
                                            <p>• Voice cloning (custom voice from audio) requires ElevenLabs voice ID</p>
                                        </>}
                                        {category === "motions" && <>
                                            <p>• Upload standard Live2D <strong>.motion3.json</strong> files with Curves and Meta.Duration</p>
                                            <p>• Or a simple config: <code className="bg-white/5 px-1 rounded">{"{ \"group\": \"idle\", \"index\": 0 }"}</code> to trigger built-in model motions</p>
                                            <p>• <strong>⚠️ Motions are model-specific!</strong> Clearly state which models are compatible</p>
                                            <p>• Include model compatibility list in your description to avoid disputes</p>
                                        </>}
                                        {category === "expressions" && <>
                                            <p>• Standard Live2D <strong>.exp3.json</strong> format: <code className="bg-white/5 px-1 rounded">{"{ \"Parameters\": [{\"Id\":\"ParamEyeLOpen\",\"Value\":0.5}] }"}</code></p>
                                            <p>• Or simple key-value JSON: <code className="bg-white/5 px-1 rounded">{"{ \"ParamEyeLOpen\": 0.5, \"ParamMouthOpenY\": 0.3 }"}</code></p>
                                            <p>• Parameters must match the target model's parameter IDs</p>
                                        </>}
                                        {category === "effects" && <>
                                            <p>• JSON config: <code className="bg-white/5 px-1 rounded">{"{ \"type\": \"particles|sparkle|rain|aura\", \"color\": \"#hex\", \"density\": 30 }"}</code></p>
                                            <p>• Effects are model-independent and work with all avatars ✅</p>
                                        </>}
                                        {category === "scenes" && <>
                                            <p>• Images: .png, .jpg, .webp (will be displayed behind the avatar)</p>
                                            <p>• Videos: .mp4, .webm (will auto-loop behind the avatar)</p>
                                            <p>• Scenes are model-independent and work with all avatars ✅</p>
                                        </>}
                                        {category === "personas" && <>
                                            <p>• JSON file with system prompt: <code className="bg-white/5 px-1 rounded">{"{ \"systemPrompt\": \"You are a pirate...\", \"traits\": [...] }"}</code></p>
                                            <p>• The systemPrompt changes how the AI avatar responds in conversation</p>
                                            <p>• This is a <strong>text prompt, not a LoRA/fine-tuned model</strong> — it uses prompt engineering</p>
                                            <p>• Personas are model-independent and work with all avatars ✅</p>
                                        </>}
                                        {category === "accessories" && <>
                                            <p>• <strong>Images:</strong> .png with transparency — will track the avatar's head movement</p>
                                            <p>• <strong>Live2D models:</strong> .model3.json — rendered as separate overlay</p>
                                            <p>• Image accessories auto-track avatar head angle for natural positioning</p>
                                        </>}
                                        {category === "bundles" && <>
                                            <p>• .zip file containing a <strong>manifest.json</strong> listing all sub-assets</p>
                                            <p>• Each sub-asset needs: <code className="bg-white/5 px-1 rounded">{"{ \"category\": \"skins\", \"fileUrl\": \"...\", \"name\": \"...\" }"}</code></p>
                                            <p>• All included assets must individually meet their category requirements</p>
                                        </>}
                                    </div>
                                )}
                            </div>

                            {/* Thumbnail Upload */}
                            <div>
                                <label className="text-sm text-[#a8b8d0] font-medium block mb-2">Preview Image</label>
                                <label className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-white/10 rounded-2xl cursor-pointer hover:border-[#00d4aa]/30 transition-all bg-white/[0.01]">
                                    <span className="text-2xl mb-1">{thumbnail ? "🖼️" : "📷"}</span>
                                    <span className="text-sm text-[#a8b8d0]">{thumbnail ? thumbnail.name : "Upload preview thumbnail"}</span>
                                    <span className="text-xs text-[#7a8a9d] mt-1">.png, .jpg, .webp — recommended 400×400px</span>
                                    <input type="file" accept="image/*" className="hidden" onChange={e => setThumbnail(e.target.files?.[0] || null)} />
                                </label>
                            </div>

                            {/* Upload Error */}
                            {uploadError && (
                                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                                    ⚠️ {uploadError}
                                </div>
                            )}

                            {/* Tags */}
                            <div>
                                <label className="text-sm text-[#a8b8d0] font-medium block mb-2">Tags</label>
                                <input
                                    type="text"
                                    value={tags}
                                    onChange={e => setTags(e.target.value)}
                                    placeholder="e.g. anime, cute, japanese (comma separated)"
                                    className="w-full px-4 py-3 bg-white/[0.02] border border-white/5 rounded-xl text-sm text-[#eae6df] placeholder-[#7a8a9d] focus:outline-none focus:border-[#00d4aa]/30"
                                />
                            </div>

                            {/* License */}
                            <div>
                                <label className="text-sm text-[#a8b8d0] font-medium block mb-2">License</label>
                                <div className="space-y-2">
                                    {LICENSE_OPTIONS.map(l => (
                                        <label key={l.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${license === l.id ? "border-[#00d4aa]/30 bg-[#00d4aa]/5" : "border-white/5 hover:border-white/10"}`}>
                                            <input type="radio" name="license" value={l.id} checked={license === l.id} onChange={() => setLicense(l.id)} className="accent-[#00d4aa]" />
                                            <div>
                                                <span className="text-sm text-[#eae6df] font-medium">{l.label}</span>
                                                <p className="text-xs text-[#7a8a9d]">{l.desc}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-8">
                            <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-full border border-white/10 text-[#a8b8d0] hover:text-white transition-all">← Back</button>
                            <button
                                disabled={!category || !name || !description}
                                onClick={() => setStep(3)}
                                className="flex-1 py-3 rounded-full bg-[#00d4aa] text-[#0a0f1a] font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all"
                            >
                                Continue →
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Pricing & Payment */}
                {step === 3 && (
                    <div>
                        <h1 className="heading-serif text-3xl mb-2">Set your <em>price</em></h1>
                        <p className="text-[#a8b8d0] mb-8">Choose how to price and receive payments.</p>

                        <div className="space-y-5">
                            {/* Free toggle */}
                            <label className="flex items-center gap-3 p-4 rounded-xl border border-white/5 cursor-pointer hover:border-white/10 transition-all">
                                <input type="checkbox" checked={isFree} onChange={e => setIsFree(e.target.checked)} className="accent-[#00d4aa] w-5 h-5" />
                                <div>
                                    <span className="text-sm text-[#eae6df] font-medium">Make it free</span>
                                    <p className="text-xs text-[#7a8a9d]">Anyone can download for free</p>
                                </div>
                            </label>

                            {/* Price */}
                            {!isFree && (
                                <div>
                                    <label className="text-sm text-[#a8b8d0] font-medium block mb-2">Price (USD)</label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7a8a9d]">$</span>
                                        <input
                                            type="number"
                                            min="0.49"
                                            step="0.01"
                                            value={price}
                                            onChange={e => setPrice(e.target.value)}
                                            placeholder="4.99"
                                            className="w-full pl-8 pr-4 py-3 bg-white/[0.02] border border-white/5 rounded-xl text-sm text-[#eae6df] placeholder-[#7a8a9d] focus:outline-none focus:border-[#00d4aa]/30"
                                        />
                                    </div>

                                    {/* Revenue breakdown */}
                                    {priceNum > 0 && (
                                        <div className="mt-3 p-4 bg-white/[0.02] rounded-xl border border-white/5">
                                            <div className="flex justify-between text-sm mb-2">
                                                <span className="text-[#a8b8d0]">Sale price</span>
                                                <span className="text-[#eae6df] font-medium">${priceNum.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between text-sm mb-2">
                                                <span className="text-[#7a8a9d]">Platform fee ({(commission * 100).toFixed(0)}%)</span>
                                                <span className="text-red-400">-${(priceNum * commission).toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between text-sm pt-2 border-t border-white/5">
                                                <span className="text-[#00d4aa] font-semibold">You earn</span>
                                                <span className="text-[#00d4aa] font-bold">${creatorEarns.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between text-xs mt-2 pt-2 border-t border-[#c9a84c]/10">
                                                <span className="text-[#c9a84c]">✨ With membership ({(memberCommission * 100).toFixed(1)}% fee)</span>
                                                <span className="text-[#c9a84c] font-bold">${memberEarns.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Payment method */}
                            <div>
                                <label className="text-sm text-[#a8b8d0] font-medium block mb-2">How do you want to get paid?</label>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-3 p-4 rounded-xl border border-white/5 cursor-pointer hover:border-white/10 transition-all">
                                        <input type="radio" name="payout" defaultChecked className="accent-[#00d4aa]" />
                                        <div>
                                            <span className="text-sm text-[#eae6df]">💳 Stripe (Bank / PayPal)</span>
                                            <p className="text-xs text-[#7a8a9d]">Supports credit cards, Alipay, WeChat Pay</p>
                                        </div>
                                    </label>
                                    <label className="flex items-center gap-3 p-4 rounded-xl border border-white/5 cursor-pointer hover:border-white/10 transition-all">
                                        <input type="radio" name="payout" className="accent-[#00d4aa]" />
                                        <div>
                                            <span className="text-sm text-[#eae6df]">🔗 x402 Crypto (USDC/USDT)</span>
                                            <p className="text-xs text-[#7a8a9d]">Receive payment in USDC on Base L2</p>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {/* Wallet address for crypto */}
                            <div>
                                <label className="text-sm text-[#a8b8d0] font-medium block mb-2">Wallet Address (optional — for crypto payouts)</label>
                                <input
                                    type="text"
                                    value={walletAddress}
                                    onChange={e => setWalletAddress(e.target.value)}
                                    placeholder="0x..."
                                    className="w-full px-4 py-3 bg-white/[0.02] border border-white/5 rounded-xl text-sm text-[#eae6df] placeholder-[#7a8a9d] focus:outline-none focus:border-[#00d4aa]/30 font-mono"
                                />
                            </div>

                            {/* Summary */}
                            <div className="p-5 rounded-2xl bg-[#00d4aa]/5 border border-[#00d4aa]/15">
                                <h3 className="text-sm font-semibold text-[#eae6df] mb-3">📋 Summary</h3>
                                <div className="space-y-1 text-xs text-[#a8b8d0]">
                                    <div className="flex justify-between"><span>Identity</span><span className="text-[#eae6df]">{identity === "human" ? "👤 Human" : identity === "agent" ? "🤖 AI Agent" : "🦞 Lobster"}</span></div>
                                    <div className="flex justify-between"><span>Category</span><span className="text-[#eae6df]">{CATEGORIES.find(c => c.id === category)?.label || "—"}</span></div>
                                    <div className="flex justify-between"><span>Asset</span><span className="text-[#eae6df]">{name || "—"}</span></div>
                                    <div className="flex justify-between"><span>Price</span><span className="text-[#eae6df]">{isFree ? "Free" : `$${priceNum.toFixed(2)}`}</span></div>
                                    {!isFree && <div className="flex justify-between"><span>You earn</span><span className="text-[#00d4aa] font-semibold">${creatorEarns.toFixed(2)} per sale</span></div>}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-8">
                            <button onClick={() => setStep(2)} className="flex-1 py-3 rounded-full border border-white/10 text-[#a8b8d0] hover:text-white transition-all">← Back</button>
                            <button
                                onClick={handleSubmit}
                                disabled={submitting || (!isFree && priceNum <= 0)}
                                className="flex-1 py-3 rounded-full bg-[#00d4aa] text-[#0a0f1a] font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all"
                            >
                                {submitting ? "⏳ Uploading..." : "🚀 Publish Asset"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}
