"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import Header from "@/components/Header";

function SuccessContent() {
    const params = useSearchParams();
    const assetId = params.get("asset");
    const sessionId = params.get("session_id");

    return (
        <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
            <Header />
            <div className="pt-32 pb-20 px-6">
                <div className="max-w-lg mx-auto text-center">
                    {/* Success animation */}
                    <div className="w-24 h-24 mx-auto mb-8 rounded-full bg-[#00d4aa]/10 border border-[#00d4aa]/20 flex items-center justify-center animate-pulse">
                        <span className="text-5xl">✅</span>
                    </div>

                    <h1 className="heading-serif text-3xl mb-3">Payment <em>Successful!</em></h1>
                    <p className="text-[#a8b8d0] mb-8">
                        Your purchase has been confirmed. The asset is now available for download.
                    </p>

                    {/* Purchase details */}
                    <div className="card-dark p-6 mb-8 text-left">
                        <h3 className="text-sm font-semibold text-[#eae6df] mb-4">Purchase Details</h3>
                        <div className="space-y-2 text-xs text-[#a8b8d0]">
                            {assetId && (
                                <div className="flex justify-between">
                                    <span>Asset ID</span>
                                    <span className="text-[#eae6df] font-mono">{assetId}</span>
                                </div>
                            )}
                            {sessionId && (
                                <div className="flex justify-between">
                                    <span>Transaction</span>
                                    <span className="text-[#eae6df] font-mono">{sessionId.slice(0, 20)}...</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span>Status</span>
                                <span className="text-[#00d4aa] font-semibold">✓ Completed</span>
                            </div>
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-3">
                        <button className="w-full py-3 rounded-full bg-[#00d4aa] text-[#0a0f1a] font-semibold hover:brightness-110 transition-all">
                            ⬇ Download Asset
                        </button>
                        <Link href="/marketplace" className="w-full py-3 rounded-full border border-white/10 text-[#a8b8d0] hover:text-white hover:border-white/20 transition-all block">
                            ← Back to Marketplace
                        </Link>
                        <Link href="/" className="text-xs text-[#7a8a9d] hover:text-[#00d4aa] transition-colors">
                            Try it on your Avatar →
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function PurchaseSuccessPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
                <span className="text-[#a8b8d0]">Loading...</span>
            </div>
        }>
            <SuccessContent />
        </Suspense>
    );
}
