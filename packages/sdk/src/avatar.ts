/**
 * PrometheusAvatar — Main orchestrator class
 *
 * Ties together renderer, TTS, lip sync, and emotion analysis into a
 * unified API for driving a Live2D avatar from LLM output.
 *
 * Usage:
 *   const avatar = await createAvatar({
 *     container: document.getElementById('avatar'),
 *     modelUrl: '/models/haru/haru.model3.json',
 *   });
 *   await avatar.speak('Hello! How are you today? 😊');
 */

import { Live2DRenderer } from './renderer';
import { WebSpeechTTS } from './tts';
import { LipSyncEngine } from './lip-sync';
import { EmotionAnalyzer } from './emotion';
import type { PrometheusConfig, AvatarOptions, Emotion, EmotionResult, AvatarEventMap } from './types';

type EventCallback<T> = (data: T) => void;

export class PrometheusAvatar {
    private renderer: Live2DRenderer;
    private tts: WebSpeechTTS;
    private lipSync: LipSyncEngine;
    private emotion: EmotionAnalyzer;
    private currentEmotion: Emotion = 'neutral';
    private config: PrometheusConfig;
    private listeners: Map<string, Set<EventCallback<unknown>>> = new Map();
    private destroyed = false;

    constructor(config: PrometheusConfig) {
        this.config = config;

        // Initialize renderer
        this.renderer = new Live2DRenderer({
            container: config.container,
            width: config.width,
            height: config.height,
            backgroundColor: config.backgroundColor,
            debug: config.debug,
        });

        // Initialize TTS (pluggable — defaults to Web Speech API)
        this.tts = (config.ttsEngine as WebSpeechTTS) ?? new WebSpeechTTS(config.ttsOptions);

        // Initialize lip sync
        this.lipSync = new LipSyncEngine();

        // Initialize emotion analyzer
        this.emotion = new EmotionAnalyzer();

        // Wire up lip sync: TTS audio → lip sync engine → renderer mouth
        this.tts.onAudioData = (data: Float32Array) => {
            this.lipSync.processAudioData(data);
        };

        this.lipSync.onFrame = (frame) => {
            this.renderer.setMouthOpen(frame.mouthOpenY);
            this.emit('lipsync:frame', { frame });
        };

        this.tts.onEnd = () => {
            this.lipSync.stop();
        };
    }

    /**
     * Initialize the avatar — must be called before speak/setEmotion
     */
    async init(): Promise<void> {
        await this.renderer.init();
        await this.renderer.loadModel(this.config.modelUrl);
        this.emit('model:loaded', { modelUrl: this.config.modelUrl });
    }

    /**
     * Speak text through the avatar:
     * 1. Analyze emotion from text
     * 2. Set expression
     * 3. Start TTS
     * 4. Lip sync follows audio
     */
    async speak(text: string): Promise<void> {
        if (this.destroyed) return;

        // 1. Analyze emotion
        const result = this.emotion.analyze(text);

        // 2. Update expression if emotion changed
        if (result.emotion !== this.currentEmotion) {
            const previous = this.currentEmotion;
            this.currentEmotion = result.emotion;
            this.renderer.setEmotion(result.emotion);
            this.emit('emotion:change', { result, previous });
        }

        // 3. Emit speech start
        this.emit('speech:start', { text });

        // 4. Start TTS + lip sync
        try {
            await this.tts.speak(text, this.config.ttsOptions);
        } finally {
            this.lipSync.stop();
            this.emit('speech:end', { text });
        }
    }

    /**
     * Process text from an LLM stream — updates emotion and lip sync
     * without TTS (useful when TTS is handled externally)
     */
    processText(text: string): EmotionResult {
        if (this.destroyed) return { emotion: 'neutral', confidence: 0, triggers: [] };

        const result = this.emotion.analyze(text);

        if (result.emotion !== this.currentEmotion) {
            const previous = this.currentEmotion;
            this.currentEmotion = result.emotion;
            this.renderer.setEmotion(result.emotion);
            this.emit('emotion:change', { result, previous });
        }

        // Text-based lip sync
        this.lipSync.startTextSync(text);

        return result;
    }

    /**
     * Directly set the avatar's emotion
     */
    setEmotion(emotion: Emotion): void {
        if (this.destroyed) return;

        const previous = this.currentEmotion;
        this.currentEmotion = emotion;
        this.renderer.setEmotion(emotion);
        this.emit('emotion:change', {
            result: { emotion, confidence: 1, triggers: ['manual'] },
            previous,
        });
    }

    /**
     * Load a different avatar model
     */
    async loadModel(modelUrl: string): Promise<void> {
        if (this.destroyed) return;

        try {
            await this.renderer.loadModel(modelUrl);
            this.config.modelUrl = modelUrl;
            this.currentEmotion = 'neutral';
            this.emit('model:loaded', { modelUrl });
        } catch (error) {
            this.emit('model:error', { error: error as Error, modelUrl });
            throw error;
        }
    }

    /**
     * Stop current speech and lip sync
     */
    stop(): void {
        this.tts.stop();
        this.lipSync.stop();
    }

    /**
     * Resize the avatar canvas
     */
    resize(width: number, height: number): void {
        this.renderer.resize(width, height);
    }

    /**
     * Get current emotion
     */
    getEmotion(): Emotion {
        return this.currentEmotion;
    }

    /**
     * Subscribe to events
     */
    on<K extends keyof AvatarEventMap>(
        event: K,
        callback: EventCallback<AvatarEventMap[K]>
    ): () => void {
        const key = event as string;
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key)!.add(callback as EventCallback<unknown>);

        // Return unsubscribe function
        return () => {
            this.listeners.get(key)?.delete(callback as EventCallback<unknown>);
        };
    }

    /**
     * Destroy the avatar and release all resources
     */
    destroy(): void {
        this.destroyed = true;
        this.stop();
        this.renderer.destroy();
        this.listeners.clear();
        this.emit('destroy', undefined as unknown as void);
    }

    /**
     * Emit an event to all listeners
     */
    private emit<K extends keyof AvatarEventMap>(
        event: K,
        data: AvatarEventMap[K]
    ): void {
        const key = event as string;
        this.listeners.get(key)?.forEach(cb => {
            try {
                cb(data);
            } catch (error) {
                console.error(`[Prometheus] Error in event handler for '${key}':`, error);
            }
        });
    }
}

/**
 * Factory function — convenient way to create and initialize a PrometheusAvatar
 *
 * @example
 * ```ts
 * const avatar = await createAvatar({
 *   container: document.getElementById('avatar')!,
 *   modelUrl: '/models/haru/haru.model3.json',
 * });
 * await avatar.speak('Hello world! 😊');
 * ```
 */
export async function createAvatar(options: AvatarOptions): Promise<PrometheusAvatar> {
    const config: PrometheusConfig = {
        width: 800,
        height: 600,
        backgroundColor: 0x00000000,
        debug: false,
        ...options,
    };

    const avatar = new PrometheusAvatar(config);
    await avatar.init();
    return avatar;
}
