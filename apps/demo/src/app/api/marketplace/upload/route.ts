import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * POST /api/marketplace/upload
 * 
 * Real file upload: stores in Supabase Storage, creates DB record.
 * 
 * Accepts multipart/form-data:
 * - file: asset file (.zip, .model3.json, .mp3, etc.)
 * - thumbnail: preview image
 * - name, description, category, price, license, creatorType, tags
 */
export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();

        const file = formData.get("file") as File | null;
        const thumbnail = formData.get("thumbnail") as File | null;
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const category = formData.get("category") as string;
        const price = parseFloat(formData.get("price") as string || "0");
        const license = formData.get("license") as string || "personal";
        const creatorType = formData.get("creatorType") as string || "human";
        const tags = (formData.get("tags") as string || "").split(",").map(t => t.trim()).filter(Boolean);

        if (!name || !category) {
            return NextResponse.json({ error: "Name and category are required" }, { status: 400 });
        }

        let fileUrl: string | null = null;
        let thumbnailUrl: string | null = null;
        let fileSize = 0;

        const assetId = crypto.randomUUID();
        const timestamp = Date.now();

        // ═══ Upload asset file to Supabase Storage ═══
        if (file) {
            const ext = file.name.split(".").pop() || "zip";
            const storagePath = `assets/${assetId}/${timestamp}.${ext}`;
            const buffer = Buffer.from(await file.arrayBuffer());
            fileSize = buffer.length;

            const { error: uploadError } = await supabase.storage
                .from("marketplace")
                .upload(storagePath, buffer, {
                    contentType: file.type || "application/octet-stream",
                    upsert: true,
                });

            if (uploadError) {
                console.error("[Upload] File error:", uploadError);
                return NextResponse.json({ error: "File upload failed: " + uploadError.message }, { status: 500 });
            }

            const { data: urlData } = supabase.storage.from("marketplace").getPublicUrl(storagePath);
            fileUrl = urlData.publicUrl;
        }

        // ═══ Upload thumbnail ═══
        if (thumbnail) {
            const ext = thumbnail.name.split(".").pop() || "png";
            const thumbPath = `thumbnails/${assetId}/${timestamp}.${ext}`;
            const buffer = Buffer.from(await thumbnail.arrayBuffer());

            const { error: thumbError } = await supabase.storage
                .from("marketplace")
                .upload(thumbPath, buffer, {
                    contentType: thumbnail.type || "image/png",
                    upsert: true,
                });

            if (!thumbError) {
                const { data: thumbUrl } = supabase.storage.from("marketplace").getPublicUrl(thumbPath);
                thumbnailUrl = thumbUrl.publicUrl;
            }
        }

        // ═══ Insert asset record ═══
        const { data: asset, error: dbError } = await supabase
            .from("assets")
            .insert({
                id: assetId,
                name,
                description,
                category,
                price,
                is_free: price <= 0,
                thumbnail: thumbnailUrl || "/previews/skin-haru.png",
                file_url: fileUrl,
                file_size: fileSize,
                downloads: 0,
                rating: 0,
                tags,
                creator_type: creatorType,
                is_featured: false,
                license,
                total_revenue: 0,
            })
            .select()
            .single();

        if (dbError) {
            console.error("[Upload] DB error:", dbError);
            return NextResponse.json({ error: "Database error: " + dbError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            asset: { id: assetId, name, fileUrl, thumbnailUrl, fileSize },
        });

    } catch (error: any) {
        console.error("[Upload] Fatal:", error);
        return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
    }
}
