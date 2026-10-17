import { describe, it, expect, vi } from 'vitest';

// The avatar imports the renderer; keep PixiJS (browser only) out of the Node test run.
vi.mock('pixi.js', () => ({ Application: class {}, Ticker: {} }));
vi.mock('pixi-live2d-display/cubism4', () => ({ Live2DModel: {} }));
vi.mock('pixi-live2d-display/cubism2', () => ({ Live2DModel: {} }));

import { PrometheusAvatar } from '../src/avatar';
import type { ITTSEngine, TTSOptions, LipSyncFrame } from '../src/types';

/** The custom engine from the README ("Custom TTS Engine"), with a stand-in for real playback. */
class ReadmeTTSEngine implements ITTSEngine {
    private speaking = false;
    spoken: Array<{ text: string; options?: TTSOptions }> = [];
    onAudioData?: (data: Float32Array) => void;
    onEnd?: () => void;

    get isSpeaking(): boolean {
        return this.speaking;
    }

    async speak(text: string, options?: TTSOptions): Promise<void> {
        this.speaking = true;
        this.spoken.push({ text, options });
        this.onAudioData?.(new Float32Array([0.8, 0.6, 0.7])); // samples that drive the mouth
        this.speaking = false;
        this.onEnd?.();
    }

    stop(): void {
        this.speaking = false;
    }
}

describe('custom ITTSEngine (README contract)', () => {
    it('is wired to lip sync, receives ttsOptions, and brackets speech with events', async () => {
        const engine = new ReadmeTTSEngine();
        const avatar = new PrometheusAvatar({
            container: {} as HTMLElement,
            modelUrl: '/m/haru.model3.json',
            ttsEngine: engine,
            ttsOptions: { lang: 'fi-FI', rate: 0.9 },
        });

        // The avatar installs the callbacks the engine is documented to call.
        expect(typeof engine.onAudioData).toBe('function');
        expect(typeof engine.onEnd).toBe('function');

        const events: string[] = [];
        const frames: LipSyncFrame[] = [];
        avatar.on('speech:start', () => events.push('start'));
        avatar.on('speech:end', () => events.push('end'));
        avatar.on('lipsync:frame', ({ frame }) => frames.push(frame));

        await avatar.speak('Hello! I am happy to see you.');
        await new Promise((r) => setTimeout(r, 20)); // lip sync runs on animation frames

        expect(events).toEqual(['start', 'end']);
        expect(engine.spoken).toHaveLength(1);
        expect(engine.spoken[0].options).toEqual({ lang: 'fi-FI', rate: 0.9 });
        expect(frames.length).toBeGreaterThan(0);
        expect(frames.some((f) => f.mouthOpenY > 0)).toBe(true);
        avatar.destroy();
    });
});
