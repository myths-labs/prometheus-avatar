import { NextRequest, NextResponse } from "next/server";

const COMMISSION_RATES: Record<string, number> = {
    official: 0,
    human: 0.20,
    agent: 0.15,
    lobster: 0.10,
};

/**
 * Asset Upload API
 * Handles multipart form data upload from the marketplace upload page
 */
export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();

        const creatorType = formData.get("creatorType") as string;
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const category = formData.get("category") as string;
        const price = parseFloat(formData.get("price") as string) || 0;
        const isFree = formData.get("isFree") === "true";
        const license = formData.get("license") as string || "personal";
        const tags = (formData.get("tags") as string || "").split(",").map(t => t.trim()).filter(Boolean);
        const file = formData.get("file") as File | null;

        // Validation
        if (!name || !description || !category || !creatorType) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        if (!isFree && price <= 0) {
            return NextResponse.json({ error: "Price must be greater than 0 for paid assets" }, { status: 400 });
        }

        if (!["human", "agent", "lobster"].includes(creatorType)) {
            return NextResponse.json({ error: "Invalid creator type" }, { status: 400 });
        }

        const commission = COMMISSION_RATES[creatorType] || 0.20;

        // In production:
        // 1. Upload file to Supabase Storage or S3
        // 2. Generate thumbnail/preview
        // 3. Insert into assets table
        // 4. Create/verify creator profile

        const assetId = `asset_${Date.now()}`;

        console.log(`[Upload] New asset from ${creatorType}:`, {
            id: assetId,
            name,
            category,
            price: isFree ? "Free" : `$${price}`,
            commission: `${(commission * 100).toFixed(0)}%`,
            fileSize: file?.size,
            fileName: file?.name,
        });

        return NextResponse.json({
            success: true,
            asset: {
                id: assetId,
                name,
                description,
                category,
                price: isFree ? 0 : price,
                is_free: isFree,
                creator_type: creatorType,
                commission_rate: commission,
                license,
                tags,
                status: "live", // Auto-approved for now
            },
            message: `Asset "${name}" published successfully!`,
        });

    } catch (error: any) {
        console.error("[Upload] Error:", error);
        return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
    }
}
