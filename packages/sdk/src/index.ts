/**
 * Prometheus SDK — Give your AI agent an embodied avatar
 *
 * @module @prometheus-avatar/core
 */

export { PrometheusAvatar } from './avatar';
export { createAvatar } from './avatar';
export { Live2DRenderer } from './renderer';
export { WebSpeechTTS } from './tts';
export { LipSyncEngine } from './lip-sync';
export { EmotionAnalyzer } from './emotion';
export type {
    PrometheusConfig,
    AvatarOptions,
    Emotion,
    EmotionResult,
    ITTSEngine,
    TTSOptions,
    LipSyncFrame,
    AvatarEventMap,
} from './types';
