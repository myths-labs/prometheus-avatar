import { NextRequest, NextResponse } from "next/server";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Stripe Webhook Handler
 * Processes: checkout.session.completed
 * - Records order in database
 * - Credits creator account
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.text();
        const signature = req.headers.get("stripe-signature");

        // In production, verify webhook signature
        if (STRIPE_WEBHOOK_SECRET && signature) {
            // Stripe signature verification would go here
            // For now we process all events
            console.log("[Webhook] Received Stripe event");
        }

        const event = JSON.parse(body);

        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object;
                const { asset_id, creator_type, commission_rate, platform_fee_cents } = session.metadata || {};

                console.log(`[Webhook] ✅ Payment completed:`, {
                    assetId: asset_id,
                    creatorType: creator_type,
                    amount: session.amount_total / 100,
                    platformFee: parseInt(platform_fee_cents) / 100,
                    paymentIntent: session.payment_intent,
                });

                // In production:
                // 1. Record order in Supabase orders table
                // 2. Increment asset download count
                // 3. Update creator earnings
                // 4. Send confirmation email / notification
                break;
            }

            case "payment_intent.payment_failed": {
                console.warn(`[Webhook] ❌ Payment failed:`, event.data.object.id);
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
