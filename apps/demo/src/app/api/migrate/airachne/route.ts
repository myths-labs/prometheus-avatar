import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Tiered conversion: 5:1 → 10:1 → 20:1 → 50:1
function calculateConversion(airPoints: number): number {
    let remaining = Math.min(airPoints, 15000);
    let prometheusPoints = 0;

    // Tier 1: 0-1000 at 5:1
    const tier1 = Math.min(remaining, 1000);
    prometheusPoints += Math.floor(tier1 / 5);
    remaining -= tier1;

    // Tier 2: 1001-5000 at 10:1
    const tier2 = Math.min(remaining, 4000);
    prometheusPoints += Math.floor(tier2 / 10);
    remaining -= tier2;

    // Tier 3: 5001-10000 at 20:1
    const tier3 = Math.min(remaining, 5000);
    prometheusPoints += Math.floor(tier3 / 20);
    remaining -= tier3;

    // Tier 4: 10001-15000 at 50:1
    const tier4 = Math.min(remaining, 5000);
    prometheusPoints += Math.floor(tier4 / 50);

    return prometheusPoints;
}

// GET /api/claim/airachne?email=xxx — Preview conversion
export async function GET(req: NextRequest) {
    const email = req.nextUrl.searchParams.get("email");
    if (!email) {
        return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    // Check if already claimed
    const { data: existing } = await supabase
        .from("point_accounts")
        .select("is_airachne_user, airachne_points_imported")
        .eq("user_email", email)
        .single();

    if (existing?.is_airachne_user) {
        return NextResponse.json({
            status: "already_claimed",
            pointsImported: existing.airachne_points_imported,
            message: "This account has already been claimed from Airachne.",
        });
    }

    // For MVP: return a preview based on a simulated lookup
    // In production: call Airachne API to get actual AIR balance
    // GET https://api.airachne.com/v1/users/{email}/balance
    const mockAirBalance = 5000; // Placeholder — will be replaced with real API call

    return NextResponse.json({
        status: "preview",
        airachneEmail: email,
        airBalance: mockAirBalance,
        conversion: {
            prometheusPoints: calculateConversion(mockAirBalance),
            breakdown: [
                { tier: "0-1,000 AIR", ratio: "5:1", airUsed: Math.min(mockAirBalance, 1000), ptsEarned: Math.floor(Math.min(mockAirBalance, 1000) / 5) },
                { tier: "1,001-5,000 AIR", ratio: "10:1", airUsed: Math.min(Math.max(mockAirBalance - 1000, 0), 4000), ptsEarned: Math.floor(Math.min(Math.max(mockAirBalance - 1000, 0), 4000) / 10) },
                { tier: "5,001-10,000 AIR", ratio: "20:1", airUsed: Math.min(Math.max(mockAirBalance - 5000, 0), 5000), ptsEarned: Math.floor(Math.min(Math.max(mockAirBalance - 5000, 0), 5000) / 20) },
                { tier: "10,001-15,000 AIR", ratio: "50:1", airUsed: Math.min(Math.max(mockAirBalance - 10000, 0), 5000), ptsEarned: Math.floor(Math.min(Math.max(mockAirBalance - 10000, 0), 5000) / 50) },
            ],
        },
        lifetimeMembership: {
            eligible: mockAirBalance >= 10000,
            airRequired: 10000,
            slotsRemaining: 100000, // Will query from DB in production
        },
    });
}

// POST /api/claim/airachne — Execute claim
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { email, airBalance, claimLifetime } = body;

        if (!email || !airBalance) {
            return NextResponse.json({ error: "Email and airBalance required" }, { status: 400 });
        }

        // Check if already claimed
        const { data: existing } = await supabase
            .from("point_accounts")
            .select("id, is_airachne_user")
            .eq("user_email", email)
            .single();

        if (existing?.is_airachne_user) {
            return NextResponse.json({ error: "Already claimed" }, { status: 409 });
        }

        const prometheusPoints = calculateConversion(airBalance);
        let lifetimeGranted = false;

        // Handle lifetime membership claim
        if (claimLifetime && airBalance >= 10000) {
            const { data: slots } = await supabase
                .from("lifetime_memberships")
                .select("id", { count: "exact", head: true });

            // Check remaining slots (max 100K)
            if ((slots as any)?.length < 100000) {
                if (existing) {
                    await supabase.from("lifetime_memberships").insert({
                        account_id: existing.id,
                        airachne_points_used: 10000,
                    });
                    lifetimeGranted = true;
                }
            }
        }

        // Update or create point account
        if (existing) {
            await supabase.from("point_accounts").update({
                balance: prometheusPoints,
                lifetime_earned: prometheusPoints,
                is_airachne_user: true,
                airachne_points_imported: airBalance,
                has_lifetime_membership: lifetimeGranted,
            }).eq("id", existing.id);
        } else {
            // Create new account
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            await supabase.from("point_accounts").insert({
                user_email: email,
                referral_code: code,
                balance: prometheusPoints,
                lifetime_earned: prometheusPoints,
                is_airachne_user: true,
                airachne_points_imported: airBalance,
                has_lifetime_membership: lifetimeGranted,
            });
        }

        // Record transaction
        const { data: account } = await supabase
            .from("point_accounts")
            .select("id")
            .eq("user_email", email)
            .single();

        if (account) {
            await supabase.from("point_transactions").insert({
                account_id: account.id,
                amount: prometheusPoints,
                type: "airachne_claim",
                description: `Claimed ${airBalance} AIR → ${prometheusPoints} Prometheus pts (tiered)`,
                metadata: { airBalance, lifetimeGranted },
            });
        }

        return NextResponse.json({
            status: "claimed",
            airImported: airBalance,
            prometheusPointsGranted: prometheusPoints,
            lifetimeMembership: lifetimeGranted,
            message: lifetimeGranted
                ? `🎉 Claimed ${airBalance} AIR → ${prometheusPoints} pts + Lifetime Membership!`
                : `✅ Claimed ${airBalance} AIR → ${prometheusPoints} Prometheus points.`,
        });

    } catch (error: any) {
        return NextResponse.json({ error: "Claim failed: " + error.message }, { status: 500 });
    }
}
