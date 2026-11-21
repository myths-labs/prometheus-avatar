import type { PluginConfig } from './types';

export const DEFAULT_BASE = 'https://prometheus.mythslabs.ai';

export function isLoopbackHttp(u: URL): boolean {
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
}

/** The origin an address points at, or null when it is not one a key may be sent to (https, or http on this machine). */
export function safeOrigin(raw: string | undefined): string | null {
    try {
        const u = new URL(raw ?? DEFAULT_BASE);
        return u.protocol === 'https:' || isLoopbackHttp(u) ? u.origin : null;
    } catch {
        return null;
    }
}

export function isDefaultHost(raw: string | undefined): boolean {
    return safeOrigin(raw) === new URL(DEFAULT_BASE).origin;
}

/**
 * The agent API key (pak_...) for the API-key paths. One set in the plugin config goes where the config points; one
 * from PROMETHEUS_API_KEY only ever goes to the production host, so an environment key cannot be steered elsewhere by
 * changing the address.
 */
export function agentApiKey(config: PluginConfig, env: Record<string, string | undefined> = process.env): string | undefined {
    return config.apiKey ?? (isDefaultHost(config.channelBaseUrl) ? env.PROMETHEUS_API_KEY : undefined);
}
