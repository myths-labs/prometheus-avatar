import type { PluginApi, PluginConfig } from './types';
import { agentApiKey } from './hostRules';

interface AvatarLike {
    processText(text: string): unknown;
    speak(text: string): Promise<unknown>;
    setEmotion(emotion: string): unknown;
}

type Emotion = 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'neutral';

/** The part of core's EmbedBridge this file uses. Expression only: nothing here ever asks the hosted avatar to speak. */
interface EmbedLike {
    setEmotion(emotion: Emotion): unknown;
}

interface AnalyzerLike {
    analyze(text: string): { emotion: Emotion };
}

/** The page element the avatar goes into, as far as this file needs it. */
interface ContainerLike {
    ownerDocument?: { createElement?(tag: string): any; defaultView?: unknown } | null;
    appendChild?(node: unknown): unknown;
}

/**
 * Where the hosted avatar pages live. The frame always points here: `channelBaseUrl` is for testing the seller
 * channel and never moves the avatar page.
 */
const PROMETHEUS_ORIGIN = 'https://prometheus.mythslabs.ai';

/** What a hosted avatar id looks like. Anything else is refused, so no path or query can be added to the page address. */
const HOSTED_AVATAR_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Where OpenClaw keeps this plugin's settings. */
const CONFIG_PATH = 'plugins.entries.prometheus-avatar.config';

/**
 * Agent events -> on-screen avatar.
 *
 * The avatar draws into a page element, so this only runs where there is one: a browser-hosted OpenClaw UI
 * with a `containerSelector` that matches an element. The OpenClaw gateway itself is a Node process without a
 * page, so there it does nothing except say so once; the seller and image tools do not depend on it.
 *
 * With a page element:
 * - `modelUrl` set: that 2D model file (.model3.json) is drawn in the page, with speech, lip-sync and emotion.
 * - no `modelUrl`, but an agent key (`apiKey`, or PROMETHEUS_API_KEY for the production host) and an `avatarId`:
 *   the hosted avatar page is framed and its expression is driven through core's `connectEmbed`. Expression only:
 *   the page address carries nothing after the avatar id, and the hosted avatar is never made to speak.
 *   The key is never put into the page address or sent to the page.
 * - anything else: one error that says what to set, and nothing is shown. The plugin ships no model of its own to fall back to.
 */
export function attachAvatarBridge(api: PluginApi, config: PluginConfig, loadCore: () => Promise<any>): void {
    const doc = (globalThis as { document?: { querySelector(sel: string): unknown } }).document;
    const container = doc && config.containerSelector ? doc.querySelector(config.containerSelector) : null;
    if (!container) {
        api.logger.info('Avatar rendering skipped: no page element to draw into (the OpenClaw gateway has none). Seller and image tools are unaffected.');
        return;
    }

    const modelUrl = typeof config.modelUrl === 'string' ? config.modelUrl.trim() : '';
    const avatarId = typeof config.avatarId === 'string' ? config.avatarId.trim() : '';
    const apiKey = agentApiKey(config);
    const hasAgentKey = typeof apiKey === 'string' && apiKey.trim().length > 0;

    if (!modelUrl) {
        if (avatarId && hasAgentKey) {
            attachHostedAvatar(api, config, container as ContainerLike, avatarId, loadCore);
            return;
        }
        if (avatarId) {
            api.logger.error(
                'No avatar is shown: "avatarId" needs a Prometheus agent key to show the hosted avatar. '
                + `Set "apiKey" (pak_...) in the plugin config (${CONFIG_PATH}) or the PROMETHEUS_API_KEY environment variable, `
                + 'or set "modelUrl" to the URL of a 2D model file (.model3.json). '
                + 'The seller and image tools keep working without it.'
            );
            return;
        }
        api.logger.error(
            'No avatar is shown because "modelUrl" is not set. '
            + `Set "modelUrl" in the plugin config (${CONFIG_PATH}) to the URL of a 2D model file (.model3.json), `
            + 'for example "modelUrl": "https://your-cdn.example/models/your-model.model3.json". '
            + 'To show a hosted avatar instead, set "avatarId" (the id of an avatar made with your Prometheus agent key) together with "apiKey". '
            + 'The seller and image tools keep working without it.'
        );
        return;
    }
    if (avatarId && hasAgentKey) {
        api.logger.info('"modelUrl" is set, so the 2D model file is drawn and "avatarId" is not used.');
    }

    let avatar: AvatarLike | null = null;
    const ready = (async () => {
        const core = await loadCore();
        avatar = await core.createAvatar({
            container,
            modelUrl,
            ttsOptions: { voice: config.ttsVoice },
        }) as AvatarLike;
        api.logger.info('Avatar ready.');
    })().catch((err) => api.logger.error(`Avatar failed to start: ${(err as Error).message}`));

    // Observation-only hooks: they never change what is delivered.
    api.on('message_sent', async (event: { content?: string; text?: string; success?: boolean }) => {
        const text = event?.content ?? event?.text;
        if (!text || event?.success === false) return;
        await ready;
        if (!avatar) return;
        try {
            if (config.enableEmotion !== false) avatar.processText(text);
            if (config.enableLipSync !== false) {
                await avatar.speak(text);
            }
        } catch (err) {
            api.logger.error(`Avatar could not speak: ${(err as Error).message}`);
        }
    });
    api.on('model_call_started', () => { avatar?.setEmotion('thinking'); });
    api.on('model_call_ended', (event: { outcome?: string }) => { if (event?.outcome === 'error') avatar?.setEmotion('surprised'); });
}

/**
 * Show a hosted avatar: frame its page and drive its expression through core's embed bridge.
 *
 * What is sent to the page is expression only (`setEmotion`). The page address carries no query string, so no greeting is
 * requested at load, and the bridge is never asked to speak. The agent key is never put into the page address, the frame
 * or a message.
 */
function attachHostedAvatar(api: PluginApi, config: PluginConfig, container: ContainerLike, avatarId: string, loadCore: () => Promise<any>): void {
    if (!HOSTED_AVATAR_ID.test(avatarId)) {
        api.logger.error(
            'No avatar is shown: "avatarId" must be the id of a hosted avatar '
            + '(letters, digits, "-" and "_" only, up to 64 characters). '
            + 'The seller and image tools keep working without it.'
        );
        return;
    }

    const doc = container.ownerDocument;
    if (!doc || typeof doc.createElement !== 'function' || typeof container.appendChild !== 'function') {
        api.logger.error('No avatar is shown: the page element (containerSelector) cannot hold a frame for the hosted avatar. The seller and image tools keep working.');
        return;
    }

    let embed: EmbedLike | null = null;
    let analyzer: AnalyzerLike | null = null;
    const ready = (async () => {
        const core = await loadCore();
        // The address is set before the bridge is created, and the bridge is created right after the frame is added,
        // so the page's first message is not missed.
        const frame = doc.createElement!('iframe');
        frame.title = 'Prometheus avatar';
        frame.style.width = '100%';
        frame.style.height = '100%';
        frame.style.border = '0';
        frame.style.background = 'transparent';
        frame.src = `${PROMETHEUS_ORIGIN}/embed/${avatarId}`;
        container.appendChild!(frame);
        try {
            embed = core.connectEmbed(frame, {
                origin: PROMETHEUS_ORIGIN,
                avatarId,
                hostWindow: doc.defaultView ?? undefined,
                onLoaded: () => api.logger.info('Hosted avatar ready.'),
                onFallback: (reason: string) => {
                    api.logger.warn(
                        reason === 'ready-timeout'
                            ? 'The hosted avatar page did not report that it is listening; sending the queued expression anyway. Check the network connection and that "avatarId" is correct.'
                            : 'The hosted avatar page did not report that the avatar loaded. Check that "avatarId" is the id of an avatar made with your Prometheus agent key.'
                    );
                },
            }) as EmbedLike;
        } catch (err) {
            frame.remove?.();
            api.logger.error(`Could not connect to the hosted avatar: ${(err as Error).message}`);
            return;
        }
        analyzer = new core.EmotionAnalyzer() as AnalyzerLike;
    })().catch((err) => api.logger.error(`Hosted avatar failed to start: ${(err as Error).message}`));

    // Observation-only hooks, as above. Each waits for the bridge, so an event that comes before it is ready is not lost.
    api.on('message_sent', async (event: { content?: string; text?: string; success?: boolean }) => {
        const text = event?.content ?? event?.text;
        if (!text || event?.success === false) return;
        await ready;
        if (!embed || !analyzer || config.enableEmotion === false) return;
        embed.setEmotion(analyzer.analyze(text).emotion);
    });
    api.on('model_call_started', async () => { await ready; embed?.setEmotion('thinking'); });
    api.on('model_call_ended', async (event: { outcome?: string }) => {
        if (event?.outcome !== 'error') return;
        await ready;
        embed?.setEmotion('surprised');
    });
}
