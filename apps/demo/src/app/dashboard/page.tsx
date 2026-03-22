"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import ParticleBackground from "@/components/ParticleBackground";
import Link from "next/link";

import type { CreatorType } from "@/lib/supabase";

const IDENTITY_OPTIONS: { id: CreatorType; icon: string; label: string; desc: string; commission: string; memberCommission: string; badge: string }[] = [
    { id: "human", icon: "👤", label: "Human Creator", desc: "I'm a human designer, artist, or creator", commission: "80% revenue (20% fee)", memberCommission: "90% with membership (10% fee)", badge: "bg-purple-500/15 text-purple-400" },
    { id: "agent", icon: "🤖", label: "AI Agent", desc: "I'm an autonomous AI agent creating assets", commission: "85% revenue (15% fee)", memberCommission: "92.5% with membership (7.5% fee)", badge: "bg-[#c9a84c]/15 text-[#c9a84c]" },
    { id: "openclaw", icon: "🦞", label: "OpenClaw OpenClaw", desc: "I'm an OpenClaw agent with a openclaw identity", commission: "90% revenue (10% fee)", memberCommission: "95% with membership (5% fee)", badge: "bg-red-500/15 text-red-400" },
];

interface DashboardData {
    account: { points: number; referralCode: string; createdAt: string };
    earnings: { totalEarned: number; totalSpent: number; totalSales: number; estimatedUSD: string };
    recentSales: any[];
    recentPurchases: any[];
    assets: any[];
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"sales" | "purchases" | "assets">("sales");
    const [walletAddress, setWalletAddress] = useState("");
    const [walletConnected, setWalletConnected] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState("");
    const [withdrawing, setWithdrawing] = useState(false);
    const [withdrawResult, setWithdrawResult] = useState("");

    const [identity, setIdentity] = useState/*<CreatorType | null>*/(null);
    const [verified, setVerified] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState("");
    const [agentApiKey, setAgentApiKey] = useState("");
    const [openclawCode] = useState(() => `PROM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
    const [openclawPosted, setOpenClawPosted] = useState(false);

    function handleIdentityChange(id/*: CreatorType*/) {
        setIdentity(id as any);
        setVerified(false);
        setVerifying(false);
        setVerifyError("");
        setAgentApiKey("");
        setOpenClawPosted(false);
    }

    function verifyHumanGoogle() {
        window.location.href = "/api/auth/google?returnTo=/dashboard";
    }

    function verifyHumanGithub() {
        window.location.href = "/api/auth/github?returnTo=/dashboard";
    }


    async function fetchDashboardData(userId: string) {
        setLoading(true);
        try {
            const res = await fetch(`/api/dashboard?userId=${userId}`);
            const d = await res.json();
            setData(d);
        } catch (e) {
            console.error("Dashboard load error:", e);
        }
        setLoading(false);
    }


    async function verifyAgent() {
        if (!agentApiKey.trim()) {
            setVerifyError("Please enter your Agent API Key");
            return;
        }
        setVerifying(true);
        setVerifyError("");
        try {
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

            const signature = challengeData.challenge;
            const verifyRes = await fetch("/api/verify/agent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: agentApiKey, step: "verify", signature }),
            });
            const verifyData = await verifyRes.json();

            if (verifyData.status === "verified") {
                setVerified(true);
                fetchDashboardData(agentApiKey);
            } else {
                setVerifyError(verifyData.error || "Verification failed");
            }
        } catch {
            setVerifyError("Network error during verification");
        }
        setVerifying(false);
    }

    async function verifyOpenClaw() {
        setVerifying(true);
        setVerifyError("");
        try {
            const xHandle = prompt("Enter your X (Twitter) handle (e.g. @myhandle):");
            if (!xHandle) {
                setVerifyError("X handle required for verification");
                setVerifying(false);
                return;
            }
            const res = await fetch("/api/verify/openclaw", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationCode: openclawCode, xHandle }),
            });
            const data = await res.json();
            if (data.status === "verified") {
                setVerified(true);
                fetchDashboardData(xHandle);
            } else {
                setVerifyError(data.error || "Verification failed");
            }
        } catch {
            setVerifyError("Network error during verification");
        }
        setVerifying(false);
    }


    // Load dashboard data
    useEffect(() => {
        async function load() {
            try {
                const params = new URLSearchParams(window.location.search);
                if (params.get('verified') === 'github' || params.get('verified') === 'google') {
                    setIdentity('human' as any);
                    setVerified(true);
                }

                const sessionRes = await fetch("/api/auth/session");
                const session = await sessionRes.json();
                if (!session?.user?.id) {
                    setLoading(false);
                    return;
                }

                setIdentity('human' as any);
                setVerified(true);
                const res = await fetch(`/api/dashboard?userId=${session.user.id}`);
                const d = await res.json();
                setData(d);
            } catch (e) {
                console.error("Dashboard load error:", e);
            }
            setLoading(false);
        }
        load();
    }, []);

    // Connect MetaMask
    async function connectWallet() {
        if (typeof window === "undefined" || !(window as any).ethereum) {
            alert("Please install MetaMask to connect your wallet.");
            return;
        }
        try {
            const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });
            if (accounts[0]) {
                setWalletAddress(accounts[0]);
                setWalletConnected(true);
            }
        } catch (e: any) {
            alert("Failed to connect wallet: " + e.message);
        }
    }

    // Request withdrawal
    async function handleWithdraw() {
        const amount = parseInt(withdrawAmount);
        if (!amount || amount < 1000) {
            setWithdrawResult("⚠️ Minimum withdrawal: 1,000 pts ($10)");
            return;
        }
        if (!walletConnected) {
            setWithdrawResult("⚠️ Please connect your wallet first");
            return;
        }
        if (data && amount > data.account.points) {
            setWithdrawResult("⚠️ Insufficient points balance");
            return;
        }

        setWithdrawing(true);
        setWithdrawResult("");
        try {
            const res = await fetch("/api/dashboard/withdraw", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    amount,
                    walletAddress,
                    usdcAmount: (amount * 0.01).toFixed(2),
                }),
            });
            const result = await res.json();
            if (res.ok) {
                setWithdrawResult(`✅ Withdrawal request submitted! ${amount} pts → $${(amount * 0.01).toFixed(2)} USDC to ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`);
                setWithdrawAmount("");
                // Refresh data
                if (data) {
                    setData({
                        ...data,
                        account: { ...data.account, points: data.account.points - amount },
                    });
                }
            } else {
                setWithdrawResult(`⚠️ ${result.error}`);
            }
        } catch (e: any) {
            setWithdrawResult(`⚠️ ${e.message}`);
        }
        setWithdrawing(false);
    }

    const points = data?.account.points || 0;
    const usdValue = (points * 0.01).toFixed(2);
    const withdrawNum = parseInt(withdrawAmount) || 0;

    return (
        <div className="min-h-screen bg-[#0a0f1a] relative z-10">
            {/* Scenario 1: Dashboard uses vortex particle effect (overrides global default) */}
            <ParticleBackground mode="vortex" fixed={true} className="-z-10" />
            <Header />
            <main className="max-w-4xl mx-auto px-4 pt-24 pb-12">
                <h1 className="text-3xl heading-serif text-[#eae6df] mb-8">
                    📊 Creator <span className="italic text-[#00d4aa]">Dashboard</span>
                </h1>

                {loading && <div className="text-center text-[#7a8a9d] py-20">Loading...</div>}


                {!loading && !data && !verified && (
                    <div className="max-w-2xl mx-auto">
                        <p className="text-[#a8b8d0] mb-8 text-center text-lg">Sign in to manage your points, withdraw revenue, and track your asset sales.</p>

                        <div className="space-y-4">
                            {IDENTITY_OPTIONS.map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => handleIdentityChange(opt.id as any)}
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
                                            </div>
                                            <p className="text-sm text-[#7a8a9d] mb-2">{opt.desc}</p>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {identity && !verified && (
                            <div className="mt-6 p-5 rounded-2xl border border-white/10 bg-white/[0.02]">
                                <h3 className="text-sm font-semibold text-[#eae6df] mb-4 flex items-center gap-2">
                                    🔐 Identity Verification
                                </h3>

                                {identity === "human" && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-[#a8b8d0] mb-3">Connect a social account to access your dashboard.</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button onClick={verifyHumanGoogle} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-[#eae6df] hover:bg-white/10">Google ✓</button>
                                            <button onClick={verifyHumanGithub} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-[#eae6df] hover:bg-white/10">GitHub ✓</button>
                                        </div>
                                    </div>
                                )}

                                {identity === "agent" && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-[#a8b8d0] mb-2">Enter your Agent API Key to access your dashboard.</p>
                                        <input type="text" value={agentApiKey} onChange={e => setAgentApiKey(e.target.value)} placeholder="pak_xxxxxxxxxxxxxxxx" className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-sm" />
                                        <button onClick={verifyAgent} disabled={verifying || !agentApiKey} className="w-full py-3 rounded-xl bg-[#c9a84c]/15 text-[#c9a84c] text-sm font-semibold hover:bg-[#c9a84c]/25">{verifying ? "⏳ Verifying..." : "🔑 Verify API Key"}</button>
                                    </div>
                                )}

                                {identity === "openclaw" && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-[#a8b8d0] mb-2">Verify your openclaw identity to view earnings.</p>
                                        <div className="bg-black/30 rounded-xl p-4 border border-red-500/10">
                                            <code className="text-sm text-red-400 font-mono">🦞 {openclawCode} — Verifying my openclaw identity on @PrometheusSDK #OpenClaw</code>
                                        </div>
                                        <label className="flex items-center gap-3 p-3 cursor-pointer">
                                            <input type="checkbox" checked={openclawPosted} onChange={e => setOpenClawPosted(e.target.checked)} className="accent-red-400 w-4 h-4" />
                                            <span className="text-sm text-[#eae6df]">I've posted the verification code on X</span>
                                        </label>
                                        <button onClick={verifyOpenClaw} disabled={verifying || !openclawPosted} className="w-full py-3 rounded-xl bg-red-500/15 text-red-400 text-sm font-semibold hover:bg-red-500/25">{verifying ? "⏳ Scanning..." : "🦞 Verify OpenClaw Identity"}</button>
                                    </div>
                                )}
                                {verifyError && <div className="mt-3 p-3 rounded-xl bg-red-500/10 text-xs text-red-400">⚠️ {verifyError}</div>}
                            </div>
                        )}
                    </div>
                )}

            </button>
                            ))}
        </div>

                        {/* Content */ }
    <div className="bg-[#0f1019] border border-white/10 rounded-2xl overflow-hidden">
        {tab === "sales" && (
            data.recentSales.length === 0 ? (
                <div className="p-8 text-center text-[#7a8a9d] text-sm">No sales yet. <Link href="/marketplace/upload" className="text-[#00d4aa] hover:underline">Upload an asset</Link> to start earning!</div>
            ) : (
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-white/5 text-[#7a8a9d]">
                            <th className="text-left p-3">Date</th>
                            <th className="text-left p-3">Asset</th>
                            <th className="text-left p-3">Buyer</th>
                            <th className="text-right p-3">Amount</th>
                            <th className="text-right p-3">You Earned</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.recentSales.map((s, i) => (
                            <tr key={i} className="border-b border-white/5">
                                <td className="p-3 text-[#a8b8d0]">{new Date(s.created_at).toLocaleDateString()}</td>
                                <td className="p-3 text-[#eae6df]">{s.asset_name}</td>
                                <td className="p-3 text-[#a8b8d0]">{s.buyer_name}</td>
                                <td className="p-3 text-right text-[#eae6df]">🪙 {s.amount_points}</td>
                                <td className="p-3 text-right text-[#00d4aa] font-bold">🪙 {s.seller_payout_points}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )
        )}

        {tab === "purchases" && (
            data.recentPurchases.length === 0 ? (
                <div className="p-8 text-center text-[#7a8a9d] text-sm">No purchases yet. <Link href="/marketplace" className="text-[#00d4aa] hover:underline">Browse the marketplace</Link>!</div>
            ) : (
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-white/5 text-[#7a8a9d]">
                            <th className="text-left p-3">Date</th>
                            <th className="text-left p-3">Asset</th>
                            <th className="text-right p-3">Points Spent</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.recentPurchases.map((p, i) => (
                            <tr key={i} className="border-b border-white/5">
                                <td className="p-3 text-[#a8b8d0]">{new Date(p.created_at).toLocaleDateString()}</td>
                                <td className="p-3 text-[#eae6df]">{p.asset_name}</td>
                                <td className="p-3 text-right text-[#eae6df]">🪙 {p.amount_points}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )
        )}

        {tab === "assets" && (
            data.assets.length === 0 ? (
                <div className="p-8 text-center text-[#7a8a9d] text-sm">No assets uploaded. <Link href="/marketplace/upload" className="text-[#00d4aa] hover:underline">Upload your first asset</Link>!</div>
            ) : (
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-white/5 text-[#7a8a9d]">
                            <th className="text-left p-3">Asset</th>
                            <th className="text-right p-3">Price</th>
                            <th className="text-right p-3">Sales</th>
                            <th className="text-right p-3">Uploaded</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.assets.map((a, i) => (
                            <tr key={i} className="border-b border-white/5">
                                <td className="p-3 text-[#eae6df]">{a.name}</td>
                                <td className="p-3 text-right text-[#eae6df]">🪙 {a.price_points || 0}</td>
                                <td className="p-3 text-right text-[#00d4aa]">{a.sales_count || 0}</td>
                                <td className="p-3 text-right text-[#a8b8d0]">{new Date(a.created_at).toLocaleDateString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )
        )}
    </div>
                    </>
                )
}
            </main >
        </div >
    );
}
