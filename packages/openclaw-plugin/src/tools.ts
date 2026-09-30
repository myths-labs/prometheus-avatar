import type { PluginTool, PluginToolResult, PluginConfig } from './types';
import type { CoreModule, Outcome, PublishArgs, SellerConnection } from './sellerConnection';
import { DEFAULT_BASE, agentApiKey, safeOrigin } from './hostRules';

const text = (o: Outcome | { text: string; details: Record<string, unknown> }): PluginToolResult => ({
    content: [{ type: 'text', text: o.text }],
    details: o.details,
});

const CATEGORIES = ['skins', 'voices', 'effects', 'motions', 'accessories', 'scenes', 'personas', 'expressions', 'bundles'];

const publishProps = {
    name: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES, description: 'Launch categories: skins, motions, expressions, personas. voices are published in the Voice Creator on the site, so a voice is refused here. accessories and effects are coming soon.' },
    description: { type: 'string', description: 'Required for personas.' },
    price: { type: 'number', description: 'Price in USD.' },
    price_points: { type: 'number', description: 'Price in platform points.' },
    price_currency: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    license: { type: 'string', enum: ['personal', 'commercial', 'cc-by'] },
    persona_config: { type: 'object', description: 'Required for personas.' },
    bundle_items: { type: 'array', items: {}, description: 'Required for bundles.' },
    fileData: { type: 'string', description: 'URL or Base64 string of the actual asset file.' },
    thumbnailData: { type: 'string', description: 'URL or Base64 string of the thumbnail (use prometheus_generate_image_pro or prometheus_generate_thumbnail first).' },
    draft_asset_id: { type: 'string', description: 'Publish a draft the account already holds instead of sending the fields above.' },
};

interface ToolDeps {
    conn: SellerConnection;
    loadCore: () => Promise<CoreModule>;
    config: PluginConfig;
    logInfo: (m: string) => void;
}

export function buildTools(d: ToolDeps): PluginTool[] {
    // An API key from the environment only ever goes to the production host; a key set in the plugin config goes where the config points.
    const configuredApiKey = () => agentApiKey(d.config);
    const creator = async () => {
        const base = (d.config.channelBaseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
        if (!safeOrigin(base)) throw new Error('channelBaseUrl must be https (or http on localhost): an API key is never sent over plain HTTP.');
        const core = await d.loadCore();
        return new core.AssetCreator(base, configuredApiKey());
    };

    return [
        {
            name: 'prometheus_connect_seller',
            label: 'Connect Prometheus seller account',
            description: 'Connect this OpenClaw to your Prometheus seller account. Once the account is verified through OpenClaw, all of the account\'s listings are sold at the OpenClaw seller rate (the rate follows the account, not each listing). Returns a link and a short code for the user to approve in the browser (10 minutes). Use when the user says "Connect my Prometheus seller account".',
            parameters: {
                type: 'object', additionalProperties: false,
                properties: { relink: { type: 'boolean', description: 'Connect a different account even though one is already connected.' } },
            },
            async execute(_id, params) { return text(await d.conn.connect(params?.relink === true)); },
        },
        {
            name: 'prometheus_connection_status',
            label: 'Prometheus connection status',
            description: 'Check the Prometheus seller connection: waiting for approval, connected (fee rates, X link, today\'s publish count), or not connected. Also finishes a pending connection once the user has approved it.',
            parameters: { type: 'object', additionalProperties: false, properties: {} },
            async execute() { return text(await d.conn.status()); },
        },
        {
            name: 'prometheus_publish_listing',
            label: 'Publish to Prometheus Marketplace',
            description: 'Publish an asset (launch categories: skins, motions, expressions, personas; voices are published in the Voice Creator on the site and are refused here; accessories and effects are coming soon) to Prometheus Marketplace through the connected seller account; the listing is sold at the account\'s rate. Needs a connection (prometheus_connect_seller). Use when the user says "Publish this to Prometheus Marketplace". The listing becomes public and cannot be withdrawn from the agent loop, so confirm with the user first. If a check fails (for example the X account is not linked), nothing is published and it says why and how to fix it.',
            parameters: { type: 'object', additionalProperties: false, properties: publishProps },
            async execute(_id, params) { return text(await d.conn.publish(params as PublishArgs)); },
        },
        {
            name: 'prometheus_deploy_asset',
            label: 'Deploy asset to Prometheus Marketplace',
            description: 'Older name of prometheus_publish_listing, kept for compatibility. When this OpenClaw is connected to a Prometheus seller account it publishes through the connection; otherwise it deploys with the configured agent API key (pak_...). Either way the listing is sold at the account\'s seller rate (the AI agent rate for an account that has not been verified through OpenClaw or Hermes). Public and not withdrawable from the agent loop: confirm with the user first.',
            parameters: { type: 'object', additionalProperties: false, properties: publishProps },
            async execute(_id, params) {
                const args = params as PublishArgs;
                // A saved connection decides. Publish through it, and if that fails say so: never switch quietly to the API key,
                // which sells at another rate (and a failed status check must not look like "not connected").
                if ((await d.conn.keyState()) !== 'none') return text(await d.conn.publish(args));
                const waiting = d.conn.pendingOutcome();
                if (waiting) {
                    return text({ text: `A connection is waiting for approval, so I did not deploy with the API key (that sells at a different rate). ${waiting.text}`, details: { ...waiting.details, ok: false } });
                }
                // Not connected: the original API-key deploy.
                const apiKey = configuredApiKey();
                if (!apiKey) {
                    return text({
                        text: 'This OpenClaw is not connected to a Prometheus seller account and has no agent API key. Either ask me to "Connect my Prometheus seller account" (this verifies the account through OpenClaw), or set the `apiKey` plugin config (or PROMETHEUS_API_KEY) to a pak_... key from https://prometheus.mythslabs.ai/settings/agent-keys.',
                        details: { ok: false, code: 'NO_CREDENTIALS' },
                    });
                }
                if (!args.name || !args.category || !args.fileData) {
                    return text({ text: 'Deploying needs name, category and fileData.', details: { ok: false, code: 'VALIDATION_ERROR' } });
                }
                const { fileData, thumbnailData, draft_asset_id: _d, ...config } = args;
                try {
                    const res = await (await creator()).deployAsset(config as never, fileData, thumbnailData);
                    return text({ text: `Deployed to Prometheus Marketplace${res.asset?.url ? `: ${res.asset.url}` : ''}.`, details: { ...res } });
                } catch (err) {
                    return text({ text: `Deploy failed: ${(err as Error).message}`, details: { ok: false, code: 'DEPLOY_FAILED' } });
                }
            },
        },
        {
            name: 'prometheus_disconnect_seller',
            label: 'Disconnect Prometheus seller account',
            description: 'Revoke this OpenClaw\'s Prometheus seller connection immediately. The account\'s rate and the listings already published are unchanged. Only call when the user asks to disconnect, and pass confirm=true.',
            parameters: {
                type: 'object', additionalProperties: false, required: ['confirm'],
                properties: {
                    confirm: { type: 'boolean', description: 'Must be true.' },
                    hide_listings: { type: 'boolean', description: 'Also hide the listings published through this connection.' },
                },
            },
            async execute(_id, params) {
                if (params?.confirm !== true) return text({ text: 'Not disconnected: confirm=true is required.', details: { ok: false, code: 'CONFIRM_REQUIRED' } });
                return text(await d.conn.disconnect(params.hide_listings === true));
            },
        },
        {
            name: 'prometheus_generate_thumbnail',
            label: 'Generate marketplace thumbnail',
            description: 'Generate an eye-catching thumbnail image for a marketplace asset (Live2D, Voice, Backdrop).',
            parameters: {
                type: 'object',
                properties: { prompt: { type: 'string', description: 'Visual description of the image' }, negative_prompt: { type: 'string' } },
                required: ['prompt'],
            },
            async execute(_id, params) {
                d.logInfo('Generating thumbnail...');
                try {
                    const b64 = await (await creator()).generateThumbnail({ prompt: params.prompt, negative_prompt: params.negative_prompt });
                    return text({ text: 'Thumbnail generated (base64 in details.base64Data).', details: { success: true, base64Data: b64 } });
                } catch (err) {
                    return text({ text: `Thumbnail failed: ${(err as Error).message}`, details: { ok: false, success: false } });
                }
            },
        },
        {
            name: 'prometheus_generate_image_pro',
            label: 'Generate AAA-quality image',
            description: 'Generate AAA-quality images via Prometheus image engine. Use for skin preview cards, posters, UI mocks, or game-store-tier character art at Genshin Impact / Overwatch / WoW shop card quality. Supports BYOK, Free quota, or Pro Credits. Recommend >=100-word prompts with explicit AAA benchmark named — Twin Prompt-Is-The-Ceiling rule (lazy short prompts produce mediocre output).',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'Image prompt. Recommend >=100 words with explicit AAA benchmark (e.g. "Genshin Impact / Overwatch shop preview tier · 3D cel-shaded engine render · NOT flat 2D illustration · clean studio backdrop · slight elevated 3/4 hero pose · production-ready").' },
                    style: { type: 'string', enum: ['anime', 'cel-shade', 'cyberpunk', 'kawaii', 'fantasy', 'cartoon', 'realistic', 'photorealistic', 'pixar'], description: 'Visual style preset prepended to prompt server-side.' },
                    taskType: { type: 'string', enum: ['aaa_skin', 'character', 'scene', 'accessory', 'poster', 'ui_mock', 'game_ui', 'thumbnail', 'auxiliary', 'batch_variants'], description: 'Routes to the optimal provider per task.' },
                    size: { type: 'string', enum: ['1024x1024', '1024x1536', '1536x1024', 'auto'], description: 'Default 1024x1024. Use 1024x1536 for vertical (XHS / 9:16). 1536x1024 for landscape (X / LinkedIn / 16:9).' },
                    quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'], description: 'Default high. Cost: $0.02 low → $0.07-0.19 high (per image).' },
                    numVariants: { type: 'number', description: '1-4 variants. Default 1.' },
                    referenceImages: { type: 'array', items: { type: 'string' }, description: 'Data URLs or HTTPS URLs · character consistency chain across multiple calls.' },
                    apiKey: { type: 'string', description: 'BYOK — your own image-provider API key. Bypasses platform billing (zero-marginal-cost flow).' },
                    upload: { type: 'boolean', description: 'Upload to Supabase Storage and return publicUrl alongside data URL.' },
                },
                required: ['prompt'],
            },
            async execute(_id, params) {
                d.logInfo(`Generating ${params.taskType ?? 'character'} image (style: ${params.style ?? 'none'})...`);
                try {
                    const r = await (await creator()).createImage({
                        prompt: params.prompt, style: params.style, taskType: params.taskType, size: params.size, quality: params.quality,
                        numVariants: params.numVariants, referenceImages: params.referenceImages, apiKey: params.apiKey, upload: params.upload,
                    });
                    return text({ text: `Image generated${r.publicUrl ? `: ${r.publicUrl}` : ''}.`, details: { success: true, ...r } });
                } catch (err) {
                    return text({ text: `Image generation failed: ${(err as Error).message}`, details: { ok: false, success: false } });
                }
            },
        },
    ];
}

export const TOOL_NAMES = [
    'prometheus_connect_seller', 'prometheus_connection_status', 'prometheus_publish_listing', 'prometheus_deploy_asset',
    'prometheus_disconnect_seller', 'prometheus_generate_thumbnail', 'prometheus_generate_image_pro',
];
