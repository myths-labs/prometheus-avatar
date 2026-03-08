/**
 * Prometheus AssetManager
 * 
 * Handles loading, applying, and managing ALL marketplace asset categories:
 * - Skins: Live2D .model3.json + textures
 * - Voices: TTS voice config or audio samples
 * - Motions: Live2D .motion3.json animations
 * - Expressions: Live2D .exp3.json facial expressions  
 * - Effects: Particle/shader overlays (JSON config)
 * - Scenes: Background images/videos
 * - Personas: Personality prompt/behavior JSON
 * - Accessories: Additional Live2D attachments
 * - Bundles: Multi-asset packages
 */

export type AssetCategory =
    | "skins" | "voices" | "motions" | "expressions"
    | "effects" | "scenes" | "personas" | "accessories" | "bundles";

export interface AssetManifest {
    id: string;
    name: string;
    category: AssetCategory;
    fileUrl: string;
    /** For bundles: list of sub-asset URLs */
    files?: { category: AssetCategory; url: string; name: string }[];
    /** For voices: voice config */
    voiceConfig?: { lang?: string; rate?: number; pitch?: number; voiceId?: string };
    /** For personas: system prompt */
    persona?: { systemPrompt: string; traits?: string[]; greeting?: string };
    /** For effects: particle config */
    effectConfig?: { type: string; color?: string; density?: number; speed?: number };
    /** For scenes: scene config */
    sceneConfig?: { type: "image" | "video" | "gradient"; loop?: boolean };
}

export interface AssetManagerCallbacks {
    onSkinLoaded?: (modelUrl: string) => void;
    onVoiceChanged?: (config: AssetManifest["voiceConfig"]) => void;
    onMotionPlay?: (motionUrl: string) => void;
    onExpressionLoaded?: (expressionUrl: string) => void;
    onEffectApplied?: (config: AssetManifest["effectConfig"]) => void;
    onSceneChanged?: (sceneUrl: string, config: AssetManifest["sceneConfig"]) => void;
    onPersonaLoaded?: (persona: AssetManifest["persona"]) => void;
    onAccessoryAdded?: (accessoryUrl: string) => void;
    onError?: (error: Error, category: AssetCategory) => void;
}

export class AssetManager {
    private appliedAssets: Map<AssetCategory, AssetManifest> = new Map();
    private callbacks: AssetManagerCallbacks;
    private sceneElement: HTMLElement | null = null;
    private effectCanvas: HTMLCanvasElement | null = null;

    constructor(callbacks: AssetManagerCallbacks = {}) {
        this.callbacks = callbacks;
    }

    /**
     * Apply an asset from the marketplace.
     * Fetches the file, determines category, and applies it.
     */
    async applyAsset(manifest: AssetManifest): Promise<void> {
        try {
            switch (manifest.category) {
                case "skins":
                    await this.applySkin(manifest);
                    break;
                case "voices":
                    this.applyVoice(manifest);
                    break;
                case "motions":
                    await this.applyMotion(manifest);
                    break;
                case "expressions":
                    await this.applyExpression(manifest);
                    break;
                case "effects":
                    this.applyEffect(manifest);
                    break;
                case "scenes":
                    this.applyScene(manifest);
                    break;
                case "personas":
                    this.applyPersona(manifest);
                    break;
                case "accessories":
                    await this.applyAccessory(manifest);
                    break;
                case "bundles":
                    await this.applyBundle(manifest);
                    break;
            }
            this.appliedAssets.set(manifest.category, manifest);
        } catch (error) {
            this.callbacks.onError?.(error as Error, manifest.category);
            throw error;
        }
    }

    // ═══ Category-specific apply methods ═══

    private async applySkin(manifest: AssetManifest): Promise<void> {
        // Skin = Live2D model — the SDK's loadModel() handles this
        this.callbacks.onSkinLoaded?.(manifest.fileUrl);
    }

    private applyVoice(manifest: AssetManifest): void {
        // Voice = TTS configuration or voice ID
        const config = manifest.voiceConfig || this.parseVoiceFromUrl(manifest.fileUrl);
        this.callbacks.onVoiceChanged?.(config);
    }

    private async applyMotion(manifest: AssetManifest): Promise<void> {
        // Motion = Live2D motion3.json or animation data
        this.callbacks.onMotionPlay?.(manifest.fileUrl);
    }

    private async applyExpression(manifest: AssetManifest): Promise<void> {
        // Expression = Live2D exp3.json or parameter preset
        this.callbacks.onExpressionLoaded?.(manifest.fileUrl);
    }

    private applyEffect(manifest: AssetManifest): void {
        // Effect = particle/shader overlay config
        const config = manifest.effectConfig || { type: "particles", color: "#00d4aa", density: 50, speed: 1 };
        this.callbacks.onEffectApplied?.(config);
    }

    private applyScene(manifest: AssetManifest): void {
        // Scene = background image/video/gradient
        const config = manifest.sceneConfig || { type: "image" as const };
        this.callbacks.onSceneChanged?.(manifest.fileUrl, config);
    }

    private applyPersona(manifest: AssetManifest): void {
        // Persona = personality/behavior prompt
        const persona = manifest.persona || { systemPrompt: "", traits: [] };
        this.callbacks.onPersonaLoaded?.(persona);
    }

    private async applyAccessory(manifest: AssetManifest): Promise<void> {
        // Accessory = additional Live2D layer or sprite overlay
        this.callbacks.onAccessoryAdded?.(manifest.fileUrl);
    }

    private async applyBundle(manifest: AssetManifest): Promise<void> {
        // Bundle = apply all sub-assets sequentially
        if (manifest.files) {
            for (const file of manifest.files) {
                await this.applyAsset({
                    id: `${manifest.id}_${file.category}`,
                    name: file.name,
                    category: file.category,
                    fileUrl: file.url,
                });
            }
        }
    }

    // ═══ Helpers ═══

    private parseVoiceFromUrl(url: string): AssetManifest["voiceConfig"] {
        // Extract voice config from filename or fetch JSON
        return { lang: "en-US", rate: 1, pitch: 1 };
    }

    /** Get all currently applied assets */
    getApplied(): Map<AssetCategory, AssetManifest> {
        return new Map(this.appliedAssets);
    }

    /** Remove an applied asset */
    removeAsset(category: AssetCategory): void {
        this.appliedAssets.delete(category);
    }

    /** Get file format requirements for each category */
    static getFormatRequirements(): Record<AssetCategory, { formats: string[]; maxSize: string; description: string }> {
        return {
            skins: {
                formats: [".model3.json", ".zip (with textures)"],
                maxSize: "50MB",
                description: "Live2D model package — includes .model3.json, textures (.png), and physics config",
            },
            voices: {
                formats: [".json (voice config)", ".mp3", ".wav"],
                maxSize: "20MB",
                description: "Voice pack — TTS config JSON with lang/rate/pitch or audio sample files",
            },
            motions: {
                formats: [".motion3.json", ".zip"],
                maxSize: "10MB",
                description: "Motion animations — Live2D motion3.json files for dance, idle, wave, etc.",
            },
            expressions: {
                formats: [".exp3.json", ".json"],
                maxSize: "5MB",
                description: "Expression presets — Live2D exp3.json or parameter preset JSON",
            },
            effects: {
                formats: [".json (config)", ".zip"],
                maxSize: "10MB",
                description: "Visual effects — particle/shader config JSON with optional texture assets",
            },
            scenes: {
                formats: [".png", ".jpg", ".webp", ".mp4", ".webm"],
                maxSize: "30MB",
                description: "Background scene — static image or looping video behind the avatar",
            },
            personas: {
                formats: [".json"],
                maxSize: "1MB",
                description: "Persona config — JSON with systemPrompt, personalityTraits, and optional greeting",
            },
            accessories: {
                formats: [".model3.json", ".png", ".zip"],
                maxSize: "20MB",
                description: "Accessories — Live2D overlay model or sprite images (ears, hats, glasses, etc.)",
            },
            bundles: {
                formats: [".zip"],
                maxSize: "100MB",
                description: "Bundle — ZIP containing multiple assets with a manifest.json listing each item",
            },
        };
    }
}
