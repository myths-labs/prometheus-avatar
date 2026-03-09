import { NextResponse } from "next/server";

// Google OAuth — Step 1: Redirect user to Google authorization
export async function GET(request: Request) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const returnTo = searchParams.get("returnTo") || "/marketplace";

    const state = Buffer.from(JSON.stringify({ returnTo, ts: Date.now() })).toString("base64url");

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${process.env.NEXTAUTH_URL || "https://prometheus.mythslabs.ai"}/api/auth/callback/google`,
        response_type: "code",
        scope: "openid email profile",
        state,
        access_type: "offline",
        prompt: "consent",
    });

    return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
