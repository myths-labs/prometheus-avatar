import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json({ error: "Missing userId" }, { status: 400 });
        }

        // Get account info
        const { data: account } = await supabase
            .from("accounts")
            .select("*")
            .eq("user_id", userId)
            .single();

        // Get sales (as seller)
        const { data: sales } = await supabase
            .from("marketplace_transactions")
            .select("*")
            .eq("seller_id", userId)
            .order("created_at", { ascending: false })
            .limit(50);

        // Get purchases (as buyer)
        const { data: purchases } = await supabase
            .from("marketplace_transactions")
            .select("*")
            .eq("buyer_id", userId)
            .order("created_at", { ascending: false })
            .limit(50);

        // Get creator's assets
        const { data: assets } = await supabase
            .from("marketplace_assets")
            .select("id, name, price_points, sales_count, created_at")
            .eq("creator_id", userId)
            .order("created_at", { ascending: false });

        // Calculate totals
        const totalEarned = (sales || []).reduce((sum, s) => sum + (s.seller_payout_points || 0), 0);
        const totalSpent = (purchases || []).reduce((sum, p) => sum + (p.amount_points || 0), 0);
        const totalSales = (sales || []).length;

        return NextResponse.json({
            account: {
                points: account?.points || 0,
                referralCode: account?.referral_code,
                createdAt: account?.created_at,
            },
            earnings: {
                totalEarned,
                totalSpent,
                totalSales,
                estimatedUSD: (totalEarned * 0.01).toFixed(2),
            },
            recentSales: (sales || []).slice(0, 20),
            recentPurchases: (purchases || []).slice(0, 20),
            assets: assets || [],
        });
    } catch (error: any) {
        console.error("[Dashboard] Error:", error);
        return NextResponse.json({ error: error.message || "Dashboard failed" }, { status: 500 });
    }
}
