import { NextResponse, NextRequest } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ALLOWED_ORIGINS = [
    "https://prometheus.mythslabs.ai",
    "https://prometheus-avatar",            // Vercel preview deploys
    "http://localhost:3000",
    "http://localhost:3001",
];

// Simple in-memory rate limiter
const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10;        // 10 requests per minute

// Force dynamic
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    if (!GEMINI_API_KEY) {
        return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    // Origin check — block requests from unknown origins
    const origin = req.headers.get("origin") || req.headers.get("referer") || "";
    const isAllowed = ALLOWED_ORIGINS.some((o) => origin.startsWith(o));
    if (!isAllowed && process.env.NODE_ENV === "production") {
        console.warn(`[Live Token] ⛔ Blocked request from origin: ${origin}`);
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Basic rate limiting by IP
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const now = Date.now();
    const entry = rateLimit.get(ip);
    if (entry && now < entry.resetAt) {
        if (entry.count >= RATE_LIMIT_MAX) {
            return NextResponse.json({ error: "Rate limited" }, { status: 429 });
        }
        entry.count++;
    } else {
        rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    }

    // Direct API key pass-through for Live Voice
    // TODO: Switch back to ephemeral tokens when SDK stabilizes v1alpha/v1beta
    console.log("[Live Token] ✅ Returning API key for Live Voice");
    return NextResponse.json({ token: GEMINI_API_KEY });
}
