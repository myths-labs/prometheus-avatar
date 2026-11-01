/**
 * Prometheus SDK — Give your AI agent an embodied avatar
 *
 * @module @prometheus-avatar/core
 */

export { PrometheusAvatar } from './avatar';
export { createAvatar } from './avatar';
export { AvatarRenderer } from './renderer';
/** @deprecated Use `AvatarRenderer`. */
export { Live2DRenderer } from './renderer';
export { EmbedBridge, connectEmbed, EMBED_READY_TIMEOUT_MS, EMBED_LOADED_TIMEOUT_MS } from './embed';
export type {
    EmbedBridgeOptions,
    EmbedCompanionState,
    EmbedOutgoingMessage,
    EmbedSendResult,
    EmbedFallbackReason,
    EmbedFrameLike,
    EmbedMessageEventLike,
    EmbedHostWindowLike,
} from './embed';
export { WebSpeechTTS } from './tts';
export { LipSyncEngine } from './lip-sync';
export { EmotionAnalyzer } from './emotion';
export { AssetManager } from './asset-manager';
export { AssetCreator } from './creator';
export { MemoryBridge, MEMORY_BRIDGE_DEFAULT_ORIGINS } from './memory-bridge';
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
    CreateImageOptions,
    CreateImageResult,
} from './creator';

