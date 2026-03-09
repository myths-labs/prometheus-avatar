import { NextResponse } from "next/server";
import { cookies } from "next/headers";

// Get current auth session
export async function GET() {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get("prometheus_auth");

    if (!authCookie?.value) {
        return NextResponse.json({ authenticated: false });
    }

    try {
        const session = JSON.parse(authCookie.value);
        return NextResponse.json({
            authenticated: true,
            provider: session.provider,
            user: {
                name: session.name,
                login: session.login,
                avatar_url: session.avatar_url,
                email: session.email,
            },
        });
    } catch {
        return NextResponse.json({ authenticated: false });
    }
}

// Logout
export async function DELETE() {
    const cookieStore = await cookies();
    cookieStore.delete("prometheus_auth");
    return NextResponse.json({ success: true });
}
