import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/authUrl";

// GitHub OAuth — Step 1: Redirect user to GitHub authorization
export async function GET(request: Request) {
    const clientId = (process.env.GITHUB_CLIENT_ID || "").trim();
    if (!clientId) {
        return NextResponse.json({ error: "GitHub OAuth not configured" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const returnTo = searchParams.get("returnTo") || "/marketplace";

    const state = Buffer.from(JSON.stringify({ returnTo, ts: Date.now() })).toString("base64url");
    const baseUrl = getBaseUrl();

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${baseUrl}/api/auth/callback/github`,
        scope: "read:user user:email",
        state,
    });

    return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
}
