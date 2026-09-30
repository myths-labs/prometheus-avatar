/**
 * Prometheus Avatar plugin for OpenClaw.
 *
 * - Seller channel: connect this OpenClaw to a Prometheus seller account (RFC 8628 device flow) and publish
 *   listings at the OpenClaw rate: prometheus_connect_seller, prometheus_connection_status,
 *   prometheus_publish_listing (+ prometheus_deploy_asset, the older name), prometheus_disconnect_seller.
 * - Image tools: prometheus_generate_image_pro, prometheus_generate_thumbnail.
 * - Avatar bridge: agent events -> on-screen avatar, where the host gives the plugin a page element.
 * - Companion state: agent activity -> the user's Prometheus avatar through the platform's state channel (works in the gateway).
 *
 * `register` must be synchronous (OpenClaw rejects an async one), so everything slow happens inside the tools.
 * The default export is a plain object: OpenClaw only needs `register`, and nothing here imports the host.
 */
import { RuntimeKeyStore } from './keyStore';
import { SellerConnection } from './sellerConnection';
import type { CoreModule } from './sellerConnection';
import { buildTools } from './tools';
import { attachAvatarBridge } from './avatarBridge';
import { attachCompanion } from './companion';
import { PLUGIN_VERSION } from './version';
import type { PluginApi, PluginConfig } from './types';

function register(api: PluginApi): void {
    const config = (api.pluginConfig ?? {}) as PluginConfig;

    let core: Promise<CoreModule> | undefined;
    const loadCore = () => (core ??= import('@prometheusavatar/core') as unknown as Promise<CoreModule>);

    const store = new RuntimeKeyStore(api, api.logger);
    const conn = new SellerConnection({
        loadCore,
        store,
        log: api.logger,
        pluginVersion: PLUGIN_VERSION,
        runtimeVersion: api.runtime.version,
        baseUrl: config.channelBaseUrl,
    });

    for (const tool of buildTools({ conn, loadCore, config, logInfo: (m) => api.logger.info(m) })) {
        api.registerTool(tool);
    }

    attachAvatarBridge(api, config, loadCore);
    attachCompanion({
        api,
        config,
        loadAnalyzer: async () => new ((await loadCore()) as unknown as { EmotionAnalyzer: new () => { analyze(t: string): { emotion: 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'neutral' } } }).EmotionAnalyzer(),
    });
}

export default {
    id: 'prometheus-avatar',
    name: 'Prometheus Avatar',
    description: 'Sell on Prometheus Marketplace from OpenClaw at the OpenClaw seller rate, generate AAA images, and give your agent an avatar.',
    register,
};
