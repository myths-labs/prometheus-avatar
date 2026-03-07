/**
 * Prometheus Avatar Plugin for OpenClaw
 *
 * Bridges OpenClaw agent events → Prometheus Avatar SDK
 * When your agent speaks, the avatar speaks too.
 *
 * Installation: openclaw plugins install prometheus-avatar
 */

import { createAvatar, PrometheusAvatar } from '@prometheus-avatar/core';
import type { PrometheusConfig } from '@prometheus-avatar/core';

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

    // Return cleanup function
    return () => {
        avatar.destroy();
    };
}
