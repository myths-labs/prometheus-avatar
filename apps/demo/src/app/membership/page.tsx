"use client";

import { useState } from "react";
import Header from "@/components/Header";
import Link from "next/link";

const PLANS = [
    {
        id: "monthly",
        name: "Monthly",
        price: "$9.90",
        priceUSD: 9.9,
        period: "/mo",
        points: "1,000 pts",
        features: ["Lower commission rates", "Premium assets access", "Priority support"],
        popular: false,
    },
    {
        id: "yearly",
        name: "Yearly",
        price: "$99",
        priceUSD: 99,
        period: "/yr",
        points: "9,000 pts",
        features: ["Everything in Monthly", "2 months free", "Early access to new features", "Exclusive yearly badge"],
        popular: true,
        savings: "Save $19.80",
    },
    {
        id: "lifetime",
        name: "Lifetime",
        price: "$299",
        priceUSD: 299,
        period: "one-time",
        points: "Or 10K $AIR",
        features: ["Everything in Yearly", "Lifetime access", "Genesis NFT badge", "DAO governance eligibility", "USDC profit lottery access"],
        popular: false,
        limited: "100K slots only",
    },
];

const PAYMENT_METHODS = [
    { id: "metamask", icon: "🦊", label: "MetaMask", status: "live", desc: "Pay with ETH/USDC" },
    { id: "moonpay", icon: "🌙", label: "MoonPay", status: "coming", desc: "Credit card → crypto" },
    { id: "stripe", icon: "💳", label: "Stripe", status: "coming", desc: "Credit/debit card" },
    { id: "alipay", icon: "🔵", label: "Alipay", status: "coming", desc: "支付宝" },
    { id: "wechat", icon: "💚", label: "WeChat Pay", status: "coming", desc: "微信支付" },
    { id: "points", icon: "🪙", label: "Points", status: "live", desc: "Use Prometheus pts" },
];

export default function MembershipPage() {
    const [selectedPlan, setSelectedPlan] = useState("yearly");
    const [selectedPayment, setSelectedPayment] = useState("metamask");

    const plan = PLANS.find(p => p.id === selectedPlan)!;
    const payment = PAYMENT_METHODS.find(p => p.id === selectedPayment)!;

    async function handlePurchase() {
        if (selectedPayment === "metamask") {
            // Existing MetaMask flow
            alert("MetaMask payment flow — connecting wallet...");
        } else if (selectedPayment === "moonpay") {
            // Will open MoonPay widget when API key is available
            alert("MoonPay integration coming soon! API key pending.");
        } else if (selectedPayment === "points") {
            alert("Points redemption — checking your balance...");
        } else {
            alert(`${payment.label} coming soon!`);
        }
    }

    return (
        <div className="min-h-screen bg-[#0a0f1a]">
            <Header />
            <main className="max-w-5xl mx-auto px-4 py-12">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-[#eae6df] mb-3">
                        Choose Your <span className="text-[#00d4aa]">Membership</span>
                    </h1>
                    <p className="text-[#a8b8d0]">Unlock lower commission rates, premium assets, and exclusive perks</p>
                </div>

                {/* Plans */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
                    {PLANS.map(p => (
                        <button
                            key={p.id}
                            onClick={() => setSelectedPlan(p.id)}
                            className={`relative text-left p-6 rounded-2xl border transition-all hover:scale-[1.02] ${selectedPlan === p.id
                                ? "bg-[#00d4aa]/5 border-[#00d4aa]/40 shadow-[0_0_30px_rgba(0,212,170,0.1)]"
                                : "bg-white/[0.015] border-white/10 hover:border-white/20"
                                }`}
                        >
                            {p.popular && (
                                <span className="absolute -top-3 right-4 px-3 py-1 rounded-full bg-[#00d4aa] text-[#0a0f1a] text-[10px] font-bold uppercase tracking-wider">
                                    Most Popular
                                </span>
                            )}
                            {(p as any).limited && (
                                <span className="absolute -top-3 right-4 px-3 py-1 rounded-full bg-[#c9a84c] text-[#0a0f1a] text-[10px] font-bold uppercase tracking-wider">
                                    {(p as any).limited}
                                </span>
                            )}
                            <h3 className="text-lg font-bold text-[#eae6df] mb-1">{p.name}</h3>
                            <div className="mb-4">
                                <span className="text-3xl font-bold text-[#eae6df]">{p.price}</span>
                                <span className="text-sm text-[#7a8a9d] ml-1">{p.period}</span>
                            </div>
                            {(p as any).savings && (
                                <div className="text-xs text-[#00d4aa] font-semibold mb-3">{(p as any).savings}</div>
                            )}
                            <div className="text-xs text-[#c9a84c] mb-3">Or redeemable for {p.points}</div>
                            <ul className="space-y-2">
                                {p.features.map((f, i) => (
                                    <li key={i} className="flex items-center gap-2 text-xs text-[#a8b8d0]">
                                        <span className="text-[#00d4aa]">✓</span> {f}
                                    </li>
                                ))}
                            </ul>
                        </button>
                    ))}
                </div>

                {/* Payment methods */}
                <div className="bg-[#0f1019] border border-white/10 rounded-2xl p-6 mb-8">
                    <h3 className="text-sm font-semibold text-[#eae6df] mb-4">💳 Payment Method</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
                        {PAYMENT_METHODS.map(pm => (
                            <button
                                key={pm.id}
                                onClick={() => pm.status === "live" && setSelectedPayment(pm.id)}
                                className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${selectedPayment === pm.id
                                    ? "bg-[#00d4aa]/10 border-[#00d4aa]/30"
                                    : pm.status === "live"
                                        ? "bg-white/[0.02] border-white/10 hover:border-white/20"
                                        : "bg-white/[0.01] border-white/5 opacity-50 cursor-not-allowed"
                                    }`}
                            >
                                <span className="text-xl">{pm.icon}</span>
                                <span className="text-xs text-[#eae6df] font-medium">{pm.label}</span>
                                <span className="text-[10px] text-[#7a8a9d]">{pm.desc}</span>
                                {pm.status === "coming" && (
                                    <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] bg-white/5 text-[#7a8a9d]">Soon</span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Purchase summary */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 mb-4">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-[#a8b8d0]">{plan.name} Membership</span>
                            <span className="text-[#eae6df] font-bold">{plan.price}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-[#7a8a9d]">Payment via</span>
                            <span className="text-[#a8b8d0]">{payment.icon} {payment.label}</span>
                        </div>
                    </div>

                    <button
                        onClick={handlePurchase}
                        disabled={payment.status !== "live"}
                        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#00d4aa] to-[#00b896] text-[#0a0f1a] font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        {payment.status === "live" ? `Purchase with ${payment.label}` : `${payment.label} Coming Soon`}
                    </button>
                </div>

                {/* Airachne migration link */}
                <div className="text-center">
                    <p className="text-xs text-[#7a8a9d] mb-2">Coming from Airachne?</p>
                    <Link href="/migrate" className="text-sm text-[#c9a84c] hover:text-[#d9b85c] transition-colors">
                        🕸️ Migrate your $AIR points →
                    </Link>
                </div>
            </main>
        </div>
    );
}
