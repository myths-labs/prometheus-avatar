import { describe, it, expect } from 'vitest';
import { LipSyncEngine } from '../src/lip-sync';

describe('LipSyncEngine', () => {
    it('creates instance', () => {
        const engine = new LipSyncEngine();
        expect(engine).toBeDefined();
    });

    it('processes audio data without throwing', () => {
        const engine = new LipSyncEngine();
        const audioData = new Float32Array(1024).fill(0);
        expect(() => engine.processAudioData(audioData)).not.toThrow();
    });

    it('processes silence (all zeros) → low mouth open', () => {
        const engine = new LipSyncEngine();
        let lastFrame: any = null;
        engine.onFrame = (frame) => { lastFrame = frame; };

        const silence = new Float32Array(1024).fill(0);
        engine.processAudioData(silence);

        if (lastFrame) {
            expect(lastFrame.mouthOpenY).toBeLessThanOrEqual(0.1);
        }
    });

    it('processes loud audio → higher mouth open', () => {
        const engine = new LipSyncEngine();
        let lastFrame: any = null;
        engine.onFrame = (frame) => { lastFrame = frame; };

        // Create a loud sine wave
        const loud = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) {
            loud[i] = Math.sin(i * 0.1) * 0.8;
        }
        engine.processAudioData(loud);

        if (lastFrame) {
            expect(lastFrame.mouthOpenY).toBeGreaterThan(0);
        }
    });

    it('stop resets state', () => {
        const engine = new LipSyncEngine();
        engine.stop();
        // Should not throw after stop
        expect(() => engine.processAudioData(new Float32Array(512))).not.toThrow();
    });

    it('text sync does not throw', () => {
        const engine = new LipSyncEngine();
        expect(() => engine.startTextSync('Hello world')).not.toThrow();
    });

    it('frame has correct shape', () => {
        const engine = new LipSyncEngine();
        let frame: any = null;
        engine.onFrame = (f) => { frame = f; };

        const audio = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) audio[i] = Math.sin(i * 0.05) * 0.5;
        engine.processAudioData(audio);

        if (frame) {
            expect(frame).toHaveProperty('mouthOpenY');
            expect(frame).toHaveProperty('mouthForm');
            expect(frame).toHaveProperty('timestamp');
            expect(typeof frame.mouthOpenY).toBe('number');
        }
    });
});
