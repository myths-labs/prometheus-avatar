import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Force dynamic — each request needs a fresh ephemeral token
export const dynamic = "force-dynamic";

export async function GET() {
    if (!GEMINI_API_KEY) {
        return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    try {
        // Create ephemeral token via REST API (more reliable than SDK)
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-live-001:generateEphemeralToken?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ephemeralToken: {
                        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                    },
                }),
            }
        );

        if (!response.ok) {
            const err = await response.text();
            console.error("[Live Token] API error:", err);
            return NextResponse.json({ error: `Token API error: ${response.status}` }, { status: 500 });
        }

        const data = await response.json();
        const token = data.ephemeralToken?.token;

        if (!token) {
            console.error("[Live Token] No token in response:", JSON.stringify(data));
            return NextResponse.json({ error: "No token returned" }, { status: 500 });
        }

        console.log("[Live Token] ✅ Ephemeral token created");
        return NextResponse.json({ token });
    } catch (error: any) {
        console.error("[Live Token] Error:", error.message);
        return NextResponse.json({ error: error.message || "Failed to create token" }, { status: 500 });
    }
}
