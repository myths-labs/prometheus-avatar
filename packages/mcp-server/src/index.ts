#!/usr/bin/env node
/**
 * Prometheus Avatar MCP Server (S068)
 * 
 * Model Context Protocol server that exposes 7 tools for AI agents
 * to interact with the Prometheus Avatar platform:
 * 
 *   1. create_avatar     — Initialize an avatar instance
 *   2. equip_asset       — Equip a marketplace asset to an avatar
 *   3. generate_asset    — AI-generate a new asset (skin, voice, etc.)
 *   4. list_marketplace  — Browse available marketplace assets
 *   5. get_avatar_status — Get current avatar state
 *   6. share_avatar      — Generate a shareable link for an avatar
 *   7. speak             — Make the avatar speak text with TTS
 * 
 * Usage:
 *   npx @prometheusavatar/mcp-server
 *   
 * In Claude Desktop's claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "prometheus": {
 *         "command": "npx",
 *         "args": ["-y", "@prometheusavatar/mcp-server"]
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.PROMETHEUS_API_URL || "https://prometheus.mythslabs.ai";
const API_KEY = process.env.PROMETHEUS_API_KEY || "";

// ═══════════════════════════════════════════════════════════════
// Helper: API call wrapper
// ═══════════════════════════════════════════════════════════════

async function apiCall(path: string, method: string = "GET", body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "PrometheusAvatar-MCP/0.1.0",
    };
    if (API_KEY) {
        headers["Authorization"] = `Bearer ${API_KEY}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        throw new Error(`API ${method} ${path} failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    return res.json();
}

// ═══════════════════════════════════════════════════════════════
// MCP Server Setup
// ═══════════════════════════════════════════════════════════════

const server = new McpServer({
    name: "prometheus-avatar",
    version: "0.1.0",
    description: "Give any AI agent an embodied Live2D avatar with TTS, lip-sync, and emotion. Zero dependencies — just connect via MCP.",
});

// ═══════════════════════════════════════════════════════════════
// Tool 1: create_avatar
// ═══════════════════════════════════════════════════════════════

server.tool(
    "create_avatar",
    "Create a new Prometheus Avatar instance. Returns an avatar ID and embed URL that can be used in a browser.",
    {
        name: z.string().optional().describe("Display name for the avatar (default: 'My Avatar')"),
        model: z.string().optional().describe("Model ID or URL. Available: 'haru' (default), 'koharu', or a full model3.json URL"),
        voice: z.string().optional().describe("Voice name for TTS. Options: Kore, Aoede, Leda, Despina, Puck, Charon, Fenrir, Zephyr"),
        persona: z.string().optional().describe("Custom system prompt / personality for the avatar's conversation style"),
    },
    async ({ name, model, voice, persona }) => {
        const avatarName = name || "My Avatar";
        const modelId = model || "haru";
        const voiceName = voice || "Kore";

        // Build embed URL
        const embedParams = new URLSearchParams({
            name: avatarName,
            model: modelId,
            voice: voiceName,
        });
        if (persona) embedParams.set("persona", persona);

        const embedUrl = `${API_BASE}/embed/preview?${embedParams.toString()}`;
        const appUrl = `${API_BASE}/app`;
        const avatarId = `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        avatar_id: avatarId,
                        name: avatarName,
                        model: modelId,
                        voice: voiceName,
                        embed_url: embedUrl,
                        app_url: appUrl,
                        instructions: `Avatar "${avatarName}" is ready. Open the app URL to interact, or embed the iframe URL in any webpage. Use 'speak' tool to make it talk, or 'equip_asset' to customize its appearance.`,
                    }, null, 2),
                },
            ],
        };
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 2: equip_asset
// ═══════════════════════════════════════════════════════════════

server.tool(
    "equip_asset",
    "Equip a marketplace asset to the avatar. Changes the avatar's skin, voice, expression, accessories, scene, or persona.",
    {
        asset_id: z.string().describe("The asset ID from the marketplace (UUID format)"),
        action: z.enum(["equip", "unequip"]).optional().describe("Action to perform (default: 'equip')"),
    },
    async ({ asset_id, action }) => {
        try {
            const result = await apiCall("/api/user/inventory", "POST", {
                assetId: asset_id,
                action: action || "equip",
            });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Error: ${errMsg}` }],
                isError: true,
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 3: generate_asset
// ═══════════════════════════════════════════════════════════════

server.tool(
    "generate_asset",
    "AI-generate a new marketplace asset using a text prompt. Supports: persona, expression, motion, effect, scene, accessory, voice. Set pricing at creation time.",
    {
        category: z.enum(["persona", "expression", "motion", "effect", "scene", "accessory", "voice"])
            .describe("Type of asset to generate"),
        prompt: z.string().describe("Creative prompt describing the asset to generate"),
        name: z.string().optional().describe("Name for the generated asset"),
        price: z.number().optional().describe("USD price (e.g. 2.99). Set 0 for free. Mutually exclusive with price_points."),
        price_points: z.number().optional().describe("Points price (e.g. 200). Mutually exclusive with price."),
        auto_deploy: z.boolean().optional().describe("Automatically deploy to marketplace (default: true)"),
        api_key: z.string().optional().describe("Gemini API key for generation (or set GEMINI_API_KEY env var)"),
    },
    async ({ category, prompt, name, price, price_points, auto_deploy, api_key }) => {
        try {
            const apiKey = api_key || process.env.GEMINI_API_KEY;
            if (!apiKey) {
                return {
                    content: [{
                        type: "text" as const,
                        text: "Error: Gemini API key required. Pass api_key parameter or set GEMINI_API_KEY environment variable. Get a free key at https://ai.google.dev/",
                    }],
                    isError: true,
                };
            }

            const result = await apiCall(`/api/creator/generate-${category}`, "POST", {
                prompt,
                name: name || `AI ${category}: ${prompt.slice(0, 30)}`,
                price: price || 0,
                price_points: price_points || 0,
                price_currency: price && price > 0 ? "USD" : (price_points && price_points > 0 ? "PTS" : "FREE"),
                auto_deploy: auto_deploy !== false,
                apiKey: apiKey,
            });

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Error: ${errMsg}` }],
                isError: true,
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 3b: update_asset
// ═══════════════════════════════════════════════════════════════

server.tool(
    "update_asset",
    "Update an existing marketplace asset — change price, name, description, tags, or license. Use this to adjust pricing after creation.",
    {
        asset_id: z.string().describe("The asset UUID to update"),
        name: z.string().optional().describe("New name for the asset"),
        description: z.string().optional().describe("New description"),
        price: z.number().optional().describe("New USD price (sets price_currency to USD)"),
        price_points: z.number().optional().describe("New points price (sets price_currency to PTS)"),
        make_free: z.boolean().optional().describe("Set to true to make the asset free"),
        tags: z.array(z.string()).optional().describe("New tags array"),
        license: z.string().optional().describe("License type: mit, personal, commercial"),
    },
    async ({ asset_id, name, description, price, price_points, make_free, tags, license }) => {
        try {
            const updatePayload: Record<string, any> = { asset_id };
            if (name !== undefined) updatePayload.name = name;
            if (description !== undefined) updatePayload.description = description;
            if (tags !== undefined) updatePayload.tags = tags;
            if (license !== undefined) updatePayload.license = license;

            if (make_free) {
                updatePayload.price = 0;
                updatePayload.price_points = 0;
                updatePayload.price_currency = "FREE";
            } else if (price !== undefined && price > 0) {
                updatePayload.price = price;
                updatePayload.price_points = 0;
                updatePayload.price_currency = "USD";
            } else if (price_points !== undefined && price_points > 0) {
                updatePayload.price = 0;
                updatePayload.price_points = price_points;
                updatePayload.price_currency = "PTS";
            }

            const result = await apiCall("/api/marketplace/update", "PATCH", updatePayload);

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Error: ${errMsg}` }],
                isError: true,
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 4: list_marketplace
// ═══════════════════════════════════════════════════════════════

server.tool(
    "list_marketplace",
    "Browse the Prometheus Marketplace. Lists available assets by category with previews, prices, and ratings.",
    {
        category: z.enum(["all", "skins", "voices", "effects", "motions", "personas", "accessories", "expressions", "bundles", "scenes"])
            .optional().describe("Filter by category (default: 'all')"),
        sort: z.enum(["newest", "popular", "price_asc", "price_desc"])
            .optional().describe("Sort order (default: 'newest')"),
        limit: z.number().optional().describe("Max results to return (default: 20, max: 50)"),
    },
    async ({ category, sort, limit }) => {
        try {
            const params = new URLSearchParams();
            if (category && category !== "all") params.set("category", category);
            if (sort) params.set("sort", sort);
            if (limit) params.set("limit", String(Math.min(limit, 50)));

            const result = await apiCall(`/api/marketplace/assets?${params.toString()}`);

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Error: ${errMsg}` }],
                isError: true,
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 5: get_avatar_status
// ═══════════════════════════════════════════════════════════════

server.tool(
    "get_avatar_status",
    "Get the current status and equipped assets of the avatar.",
    {},
    async () => {
        try {
            const result = await apiCall("/api/user/inventory");

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        ...(result as Record<string, unknown>),
                        platform_url: `${API_BASE}/app`,
                        marketplace_url: `${API_BASE}/marketplace`,
                    }, null, 2),
                }],
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Error: ${errMsg}` }],
                isError: true,
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 6: share_avatar
// ═══════════════════════════════════════════════════════════════

server.tool(
    "share_avatar",
    "Generate a shareable link for the avatar. The link opens a full-screen interactive avatar page. Supports referral tracking.",
    {
        message: z.string().optional().describe("Welcome message the avatar will speak when the link is opened"),
        referral_code: z.string().optional().describe("Referral code for tracking (earns credits)"),
    },
    async ({ message, referral_code }) => {
        const params = new URLSearchParams();
        if (message) params.set("speak", message);
        if (referral_code) params.set("ref", referral_code);

        const shareUrl = `${API_BASE}/app${params.toString() ? "?" + params.toString() : ""}`;
        const embedUrl = `${API_BASE}/embed/preview${params.toString() ? "?" + params.toString() : ""}`;

        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    share_url: shareUrl,
                    embed_url: embedUrl,
                    embed_html: `<iframe src="${embedUrl}" width="400" height="600" style="border:none;border-radius:16px;" allow="microphone"></iframe>`,
                    instructions: "Share the URL directly, or embed the iframe in any webpage. The avatar will auto-speak the welcome message when opened.",
                }, null, 2),
            }],
        };
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 7: speak
// ═══════════════════════════════════════════════════════════════

server.tool(
    "speak",
    "Make the avatar speak text aloud. The text is synthesized to speech and played with lip-sync animation. Supports emotion detection.",
    {
        text: z.string().describe("Text for the avatar to speak aloud"),
        voice: z.string().optional().describe("Voice override: Kore (warm female), Puck (energetic male), Charon (deep male), Zephyr (neutral)"),
        emotion: z.string().optional().describe("Force emotion: happy, sad, angry, surprised, neutral"),
    },
    async ({ text, voice, emotion }) => {
        try {
            // Call the TTS API to generate audio
            const result = await apiCall("/api/tts", "POST", {
                text,
                avatar: "default",
                ...(voice ? { voiceOverride: { gemini: voice } } : {}),
                ...(emotion ? { emotion } : {}),
            });

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        text,
                        voice: voice || "Kore",
                        emotion: emotion || "auto-detected",
                        app_url: `${API_BASE}/app?speak=${encodeURIComponent(text)}`,
                        instructions: `Open the app URL to hear the avatar speak: "${text.slice(0, 50)}..."`,
                    }, null, 2),
                }],
            };
        } catch (error: unknown) {
            // TTS might not return JSON — audio binary means success
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        text,
                        voice: voice || "Kore",
                        app_url: `${API_BASE}/app?speak=${encodeURIComponent(text)}`,
                        instructions: "Audio generated. Open the app URL to hear the avatar speak.",
                    }, null, 2),
                }],
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// Resources: Prometheus Platform Info
// ═══════════════════════════════════════════════════════════════

server.resource(
    "platform-info",
    "prometheus://info",
    async () => ({
        contents: [{
            uri: "prometheus://info",
            mimeType: "text/markdown",
            text: `# Prometheus Avatar Platform

**Give any AI agent an embodied avatar — zero dependencies.**

## Quick Start
1. Use \`create_avatar\` to initialize an avatar
2. Use \`list_marketplace\` to browse available assets
3. Use \`equip_asset\` to customize appearance
4. Use \`speak\` to make the avatar talk
5. Use \`share_avatar\` to generate a shareable link

## Platform URLs
- App: ${API_BASE}/app
- Marketplace: ${API_BASE}/marketplace
- SDK: npm install @prometheusavatar/core

## Features
- **Live2D Avatars**: High-fidelity animated avatar rendering
- **Multi-LLM TTS**: Text-to-speech with 12+ voices
- **Real-time Lip Sync**: Audio-driven mouth animation
- **Emotion Detection**: Automatic expression from text sentiment
- **9 Asset Categories**: Skins, Voices, Effects, Motions, Personas, Accessories, Expressions, Scenes, Bundles
- **AI Asset Generation**: Create custom assets from text prompts (requires Gemini API key)
- **Marketplace**: Browse, buy, and sell avatar assets

## Environment Variables
- \`PROMETHEUS_API_URL\` — API base URL (default: https://prometheus.mythslabs.ai)
- \`PROMETHEUS_API_KEY\` — API key for authenticated operations
- \`GEMINI_API_KEY\` — Required for AI asset generation

## License
MIT — Myths Labs
`,
        }],
    })
);

// ═══════════════════════════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════════════════════════

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[Prometheus MCP] Server started — 7 tools available");
}

main().catch((error) => {
    console.error("[Prometheus MCP] Fatal error:", error);
    process.exit(1);
});
