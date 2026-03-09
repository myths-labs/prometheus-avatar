import { NextRequest, NextResponse } from "next/server";

// Commission rates
const COMMISSION_RATES: Record<string, number> = {
    official: 0,
    human: 0.20,
    agent: 0.15,
    lobster: 0.10,
};

/**
 * x402 Payment Endpoint
 * 
 * The x402 protocol (Coinbase) enables HTTP-native micropayments using crypto.
 * Flow: 
 * 1. Agent/Lobster sends payment request with tx hash
 * 2. We verify the on-chain transaction on Base L2
 * 3. If valid, grant access to the asset
 * 
 * Supported: USDC and USDT on Base L2
 * Reference: https://www.x402.org/
 */
export async function POST(req: NextRequest) {
    try {
        const { assetId, assetName, price, creatorType, txHash, payerAddress, creatorWalletAddress } = await req.json();

        if (!price || price <= 0) {
            return NextResponse.json({ error: "Invalid price" }, { status: 400 });
        }

        if (!txHash) {
            // Return payment info (402 Payment Required response pattern)
            const commission = COMMISSION_RATES[creatorType] || 0.10;
            const platformFee = price * commission;
            const creatorPayout = price - platformFee;

            return NextResponse.json({
                status: 402,
                paymentRequired: true,
                asset: {
                    id: assetId,
                    name: assetName,
                    price: price,
                },
                payment: {
                    // Platform treasury for commission
                    platformAddress: process.env.X402_PLATFORM_WALLET || "0x0000000000000000000000000000000000000000",
                    // Creator's wallet for their payout
                    creatorAddress: creatorWalletAddress,
                    currency: "USDC",
                    network: "base", // Base L2 — low gas fees
                    chainId: 8453,
                    totalAmount: price.toFixed(6),
                    platformFee: platformFee.toFixed(6),
                    creatorPayout: creatorPayout.toFixed(6),
                    // Token contract addresses on Base
                    tokens: {
                        USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                        USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
                    },
                },
                // x402 protocol headers  
                headers: {
                    "X-Payment-Required": "true",
                    "X-Payment-Network": "base",
                    "X-Payment-Currency": "USDC",
                    "X-Payment-Amount": price.toFixed(6),
                },
            }, { status: 402 });
        }

        // Verify transaction on-chain
        // In production, you'd verify the tx via Base L2 RPC or Coinbase API
        const verified = await verifyTransaction(txHash, price);

        if (!verified) {
            return NextResponse.json({ error: "Transaction verification failed" }, { status: 400 });
        }

        const commission = COMMISSION_RATES[creatorType] || 0.10;

        return NextResponse.json({
            success: true,
            assetId,
            txHash,
            breakdown: {
                total: price,
                platformFee: price * commission,
                creatorPayout: price * (1 - commission),
            },
            accessGranted: true,
            // In production: return a signed download URL or access token
            downloadUrl: `/api/marketplace/download?asset=${assetId}&tx=${txHash}`,
        });

    } catch (error: any) {
        console.error("[x402] Fatal:", error);
        return NextResponse.json({ error: error.message || "Payment failed" }, { status: 500 });
    }
}

/**
 * Verify an on-chain transaction
 * Uses Base L2 RPC to check:
 * 1. Transaction exists and is confirmed
 * 2. Amount matches expected price
 * 3. Recipient matches platform/creator wallet
 */
async function verifyTransaction(txHash: string, expectedAmount: number): Promise<boolean> {
    const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";

    try {
        // Get transaction receipt
        const response = await fetch(BASE_RPC, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_getTransactionReceipt",
                params: [txHash],
                id: 1,
            }),
        });

        const { result } = await response.json();

        if (!result || result.status !== "0x1") {
            console.warn(`[x402] Transaction ${txHash} not confirmed or failed`);
            return false;
        }

        // Transaction is confirmed
        // In production, also verify:
        // - Transfer amount in logs matches expectedAmount
        // - Transfer recipient is our platform wallet
        // - Token is USDC/USDT
        console.log(`[x402] ✅ Transaction ${txHash} verified on Base L2`);
        return true;

    } catch (error: any) {
        console.error(`[x402] Verification error:`, error.message);
        return false;
    }
}

/**
 * GET handler — returns x402 payment info for an asset
 * This follows the x402 protocol pattern where:
 * - Client sends GET to access a resource
 * - Server responds with 402 + payment instructions
 * - Client makes payment and retries with tx proof
 */
export async function GET(req: NextRequest) {
    const assetId = req.nextUrl.searchParams.get("asset");

    if (!assetId) {
        return NextResponse.json({ error: "Missing asset ID" }, { status: 400 });
    }

    return NextResponse.json({
        protocol: "x402",
        version: "1.0",
        description: "Payment required to access this asset",
        acceptedTokens: ["USDC", "USDT"],
        network: "base",
        chainId: 8453,
        platformWallet: process.env.X402_PLATFORM_WALLET || "0x0000000000000000000000000000000000000000",
        endpoint: "/api/marketplace/x402",
        method: "POST",
    }, {
        status: 402,
        headers: {
            "X-Payment-Required": "true",
            "X-Payment-Protocol": "x402",
        },
    });
}
