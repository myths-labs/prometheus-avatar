/**
 * prometheus-avatar/core/creator
 * 
 * Tooling for AI Agents to automatically generate, package, and deploy
 * assets (models, voices, backdrops) to the Prometheus Marketplace.
 */

export interface AssetDeployConfig {
    name: string;
    category: 'avatar' | 'voice' | 'backdrop' | 'wearable' | 'animation' | 'personality';
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
    private apiBaseUrl: string;

    /**
     * @param apiBaseUrl Base URL of the Prometheus Marketplace (e.g. "https://prometheus.mythslabs.ai")
     */
    constructor(apiBaseUrl: string = "https://prometheus.mythslabs.ai") {
        this.apiBaseUrl = apiBaseUrl.replace(/\/$/, ''); // Remove trailing slash
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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
}
