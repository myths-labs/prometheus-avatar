"use client";

import { useState } from "react";
import Header from "@/components/Header";
import Link from "next/link";

const TIERS = [
    { range: "0 – 1,000", ratio: "5:1", maxAir: 1000, example: "1,000 $AIR → 200 pts" },
    { range: "1,001 – 5,000", ratio: "10:1", maxAir: 4000, example: "4,000 $AIR → 400 pts" },
    { range: "5,001 – 10,000", ratio: "20:1", maxAir: 5000, example: "5,000 $AIR → 250 pts" },
    { range: "10,001 – 15,000", ratio: "50:1", maxAir: 5000, example: "5,000 $AIR → 100 pts" },
];

function calculateConversion(airPoints: number) {
    let remaining = Math.min(airPoints, 15000);
    let total = 0;
    const breakdown: { tier: string; air: number; pts: number }[] = [];

    const tiers = [
        { name: "Tier 1 (5:1)", max: 1000, ratio: 5 },
        { name: "Tier 2 (10:1)", max: 4000, ratio: 10 },
        { name: "Tier 3 (20:1)", max: 5000, ratio: 20 },
        { name: "Tier 4 (50:1)", max: 5000, ratio: 50 },
    ];

    for (const t of tiers) {
        const used = Math.min(remaining, t.max);
        const pts = Math.floor(used / t.ratio);
        if (used > 0) breakdown.push({ tier: t.name, air: used, pts });
        total += pts;
        remaining -= used;
        if (remaining <= 0) break;
    }

    return { total, breakdown };
}

export default function MigratePage() {
    const [email, setEmail] = useState("");
    const [airBalance, setAirBalance] = useState("");
    const [step, setStep] = useState<"input" | "preview" | "done">("input");
    const [result, setResult] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [claimLifetime, setClaimLifetime] = useState(false);
    const [error, setError] = useState("");

    const airNum = parseInt(airBalance) || 0;
    const preview = calculateConversion(airNum);

    async function handleMigrate() {
        if (!email || !airNum) return;
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/migrate/airachne", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, airBalance: airNum, claimLifetime }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setResult(data);
            setStep("done");
        } catch (e: any) {
            setError(e.message || "Migration failed");
        }
        setLoading(false);
    }

    return (
        <div className="min-h-screen bg-[#0a0f1a]">
            <Header />
            <main className="max-w-2xl mx-auto px-4 py-12">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-bold text-[#eae6df] mb-3">
                        🕸️ Airachne → <span className="text-[#00d4aa]">Prometheus</span>
                    </h1>
                    <p className="text-[#a8b8d0]">Migrate your $AIR points to Prometheus platform points</p>
                </div>

                {/* Conversion table */}
                <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-5 mb-8">
                    <h3 className="text-sm font-semibold text-[#eae6df] mb-4">📊 Tiered Conversion Rates</h3>
                    <div className="grid grid-cols-4 gap-2 text-xs mb-2">
                        <div className="text-[#7a8a9d] font-medium">$AIR Range</div>
                        <div className="text-[#7a8a9d] font-medium">Ratio</div>
                        <div className="text-[#7a8a9d] font-medium">Max $AIR</div>
                        <div className="text-[#7a8a9d] font-medium">Example</div>
                    </div>
                    {TIERS.map((t, i) => (
                        <div key={i} className="grid grid-cols-4 gap-2 text-xs py-2 border-t border-white/5">
                            <div className="text-[#eae6df]">{t.range}</div>
                            <div className="text-[#c9a84c] font-mono font-bold">{t.ratio}</div>
                            <div className="text-[#a8b8d0] tabular-nums">{t.maxAir.toLocaleString()}</div>
                            <div className="text-[#00d4aa]">{t.example}</div>
                        </div>
                    ))}
                    <div className="mt-3 pt-3 border-t border-white/10 flex justify-between text-sm">
                        <span className="text-[#a8b8d0]">Max 15,000 $AIR total</span>
                        <span className="text-[#00d4aa] font-bold">≈ 950 pts</span>
                    </div>
                </div>

                {/* Lifetime membership callout */}
                <div className="bg-gradient-to-r from-[#c9a84c]/10 to-[#00d4aa]/10 border border-[#c9a84c]/20 rounded-2xl p-5 mb-8">
                    <div className="flex items-start gap-3">
                        <span className="text-2xl">💎</span>
                        <div>
                            <h3 className="text-sm font-semibold text-[#eae6df]">Lifetime Membership</h3>
                            <p className="text-xs text-[#a8b8d0] mt-1">
                                Redeem <strong className="text-[#c9a84c]">10,000 $AIR</strong> directly for a Lifetime Membership (separate channel, not via points).
                                Only 100K slots available.
                            </p>
                        </div>
                    </div>
                </div>

                {step === "input" && (
                    <div className="bg-[#0f1019] border border-white/10 rounded-2xl p-6 space-y-5">
                        <div>
                            <label className="text-xs text-[#7a8a9d] mb-2 block">Airachne email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-sm text-[#eae6df] placeholder:text-[#3a4a5d]"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-[#7a8a9d] mb-2 block">Your $AIR balance</label>
                            <input
                                type="number"
                                value={airBalance}
                                onChange={e => setAirBalance(e.target.value)}
                                placeholder="e.g. 5000"
                                max={15000}
                                className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-sm text-[#eae6df] placeholder:text-[#3a4a5d]"
                            />
                        </div>

                        {/* Live preview */}
                        {airNum > 0 && (
                            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
                                <div className="text-xs text-[#7a8a9d] mb-2">Conversion preview</div>
                                {preview.breakdown.map((b, i) => (
                                    <div key={i} className="flex justify-between text-xs">
                                        <span className="text-[#a8b8d0]">{b.tier}: {b.air.toLocaleString()} $AIR</span>
                                        <span className="text-[#00d4aa] font-bold tabular-nums">→ {b.pts} pts</span>
                                    </div>
                                ))}
                                <div className="border-t border-white/10 pt-2 mt-2 flex justify-between text-sm font-bold">
                                    <span className="text-[#eae6df]">Total</span>
                                    <span className="text-[#00d4aa]">{preview.total} pts</span>
                                </div>
                            </div>
                        )}

                        {/* Lifetime checkbox */}
                        {airNum >= 10000 && (
                            <label className="flex items-center gap-3 p-3 rounded-xl bg-[#c9a84c]/10 border border-[#c9a84c]/20 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={claimLifetime}
                                    onChange={e => setClaimLifetime(e.target.checked)}
                                    className="w-4 h-4 accent-[#c9a84c]"
                                />
                                <span className="text-xs text-[#eae6df]">
                                    💎 Claim Lifetime Membership (uses 10,000 $AIR)
                                </span>
                            </label>
                        )}

                        {error && (
                            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                                ⚠️ {error}
                            </div>
                        )}

                        <button
                            onClick={() => setStep("preview")}
                            disabled={!email || !airNum}
                            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00d4aa] to-[#00b896] text-[#0a0f1a] font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            Preview Migration
                        </button>
                    </div>
                )}

                {step === "preview" && (
                    <div className="bg-[#0f1019] border border-white/10 rounded-2xl p-6 space-y-5">
                        <h3 className="text-lg font-bold text-[#eae6df]">Confirm Migration</h3>
                        <div className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-[#7a8a9d]">Email</span>
                                <span className="text-[#eae6df]">{email}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-[#7a8a9d]">$AIR to migrate</span>
                                <span className="text-[#eae6df] font-mono">{airNum.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-[#7a8a9d]">Prometheus points</span>
                                <span className="text-[#00d4aa] font-bold">{preview.total}</span>
                            </div>
                            {claimLifetime && (
                                <div className="flex justify-between">
                                    <span className="text-[#7a8a9d]">Lifetime Membership</span>
                                    <span className="text-[#c9a84c] font-bold">💎 Yes</span>
                                </div>
                            )}
                        </div>

                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-xs text-yellow-300">
                            ⚠️ This action is irreversible. Each Airachne account can only migrate once.
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setStep("input")}
                                className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-[#a8b8d0] hover:bg-white/10 transition-all"
                            >
                                ← Back
                            </button>
                            <button
                                onClick={handleMigrate}
                                disabled={loading}
                                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#00d4aa] to-[#00b896] text-[#0a0f1a] font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50"
                            >
                                {loading ? "⏳ Migrating..." : "✅ Confirm & Migrate"}
                            </button>
                        </div>
                    </div>
                )}

                {step === "done" && result && (
                    <div className="bg-[#0f1019] border border-[#00d4aa]/30 rounded-2xl p-6 text-center space-y-5">
                        <div className="text-5xl">🎉</div>
                        <h3 className="text-xl font-bold text-[#eae6df]">Migration Complete!</h3>
                        <p className="text-sm text-[#a8b8d0]">{result.message}</p>
                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-[#7a8a9d]">$AIR imported</span>
                                <span className="text-[#eae6df]">{result.airImported?.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-[#7a8a9d]">Points granted</span>
                                <span className="text-[#00d4aa] font-bold">{result.prometheusPointsGranted}</span>
                            </div>
                            {result.lifetimeMembership && (
                                <div className="flex justify-between">
                                    <span className="text-[#7a8a9d]">Lifetime Membership</span>
                                    <span className="text-[#c9a84c] font-bold">💎 Active</span>
                                </div>
                            )}
                        </div>
                        <Link
                            href="/marketplace"
                            className="inline-block px-6 py-3 rounded-xl bg-[#00d4aa] text-[#0a0f1a] font-semibold text-sm hover:brightness-110 transition-all"
                        >
                            Go to Marketplace →
                        </Link>
                    </div>
                )}
            </main>
        </div>
    );
}
