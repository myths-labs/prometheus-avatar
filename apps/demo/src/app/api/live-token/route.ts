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
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

        const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const token = await ai.authTokens.create({
            config: {
                uses: 1,
                expireTime,
                liveConnectConstraints: {
                    model: "gemini-2.5-flash-native-audio-preview-12-2025",
                    config: {
                        sessionResumption: {},
                        temperature: 0.9,
                        responseModalities: [Modality.AUDIO],
                    },
                },
                httpOptions: { apiVersion: "v1alpha" },
            },
        });

        console.log("[Live Token] ✅ Ephemeral token created");

        return NextResponse.json({ token: token.name });
    } catch (error: any) {
        console.error("[Live Token] Error:", error.message);
        return NextResponse.json({ error: error.message || "Failed to create token" }, { status: 500 });
    }
}
