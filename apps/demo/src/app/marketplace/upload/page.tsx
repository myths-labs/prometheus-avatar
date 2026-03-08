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

    const commission = identity === "human" ? 0.20 : identity === "agent" ? 0.15 : 0.10;
    const memberCommission = commission * 0.5; // 50% off with membership
    const priceNum = parseFloat(price) || 0;
    const creatorEarns = priceNum * (1 - commission);
    const memberEarns = priceNum * (1 - memberCommission);

    async function handleSubmit() {
        setSubmitting(true);
        // Simulate upload
        await new Promise(r => setTimeout(r, 2000));
        setSubmitted(true);
        setSubmitting(false);
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
                                {s === 1 ? "Identity" : s === 2 ? "Details" : "Payment"}
                            </span>
                            {s < 3 && <div className={`flex-1 h-px ${step > s ? "bg-[#00d4aa]" : "bg-white/10"}`} />}
                        </div>
                    ))}
                </div>

                {/* Step 1: Identity Selection */}
                {step === 1 && (
                    <div>
                        <h1 className="heading-serif text-3xl mb-2">Who are <em>you?</em></h1>
                        <p className="text-[#a8b8d0] mb-8">Choose your creator identity. This determines your commission rate.</p>

                        <div className="space-y-4">
                            {IDENTITY_OPTIONS.map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => setIdentity(opt.id)}
                                    className={`w-full text-left p-5 rounded-2xl border transition-all ${identity === opt.id
                                        ? "border-[#00d4aa]/40 bg-[#00d4aa]/5"
                                        : "border-white/5 bg-white/[0.02] hover:border-white/10"
                                        }`}
                                >
                                    <div className="flex items-start gap-4">
                                        <span className="text-3xl">{opt.icon}</span>
                                        <div>
                                            <h3 className="text-[#eae6df] font-semibold mb-0.5">{opt.label}</h3>
                                            <p className="text-sm text-[#7a8a9d] mb-2">{opt.desc}</p>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${opt.badge} font-semibold`}>{opt.commission}</span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#c9a84c]/10 text-[#c9a84c] font-semibold ml-1">✨ {opt.memberCommission}</span>
                                        </div>
                                        {identity === opt.id && <span className="text-[#00d4aa] text-xl ml-auto">✓</span>}
                                    </div>
                                </button>
                            ))}
                        </div>

                        <button
                            disabled={!identity}
                            onClick={() => setStep(2)}
                            className="mt-8 w-full py-3 rounded-full bg-[#00d4aa] text-[#0a0f1a] font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all"
                        >
                            Continue →
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
                                    <span className="text-xs text-[#7a8a9d] mt-1">.model3.json, .zip, .mp3, .png (max 50MB)</span>
                                    <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
                                </label>
                            </div>

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
        </div>
    );
}
