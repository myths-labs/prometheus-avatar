import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function generateReferralCode(): string {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusing chars
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// GET /api/referral — Get referral info for current user (or create account)
export async function GET() {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get("prometheus_auth");
    if (!authCookie?.value) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = JSON.parse(authCookie.value);
    const email = session.email;
    if (!email) {
        return NextResponse.json({ error: "No email in session" }, { status: 400 });
    }

    // Find or create account
    let { data: account } = await supabase
        .from("point_accounts")
        .select("*")
        .eq("user_email", email)
        .single();

    if (!account) {
        // Create new account with referral code
        let code = generateReferralCode();
        // Ensure unique
        for (let i = 0; i < 5; i++) {
            const { data: existing } = await supabase
                .from("point_accounts")
                .select("id")
                .eq("referral_code", code)
                .single();
            if (!existing) break;
            code = generateReferralCode();
        }

        const { data: newAccount, error } = await supabase
            .from("point_accounts")
            .insert({
                user_email: email,
                user_name: session.name || session.login,
                provider: session.provider,
                provider_id: String(session.id),
                avatar_url: session.avatar_url,
                balance: 50, // signup bonus
                lifetime_earned: 50,
                referral_code: code,
            })
            .select()
            .single();

        if (error) {
            console.error("[Referral] Create account error:", error);
            return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
        }

        // Record signup bonus transaction
        await supabase.from("point_transactions").insert({
            account_id: newAccount.id,
            amount: 50,
            type: "signup_bonus",
            description: "Welcome bonus for joining Prometheus",
        });

        account = newAccount;
    }

    // Get referral stats
    const { count: totalReferrals } = await supabase
        .from("referrals")
        .select("*", { count: "exact", head: true })
        .eq("referrer_account_id", account.id)
        .eq("status", "registered");

    // Get recent transactions
    const { data: transactions } = await supabase
        .from("point_transactions")
        .select("*")
        .eq("account_id", account.id)
        .order("created_at", { ascending: false })
        .limit(10);

    return NextResponse.json({
        account: {
            balance: account.balance,
            lifetime_earned: account.lifetime_earned,
            referral_code: account.referral_code,
            identity_type: account.identity_type,
            has_lifetime_membership: account.has_lifetime_membership,
            is_airachne_user: account.is_airachne_user,
        },
        stats: {
            total_referrals: totalReferrals || 0,
            points_per_referral: 200,
        },
        transactions: transactions || [],
    });
}

// POST /api/referral — Process a referral (called when new user signs up with referral code)
export async function POST(request: Request) {
    const body = await request.json();
    const { referral_code, referred_email, identity_type, channel } = body;

    if (!referral_code || !referred_email) {
        return NextResponse.json({ error: "Missing referral_code or referred_email" }, { status: 400 });
    }

    // Find referrer account
    const { data: referrer } = await supabase
        .from("point_accounts")
        .select("*")
        .eq("referral_code", referral_code.toUpperCase())
        .single();

    if (!referrer) {
        return NextResponse.json({ error: "Invalid referral code" }, { status: 404 });
    }

    // Check if user already referred
    const { data: existing } = await supabase
        .from("referrals")
        .select("id")
        .eq("referral_code", referral_code.toUpperCase())
        .eq("referred_email", referred_email)
        .single();

    if (existing) {
        return NextResponse.json({ ok: true, message: "Already referred" });
    }

    // Create referral record
    await supabase.from("referrals").insert({
        referrer_account_id: referrer.id,
        referral_code: referral_code.toUpperCase(),
        referred_email,
        status: "registered",
        identity_type: identity_type || "human",
        channel: channel || "web",
    });

    // Award 200 points to referrer
    await supabase.from("point_transactions").insert({
        account_id: referrer.id,
        amount: 200,
        type: "referral",
        description: `Referral: ${referred_email.split("@")[0]}*** joined`,
        metadata: { referred_email, channel },
    });

    // Update balance
    await supabase
        .from("point_accounts")
        .update({
            balance: referrer.balance + 200,
            lifetime_earned: referrer.lifetime_earned + 200,
        })
        .eq("id", referrer.id);

    return NextResponse.json({ ok: true, points_awarded: 200 });
}
