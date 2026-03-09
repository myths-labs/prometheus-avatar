"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import Link from "next/link";

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

    // Load dashboard data
    useEffect(() => {
        async function load() {
            try {
                // Get user session
                const sessionRes = await fetch("/api/auth/session");
                const session = await sessionRes.json();
                if (!session?.user?.id) {
                    setLoading(false);
                    return;
                }

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
        <div className="min-h-screen bg-[#0a0f1a]">
            <Header />
            <main className="max-w-4xl mx-auto px-4 py-12">
                <h1 className="text-3xl font-bold text-[#eae6df] mb-8">
                    📊 Creator <span className="text-[#00d4aa]">Dashboard</span>
                </h1>

                {loading && <div className="text-center text-[#7a8a9d] py-20">Loading...</div>}

                {!loading && !data && (
                    <div className="text-center py-20">
                        <p className="text-[#a8b8d0] mb-4">Please sign in to view your dashboard.</p>
                        <Link href="/api/auth/google?returnTo=/dashboard" className="inline-block px-6 py-3 rounded-xl bg-[#00d4aa] text-[#0a0f1a] font-semibold text-sm">
                            Sign in with Google
                        </Link>
                    </div>
                )}

                {data && (
                    <>
                        {/* Stats cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10">
                                <div className="text-xs text-[#7a8a9d] mb-1">Balance</div>
                                <div className="text-xl font-bold text-[#eae6df]">🪙 {points.toLocaleString()}</div>
                                <div className="text-xs text-[#7a8a9d]">~${usdValue}</div>
                            </div>
                            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10">
                                <div className="text-xs text-[#7a8a9d] mb-1">Total Earned</div>
                                <div className="text-xl font-bold text-[#00d4aa]">🪙 {data.earnings.totalEarned.toLocaleString()}</div>
                                <div className="text-xs text-[#7a8a9d]">~${data.earnings.estimatedUSD}</div>
                            </div>
                            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10">
                                <div className="text-xs text-[#7a8a9d] mb-1">Total Sales</div>
                                <div className="text-xl font-bold text-[#eae6df]">{data.earnings.totalSales}</div>
                            </div>
                            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10">
                                <div className="text-xs text-[#7a8a9d] mb-1">Total Spent</div>
                                <div className="text-xl font-bold text-[#eae6df]">🪙 {data.earnings.totalSpent.toLocaleString()}</div>
                            </div>
                        </div>

                        {/* Withdraw Section — Coming Soon */}
                        <div className="bg-gradient-to-r from-[#00d4aa]/5 to-[#c9a84c]/5 border border-[#00d4aa]/20 rounded-2xl p-6 mb-8 relative overflow-hidden">
                            <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-[#c9a84c]/20 text-[#c9a84c] text-[10px] font-bold tracking-wide">COMING SOON</div>
                            <h3 className="text-sm font-semibold text-[#eae6df] mb-3">💸 Withdraw Earnings</h3>
                            <p className="text-xs text-[#a8b8d0] mb-4">
                                Cash out your earned Points to real money. Withdrawal options are coming soon pending compliance review.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 opacity-60">
                                    <div className="text-xs text-[#eae6df] font-medium mb-1">🦊 USDC via MetaMask</div>
                                    <div className="text-[10px] text-[#7a8a9d]">Min 1,000 pts ($10) · 1-3 days · KYC required</div>
                                </div>
                                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 opacity-60">
                                    <div className="text-xs text-[#eae6df] font-medium mb-1">💳 Bank Transfer via Stripe</div>
                                    <div className="text-[10px] text-[#7a8a9d]">Direct to bank · Stripe Connect · Most compliant</div>
                                </div>
                            </div>
                            <div className="text-[10px] text-[#7a8a9d]">
                                📌 Rate: 1 pt = $0.01 · Your Points are safe and will never expire · Use Points to buy assets or membership in the meantime
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-1 mb-4">
                            {[
                                { id: "sales" as const, label: "💰 Sales", count: data.recentSales.length },
                                { id: "purchases" as const, label: "🛒 Purchases", count: data.recentPurchases.length },
                                { id: "assets" as const, label: "📦 My Assets", count: data.assets.length },
                            ].map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setTab(t.id)}
                                    className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${tab === t.id ? "bg-[#00d4aa]/10 text-[#00d4aa] border border-[#00d4aa]/20" : "text-[#7a8a9d] hover:text-[#a8b8d0]"}`}
                                >
                                    {t.label} ({t.count})
                                </button>
                            ))}
                        </div>

                        {/* Content */}
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
                )}
            </main>
        </div>
    );
}
