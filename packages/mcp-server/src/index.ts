#!/usr/bin/env node
/**
 * Prometheus Avatar MCP Server (S068 · Phase 11 Day 3 — version lives in package.json only, see PKG_VERSION below)
 *
 * Model Context Protocol server that exposes 17 tools for AI agents
 * to interact with the Prometheus Avatar platform:
 *
 *   1. create_avatar       — Initialize an avatar instance
 *  1b. set_avatar_state    — Push companion state (thinking/acting/…) to live embeds
 *   2. equip_asset         — Equip a marketplace asset to an avatar
 *   3. generate_asset      — AI-generate a new asset (skin, voice, etc.)
 *  3b. update_asset        — Edit price / metadata of an existing asset
 *  3c. generate_image_pro  — AAA-quality image generation (NEW v0.3 · Phase 11)
 *   4. list_marketplace    — Browse available marketplace assets
 *   5. get_avatar_status   — Get current avatar state
 *   6. share_avatar        — Generate a shareable link for an avatar
 *   7. speak               — Make the avatar speak text with TTS
 *
 *  Workspace tools (workspace-tools.ts) — what the agent produces lands in the user's
 *  Prometheus workspace panes:
 *   8. save_work            — Save Markdown work output (Work pane)
 *   9. upsert_task          — Add or update a to-do (To-do pane)
 *  10. complete_task        — Mark a to-do done
 *  11. log_visited_page     — Record a page the agent visited (browse list)
 *  12-14. prometheus_read_workspace / prometheus_save_workspace_entry /
 *         prometheus_get_workspace_operation — low-level read, exact save, receipt lookup
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
import { createRequire } from "node:module";
import { registerWorkspaceTools } from "./workspace-tools.js";

// Read the version from package.json at runtime. It used to be typed in by
// hand in two places and both had drifted: serverInfo said 0.3.2 while the
// package was 0.3.3, and the User-Agent still said 0.1.0. Anyone probing the
// published server saw a version that did not match what they installed.
const PKG_VERSION: string = createRequire(import.meta.url)("../package.json").version;

const API_BASE = process.env.PROMETHEUS_API_URL || "https://prometheus.mythslabs.ai";
// What an avatar id may look like when it is put into a link or an HTML attribute.
const AVATAR_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const API_KEY = process.env.PROMETHEUS_API_KEY || "";

// ═══════════════════════════════════════════════════════════════
// Helper: API call wrapper
// ═══════════════════════════════════════════════════════════════

async function apiCall(path: string, method: string = "GET", body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": `PrometheusAvatar-MCP/${PKG_VERSION}`,
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
    version: PKG_VERSION,
    description: "Give any AI agent an embodied 3D / 2.5D avatar + AAA image generation via MCP. Skins, voices, expressions, motions, scenes, plus pro-grade image creation for marketplace and social.",
});

// Count tool registrations so the startup banner reports the real number of
// tools instead of a hand-maintained constant that silently drifts out of sync
// (this banner once printed "7 tools" while 9 were registered). Every tool
// below is registered through this wrapper instead of calling server.tool
// directly, so the count can never be wrong again.
let toolCount = 0;
const registerTool = ((...args: unknown[]) => {
    toolCount++;
    return (server.tool as (...a: unknown[]) => unknown).apply(server, args);
}) as typeof server.tool;

// ═══════════════════════════════════════════════════════════════
// Tool 1: create_avatar
// ═══════════════════════════════════════════════════════════════

registerTool(
    "create_avatar",
    "Create a new Prometheus Avatar instance. Returns an avatar ID and embed URL that can be used in a browser.",
    {
        name: z.string().optional().describe("Display name for the avatar (default: 'My Avatar')"),
        model: z.string().optional().describe("Model ID or URL. Available: 'haru' (default), 'koharu', or a full model3.json URL"),
        voice: z.string().optional().describe("Voice name for TTS. Options: Kore, Aoede, Leda, Despina, Puck, Charon, Fenrir, Zephyr"),
        persona: z.string().optional().describe("Custom system prompt / personality for the avatar's conversation style"),
    },
    async ({ name, model, voice, persona }) => {
        if (!API_KEY) {
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: "PROMETHEUS_API_KEY required",
                        instructions: "Creating an avatar persists it to your Prometheus account and returns a live, renderable embed URL. Set the PROMETHEUS_API_KEY environment variable to a Prometheus agent API key (pak_...). Get one at https://prometheus.mythslabs.ai/settings/agent-keys (sign in with Google/GitHub, click Generate key — shown once).",
                    }, null, 2),
                }],
                isError: true,
            };
        }

        try {
            // Persist the avatar to the account so it renders. POST /api/agent/avatar
            // upserts the account's avatar and returns a real /embed/<id> URL.
            const result = await apiCall("/api/agent/avatar", "POST", {
                ...(model ? { model } : {}),
                ...(voice ? { voice } : {}),
                ...(persona ? { persona } : {}),
            }) as {
                avatarId: string;
                model: string;
                modelUrl: string;
                voice: string;
                persona: string | null;
                embedUrl: string;
                availableModels?: string[];
                availableVoices?: string[];
            };

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        avatar_id: result.avatarId,
                        name: name || "My Avatar",
                        model: result.model,
                        voice: result.voice,
                        persona: result.persona,
                        embed_url: result.embedUrl,
                        instructions: `Avatar is live. Open embed_url in a browser (or embed it as an <iframe src="${result.embedUrl}">) to see it render. Use 'speak' to generate speech, 'equip_asset' to customize it, or 'share_avatar' for a shareable link.`,
                    }, null, 2),
                }],
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Error creating avatar: ${errMsg}` }],
                isError: true,
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 1.5: set_avatar_state (S304-A1 batch 2)
// ═══════════════════════════════════════════════════════════════

registerTool(
    "set_avatar_state",
    "Push a companion task state (or a direct emotion) onto your avatar. Any ALREADY-OPEN embed page follows within ~3 seconds — the avatar's expression and motion change live. Use this to make the avatar accompany real work: set 'listening' when waiting for user input, 'thinking' while working, 'acting' while executing, 'done' on completion.",
    {
        state: z.enum(["listening", "thinking", "acting", "done"]).optional()
            .describe("Agent task state. listening: attentive idle · thinking: pondering · acting: focused work · done: celebrate"),
        emotion: z.enum(["happy", "sad", "angry", "surprised", "thinking", "neutral"]).optional()
            .describe("Direct emotion override (takes effect when no state is given, or alongside it)"),
    },
    async ({ state, emotion }) => {
        if (!API_KEY) {
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: "PROMETHEUS_API_KEY required",
                        instructions: "Set the PROMETHEUS_API_KEY environment variable to a Prometheus agent API key (pak_...). Get one at https://prometheus.mythslabs.ai/settings/agent-keys (sign in with Google/GitHub, click Generate key — shown once).",
                    }, null, 2),
                }],
                isError: true,
            };
        }
        if (!state && !emotion) {
            return {
                content: [{ type: "text" as const, text: "Provide state and/or emotion." }],
                isError: true,
            };
        }
        try {
            const result = await apiCall("/api/agent/avatar/state", "POST", {
                ...(state ? { state } : {}),
                ...(emotion ? { emotion } : {}),
            }) as { avatarId: string; companionState: Record<string, string> };
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        avatar_id: result.avatarId,
                        companion_state: result.companionState,
                        instructions: "Open embed pages for this avatar pick the state up within ~3 seconds.",
                    }, null, 2),
                }],
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Error setting avatar state: ${errMsg}` }],
                isError: true,
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 2: equip_asset
// ═══════════════════════════════════════════════════════════════

registerTool(
    "equip_asset",
    "Equip a marketplace asset to the avatar. Changes the avatar's skin, voice, expression, accessories, scene, or persona.",
    {
        asset_id: z.string().describe("The asset ID from the marketplace (UUID format)"),
        action: z.enum(["equip", "unequip"]).optional().describe("Action to perform (default: 'equip'). NOTE: 'unequip' is NOT supported for agent accounts yet and always fails — to swap, equip another asset of the same category and it replaces the current one."),
    },
    async ({ asset_id, action }) => {
        try {
            if (!API_KEY) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            error: "PROMETHEUS_API_KEY required",
                            instructions: "Set the PROMETHEUS_API_KEY environment variable to a Prometheus agent API key (pak_...). Get one at https://prometheus.mythslabs.ai/settings/agent-keys (sign in with Google/GitHub, click Generate key — shown once).",
                        }, null, 2),
                    }],
                    isError: true,
                };
            }

            // The agent equip route has no unequip operation. Say so instead of
            // silently calling a human-only route that 403s every agent key.
            if (action === "unequip") {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            error: "unequip is not supported for agent accounts yet",
                            instructions: "Equipping another asset of the same category replaces the current one, which covers most swap use-cases.",
                        }, null, 2),
                    }],
                    isError: true,
                };
            }

            // Agent-key route. The previous target (/api/user/inventory) is
            // human-session-only and rejects every agent key with 403.
            const result = await apiCall("/api/agent/equip", "POST", {
                assetId: asset_id,
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

registerTool(
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
        api_key: z.string().optional().describe("API key for generation (or set GEMINI_API_KEY env var)"),
    },
    async ({ category, prompt, name, price, price_points, auto_deploy, api_key }) => {
        try {
            const apiKey = api_key || process.env.GEMINI_API_KEY;
            if (!apiKey) {
                return {
                    content: [{
                        type: "text" as const,
                        text: "Error: API key required. Pass api_key parameter or set GEMINI_API_KEY environment variable.",
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

registerTool(
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
// Tool 3c: generate_image_pro  (Phase 11 Day 3 · v0.3.0)
// ═══════════════════════════════════════════════════════════════

registerTool(
    "generate_image_pro",
    "AAA-quality image generation via Prometheus image engine. Use for skin preview cards, XHS / social carousels, posters, UI mocks, game-store-tier character art. Supports BYOK, Free quota, or Pro Credits. Returns image URL (data URL or Supabase public URL when upload=true).",
    {
        prompt: z.string().min(8).describe("Image prompt. Recommend ≥100 words with explicit AAA benchmark named (e.g. 'Genshin Impact / Overwatch shop preview tier · 3D cel-shaded engine render · NOT flat 2D illustration · clean studio backdrop · slight elevated 3/4 hero pose'). Twin Prompt-Is-The-Ceiling rule applies — long detailed prompts produce AAA results, lazy short prompts produce mediocre output."),
        style: z.enum(["anime", "cel-shade", "cyberpunk", "kawaii", "fantasy", "cartoon", "realistic", "photorealistic", "pixar"]).optional().describe("Style preset prepended to prompt server-side. Maps to Forge UI 7-style picker."),
        task: z.enum(["aaa_skin", "character", "scene", "accessory", "poster", "ui_mock", "game_ui", "thumbnail", "auxiliary", "batch_variants", "complex_text"]).optional().describe("Task type — drives internal generation routing per task. Default: 'character'."),
        size: z.enum(["1024x1024", "1024x1536", "1536x1024", "auto"]).optional().describe("Output dimensions. Default: 1024x1024. Use 1024x1536 for vertical XHS / 9:16 social, 1536x1024 for X / LinkedIn / 16:9."),
        quality: z.enum(["low", "medium", "high", "auto"]).optional().describe("Quality tier — affects cost ($0.02 low → $0.07-0.19 high). Default: 'high'."),
        numVariants: z.number().min(1).max(4).optional().describe("Variants 1-4. Default: 1."),
        reference_images: z.array(z.string()).optional().describe("Reference image URLs (data URL or https://) for character consistency chain. e.g. pass slide 1 as ref when generating slide 2."),
        provider: z.enum(["openai", "gemini", "gemini-flash"]).optional().describe("Override provider. Default: server picks per task."),
        api_key: z.string().optional().describe("BYOK — your own image-provider API key. Bypasses platform billing."),
        upload: z.boolean().optional().describe("Upload to Supabase Storage and return publicUrl. Default: false (return data URL only)."),
    },
    async ({ prompt, style, task, size, quality, numVariants, reference_images, provider, api_key, upload }) => {
        try {
            const result = await apiCall("/api/creator/generate-image-pro", "POST", {
                prompt,
                style,
                task: task || "character",
                size: size || "1024x1024",
                quality: quality || "high",
                numVariants: numVariants || 1,
                referenceImages: reference_images,
                provider,
                apiKey: api_key,
                upload: upload ?? false,
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
// Tool 4: list_marketplace
// ═══════════════════════════════════════════════════════════════

registerTool(
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

registerTool(
    "get_avatar_status",
    "Get the current status and equipped assets of the avatar.",
    {},
    async () => {
        try {
            if (!API_KEY) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            error: "PROMETHEUS_API_KEY required",
                            instructions: "Set the PROMETHEUS_API_KEY environment variable to a Prometheus agent API key (pak_...). Get one at https://prometheus.mythslabs.ai/settings/agent-keys (sign in with Google/GitHub, click Generate key — shown once).",
                        }, null, 2),
                    }],
                    isError: true,
                };
            }

            // Agent-key route: returns the account avatar, its equipped assets and
            // embed URL. The previous target (/api/user/inventory) is
            // human-session-only and rejects every agent key with 403.
            const result = await apiCall("/api/agent/avatar", "GET");

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

registerTool(
    "share_avatar",
    "Generate a shareable link and iframe embed code for an avatar. The link opens the interactive avatar page.",
    {
        avatar_id: z.string().optional().describe("Avatar ID from create_avatar: 1-64 letters, digits, \"_\" or \"-\". If omitted, uses the account's current avatar (requires PROMETHEUS_API_KEY)."),
        referral_code: z.string().optional().describe("Referral code appended to the share link for tracking."),
    },
    async ({ avatar_id, referral_code }) => {
        try {
            let avatarId = avatar_id;

            // Resolve the account's current avatar if no id was supplied. An empty string is not "no id": it is refused below.
            if (avatarId === undefined) {
                if (!API_KEY) {
                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({
                                success: false,
                                error: "avatar_id required",
                                instructions: "Pass avatar_id (returned by create_avatar), or set PROMETHEUS_API_KEY so the account's current avatar can be looked up.",
                            }, null, 2),
                        }],
                        isError: true,
                    };
                }
                const current = await apiCall("/api/agent/avatar", "GET") as { avatarId?: string };
                avatarId = current.avatarId;
            }

            if (typeof avatarId !== "string") {
                return {
                    content: [{ type: "text" as const, text: "Error: no avatar found. Create one first with create_avatar." }],
                    isError: true,
                };
            }

            // The id becomes a path segment of the link and the src of an HTML attribute, so it must be a plain id, whether the
            // caller passed it or the website returned it. The refused value is not echoed back.
            if (!AVATAR_ID_PATTERN.test(avatarId)) {
                return {
                    content: [{ type: "text" as const, text: "Error: avatar_id must be 1-64 characters, only letters, digits, \"_\" or \"-\" (use the id create_avatar returned, or leave avatar_id out to use the account's current avatar). No link was made." }],
                    isError: true,
                };
            }

            // The link carries the referral code and nothing else. Text in a link must not be something the embed
            // page speaks when someone opens it, so share_avatar takes no message and sets no speak parameter.
            const qp = new URLSearchParams();
            if (referral_code) qp.set("ref", referral_code);
            const query = qp.toString() ? `?${qp.toString()}` : "";
            const shareUrl = `${API_BASE}/embed/${avatarId}${query}`;
            const embedHtml = `<iframe src="${shareUrl}" width="400" height="600" style="border:none;border-radius:16px;" allow="microphone"></iframe>`;

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        avatar_id: avatarId,
                        share_url: shareUrl,
                        embed_url: shareUrl,
                        embed_html: embedHtml,
                        instructions: "Share share_url (renders the interactive avatar), or embed embed_html in any webpage. Opening the link only shows the avatar; it does not speak by itself. A page that embeds it can make the avatar speak by posting { type: 'prometheus:speak', text } to the iframe from its own code, after the iframe has posted { type: 'prometheus:loaded' }; a speak message sent earlier is not kept.",
                    }, null, 2),
                }],
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Error sharing avatar: ${errMsg}` }],
                isError: true,
            };
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// Tool 7: speak
// ═══════════════════════════════════════════════════════════════

registerTool(
    "speak",
    "Synthesize text to speech in the avatar's voice and return the audio (base64 WAV) for your client to play. It does not make an open embed speak; for that, post prometheus:speak to the embed iframe after it has posted prometheus:loaded. Supports emotion detection.",
    {
        text: z.string().describe("Text for the avatar to speak aloud"),
        voice: z.string().optional().describe("Voice override: Kore (warm female), Puck (energetic male), Charon (deep male), Zephyr (neutral)"),
        emotion: z.string().optional().describe("Force emotion: happy, sad, angry, surprised, neutral"),
    },
    async ({ text, voice, emotion }) => {
        if (!API_KEY) {
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: "PROMETHEUS_API_KEY required",
                        instructions: "Set PROMETHEUS_API_KEY (a pak_... agent API key) to synthesize speech. Get one at https://prometheus.mythslabs.ai/settings/agent-keys (sign in with Google/GitHub, click Generate key — shown once).",
                    }, null, 2),
                }],
                isError: true,
            };
        }

        try {
            // Generate TTS audio via the agent-authenticated speech endpoint.
            const result = await apiCall("/api/agent/speak", "POST", {
                text,
                ...(voice ? { voice } : {}),
                format: "base64",
            }) as { audio?: string; mimeType?: string; voice?: string; textLength?: number };

            const audioBytes = result.audio ? Math.floor((result.audio.length * 3) / 4) : 0;

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        text,
                        voice: result.voice || voice || "Kore",
                        emotion: emotion || "auto-detected",
                        audio_generated: !!result.audio,
                        audio_format: result.mimeType || "audio/wav",
                        audio_bytes: audioBytes,
                        instructions: "Speech audio (base64 WAV) was generated. Play it in your client, or — to see an avatar lip-sync it in a browser — open the avatar's embed URL and, from the parent window, post a { type: 'prometheus:speak', text } message to the iframe after the iframe has posted { type: 'prometheus:loaded' }.",
                    }, null, 2),
                }],
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Error generating speech: ${errMsg}` }],
                isError: true,
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
- **3D / 2.5D Avatars**: High-fidelity animated avatar rendering
- **Multi-LLM TTS**: Text-to-speech with 12+ voices
- **Real-time Lip Sync**: Audio-driven mouth animation
- **Emotion Detection**: Automatic expression from text sentiment
- **9 Asset Categories**: Skins, Voices, Effects, Motions, Personas, Accessories, Expressions, Scenes, Bundles
- **AI Asset Generation**: Create custom assets from text prompts (requires \`GEMINI_API_KEY\`)
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
    // Workspace tools are built lazily inside, so a bad PROMETHEUS_API_URL cannot stop the other tools from starting.
    toolCount += registerWorkspaceTools(server, API_BASE, API_KEY, PKG_VERSION);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[Prometheus MCP] Server started — ${toolCount} tools available`);
}

main().catch((error) => {
    console.error("[Prometheus MCP] Fatal error:", error);
    process.exit(1);
});
