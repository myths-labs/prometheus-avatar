/**
 * Shared types for the Prometheus Avatar SDK
 */

/** Supported emotion types */
export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking';

/** Result from emotion analysis */
export interface EmotionResult {
    emotion: Emotion;
    confidence: number; // 0–1
    triggers: string[]; // what triggered this emotion
}

/** TTS engine interface — implement this to plug in custom TTS providers */
export interface ITTSEngine {
    /** Speak the given text, return audio context for lip sync */
    speak(text: string, options?: TTSOptions): Promise<void>;
    /** Stop current speech */
    stop(): void;
    /** Whether the engine is currently speaking */
    readonly isSpeaking: boolean;
    /** Register callback for audio data (for lip sync) */
    onAudioData?: (data: Float32Array) => void;
    /** Register callback when speech ends */
    onEnd?: () => void;
}

/** TTS configuration options */
export interface TTSOptions {
    voice?: string;
    rate?: number;  // 0.1–10
    pitch?: number; // 0–2
    volume?: number; // 0–1
    lang?: string;
}

/** A single frame of lip sync data */
export interface LipSyncFrame {
    mouthOpenY: number;  // 0–1
    mouthForm: number;   // -1 (ee) to 1 (oh)
    timestamp: number;
}

/** Configuration for creating a Prometheus Avatar */
export interface PrometheusConfig {
    /** DOM element to mount the avatar canvas into */
    container: HTMLElement;
    /** URL to the Live2D model file (.model3.json) */
    modelUrl: string;
    /** Optional TTS engine (defaults to Web Speech API) */
    ttsEngine?: ITTSEngine;
    /** Canvas width (default: 800) */
    width?: number;
    /** Canvas height (default: 600) */
    height?: number;
    /** Background color (default: transparent) */
    backgroundColor?: number;
    /** TTS options */
    ttsOptions?: TTSOptions;
    /** Enable debug logging */
    debug?: boolean;
}

/** Avatar creation options (subset of config with defaults) */
export interface AvatarOptions extends Partial<PrometheusConfig> {
    container: HTMLElement;
    modelUrl: string;
}

/** Events emitted by PrometheusAvatar */
export interface AvatarEventMap {
    'model:loaded': { modelUrl: string };
    'model:error': { error: Error; modelUrl: string };
    'speech:start': { text: string };
    'speech:end': { text: string };
    'emotion:change': { result: EmotionResult; previous: Emotion };
    'lipsync:frame': { frame: LipSyncFrame };
    'destroy': void;
}

// ═══ Multi-LLM Provider Interface ═══

/** Standard chat message format (OpenAI-compatible) */
export interface ILLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** LLM Provider interface — implement this to plug in any LLM */
export interface ILLMProvider {
    /** Provider name (e.g. "gemini", "groq", "deepseek") */
    readonly name: string;
    /** Whether this provider is available (has API key etc.) */
    available(): boolean;
    /** Generate a streaming response. Returns an async iterator of text tokens. */
    stream(messages: ILLMMessage[]): AsyncIterable<string>;
    /** Generate a non-streaming response. */
    generate?(messages: ILLMMessage[]): Promise<string>;
}

