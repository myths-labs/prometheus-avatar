/**
 * prometheus-avatar/core/creator
 * 
 * Tooling for AI Agents to automatically generate, package, and deploy
 * assets (models, voices, backdrops) to the Prometheus Marketplace.
 */

export interface AssetDeployConfig {
    name: string;
    /** Marketplace category — must be one of the server's accepted values.
     *  ("bundles" also exists server-side but needs a bundle_items list this
     *  payload cannot express, so it is not offered here. "personas" requires
     *  `description`.) */
    category: 'skins' | 'voices' | 'effects' | 'motions' | 'accessories' | 'scenes' | 'personas' | 'expressions';
    description?: string;
    price?: number;
    tags?: string[];
    creator_id?: string;
    license?: 'personal' | 'commercial' | 'cc-by';
}

export interface ImageGenerationOptions {
    prompt: string;
    negative_prompt?: string;
    width?: number;
    height?: number;
}

/**
 * Pro-grade image generation options — Phase 11 Day 3 (SDK v0.11+).
 *
 * AAA-grade generation with automatic multi-provider fallback.
 * Routes via the marketplace `/api/creator/generate-image-pro` endpoint.
 */
export interface CreateImageOptions {
    /** Text prompt. Recommended ≥100 words with explicit AAA benchmark named (Twin Prompt-Is-The-Ceiling rule). */
    prompt: string;
    /** Style preset — prepended to prompt server-side via styleToPromptPrefix. */
    style?: 'anime' | 'cel-shade' | 'cyberpunk' | 'kawaii' | 'fantasy' | 'cartoon' | 'realistic' | 'photorealistic' | 'pixar';
    /** Task semantic — drives provider routing per task. */
    taskType?: 'aaa_skin' | 'character' | 'scene' | 'accessory' | 'poster' | 'ui_mock' | 'game_ui' | 'thumbnail' | 'auxiliary' | 'batch_variants' | 'complex_text';
    /** Output size. `auto` lets the provider pick. */
    size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
    /** Image quality tier. */
    quality?: 'low' | 'medium' | 'high' | 'auto';
    /** Variants 1-4. */
    numVariants?: number;
    /** Reference images (data URL or https URL) for character consistency chain. */
    referenceImages?: string[];
    /** Explicit provider override. Default: server picks per task. */
    provider?: 'openai' | 'gemini' | 'gemini-flash';
    /** BYOK — overrides server-side env credentials. Recommended for zero-marginal-cost flow. */
    apiKey?: string;
    /** Upload result to Supabase Storage and return publicUrl alongside data URL. */
    upload?: boolean;
}

/** Result of `AssetCreator.createImage()`. */
export interface CreateImageResult {
    /** Provider that actually fulfilled the request (after fallback resolution). */
    provider: 'openai' | 'gemini' | 'gemini-flash';
    /** Vendor task identifier — for debugging. */
    taskId: string;
    /** Data URL `data:image/png;base64,...` OR https URL. Caller should download+persist immediately. */
    imageUrl: string;
    /** Supabase public URL when `upload: true`. */
    publicUrl?: string;
    /** Additional variants when numVariants > 1. */
    variants?: string[];
    width: number;
    height: number;
    durationSec: number;
    /** Platform cost in USD for this call (Pro Credits accounting). 0 for BYOK. */
    platformCostUsd?: number;
}

export interface DeploymentResult {
    success: boolean;
    asset?: {
        id: string;
        name: string;
        url: string;        // Showroom URL
        file_url: string;   // CDN link
        thumbnail: string;  // CDN link
    };
    error?: string;
}

export class AssetCreator {
    private static readonly DEFAULT_BASE_URL = "https://prometheus.mythslabs.ai";
    private apiBaseUrl: string;
    private apiKey: string;

    /**
     * @param apiBaseUrl Base URL of the Prometheus Marketplace (e.g. "https://prometheus.mythslabs.ai")
     * @param apiKey     Prometheus agent API key (pak_...). Falls back to the
     *                   PROMETHEUS_API_KEY environment variable when running in Node —
     *                   but the env fallback only applies when talking to the default
     *                   production host, so a caller-supplied apiBaseUrl can never
     *                   siphon an env credential to another server.
     *                   Sent as `Authorization: Bearer <key>` on every marketplace call —
     *                   the live deploy gate rejects unauthenticated writes, so deploys
     *                   without a key fail with 401.
     *                   Browser note: when an Authorization header is present the server
     *                   authenticates the agent account exclusively (it does not fall
     *                   back to the session cookie), so passing an invalid key fails
     *                   with 401 even inside a logged-in browser session, and a valid
     *                   key attributes writes to the agent account, not the human one.
     */
    constructor(apiBaseUrl: string = AssetCreator.DEFAULT_BASE_URL, apiKey?: string) {
        this.apiBaseUrl = apiBaseUrl.replace(/\/$/, ''); // Remove trailing slash
        // globalThis guard: this SDK also runs in browsers, where `process` does not exist.
        const envKey = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PROMETHEUS_API_KEY;
        this.apiKey = apiKey
            ?? (this.apiBaseUrl === AssetCreator.DEFAULT_BASE_URL ? envKey : undefined)
            ?? '';
    }

    /** JSON headers with Authorization attached when an API key is configured. */
    private headers(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
        };
    }

    /**
     * Deploy an asset file (File or Base64) to the marketplace.
     */
    async deployAsset(
        config: AssetDeployConfig,
        fileBase64OrUrl: string,
        thumbnailBase64OrUrl?: string
    ): Promise<DeploymentResult> {
        const isFileUrl = fileBase64OrUrl.startsWith('http');
        const isThumbUrl = thumbnailBase64OrUrl?.startsWith('http');

        const payload = {
            ...config,
            creator_type: 'ai', // Mark explicitly as AI-generated
            file_url: isFileUrl ? fileBase64OrUrl : undefined,
            file_base64: !isFileUrl ? fileBase64OrUrl : undefined,
            thumbnail_url: isThumbUrl ? thumbnailBase64OrUrl : undefined,
            thumbnail_base64: thumbnailBase64OrUrl && !isThumbUrl ? thumbnailBase64OrUrl : undefined,
        };

        const res = await fetch(`${this.apiBaseUrl}/api/marketplace/deploy`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(`Deployment failed: ${data.error || res.statusText}`);
        }

        return data;
    }

    /**
     * Automatically generate an eye-catching thumbnail via Creator AI.
     * Use this before deploying if you don't have a thumbnail ready.
     * @returns Base64 Data URI of the generated image
     */
    async generateThumbnail(options: ImageGenerationOptions): Promise<string> {
        const res = await fetch(`${this.apiBaseUrl}/api/creator/generate-image`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(options)
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(`Image gen failed: ${data.error || res.statusText}`);
        }

        return data.base64Data;
    }

    /**
     * Utility pipeline: Generate thumbnail -> Deploy asset in one shot.
     */
    async generateAndDeploy(
        config: AssetDeployConfig,
        fileData: string,
        thumbnailPrompt: string
    ): Promise<DeploymentResult> {
        console.log(`[Creator] Generating thumbnail for: ${config.name}...`);
        const thumbB64 = await this.generateThumbnail({ prompt: thumbnailPrompt });

        console.log(`[Creator] Deploying asset: ${config.name}...`);
        return this.deployAsset(config, fileData, thumbB64);
    }

    /**
     * Pro-grade image generation via Prometheus image engine (Phase 11 Day 3).
     *
     * Routes through `/api/creator/generate-image-pro` which provides:
     *   - Provider Adapter (multi-provider · BYOK aware)
     *   - Task-type routing (per-task quality tiers)
     *   - Pro Credits / Free quota / BYOK 三档 billing handled server-side
     *   - Safety pre-check (NSFW / content policy)
     *
     * Twin alignment:
     *   - Prompt-Is-The-Ceiling: pass long, AAA-benchmark-named prompts (≥100 words).
     *   - Zero-Marginal-Cost: pass `apiKey` for BYOK to skip platform billing.
     *   - AAA Skin Preview Card standard: use `taskType: "aaa_skin"` + game-store-card prompt phrasing.
     *
     * @example
     *   const c = new AssetCreator();
     *   const result = await c.createImage({
     *     prompt: "Anime shrine maiden, 3D cel-shaded engine render, slight elevated 3/4 hero pose, clean dark studio backdrop, glossy game-art materials, Genshin Impact / Overwatch shop preview tier, NOT flat 2D illustration. Production-ready AAA skin preview card.",
     *     style: "anime",
     *     taskType: "aaa_skin",
     *     size: "1024x1536",
     *     quality: "high",
     *     upload: true,
     *   });
     *   console.log(result.publicUrl, result.platformCostUsd);
     */
    async createImage(options: CreateImageOptions): Promise<CreateImageResult> {
        if (!options.prompt || options.prompt.trim().length < 8) {
            throw new Error("createImage: `prompt` is required (recommend ≥100 words for AAA tier).");
        }

        const res = await fetch(`${this.apiBaseUrl}/api/creator/generate-image-pro`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
                prompt: options.prompt,
                style: options.style,
                task: options.taskType ?? 'character',
                size: options.size ?? '1024x1024',
                quality: options.quality ?? 'high',
                numVariants: options.numVariants ?? 1,
                referenceImages: options.referenceImages,
                provider: options.provider,
                apiKey: options.apiKey,
                upload: options.upload ?? false,
            }),
        });

        const data = await res.json();
        if (!res.ok || data.success === false || data.error) {
            throw new Error(`createImage failed (${res.status}): ${data.error || res.statusText}`);
        }

        return {
            provider: data.provider,
            taskId: data.taskId,
            imageUrl: data.imageUrl,
            publicUrl: data.publicUrl,
            variants: data.variants,
            width: data.width,
            height: data.height,
            durationSec: data.durationSec,
            platformCostUsd: data.platformCostUsd,
        };
    }
}
