/**
 * Prometheus Avatar Plugin for OpenClaw
 *
 * Bridges OpenClaw agent events → Prometheus Avatar SDK
 * When your agent speaks, the avatar speaks too.
 *
 * Installation: openclaw plugins install prometheus-avatar
 */

import { createAvatar, PrometheusAvatar, AssetCreator } from '@prometheus-avatar/core';
import type { PrometheusConfig, AssetDeployConfig } from '@prometheus-avatar/core';

interface OpenClawPluginConfig {
    avatarId?: string;
    modelUrl?: string;
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

    // Resolve model URL
    const modelUrl = config.modelUrl
        || (config.avatarId
            ? `https://marketplace.prometheus-avatar.dev/api/models/${config.avatarId}`
            : '/models/haru/haru_greeter_t03.model3.json'); // default

    if (!container) {
        console.warn('[Prometheus Plugin] No container provided. Avatar will not render.');
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

    // ═══ Register Creator Tools ═══
    if (context.registerTool) {
        const creator = new AssetCreator(); // uses default prod URL

        context.registerTool(
            "prometheus_generate_thumbnail",
            "Generate an eye-catching thumbnail image for a marketplace asset (Live2D, Voice, Backdrop) using FLUX.1 AI.",
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
            "Instantly deploy a new asset to the Prometheus Marketplace. Use this when you have created a new voice, backdrop, or Live2D model.",
            {
                type: "object",
                properties: {
                    name: { type: "string" },
                    category: { type: "string", enum: ['avatar', 'voice', 'backdrop', 'wearable', 'animation', 'personality'] },
                    description: { type: "string" },
                    price: { type: "number" },
                    fileData: { type: "string", description: "URL or Base64 string of the actual asset file" },
                    thumbnailData: { type: "string", description: "URL or Base64 string of the thumbnail (use generate_thumbnail first)" },
                    tags: { type: "array", items: { type: "string" } }
                },
                required: ["name", "category", "fileData"]
            },
            async (args) => {
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
    }

    // Return cleanup function
    return () => {
        avatar.destroy();
    };
}
