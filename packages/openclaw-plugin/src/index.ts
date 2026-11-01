/**
 * Prometheus Avatar Plugin for OpenClaw
 *
 * Bridges OpenClaw agent events → Prometheus Avatar SDK
 * When your agent speaks, the avatar speaks too.
 *
 * Installation: openclaw plugins install prometheus-avatar
 */

import { createAvatar, PrometheusAvatar, AssetCreator, EmotionAnalyzer, connectEmbed } from '@prometheusavatar/core';
import type { PrometheusConfig, AssetDeployConfig, EmbedBridge, EmbedFallbackReason, EmbedHostWindowLike } from '@prometheusavatar/core';

/** Where Prometheus is hosted: the creator API and the hosted avatar pages. */
const PROMETHEUS_ORIGIN = 'https://prometheus.mythslabs.ai';

/** What a hosted avatar id looks like. Anything else is refused, so no path or query can be added to the page address. */
const HOSTED_AVATAR_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface OpenClawPluginConfig {
    /** Id of a hosted avatar made with a Prometheus agent key. Shown when `apiKey` is set too and `modelUrl` is not. */
    avatarId?: string;
    /** URL of a 2D model file (.model3.json) to draw in the page. Wins over `avatarId`. */
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

    // Resolve the agent API key: plugin config first, then env var (Node only).
    // AssetCreator attaches it as `Authorization: Bearer <key>` — without it the
    // live marketplace deploy gate returns 401. It also tells the plugin whether this
    // is a Prometheus agent setup (see the hosted avatar below).
    const configuredApiKey = config.apiKey
        ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PROMETHEUS_API_KEY;

    // ═══ Register Creator Tools (headless-safe) ═══
    // Registered BEFORE any rendering concern: a Node/headless OpenClaw agent
    // has no DOM container, and the old order (container guard first) silently
    // dropped all creator tools in exactly the environment agents run in.
    if (context.registerTool) {
        const creator = new AssetCreator(PROMETHEUS_ORIGIN, configuredApiKey);
        // Capability probe: cores older than 0.11.3 have a one-arg constructor, so
        // plain JS silently drops the key argument and every deploy 401s with a
        // misleading "missing key" message even though the user configured one.
        // 0.11.3+ always sets an `apiKey` own-property (even when empty).
        const coreCarriesApiKey = Object.prototype.hasOwnProperty.call(creator, "apiKey");

        context.registerTool(
            "prometheus_generate_thumbnail",
            "Generate an eye-catching thumbnail image for a marketplace asset (character, voice, motion, persona, backdrop).",
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
            "Instantly deploy a new asset to the Prometheus Marketplace. Use this when you have created a new skin, voice, scene, motion, expression, accessory, effect, or persona. A persona needs its prompt in persona_config (or a persona JSON file as fileData); the public description is never the prompt. A motion needs source (original or licensed_resale) and body_type; library clips without resale rights cannot be listed.",
            {
                type: "object",
                properties: {
                    name: { type: "string" },
                    category: { type: "string", enum: ['skins', 'voices', 'effects', 'motions', 'accessories', 'scenes', 'personas', 'expressions'] },
                    description: { type: "string", description: "Public listing text. For a persona it is shown to buyers and is not the prompt." },
                    price: { type: "number" },
                    persona_config: { type: "object", description: "Personas only: the private persona config, e.g. { systemPrompt, greeting, traits }. Required unless fileData is a persona JSON file that carries it." },
                    source: { type: "string", enum: ["original", "licensed_resale"], description: "Motions only (required): original = you made it; licensed_resale = your licence allows reselling it on its own. Library clips without resale rights cannot be listed." },
                    body_type: { type: "string", description: "Motions only: the body type the motion is made for, e.g. humanoid." },
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
                    tags: args.tags,
                    ...(args.persona_config && typeof args.persona_config === 'object' ? { persona_config: args.persona_config } : {}),
                    ...(typeof args.source === 'string' ? { source: args.source } : {}),
                    ...(typeof args.body_type === 'string' ? { body_type: args.body_type } : {}),
                } as AssetDeployConfig;
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

    if (!container) {
        console.warn('[Prometheus Plugin] No container provided. Avatar will not render; creator tools remain available.');
        return;
    }

    // The plugin draws the 2D model file that `modelUrl` points at. It ships no model of its own: the sample it used to
    // fall back to was never part of the package, so that path could only 404. Without `modelUrl`, an agent setup (a
    // Prometheus agent key plus the id of a hosted avatar) shows that hosted avatar in a frame instead. Anything else:
    // say what to set and leave the creator tools running.
    const modelUrl = typeof config.modelUrl === 'string' ? config.modelUrl.trim() : '';
    const avatarId = typeof config.avatarId === 'string' ? config.avatarId.trim() : '';
    const hasAgentKey = typeof configuredApiKey === 'string' && configuredApiKey.trim().length > 0;

    if (!modelUrl) {
        if (avatarId && hasAgentKey) {
            return showHostedAvatar({ container, avatarId, config, on, emit });
        }
        if (avatarId) {
            console.error(
                '[Prometheus Plugin] No avatar is shown: "avatarId" needs a Prometheus agent key to show the hosted avatar. '
                + 'Set "apiKey" (pak_...) in the plugin config (openclaw.config.json) or the PROMETHEUS_API_KEY environment variable, '
                + 'or set "modelUrl" to the URL of a 2D model file (.model3.json). '
                + 'The creator tools keep working without it.'
            );
            return;
        }
        console.error(
            '[Prometheus Plugin] No avatar is shown because "modelUrl" is not set. '
            + 'Set "modelUrl" in the plugin config (openclaw.config.json) to the URL of a 2D model file (.model3.json), '
            + 'for example "modelUrl": "https://your-cdn.example/models/your-model.model3.json". '
            + 'To show a hosted avatar instead, set "avatarId" (the id of an avatar made with your Prometheus agent key) together with "apiKey". '
            + 'The creator tools keep working without it.'
        );
        return;
    }
    if (avatarId && hasAgentKey) {
        console.log('[Prometheus Plugin] "modelUrl" is set, so the 2D model file is drawn and "avatarId" is not used.');
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

/**
 * Show a hosted avatar: frame its page and drive its expression through core's embed bridge.
 *
 * What is sent to the page is expression only (`prometheus:emotion`). The plugin never makes the hosted avatar speak:
 * the page address carries no query string, so no greeting is requested at load, and no speak message is ever sent.
 * The agent key is never put into the page address or any message.
 */
function showHostedAvatar(args: {
    container: HTMLElement;
    avatarId: string;
    config: OpenClawPluginConfig;
    on: (event: string, handler: (e: OpenClawEvent) => void) => void;
    emit: (event: string, data: unknown) => void;
}): (() => void) | undefined {
    const { container, avatarId, config, on, emit } = args;

    if (!HOSTED_AVATAR_ID.test(avatarId)) {
        console.error(
            '[Prometheus Plugin] No avatar is shown: "avatarId" must be the id of a hosted avatar '
            + '(letters, digits, "-" and "_" only, up to 64 characters). '
            + 'The creator tools keep working without it.'
        );
        return undefined;
    }

    const doc = container.ownerDocument as Document | undefined;
    if (!doc || typeof doc.createElement !== 'function' || typeof container.appendChild !== 'function') {
        console.error('[Prometheus Plugin] No avatar is shown: the container cannot hold a frame for the hosted avatar. The creator tools keep working.');
        return undefined;
    }

    const frame = doc.createElement('iframe');
    frame.title = 'Prometheus avatar';
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = '0';
    frame.style.background = 'transparent';
    frame.src = `${PROMETHEUS_ORIGIN}/embed/${avatarId}`;
    container.appendChild(frame);

    let embed: EmbedBridge;
    try {
        embed = connectEmbed(frame, {
            origin: PROMETHEUS_ORIGIN,
            avatarId,
            hostWindow: (doc.defaultView ?? undefined) as unknown as EmbedHostWindowLike | undefined,
            onLoaded: () => emit('avatar:ready', { avatarId }),
            onFallback: (reason: EmbedFallbackReason) => {
                console.warn(
                    reason === 'ready-timeout'
                        ? '[Prometheus Plugin] The hosted avatar page did not report that it is listening; sending the queued expression anyway. Check the network connection and that "avatarId" is correct.'
                        : '[Prometheus Plugin] The hosted avatar page did not report that the avatar loaded. Check that "avatarId" is the id of an avatar made with your Prometheus agent key.'
                );
            },
        });
    } catch (error) {
        frame.remove();
        console.error('[Prometheus Plugin] Failed to connect to the hosted avatar:', error);
        return undefined;
    }

    const analyzer = new EmotionAnalyzer();

    on('agent:message', (event: OpenClawEvent) => {
        const text = event.data?.text;
        if (!text) return;
        if (config.enableEmotion !== false) {
            embed.setEmotion(analyzer.analyze(text).emotion);
        }
    });

    on('agent:thinking', () => {
        embed.setEmotion('thinking');
    });

    on('agent:error', () => {
        embed.setEmotion('surprised');
    });

    return () => {
        embed.destroy();
        frame.remove();
    };
}
