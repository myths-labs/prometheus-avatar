import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBaseUrl } from "@/lib/authUrl";

// Google OAuth — Step 2: Handle callback from Google
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const baseUrl = getBaseUrl();

    if (!code) {
        return NextResponse.redirect(`${baseUrl}/marketplace?error=no_code`);
    }

    let returnTo = "/marketplace";
    try {
        const stateData = JSON.parse(Buffer.from(state || "", "base64url").toString());
        returnTo = stateData.returnTo || "/marketplace";
    } catch { }

    try {
        // Exchange code for access token
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID!,
                client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                redirect_uri: `${baseUrl}/api/auth/callback/google`,
                grant_type: "authorization_code",
            }),
        });

        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            console.error("[Google OAuth] Token error:", tokenData.error_description);
            return NextResponse.redirect(`${baseUrl}/marketplace?error=token_failed`);
        }

        // Get user profile
        const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const user = await userRes.json();

        // Store verification in a cookie
        const session = {
            provider: "google",
            id: user.id,
            name: user.name,
            avatar_url: user.picture,
            email: user.email,
            verified: true,
            ts: Date.now(),
        };

        const cookieStore = await cookies();
        cookieStore.set("prometheus_auth", JSON.stringify(session), {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 30, // 30 days
            path: "/",
        });

        console.log(`[Google OAuth] ✅ Verified: ${user.name} (${user.email})`);

        return NextResponse.redirect(`${baseUrl}${returnTo}?verified=google`);
    } catch (error: any) {
        console.error("[Google OAuth] Error:", error.message);
        return NextResponse.redirect(`${baseUrl}/marketplace?error=oauth_failed`);
    }
}
