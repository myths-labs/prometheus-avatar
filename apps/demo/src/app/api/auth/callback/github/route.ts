import { NextResponse } from "next/server";
import { cookies } from "next/headers";

// GitHub OAuth — Step 2: Handle callback from GitHub
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code) {
        return NextResponse.redirect(`${process.env.NEXTAUTH_URL || "https://prometheus.mythslabs.ai"}/marketplace?error=no_code`);
    }

    let returnTo = "/marketplace";
    try {
        const stateData = JSON.parse(Buffer.from(state || "", "base64url").toString());
        returnTo = stateData.returnTo || "/marketplace";
    } catch { }

    try {
        // Exchange code for access token
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code,
            }),
        });

        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            console.error("[GitHub OAuth] Token error:", tokenData.error_description);
            return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/marketplace?error=token_failed`);
        }

        // Get user profile
        const userRes = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                Accept: "application/json",
            },
        });
        const user = await userRes.json();

        // Get email (if not public)
        let email = user.email;
        if (!email) {
            const emailsRes = await fetch("https://api.github.com/user/emails", {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    Accept: "application/json",
                },
            });
            const emails = await emailsRes.json();
            const primary = emails.find((e: any) => e.primary) || emails[0];
            email = primary?.email;
        }

        // Store verification in a cookie (lightweight session)
        const session = {
            provider: "github",
            id: user.id,
            login: user.login,
            name: user.name || user.login,
            avatar_url: user.avatar_url,
            email,
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

        console.log(`[GitHub OAuth] ✅ Verified: ${user.login} (${email})`);

        return NextResponse.redirect(`${process.env.NEXTAUTH_URL || "https://prometheus.mythslabs.ai"}${returnTo}?verified=github`);
    } catch (error: any) {
        console.error("[GitHub OAuth] Error:", error.message);
        return NextResponse.redirect(`${process.env.NEXTAUTH_URL || "https://prometheus.mythslabs.ai"}/marketplace?error=oauth_failed`);
    }
}
