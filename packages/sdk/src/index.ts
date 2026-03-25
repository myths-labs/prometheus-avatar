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
export { AssetManager } from './asset-manager';
export { AssetCreator } from './creator';
export { MemoryBridge } from './memory-bridge';
export type { MemoryBridgeOptions, ConversationMessage, MemoryBridgeMessage } from './memory-bridge';
export type {
    AssetCategory,
    AssetManifest,
    AssetManagerCallbacks,
} from './asset-manager';
export type {
    PrometheusConfig,
    AvatarOptions,
    Emotion,
    EmotionResult,
    ITTSEngine,
    TTSOptions,
    LipSyncFrame,
    AvatarEventMap,
    ILLMProvider,
    ILLMMessage,
} from './types';
export type {
    AssetDeployConfig,
    ImageGenerationOptions,
    DeploymentResult,
} from './creator';

