import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * AI Text-to-Texture — Generate Live2D clothing/skin textures from text descriptions
 * 
 * Inspired by NanoLive2D's text-to-texture pipeline.
 * Uses Gemini's image generation to create texture images.
 * 
 * Flow:
 * 1. Creator describes clothing: "red cheongsam with gold embroidery"
 * 2. API generates a texture-atlas-compatible image
 * 3. Image can be applied as a skin overlay on the Live2D model
 */

export async function POST(req: NextRequest) {
    try {
        if (!GEMINI_API_KEY) {
            return NextResponse.json(
                { error: "Gemini API key not configured" },
                { status: 500 }
            );
        }

        const { prompt, style, width, height } = await req.json();

        if (!prompt) {
            return NextResponse.json({ error: "Texture description (prompt) is required" }, { status: 400 });
        }

        console.log(`[TextureGen] Generating texture: "${prompt}"`);

        // Build the texture generation prompt
        const texturePrompt = [
            `Generate a flat 2D character clothing/skin texture for a Live2D avatar.`,
            `The texture should be:`,
            `- Flat, front-facing view (like a paper doll cutout)`,
            `- Clean edges with transparent/white background`,
            `- High detail, anime/game art style`,
            `- Suitable for overlaying on a Live2D character model`,
            style === "realistic" ? `- Photorealistic style` : `- Anime/illustration style`,
            ``,
            `Clothing/appearance description: ${prompt}`,
            ``,
            `Important: This is a TEXTURE for a 2D character, not a 3D render.`,
            `Keep it flat and suitable for 2D animation overlay.`,
        ].join("\n");

        // Use Gemini to generate the image
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: texturePrompt,
                        }],
                    }],
                    generationConfig: {
                        responseModalities: ["TEXT", "IMAGE"],
                    },
                }),
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[TextureGen] Gemini error:`, errText.slice(0, 300));
            return NextResponse.json(
                { error: `Image generation failed: ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();

        // Extract image from response
        const parts = data.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find((p: any) => p.inlineData);

        if (!imagePart) {
            // If no image generated, return text description
            const textPart = parts.find((p: any) => p.text);
            return NextResponse.json({
                success: false,
                message: textPart?.text || "Could not generate image. Try a more specific description.",
                suggestion: "Try: 'elegant blue kimono with cherry blossom pattern'",
            });
        }

        console.log(`[TextureGen] ✅ Texture generated for: "${prompt}"`);

        return NextResponse.json({
            success: true,
            image: {
                data: imagePart.inlineData.data,
                mimeType: imagePart.inlineData.mimeType || "image/png",
            },
            prompt,
            message: `Texture generated! Apply it to your avatar as a skin overlay.`,
        });

    } catch (error: any) {
        console.error("[TextureGen] Error:", error);
        return NextResponse.json(
            { error: error.message || "Texture generation failed" },
            { status: 500 }
        );
    }
}
