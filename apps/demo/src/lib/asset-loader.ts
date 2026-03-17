"use client";

/**
 * Asset Loader — Bridge between Marketplace purchases and Avatar SDK
 * 
 * Each asset category maps to a specific SDK integration point:
 * - skins     → avatar.loadModel(url)        — swaps the Live2D model
 * - voices    → avatar.setVoice(voiceId)      — changes TTS voice
 * - effects   → avatar.addEffect(config)      — PIXI.js particle overlay
 * - scenes    → avatar.setBackground(url)     — canvas background
 * - motions   → avatar.playMotion(url)        — Live2D motion file
 * - accessories → avatar.addAccessory(url)    — extra drawable on model
 * - personas  → updates system prompt         — AI personality
 * - expressions → avatar.setExpression(name)  — expression parameter set
 * - bundles   → applies multiple assets       — combo pack
 */

export interface AssetConfig {
    id: string;
    name: string;
    category: string;
    file_url: string;        // URL to the asset file (model3.json, audio, etc.)
    config?: Record<string, unknown>;  // Category-specific configuration
}

export interface AvatarHandle {
    loadModel: (url: string) => Promise<void>;
    speak: (text: string) => Promise<void>;
    setExpression: (name: string) => void;
    interrupt?: () => void;
    // Extended methods for marketplace assets
    setVoice?: (voiceId: string) => void;
    addEffect?: (config: unknown) => void;
    setBackground?: (url: string) => void;
    playMotion?: (url: string) => void;
    addAccessory?: (url: string) => void;
    setPersona?: (prompt: string) => void;
    applyBundle?: (assets: AssetConfig[]) => void;
}

/**
 * Load a purchased marketplace asset onto an avatar instance
 */
export async function loadAsset(avatar: AvatarHandle, asset: AssetConfig): Promise<{ success: boolean; message: string }> {
    try {
        switch (asset.category) {
            case "skins":
                await avatar.loadModel(asset.file_url);
                return { success: true, message: `Skin "${asset.name}" applied` };

            case "voices":
                if (avatar.setVoice) {
                    avatar.setVoice(asset.config?.voiceId as string || asset.file_url);
                    return { success: true, message: `Voice "${asset.name}" activated` };
                }
                return { success: false, message: "Voice switching not supported on this avatar" };

            case "effects":
                if (avatar.addEffect) {
                    avatar.addEffect(asset.config || { type: "particles", url: asset.file_url });
                    return { success: true, message: `Effect "${asset.name}" added` };
                }
                return { success: false, message: "Effects not supported on this avatar" };

            case "scenes":
                if (avatar.setBackground) {
                    avatar.setBackground(asset.file_url);
                    return { success: true, message: `Scene "${asset.name}" set as background` };
                }
                return { success: false, message: "Background switching not supported" };

            case "motions":
                if (avatar.playMotion) {
                    avatar.playMotion(asset.file_url);
                    return { success: true, message: `Motion "${asset.name}" playing` };
                }
                return { success: false, message: "Motion playback not supported" };

            case "accessories":
                if (avatar.addAccessory) {
                    avatar.addAccessory(asset.file_url);
                    return { success: true, message: `Accessory "${asset.name}" equipped` };
                }
                return { success: false, message: "Accessories not supported" };

            case "personas":
                if (avatar.setPersona) {
                    avatar.setPersona(asset.config?.prompt as string || "");
                    return { success: true, message: `Persona "${asset.name}" activated` };
                }
                return { success: false, message: "Persona switching not supported" };

            case "expressions":
                avatar.setExpression(asset.config?.expressionName as string || "default");
                return { success: true, message: `Expression pack "${asset.name}" loaded` };

            case "bundles":
                if (avatar.applyBundle) {
                    const bundleAssets = asset.config?.assets as AssetConfig[] || [];
                    avatar.applyBundle(bundleAssets);
                    return { success: true, message: `Bundle "${asset.name}" applied (${bundleAssets.length} items)` };
                }
                // Fallback: apply each item individually
                const items = asset.config?.assets as AssetConfig[] || [];
                for (const item of items) {
                    await loadAsset(avatar, item);
                }
                return { success: true, message: `Bundle "${asset.name}" applied` };

            default:
                return { success: false, message: `Unknown asset category: ${asset.category}` };
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[AssetLoader] Failed to load ${asset.category}:`, error);
        return { success: false, message: `Failed to load "${asset.name}": ${msg}` };
    }
}

/**
 * Check which asset categories an avatar instance supports
 */
export function getAvatarCapabilities(avatar: AvatarHandle): Record<string, boolean> {
    return {
        skins: true,  // All avatars support model loading
        voices: !!avatar.setVoice,
        effects: !!avatar.addEffect,
        scenes: !!avatar.setBackground,
        motions: !!avatar.playMotion,
        accessories: !!avatar.addAccessory,
        personas: !!avatar.setPersona,
        expressions: true,  // All avatars support expressions
        bundles: true,  // Always supported via fallback
    };
}
