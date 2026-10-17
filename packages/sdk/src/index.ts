/**
 * Prometheus SDK — Give your AI agent an embodied avatar
 *
 * Browser-safe entry: nothing here imports Node built-ins (`fs`, `path`, `events`),
 * so esbuild, webpack and Vite can bundle it for the browser. `MemoryBridge` needs
 * Node and lives in `@prometheusavatar/core/node` (see src/node.ts).
 *
 * @module @prometheusavatar/core
 */

export { PrometheusAvatar } from './avatar';
export { createAvatar } from './avatar';
export { Live2DRenderer } from './renderer';
export { WebSpeechTTS } from './tts';
export { LipSyncEngine } from './lip-sync';
export { EmotionAnalyzer } from './emotion';
export { AssetManager } from './asset-manager';
export { AssetCreator } from './creator';
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

