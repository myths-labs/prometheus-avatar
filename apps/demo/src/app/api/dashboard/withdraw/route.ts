import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const MIN_WITHDRAWAL = 1000; // 1000 pts = $10 USDC

export async function POST(req: NextRequest) {
    try {
        const { amount, walletAddress, userId } = await req.json();

        if (!amount || amount < MIN_WITHDRAWAL) {
            return NextResponse.json({ error: `Minimum withdrawal: ${MIN_WITHDRAWAL} pts ($${(MIN_WITHDRAWAL * 0.01).toFixed(0)})` }, { status: 400 });
        }

        if (!walletAddress || !walletAddress.startsWith("0x") || walletAddress.length !== 42) {
            return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
        }

        // Get user's current balance
        const sessionUserId = userId; // TODO: derive from session cookie
        const { data: account } = await supabase
            .from("accounts")
            .select("points, user_id")
            .eq("user_id", sessionUserId)
            .single();

        if (!account || account.points < amount) {
            return NextResponse.json({
                error: `Insufficient balance. You have ${account?.points || 0} pts, trying to withdraw ${amount} pts.`,
            }, { status: 402 });
        }

        // Deduct points
        const { error: updateErr } = await supabase
            .from("accounts")
            .update({ points: account.points - amount })
            .eq("user_id", sessionUserId);

        if (updateErr) {
            return NextResponse.json({ error: "Failed to deduct points" }, { status: 500 });
        }

        // Record withdrawal request
        const usdcAmount = (amount * 0.01).toFixed(2);
        await supabase.from("withdrawal_requests").insert({
            user_id: sessionUserId,
            amount_points: amount,
            amount_usdc: parseFloat(usdcAmount),
            wallet_address: walletAddress,
            status: "pending", // pending → processing → completed
        });

        console.log(`[Withdrawal] 📤 ${sessionUserId} requested ${amount} pts → $${usdcAmount} USDC → ${walletAddress}`);

        return NextResponse.json({
            success: true,
            message: `Withdrawal request submitted: ${amount} pts → $${usdcAmount} USDC`,
            txDetails: {
                amount,
                usdcAmount,
                walletAddress,
                status: "pending",
                estimatedProcessing: "1-3 business days",
            },
        });

        // NOTE: Actual USDC transfer is processed by admin/treasury
        // either manually or via automated script checking pending withdrawals
    } catch (error: any) {
        console.error("[Withdrawal] Error:", error);
        return NextResponse.json({ error: error.message || "Withdrawal failed" }, { status: 500 });
    }
}
