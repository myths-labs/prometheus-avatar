/**
 * The small part of the OpenClaw plugin API this plugin uses, written as structural types.
 * Typing against OpenClaw itself would need the whole `openclaw` package (hundreds of MB) at build time,
 * and the entry stays loadable without importing anything from the host.
 * Verified against OpenClaw 2026.9.6 by test/loader.test.mjs.
 */

export interface PluginToolResult {
    content: { type: 'text'; text: string }[];
    details: Record<string, unknown>;
}

export interface PluginTool {
    name: string;
    label?: string;
    description: string;
    /** JSON Schema object. */
    parameters: Record<string, unknown>;
    execute(toolCallId: string, params: any, signal?: AbortSignal): Promise<PluginToolResult>;
}

export interface KeyedStore<T> {
    lookup(key: string): Promise<T | undefined>;
    register(key: string, value: T): Promise<void>;
    consume?(key: string): Promise<unknown>;
    clear?(): Promise<void>;
}

export interface PluginLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug?(message: string): void;
}

export interface PluginApi {
    id?: string;
    pluginConfig?: Record<string, unknown>;
    logger: PluginLogger;
    runtime: {
        /** The OpenClaw product version, e.g. "2026.9.6" (no build suffix). */
        version: string;
        state: {
            resolveStateDir(env: Record<string, string | undefined>): string;
            /** Only bundled or trusted-official plugins may call this; it throws for everyone else. */
            openKeyedStore?<T>(options: { namespace: string; maxEntries?: number }): KeyedStore<T>;
        };
    };
    registerTool(tool: PluginTool): void;
    on(hook: string, handler: (event: any, ctx?: any) => unknown): void;
}

export interface PluginConfig {
    apiKey?: string;
    modelUrl?: string;
    avatarId?: string;
    ttsVoice?: string;
    enableLipSync?: boolean;
    enableEmotion?: boolean;
    /** CSS selector of a page element to render the avatar into (browser-hosted OpenClaw UIs only). */
    containerSelector?: string;
    /** Testing only: point the seller channel at a local server. Must be https, or http on localhost. */
    channelBaseUrl?: string;
}
