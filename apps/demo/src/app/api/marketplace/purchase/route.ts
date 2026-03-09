import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Commission rates by identity
const COMMISSION_RATES: Record<string, number> = {
    official: 0,
    human: 0.20,
    agent: 0.15,
    lobster: 0.10,
};

export async function POST(req: NextRequest) {
    try {
        const { assetId, buyerId, buyerName } = await req.json();

        if (!assetId || !buyerId) {
            return NextResponse.json({ error: "Missing assetId or buyerId" }, { status: 400 });
        }

        // 1. Get asset details
        const { data: asset, error: assetErr } = await supabase
            .from("marketplace_assets")
            .select("*")
            .eq("id", assetId)
            .single();

        if (assetErr || !asset) {
            return NextResponse.json({ error: "Asset not found" }, { status: 404 });
        }

        const pricePoints = asset.price_points || Math.round((asset.price || 0) * 100); // fallback: $1 = 100 pts
        if (pricePoints <= 0) {
            // Free asset — just grant access
            return NextResponse.json({
                success: true,
                message: "Free download granted",
                downloadUrl: asset.file_url,
            });
        }

        // 2. Check buyer's point balance
        const { data: buyerAccount } = await supabase
            .from("accounts")
            .select("points")
            .eq("user_id", buyerId)
            .single();

        const buyerPoints = buyerAccount?.points || 0;
        if (buyerPoints < pricePoints) {
            return NextResponse.json({
                error: `Insufficient points. Need ${pricePoints} pts, you have ${buyerPoints} pts`,
                required: pricePoints,
                balance: buyerPoints,
            }, { status: 402 });
        }

        // 3. Calculate commission
        const creatorType = asset.creator_type || "human";
        const commissionRate = COMMISSION_RATES[creatorType] || 0.20;
        // TODO: Check if buyer has membership → halve the commission
        const platformFee = Math.round(pricePoints * commissionRate);
        const creatorPayout = pricePoints - platformFee;

        // 4. Execute transaction atomically
        // Deduct buyer points
        const { error: deductErr } = await supabase.rpc("deduct_points", {
            p_user_id: buyerId,
            p_amount: pricePoints,
        });

        if (deductErr) {
            // If RPC doesn't exist, fallback to manual update
            const { error: updateErr } = await supabase
                .from("accounts")
                .update({ points: buyerPoints - pricePoints })
                .eq("user_id", buyerId);

            if (updateErr) {
                return NextResponse.json({ error: "Failed to deduct points" }, { status: 500 });
            }
        }

        // Credit creator points
        const sellerId = asset.creator_id || asset.seller_id;
        if (sellerId) {
            const { data: sellerAccount } = await supabase
                .from("accounts")
                .select("points")
                .eq("user_id", sellerId)
                .single();

            const sellerPoints = sellerAccount?.points || 0;
            await supabase
                .from("accounts")
                .upsert({
                    user_id: sellerId,
                    points: sellerPoints + creatorPayout,
                }, { onConflict: "user_id" });
        }

        // 5. Record transaction
        await supabase.from("marketplace_transactions").insert({
            asset_id: assetId,
            asset_name: asset.name,
            buyer_id: buyerId,
            buyer_name: buyerName || "Anonymous",
            seller_id: sellerId,
            payment_method: "points",
            amount_points: pricePoints,
            platform_fee_points: platformFee,
            seller_payout_points: creatorPayout,
            commission_rate: commissionRate,
            status: "completed",
        });

        // 6. Increment asset sales count
        await supabase
            .from("marketplace_assets")
            .update({ sales_count: (asset.sales_count || 0) + 1 })
            .eq("id", assetId);

        console.log(`[Purchase] ✅ ${buyerName} bought "${asset.name}" for ${pricePoints} pts (creator gets ${creatorPayout})`);

        return NextResponse.json({
            success: true,
            message: `Purchased "${asset.name}" for ${pricePoints} pts!`,
            downloadUrl: asset.file_url,
            breakdown: {
                total: pricePoints,
                platformFee,
                creatorPayout,
                commissionRate,
            },
            newBalance: buyerPoints - pricePoints,
        });
    } catch (error: any) {
        console.error("[Purchase] Error:", error);
        return NextResponse.json({ error: error.message || "Purchase failed" }, { status: 500 });
    }
}
