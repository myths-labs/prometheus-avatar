"use client";

import Link from "next/link";
import Header from "@/components/Header";

export default function PurchaseCancelledPage() {
    return (
        <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
            <Header />
            <div className="pt-32 pb-20 px-6">
                <div className="max-w-lg mx-auto text-center">
                    <div className="w-24 h-24 mx-auto mb-8 rounded-full bg-[#c9a84c]/10 border border-[#c9a84c]/20 flex items-center justify-center">
                        <span className="text-5xl">🔙</span>
                    </div>

                    <h1 className="heading-serif text-3xl mb-3">Payment <em>Cancelled</em></h1>
                    <p className="text-[#a8b8d0] mb-8">
                        No worries! Your payment was not processed. You can try again anytime.
                    </p>

                    <div className="flex flex-col gap-3">
                        <Link href="/marketplace" className="w-full py-3 rounded-full bg-[#00d4aa] text-[#0a0f1a] font-semibold hover:brightness-110 transition-all block">
                            ← Back to Marketplace
                        </Link>
                        <Link href="/" className="text-xs text-[#7a8a9d] hover:text-[#00d4aa] transition-colors">
                            Return Home
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
