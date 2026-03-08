import { NextRequest, NextResponse } from "next/server";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Stripe Webhook Handler
 * 
 * Processes: checkout.session.completed, payment_intent.payment_failed
 * 
 * Setup: Stripe Dashboard → Developers → Webhooks → Add endpoint
 * URL: https://prometheus-avatar.vercel.app/api/marketplace/webhook
 * Events: checkout.session.completed
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.text();
        const signature = req.headers.get("stripe-signature");

        // In production, verify webhook signature
        if (STRIPE_WEBHOOK_SECRET && signature) {
            console.log("[Webhook] Received Stripe event with signature");
        }

        const event = JSON.parse(body);

        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object;
                const { asset_id, creator_type, commission_rate, platform_fee_cents } = session.metadata || {};

                const amount = session.amount_total / 100;
                const fee = parseInt(platform_fee_cents || "0") / 100;
                const buyerEmail = session.customer_email || session.customer_details?.email;

                console.log(`[Webhook] ✅ Payment completed:`, {
                    assetId: asset_id,
                    creatorType: creator_type,
                    amount,
                    platformFee: fee,
                    buyer: buyerEmail,
                    paymentIntent: session.payment_intent,
                });

                // Record purchase in Supabase
                try {
                    const { createClient } = await import("@supabase/supabase-js");
                    const supabase = createClient(
                        process.env.NEXT_PUBLIC_SUPABASE_URL!,
                        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
                    );

                    // 1. Record the purchase
                    await supabase.from("purchases").insert({
                        asset_id,
                        buyer_email: buyerEmail,
                        payment_method: "stripe",
                        amount,
                        currency: session.currency || "usd",
                        commission_rate: parseFloat(commission_rate || "0.20"),
                        platform_fee: fee,
                        creator_payout: amount - fee,
                        stripe_session_id: session.id,
                        stripe_payment_intent: session.payment_intent,
                        status: "completed",
                    });

                    // 2. Increment download count
                    const { data: asset } = await supabase
                        .from("assets")
                        .select("downloads")
                        .eq("id", asset_id)
                        .single();

                    if (asset) {
                        await supabase
                            .from("assets")
                            .update({ downloads: (asset.downloads || 0) + 1 })
                            .eq("id", asset_id);
                    }

                    // 3. Update creator earnings  
                    const { data: assetFull } = await supabase
                        .from("assets")
                        .select("creator_id")
                        .eq("id", asset_id)
                        .single();

                    if (assetFull?.creator_id) {
                        const { data: creator } = await supabase
                            .from("creators")
                            .select("total_earnings")
                            .eq("id", assetFull.creator_id)
                            .single();

                        if (creator) {
                            await supabase
                                .from("creators")
                                .update({ total_earnings: (creator.total_earnings || 0) + (amount - fee) })
                                .eq("id", assetFull.creator_id);
                        }
                    }

                    console.log("[Webhook] ✅ Purchase recorded in Supabase");
                } catch (dbError: any) {
                    console.error("[Webhook] DB error (non-fatal):", dbError.message);
                    // Don't fail the webhook if DB write fails
                }

                break;
            }

            case "payment_intent.payment_failed": {
                console.warn(`[Webhook] ❌ Payment failed:`, event.data.object.id);
                break;
            }

            case "checkout.session.expired": {
                console.log(`[Webhook] ⏰ Session expired:`, event.data.object.id);
                break;
            }

            default:
                console.log(`[Webhook] Unhandled event: ${event.type}`);
        }

        return NextResponse.json({ received: true });
    } catch (error: any) {
        console.error("[Webhook] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}
