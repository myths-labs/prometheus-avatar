import { describe, it, expect } from 'vitest';
import type {
    Emotion,
    EmotionResult,
    ITTSEngine,
    TTSOptions,
    LipSyncFrame,
    PrometheusConfig,
    AvatarOptions,
    AvatarEventMap,
    ILLMProvider,
    ILLMMessage,
} from '../src/types';

describe('Types', () => {
    it('Emotion type covers all expected values', () => {
        const emotions: Emotion[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking'];
        expect(emotions).toHaveLength(6);
    });

    it('EmotionResult has correct shape', () => {
        const result: EmotionResult = {
            emotion: 'happy',
            confidence: 0.95,
            triggers: ['smile', 'emoji'],
        };
        expect(result.emotion).toBe('happy');
        expect(result.confidence).toBe(0.95);
        expect(result.triggers).toHaveLength(2);
    });

    it('TTSOptions is optional and extensible', () => {
        const opts: TTSOptions = { voice: 'en-US', rate: 1.0, pitch: 1.0, volume: 0.8 };
        expect(opts.voice).toBe('en-US');
    });

    it('LipSyncFrame has all required fields', () => {
        const frame: LipSyncFrame = { mouthOpenY: 0.5, mouthForm: 0.2, timestamp: Date.now() };
        expect(frame.mouthOpenY).toBeGreaterThanOrEqual(0);
        expect(frame.mouthOpenY).toBeLessThanOrEqual(1);
    });

    it('ILLMMessage supports all roles', () => {
        const messages: ILLMMessage[] = [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi!' },
        ];
        expect(messages).toHaveLength(3);
    });

    it('ILLMProvider interface is implementable', () => {
        const provider: ILLMProvider = {
            name: 'test-provider',
            available: () => true,
            stream: async function* (messages: ILLMMessage[]) {
                yield 'Hello';
                yield ' World';
            },
        };
        expect(provider.name).toBe('test-provider');
        expect(provider.available()).toBe(true);
    });

    it('AvatarOptions requires container and modelUrl', () => {
        // Type-level test: AvatarOptions extends Partial<PrometheusConfig>
        // but requires container + modelUrl
        const opts: AvatarOptions = {
            container: {} as HTMLElement,
            modelUrl: 'test.model3.json',
        };
        expect(opts.container).toBeDefined();
        expect(opts.modelUrl).toBe('test.model3.json');
    });
});
