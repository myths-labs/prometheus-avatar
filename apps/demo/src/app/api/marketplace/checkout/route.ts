import { NextRequest, NextResponse } from "next/server";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

// Commission rates
const COMMISSION_RATES: Record<string, number> = {
    official: 0,
    human: 0.20,
    agent: 0.15,
    lobster: 0.10,
};

export async function POST(req: NextRequest) {
    try {
        const { assetId, assetName, price, creatorType, creatorStripeAccountId } = await req.json();

        if (!price || price <= 0) {
            return NextResponse.json({ error: "Invalid price" }, { status: 400 });
        }

        if (!STRIPE_SECRET_KEY) {
            return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
        }

        const commission = COMMISSION_RATES[creatorType] || 0.20;
        const platformFee = Math.round(price * commission * 100); // in cents
        const totalAmount = Math.round(price * 100); // in cents

        // Create Stripe Checkout Session
        const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                "mode": "payment",
                "success_url": `${process.env.NEXT_PUBLIC_APP_URL || "https://prometheus-avatar.vercel.app"}/marketplace/success?asset=${assetId}&session_id={CHECKOUT_SESSION_ID}`,
                "cancel_url": `${process.env.NEXT_PUBLIC_APP_URL || "https://prometheus-avatar.vercel.app"}/marketplace/cancel`,
                "line_items[0][price_data][currency]": "usd",
                "line_items[0][price_data][product_data][name]": assetName || "Marketplace Asset",
                "line_items[0][price_data][unit_amount]": totalAmount.toString(),
                "line_items[0][quantity]": "1",
                // Multi-payment: Card, Alipay, WeChat Pay
                "payment_method_types[0]": "card",
                "payment_method_types[1]": "alipay",
                "payment_method_types[2]": "wechat_pay",
                // WeChat Pay requires payment_method_options
                "payment_method_options[wechat_pay][client]": "web",
                // Store metadata for webhook
                "metadata[asset_id]": assetId,
                "metadata[creator_type]": creatorType,
                "metadata[commission_rate]": commission.toString(),
                "metadata[platform_fee_cents]": platformFee.toString(),
                ...(creatorStripeAccountId ? {
                    "payment_intent_data[application_fee_amount]": platformFee.toString(),
                    "payment_intent_data[transfer_data][destination]": creatorStripeAccountId,
                } : {}),
            }).toString(),
        });

        if (!response.ok) {
            const error = await response.json();
            console.error("[Stripe] Checkout error:", error);
            return NextResponse.json({ error: "Failed to create checkout" }, { status: 500 });
        }

        const session = await response.json();

        return NextResponse.json({
            checkoutUrl: session.url,
            sessionId: session.id,
            breakdown: {
                total: price,
                platformFee: price * commission,
                creatorPayout: price * (1 - commission),
            },
        });
    } catch (error: any) {
        console.error("[Stripe] Fatal:", error);
        return NextResponse.json({ error: error.message || "Checkout failed" }, { status: 500 });
    }
}
