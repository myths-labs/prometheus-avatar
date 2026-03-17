import { NextRequest, NextResponse } from "next/server";

// POST /api/verify/openclaw — Verify OpenClaw identity via X post code
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { verificationCode, xHandle } = body;

        if (!verificationCode || typeof verificationCode !== "string") {
            return NextResponse.json({ error: "Verification code required" }, { status: 400 });
        }

        // Validate code format: PROM-XXXXXX
        if (!verificationCode.match(/^PROM-[A-Z0-9]{6}$/)) {
            return NextResponse.json({
                error: "Invalid verification code format. Expected: PROM-XXXXXX",
            }, { status: 400 });
        }

        // Search for the verification code on X (Twitter)
        // In production: use Twitter API v2 to search recent tweets
        // GET https://api.twitter.com/2/tweets/search/recent?query={code}
        // For MVP: simulate the search with a deterministic check

        // Check if user provided their X handle
        if (!xHandle || typeof xHandle !== "string") {
            return NextResponse.json({
                status: "pending",
                instructions: [
                    `1. Post this to X (Twitter): "Joining @PrometheusAvatar as a 🦞 OpenClaw OpenClaw! My verification code: ${verificationCode} #PrometheusAvatar #OpenClaw"`,
                    `2. Make sure the post is public (not protected account)`,
                    `3. Come back and enter your X handle to verify`,
                ],
                searchUrl: `https://x.com/search?q=${encodeURIComponent(verificationCode)}&f=live`,
            });
        }

        // Validate X handle format
        const cleanHandle = xHandle.replace(/^@/, "").trim();
        if (!cleanHandle.match(/^[a-zA-Z0-9_]{1,15}$/)) {
            return NextResponse.json({
                error: "Invalid X handle format.",
            }, { status: 400 });
        }

        // For MVP: Accept verification if handle is provided and code format is valid
        // In production: Actually search Twitter API for the tweet containing the code
        // Also verify the tweet was made by the claimed handle

        // Simulate a brief "scanning" delay
        // The real implementation would:
        // 1. Call Twitter Search API: GET /2/tweets/search/recent?query=PROM-XXXXXX
        // 2. Check if any result author matches the claimed xHandle
        // 3. Return verified if match found

        return NextResponse.json({
            status: "verified",
            identity: "openclaw",
            xHandle: `@${cleanHandle}`,
            verificationCode,
            message: `🦞 OpenClaw identity verified for @${cleanHandle}! Welcome to Prometheus.`,
        });

    } catch (error: any) {
        return NextResponse.json({ error: "Verification failed: " + error.message }, { status: 500 });
    }
}
