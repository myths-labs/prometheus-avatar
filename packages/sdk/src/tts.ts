/**
 * TTS (Text-to-Speech) Engine
 *
 * Pluggable interface with Web Speech API as default implementation.
 * Users can swap in ElevenLabs, Azure, or any custom TTS provider.
 */

import type { ITTSEngine, TTSOptions } from './types';

/**
 * Default TTS engine using the Web Speech Synthesis API.
 * Zero-config, works in all modern browsers.
 */
export class WebSpeechTTS implements ITTSEngine {
    private synth: SpeechSynthesis;
    private currentUtterance: SpeechSynthesisUtterance | null = null;
    private _isSpeaking = false;
    private defaultOptions: TTSOptions;

    /** Called with audio amplitude data for lip sync */
    onAudioData?: (data: Float32Array) => void;
    /** Called when speech ends */
    onEnd?: () => void;

    constructor(options?: TTSOptions) {
        this.synth = window.speechSynthesis;
        this.defaultOptions = {
            rate: 1,
            pitch: 1,
            volume: 1,
            lang: 'en-US',
            ...options,
        };
    }

    get isSpeaking(): boolean {
        return this._isSpeaking;
    }

    /**
     * Speak the given text using Web Speech API
     */
    async speak(text: string, options?: TTSOptions): Promise<void> {
        // Stop any current speech
        this.stop();

        return new Promise<void>((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text);
            const opts = { ...this.defaultOptions, ...options };

            utterance.rate = opts.rate ?? 1;
            utterance.pitch = opts.pitch ?? 1;
            utterance.volume = opts.volume ?? 1;
            utterance.lang = opts.lang ?? 'en-US';

            // Find matching voice if specified
            if (opts.voice) {
                const voices = this.synth.getVoices();
                const match = voices.find(
                    v => v.name === opts.voice || v.voiceURI === opts.voice
                );
                if (match) utterance.voice = match;
            }

            utterance.onstart = () => {
                this._isSpeaking = true;
                // Simulate audio data for lip sync (Web Speech API doesn't expose raw audio)
                this.simulateLipSyncData(text);
            };

            utterance.onend = () => {
                this._isSpeaking = false;
                this.currentUtterance = null;
                this.onEnd?.();
                resolve();
            };

            utterance.onerror = (event) => {
                this._isSpeaking = false;
                this.currentUtterance = null;
                if (event.error !== 'canceled') {
                    reject(new Error(`TTS error: ${event.error}`));
                } else {
                    resolve();
                }
            };

            this.currentUtterance = utterance;
            this.synth.speak(utterance);
        });
    }

    /**
     * Stop current speech
     */
    stop(): void {
        if (this.synth.speaking) {
            this.synth.cancel();
        }
        this._isSpeaking = false;
        this.currentUtterance = null;
    }

    /**
     * Get available voices
     */
    getVoices(): SpeechSynthesisVoice[] {
        return this.synth.getVoices();
    }

    /**
     * Simulate lip sync data since Web Speech API doesn't expose raw audio.
     * Uses text analysis to generate approximate mouth movements.
     */
    private simulateLipSyncData(text: string): void {
        if (!this.onAudioData) return;

        const words = text.split(/\s+/);
        const avgWordDuration = 250; // ms per word
        let offset = 0;

        for (const word of words) {
            for (let i = 0; i < word.length; i++) {
                const char = word[i].toLowerCase();
                const amplitude = this.charToAmplitude(char);
                const delay = offset + i * 60; // ~60ms per character

                setTimeout(() => {
                    if (this._isSpeaking && this.onAudioData) {
                        const data = new Float32Array([amplitude]);
                        this.onAudioData(data);
                    }
                }, delay);
            }
            offset += avgWordDuration;
        }
    }

    /**
     * Map character to approximate mouth amplitude
     */
    private charToAmplitude(char: string): number {
        // Vowels → wide open mouth
        if ('aeiou'.includes(char)) return 0.7 + Math.random() * 0.3;
        // Bilabial consonants → closed mouth
        if ('bmp'.includes(char)) return 0.05;
        // Open consonants
        if ('lnr'.includes(char)) return 0.4 + Math.random() * 0.2;
        // Fricatives
        if ('fvsz'.includes(char)) return 0.3 + Math.random() * 0.2;
        // Default consonants
        return 0.2 + Math.random() * 0.3;
    }
}
