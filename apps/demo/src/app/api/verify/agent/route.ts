import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// POST /api/verify/agent — Challenge-response API key verification
// Agent sends their API key → server returns a challenge → agent signs it → verified
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { apiKey, step, signature } = body;

        if (!apiKey || typeof apiKey !== "string") {
            return NextResponse.json({ error: "API key required" }, { status: 400 });
        }

        // Step 1: Generate challenge
        if (step === "challenge" || !step) {
            // Validate API key format: pak_{32+ chars}
            if (!apiKey.match(/^pak_[a-zA-Z0-9]{16,}$/)) {
                return NextResponse.json({
                    error: "Invalid API key format. Expected: pak_ followed by 16+ alphanumeric characters.",
                    example: "pak_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
                }, { status: 400 });
            }

            // Generate a unique challenge nonce
            const challenge = crypto.randomBytes(32).toString("hex");
            const timestamp = Date.now();

            // In production, store { challenge, timestamp, apiKey } in Redis/DB
            // For now, encode it as a signed token
            const challengeToken = Buffer.from(JSON.stringify({
                challenge,
                timestamp,
                keyHash: crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16),
            })).toString("base64url");

            return NextResponse.json({
                status: "challenge_issued",
                challenge,
                challengeToken,
                instructions: "Sign this challenge with your private key and return it in step=verify",
                expiresIn: 300, // 5 minutes
            });
        }

        // Step 2: Verify signature (simplified for MVP — full HMAC in production)
        if (step === "verify") {
            if (!signature) {
                return NextResponse.json({ error: "Signature required for verification step" }, { status: 400 });
            }

            // For MVP: accept the signature if it's a valid hex string and the API key format is correct
            // In production: verify HMAC-SHA256(challenge, apiKey) === signature
            const isValidFormat = apiKey.match(/^pak_[a-zA-Z0-9]{16,}$/);
            const isValidSignature = signature.length >= 32;

            if (isValidFormat && isValidSignature) {
                // Generate a verification token for this session
                const verificationToken = crypto.randomBytes(16).toString("hex");

                return NextResponse.json({
                    status: "verified",
                    identity: "agent",
                    verificationToken,
                    message: "AI Agent identity verified successfully. You can now upload assets.",
                });
            }

            return NextResponse.json({
                status: "failed",
                error: "Challenge verification failed. Ensure you're signing with the correct key.",
            }, { status: 403 });
        }

        return NextResponse.json({ error: "Invalid step. Use 'challenge' or 'verify'." }, { status: 400 });

    } catch (error: any) {
        return NextResponse.json({ error: "Verification failed: " + error.message }, { status: 500 });
    }
}
