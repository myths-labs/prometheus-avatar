import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * GET /api/marketplace/assets
 * 
 * Fetches all assets from Supabase for the marketplace page.
 * Supports filtering by category and search query.
 */
export async function GET(req: NextRequest) {
    const category = req.nextUrl.searchParams.get("category");
    const search = req.nextUrl.searchParams.get("search");
    const creator = req.nextUrl.searchParams.get("creator");
    const sort = req.nextUrl.searchParams.get("sort") || "popular";

    let query = supabase
        .from("assets")
        .select(`
            id, name, description, category, price, is_free,
            thumbnail, file_url, downloads, rating, badge, tags,
            creator_type, is_featured, license, total_revenue,
            created_at,
            creators ( id, name, avatar_url, is_official, creator_type, verified )
        `);

    // Filters
    if (category && category !== "all") {
        query = query.eq("category", category);
    }
    if (search) {
        query = query.ilike("name", `%${search}%`);
    }
    if (creator) {
        query = query.eq("creator_type", creator);
    }

    // Sorting
    switch (sort) {
        case "newest":
            query = query.order("created_at", { ascending: false });
            break;
        case "price-low":
            query = query.order("price", { ascending: true });
            break;
        case "price-high":
            query = query.order("price", { ascending: false });
            break;
        case "rating":
            query = query.order("rating", { ascending: false });
            break;
        case "popular":
        default:
            query = query.order("downloads", { ascending: false });
            break;
    }

    const { data: assets, error } = await query;

    if (error) {
        console.error("[Assets API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ assets: assets || [] });
}
