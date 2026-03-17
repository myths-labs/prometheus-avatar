import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * GET /api/marketplace/download?asset=UUID
 * 
 * Returns the download URL for a purchased asset.
 * In production, verify purchase first. For MVP, checks if asset exists.
 */
export async function GET(req: NextRequest) {
    const assetId = req.nextUrl.searchParams.get("asset");
    const txProof = req.nextUrl.searchParams.get("tx"); // Stripe session or x402 tx hash

    if (!assetId) {
        return NextResponse.json({ error: "Missing asset ID" }, { status: 400 });
    }

    // Fetch asset from DB
    const { data: asset, error } = await supabase
        .from("assets")
        .select("id, name, file_url, is_free, price, category")
        .eq("id", assetId)
        .single();

    if (error || !asset) {
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Free assets: direct download
    if (asset.is_free) {
        // Increment download count
        try {
            await supabase
                .from("assets")
                .update({ downloads: (asset as any).downloads ? (asset as any).downloads + 1 : 1 })
                .eq("id", assetId);
        } catch {
            // Non-fatal
        }

        return NextResponse.json({
            success: true,
            asset: {
                id: asset.id,
                name: asset.name,
                category: asset.category,
                fileUrl: asset.file_url,
            },
        });
    }

    // Paid assets: verify purchase exists
    if (txProof) {
        const { data: purchase } = await supabase
            .from("purchases")
            .select("id, status")
            .or(`stripe_session_id.eq.${txProof},x402_tx_hash.eq.${txProof}`)
            .eq("asset_id", assetId)
            .eq("status", "completed")
            .single();

        if (purchase) {
            return NextResponse.json({
                success: true,
                asset: {
                    id: asset.id,
                    name: asset.name,
                    category: asset.category,
                    fileUrl: asset.file_url,
                },
            });
        }
    }

    // No purchase proof — return 402
    return NextResponse.json({
        error: "Payment required",
        assetId: asset.id,
        price: asset.price,
    }, { status: 402 });
}
