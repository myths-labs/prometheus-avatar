/**
 * Prometheus Avatar Plugin for OpenClaw
 *
 * Bridges OpenClaw agent events → Prometheus Avatar SDK
 * When your agent speaks, the avatar speaks too.
 *
 * Installation: openclaw plugins install prometheus-avatar
 */

import { createAvatar, PrometheusAvatar, AssetCreator } from '@prometheusavatar/core';
import type { PrometheusConfig, AssetDeployConfig } from '@prometheusavatar/core';

interface OpenClawPluginConfig {
    avatarId?: string;
    modelUrl?: string;
    /** Prometheus agent API key (pak_...). Required for marketplace deploys — the live
     *  gate rejects unauthenticated writes. Falls back to PROMETHEUS_API_KEY env var. */
    apiKey?: string;
    ttsProvider?: string;
    ttsVoice?: string;
    enableLipSync?: boolean;
    enableEmotion?: boolean;
}

interface OpenClawEvent {
    type: string;
    data: {
        text?: string;
        role?: string;
        [key: string]: unknown;
    };
}

/**
 * OpenClaw Plugin entry point
 * Called by OpenClaw when the plugin is loaded
 */
export async function activate(context: {
    config: OpenClawPluginConfig;
    container?: HTMLElement;
    on: (event: string, handler: (e: OpenClawEvent) => void) => void;
    emit: (event: string, data: unknown) => void;
    registerTool?: (toolName: string, description: string, schema: any, handler: (args: any) => Promise<any>) => void;
}) {
    const { config, container, on, emit } = context;

    // ═══ Register Creator Tools (headless-safe) ═══
    // Registered BEFORE any rendering concern: a Node/headless OpenClaw agent
    // has no DOM container, and the old order (container guard first) silently
    // dropped all creator tools in exactly the environment agents run in.
    if (context.registerTool) {
        // Resolve the agent API key: plugin config first, then env var (Node only).
        // AssetCreator attaches it as `Authorization: Bearer <key>` — without it the
        // live marketplace deploy gate returns 401.
        const configuredApiKey = config.apiKey
            ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PROMETHEUS_API_KEY;
        const creator = new AssetCreator("https://prometheus.mythslabs.ai", configuredApiKey);
        // Capability probe: cores older than 0.11.3 have a one-arg constructor, so
        // plain JS silently drops the key argument and every deploy 401s with a
        // misleading "missing key" message even though the user configured one.
        // 0.11.3+ always sets an `apiKey` own-property (even when empty).
        const coreCarriesApiKey = Object.prototype.hasOwnProperty.call(creator, "apiKey");

        context.registerTool(
            "prometheus_generate_thumbnail",
            "Generate an eye-catching thumbnail image for a marketplace asset (Live2D, Voice, Backdrop).",
            {
                type: "object",
                properties: {
                    prompt: { type: "string", description: "Visual description of the image" },
                    negative_prompt: { type: "string" }
                },
                required: ["prompt"]
            },
            async (args) => {
                console.log("[Prometheus Plugin] Generating thumbnail...");
                const b64 = await creator.generateThumbnail({ prompt: args.prompt, negative_prompt: args.negative_prompt });
                return { success: true, base64Data: b64 };
            }
        );

        context.registerTool(
            "prometheus_deploy_asset",
            "Instantly deploy a new asset to the Prometheus Marketplace. Use this when you have created a new skin, voice, scene, motion, expression, accessory, effect, or persona.",
            {
                type: "object",
                properties: {
                    name: { type: "string" },
                    category: { type: "string", enum: ['skins', 'voices', 'effects', 'motions', 'accessories', 'scenes', 'personas', 'expressions'] },
                    description: { type: "string" },
                    price: { type: "number" },
                    fileData: { type: "string", description: "URL or Base64 string of the actual asset file" },
                    thumbnailData: { type: "string", description: "URL or Base64 string of the thumbnail (use generate_thumbnail first)" },
                    tags: { type: "array", items: { type: "string" } }
                },
                required: ["name", "category", "fileData"]
            },
            async (args) => {
                if (!configuredApiKey) {
                    return {
                        success: false,
                        error: "API key required",
                        instructions: "Set the `apiKey` plugin config (or the PROMETHEUS_API_KEY environment variable) to a Prometheus agent API key (pak_...). Get one at https://prometheus.mythslabs.ai/settings/agent-keys (sign in with Google/GitHub, click Generate key — shown once).",
                    };
                }
                if (!coreCarriesApiKey) {
                    return {
                        success: false,
                        error: "@prometheusavatar/core is too old for authenticated deploys",
                        instructions: "The installed @prometheusavatar/core predates 0.11.3, so it cannot attach your API key (the argument is silently dropped and deploys 401). Reinstall dependencies so core resolves to >=0.11.3, e.g. `rm -rf node_modules && npm install`.",
                    };
                }
                console.log(`[Prometheus Plugin] Deploying asset: ${args.name}...`);
                const config: AssetDeployConfig = {
                    name: args.name,
                    category: args.category as any,
                    description: args.description,
                    price: args.price,
                    tags: args.tags
                };
                return await creator.deployAsset(config, args.fileData, args.thumbnailData);
            }
        );

        // ═══ NEW v0.9 — Phase 11 Pro Image Generation ═══
        context.registerTool(
            "prometheus_generate_image_pro",
            "Generate AAA-quality images via Prometheus image engine. Use for skin preview cards, posters, UI mocks, or game-store-tier character art at Genshin Impact / Overwatch / WoW shop card quality. Supports BYOK, Free quota, or Pro Credits. Recommend ≥100-word prompts with explicit AAA benchmark named — Twin Prompt-Is-The-Ceiling rule (lazy short prompts produce mediocre output).",
            {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        description: "Image prompt. Recommend ≥100 words with explicit AAA benchmark (e.g. 'Genshin Impact / Overwatch shop preview tier · 3D cel-shaded engine render · NOT flat 2D illustration · clean studio backdrop · slight elevated 3/4 hero pose · production-ready')."
                    },
                    style: {
                        type: "string",
                        enum: ["anime", "cel-shade", "cyberpunk", "kawaii", "fantasy", "cartoon", "realistic", "photorealistic", "pixar"],
                        description: "Visual style preset prepended to prompt server-side."
                    },
                    taskType: {
                        type: "string",
                        enum: ["aaa_skin", "character", "scene", "accessory", "poster", "ui_mock", "game_ui", "thumbnail", "auxiliary", "batch_variants"],
                        description: "Routes to the optimal provider per task."
                    },
                    size: {
                        type: "string",
                        enum: ["1024x1024", "1024x1536", "1536x1024", "auto"],
                        description: "Default 1024x1024. Use 1024x1536 for vertical (XHS / 9:16). 1536x1024 for landscape (X / LinkedIn / 16:9)."
                    },
                    quality: {
                        type: "string",
                        enum: ["low", "medium", "high", "auto"],
                        description: "Default high. Cost: $0.02 low → $0.07-0.19 high (per image)."
                    },
                    numVariants: {
                        type: "number",
                        description: "1-4 variants. Default 1."
                    },
                    referenceImages: {
                        type: "array",
                        items: { type: "string" },
                        description: "Data URLs or HTTPS URLs · character consistency chain across multiple calls."
                    },
                    apiKey: {
                        type: "string",
                        description: "BYOK — your own image-provider API key. Bypasses platform billing (zero-marginal-cost flow)."
                    },
                    upload: {
                        type: "boolean",
                        description: "Upload to Supabase Storage and return publicUrl alongside data URL."
                    }
                },
                required: ["prompt"]
            },
            async (args) => {
                console.log(`[Prometheus Plugin] Generating ${args.taskType ?? 'character'} image (style: ${args.style ?? 'none'})...`);
                const result = await creator.createImage({
                    prompt: args.prompt,
                    style: args.style,
                    taskType: args.taskType,
                    size: args.size,
                    quality: args.quality,
                    numVariants: args.numVariants,
                    referenceImages: args.referenceImages,
                    apiKey: args.apiKey,
                    upload: args.upload,
                });
                return { success: true, ...result };
            }
        );
    }


    // Resolve model URL. avatarId → model-URL resolution has no live endpoint
    // (the old marketplace.prometheus-avatar.dev resolver never shipped, and no
    // /api/models route exists in production), so don't fabricate a URL that can
    // only 404 — warn and fall back to the default model instead.
    if (!config.modelUrl && config.avatarId) {
        console.warn('[Prometheus Plugin] avatarId-based model resolution is not available yet — pass modelUrl (a .model3.json URL) instead. Using the default model.');
    }
    const modelUrl = config.modelUrl || '/models/haru/haru_greeter_t03.model3.json'; // default

    if (!container) {
        console.warn('[Prometheus Plugin] No container provided. Avatar will not render; creator tools remain available.');
        return;
    }

    // Create avatar instance
    let avatar: PrometheusAvatar;

    try {
        avatar = await createAvatar({
            container,
            modelUrl,
            ttsOptions: {
                voice: config.ttsVoice,
            },
        });

        emit('avatar:ready', { modelUrl });
    } catch (error) {
        console.error('[Prometheus Plugin] Failed to initialize:', error);
        return;
    }

    // Listen for agent messages → drive avatar
    on('agent:message', async (event: OpenClawEvent) => {
        const text = event.data?.text;
        if (!text) return;

        try {
            // Process text for emotion (always)
            if (config.enableEmotion !== false) {
                avatar.processText(text);
            }

            // Speak the text (with TTS + lip sync)
            if (config.enableLipSync !== false) {
                await avatar.speak(text);
                emit('avatar:speak', { text });
            }
        } catch (error) {
            console.error('[Prometheus Plugin] Error processing message:', error);
        }
    });

    // Agent thinking → show thinking expression
    on('agent:thinking', () => {
        avatar.setEmotion('thinking');
    });

    // Agent error → show surprised expression
    on('agent:error', () => {
        avatar.setEmotion('surprised');
    });

    // Return cleanup function
    return () => {
        avatar.destroy();
    };
}
