/**
 * Lip Sync Engine
 *
 * Drives Live2D mouth parameters from audio data or text analysis.
 * Two modes:
 * 1. Audio-driven: analyzes audio amplitude → mouth open/close
 * 2. Text fallback: generates syllable-based mouth animation
 */

import type { LipSyncFrame } from './types';

export class LipSyncEngine {
    private animationFrame: number | null = null;
    private currentMouthOpen = 0;
    private targetMouthOpen = 0;
    private smoothing = 0.3; // lower = smoother
    private isActive = false;

    /** Called each frame with updated lip sync data */
    onFrame?: (frame: LipSyncFrame) => void;

    constructor(options?: { smoothing?: number }) {
        if (options?.smoothing !== undefined) {
            this.smoothing = Math.max(0.05, Math.min(1, options.smoothing));
        }
    }

    /**
     * Process audio amplitude data (called by TTS engine)
     */
    processAudioData(data: Float32Array): void {
        if (data.length === 0) return;

        // Calculate RMS amplitude
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += data[i] * data[i];
        }
        const rms = Math.sqrt(sum / data.length);

        // Map RMS to mouth open value (0–1)
        this.targetMouthOpen = Math.min(1, rms * 2);

        if (!this.isActive) {
            this.startAnimation();
        }
    }

    /**
     * Start text-based lip sync animation (fallback when no audio data)
     */
    startTextSync(text: string, durationMs?: number): void {
        const duration = durationMs ?? text.length * 80; // ~80ms per char
        const syllables = this.textToSyllables(text);
        const syllableDuration = duration / syllables.length;
        let index = 0;

        this.isActive = true;

        const step = () => {
            if (index >= syllables.length || !this.isActive) {
                this.targetMouthOpen = 0;
                return;
            }

            this.targetMouthOpen = syllables[index];
            index++;

            setTimeout(step, syllableDuration);
        };

        step();

        if (!this.animationFrame) {
            this.startAnimation();
        }
    }

    /**
     * Stop lip sync animation
     */
    stop(): void {
        this.isActive = false;
        this.targetMouthOpen = 0;
        this.currentMouthOpen = 0;

        if (this.animationFrame !== null) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        this.onFrame?.({
            mouthOpenY: 0,
            mouthForm: 0,
            timestamp: performance.now(),
        });
    }

    /**
     * Start the smooth animation loop
     */
    private startAnimation(): void {
        this.isActive = true;

        const animate = () => {
            // Smooth interpolation toward target
            this.currentMouthOpen += (this.targetMouthOpen - this.currentMouthOpen) * this.smoothing;

            // Threshold — close mouth fully when very small
            if (this.currentMouthOpen < 0.02) {
                this.currentMouthOpen = 0;
            }

            this.onFrame?.({
                mouthOpenY: this.currentMouthOpen,
                mouthForm: 0, // neutral form for now
                timestamp: performance.now(),
            });

            if (this.isActive || this.currentMouthOpen > 0.01) {
                this.animationFrame = requestAnimationFrame(animate);
            } else {
                this.animationFrame = null;
            }
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    /**
     * Convert text to syllable amplitude array
     */
    private textToSyllables(text: string): number[] {
        const syllables: number[] = [];

        for (const char of text) {
            const lower = char.toLowerCase();

            if ('aeiouáéíóú'.includes(lower)) {
                // Vowels → open
                syllables.push(0.6 + Math.random() * 0.4);
            } else if ('bmp'.includes(lower)) {
                // Bilabial → close then open
                syllables.push(0.05);
            } else if (' \t\n'.includes(char)) {
                // Whitespace → brief close
                syllables.push(0);
            } else if (/[\u4e00-\u9fff]/.test(char)) {
                // CJK characters → moderate open (each is a syllable)
                syllables.push(0.5 + Math.random() * 0.3);
            } else if (/[a-z]/.test(lower)) {
                // Other consonants → moderate
                syllables.push(0.3 + Math.random() * 0.3);
            } else {
                // Punctuation / symbols → slight pause
                syllables.push(0.05);
            }
        }

        return syllables;
    }
}
