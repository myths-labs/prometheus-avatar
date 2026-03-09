import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Force dynamic
export const dynamic = "force-dynamic";

export async function GET() {
    if (!GEMINI_API_KEY) {
        return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    // Direct API key pass-through for Live Voice
    // TODO: Switch back to ephemeral tokens when SDK stabilizes v1alpha/v1beta
    console.log("[Live Token] ✅ Returning API key for Live Voice");
    return NextResponse.json({ token: GEMINI_API_KEY });
}
