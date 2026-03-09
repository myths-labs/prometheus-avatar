import { NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Force dynamic — each request needs a fresh ephemeral token
export const dynamic = "force-dynamic";

export async function GET() {
    if (!GEMINI_API_KEY) {
        return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    try {
        const ai = new GoogleGenAI({
            apiKey: GEMINI_API_KEY,
            httpOptions: { apiVersion: "v1beta" },
        });

        const token = await ai.authTokens.create({
            config: {
                uses: 1,
                expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                liveConnectConstraints: {
                    model: "gemini-2.0-flash-live-001",
                    config: {
                        responseModalities: [Modality.AUDIO],
                    },
                },
            },
        });

        console.log("[Live Token] ✅ Ephemeral token created");
        return NextResponse.json({ token: token.name });
    } catch (error: any) {
        console.error("[Live Token] Error:", error.message || error);
        return NextResponse.json(
            { error: error.message || "Failed to create token" },
            { status: 500 }
        );
    }
}
