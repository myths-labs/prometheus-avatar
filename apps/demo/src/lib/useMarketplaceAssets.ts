"use client";

/**
 * useMarketplaceAssets — Hook that integrates marketplace assets with the live avatar
 * 
 * Handles ALL 9 categories:
 * 1. Skins → loadModel() on the avatar canvas
 * 2. Voices → Switch TTS voice/config
 * 3. Motions → Play Live2D motion on model
 * 4. Expressions → Load expression preset
 * 5. Effects → Canvas particle/shader overlay
 * 6. Scenes → Background image/video behind avatar
 * 7. Personas → Update system prompt for chat
 * 8. Accessories → Add sprite overlay to avatar
 * 9. Bundles → Apply all sub-assets
 */

import { useState, useCallback, useRef, useEffect } from "react";

export type AssetCategory =
    | "skins" | "voices" | "motions" | "expressions"
    | "effects" | "scenes" | "personas" | "accessories" | "bundles";

export interface AppliedAsset {
    id: string;
    name: string;
    category: AssetCategory;
    fileUrl: string;
    appliedAt: number;
}

export interface MarketplaceAssetHook {
    /** Apply a purchased/free asset to the avatar */
    applyAsset: (asset: { id: string; name: string; category: AssetCategory; fileUrl: string }) => Promise<void>;
    /** Remove an applied asset */
    removeAsset: (category: AssetCategory) => void;
    /** Currently applied assets */
    appliedAssets: Map<AssetCategory, AppliedAsset>;
    /** Download and apply an asset from marketplace (handles fetch + apply) */
    downloadAndApply: (assetId: string, txProof?: string) => Promise<void>;
    /** Current scene background URL */
    sceneUrl: string | null;
    /** Current persona system prompt */
    personaPrompt: string | null;
    /** Current voice config */
    voiceConfig: { lang?: string; rate?: number; pitch?: number; voiceId?: string } | null;
    /** Active effects */
    activeEffects: { type: string; color?: string; density?: number }[];
    /** Loading state */
    loading: boolean;
    /** Error state */
    error: string | null;
}

/**
 * Hook params:
 * @param avatarRef - ref to the avatar model/canvas for skin/motion/expression loading
 * @param onModelLoad - callback when a new skin model should be loaded
 */
export function useMarketplaceAssets(
    onModelLoad?: (modelUrl: string) => Promise<void>,
): MarketplaceAssetHook {
    const [appliedAssets, setAppliedAssets] = useState<Map<AssetCategory, AppliedAsset>>(new Map());
    const [sceneUrl, setSceneUrl] = useState<string | null>(null);
    const [personaPrompt, setPersonaPrompt] = useState<string | null>(null);
    const [voiceConfig, setVoiceConfig] = useState<MarketplaceAssetHook["voiceConfig"]>(null);
    const [activeEffects, setActiveEffects] = useState<{ type: string; color?: string; density?: number }[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const applyAsset = useCallback(async (asset: { id: string; name: string; category: AssetCategory; fileUrl: string }) => {
        setLoading(true);
        setError(null);

        try {
            switch (asset.category) {
                case "skins": {
                    // Load new Live2D model
                    if (onModelLoad) {
                        await onModelLoad(asset.fileUrl);
                    }
                    break;
                }

                case "voices": {
                    // Parse voice config from JSON file or use defaults
                    try {
                        const res = await fetch(asset.fileUrl);
                        const config = await res.json();
                        setVoiceConfig(config);
                    } catch {
                        // If not JSON, treat as audio sample URL
                        setVoiceConfig({ voiceId: asset.fileUrl });
                    }
                    break;
                }

                case "motions": {
                    // Trigger motion on the Live2D model
                    // The model's internal motion manager handles .motion3.json
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("prometheus:motion", {
                            detail: { url: asset.fileUrl, name: asset.name }
                        }));
                    }
                    break;
                }

                case "expressions": {
                    // Load expression preset
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("prometheus:expression", {
                            detail: { url: asset.fileUrl, name: asset.name }
                        }));
                    }
                    break;
                }

                case "effects": {
                    // Parse effect config and add to active effects
                    try {
                        const res = await fetch(asset.fileUrl);
                        const effectConfig = await res.json();
                        setActiveEffects(prev => [...prev, effectConfig]);
                    } catch {
                        setActiveEffects(prev => [...prev, { type: "particles", color: "#00d4aa", density: 50 }]);
                    }
                    break;
                }

                case "scenes": {
                    // Set background scene
                    setSceneUrl(asset.fileUrl);
                    break;
                }

                case "personas": {
                    // Load persona prompt
                    try {
                        const res = await fetch(asset.fileUrl);
                        const persona = await res.json();
                        setPersonaPrompt(persona.systemPrompt || persona.prompt || JSON.stringify(persona));
                    } catch {
                        setPersonaPrompt(null);
                    }
                    break;
                }

                case "accessories": {
                    // Dispatch accessory event for avatar canvas to handle
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("prometheus:accessory", {
                            detail: { url: asset.fileUrl, name: asset.name }
                        }));
                    }
                    break;
                }

                case "bundles": {
                    // Fetch bundle manifest and apply each sub-asset
                    try {
                        const res = await fetch(asset.fileUrl);
                        const bundle = await res.json();
                        if (bundle.assets && Array.isArray(bundle.assets)) {
                            for (const subAsset of bundle.assets) {
                                await applyAsset(subAsset);
                            }
                        }
                    } catch (e) {
                        console.error("[AssetManager] Bundle parse error:", e);
                    }
                    break;
                }
            }

            // Record applied asset
            setAppliedAssets(prev => {
                const next = new Map(prev);
                next.set(asset.category, { ...asset, appliedAt: Date.now() });
                return next;
            });

        } catch (err: any) {
            setError(err.message || "Failed to apply asset");
            throw err;
        } finally {
            setLoading(false);
        }
    }, [onModelLoad]);

    const removeAsset = useCallback((category: AssetCategory) => {
        setAppliedAssets(prev => {
            const next = new Map(prev);
            next.delete(category);
            return next;
        });

        // Clean up category-specific state
        switch (category) {
            case "scenes": setSceneUrl(null); break;
            case "personas": setPersonaPrompt(null); break;
            case "voices": setVoiceConfig(null); break;
            case "effects": setActiveEffects([]); break;
        }
    }, []);

    const downloadAndApply = useCallback(async (assetId: string, txProof?: string) => {
        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams({ asset: assetId });
            if (txProof) params.append("tx", txProof);

            const res = await fetch(`/api/marketplace/download?${params}`);
            const data = await res.json();

            if (res.status === 402) {
                throw new Error("Payment required — please purchase this asset first");
            }

            if (!res.ok) {
                throw new Error(data.error || "Download failed");
            }

            // Apply the downloaded asset
            await applyAsset({
                id: assetId,
                name: data.asset.name,
                category: data.asset.category,
                fileUrl: data.asset.fileUrl,
            });

        } catch (err: any) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [applyAsset]);

    return {
        applyAsset,
        removeAsset,
        appliedAssets,
        downloadAndApply,
        sceneUrl,
        personaPrompt,
        voiceConfig,
        activeEffects,
        loading,
        error,
    };
}
