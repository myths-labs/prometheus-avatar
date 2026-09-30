import type { PluginApi, PluginConfig } from './types';

interface AvatarLike {
    processText(text: string): unknown;
    speak(text: string): Promise<unknown>;
    setEmotion(emotion: string): unknown;
}

/**
 * Agent events -> on-screen avatar (speech with lip-sync, emotion, thinking, surprise).
 *
 * The avatar draws into a page element, so this only runs where there is one: a browser-hosted OpenClaw UI
 * with a `containerSelector` that matches an element. The OpenClaw gateway itself is a Node process without a
 * page, so there it does nothing except say so once; the seller and image tools do not depend on it.
 */
export function attachAvatarBridge(api: PluginApi, config: PluginConfig, loadCore: () => Promise<any>): void {
    const doc = (globalThis as { document?: { querySelector(sel: string): unknown } }).document;
    const container = doc && config.containerSelector ? doc.querySelector(config.containerSelector) : null;
    if (!container) {
        api.logger.info('Avatar rendering skipped: no page element to draw into (the OpenClaw gateway has none). Seller and image tools are unaffected.');
        return;
    }

    let avatar: AvatarLike | null = null;
    const ready = (async () => {
        const core = await loadCore();
        avatar = await core.createAvatar({
            container,
            modelUrl: config.modelUrl || '/models/haru/haru_greeter_t03.model3.json',
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
            if (config.enableLipSync !== false) await avatar.speak(text);
        } catch (err) {
            api.logger.error(`Avatar could not speak: ${(err as Error).message}`);
        }
    });
    api.on('model_call_started', () => { avatar?.setEmotion('thinking'); });
    api.on('model_call_ended', (event: { outcome?: string }) => { if (event?.outcome === 'error') avatar?.setEmotion('surprised'); });
}
