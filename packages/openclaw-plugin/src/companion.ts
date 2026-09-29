import type { PluginApi, PluginConfig } from './types';

const DEFAULT_BASE = 'https://prometheus.mythslabs.ai';
const STATE_PATH = '/api/agent/avatar/state';

export interface CompanionPayload {
    state?: 'listening' | 'thinking' | 'acting' | 'done';
    emotion?: 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'neutral';
}

interface AnalyzerLike { analyze(text: string): { emotion: NonNullable<CompanionPayload['emotion']> } }

export interface CompanionDeps {
    api: PluginApi;
    config: PluginConfig;
    /** Loads the core package; only used to analyse the emotion of a sent message. */
    loadAnalyzer: () => Promise<AnalyzerLike>;
    fetchImpl?: typeof fetch;
    now?: () => number;
    /** Lowest gap between two pushes, ms. */
    minIntervalMs?: number;
}

function isLoopbackHttp(u: URL) {
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
}

/**
 * Agent activity -> the user's Prometheus avatar, through the companion-state channel the platform already runs
 * (`POST /api/agent/avatar/state`, the same one the MCP `set_avatar_state` tool uses). Any avatar page the user has
 * open follows within a few seconds, so this works in the OpenClaw gateway, which has no page of its own.
 *
 * Pushes happen on transitions only: identical consecutive payloads are dropped and the rest are spaced out, with the
 * newest one winning. The hooks only observe; a failed push never touches the agent. On a 404 (a platform build without
 * the channel) or a rejected key the pushes turn off for the rest of the process, with one log line.
 * Needs an agent API key (`apiKey` config or PROMETHEUS_API_KEY). Turn it off with `companionState: false`.
 */
export function attachCompanion(d: CompanionDeps): void {
    const { api, config } = d;
    if (config.companionState === false) return;

    const baseRaw = (config.channelBaseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    const isDefaultHost = baseRaw === DEFAULT_BASE;
    // The env key only ever goes to the production host, like AssetCreator does.
    const envKey = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PROMETHEUS_API_KEY;
    const apiKey = config.apiKey ?? (isDefaultHost ? envKey : undefined);
    if (!apiKey) return;                       // no key, nothing to push with; the tools explain how to get one
    let base: URL;
    try { base = new URL(baseRaw); } catch { return; }
    if (base.protocol !== 'https:' && !isLoopbackHttp(base)) {
        api.logger.warn('Avatar state updates are off: the Prometheus address must be https (or http on localhost), so the API key is never sent unencrypted.');
        return;
    }

    const now = d.now ?? Date.now;
    const minInterval = d.minIntervalMs ?? 1500;
    let disabled = false;
    let last: string | null = null;          // last payload delivered (JSON)
    let lastSentAt = 0;
    let pending: CompanionPayload | null = null;
    let timer: { unref?: () => void } | undefined;
    let inFlight = false;
    let networkWarned = false;

    const send = async (payload: CompanionPayload) => {
        const body = JSON.stringify(payload);
        if (body === last) return;
        inFlight = true;
        lastSentAt = now();
        try {
            const res = await (d.fetchImpl ?? fetch)(`${baseRaw}${STATE_PATH}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body,
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) { last = body; networkWarned = false; return; }
            if (res.status === 404) {
                disabled = true;
                api.logger.info('Avatar state updates are off: this Prometheus deployment has no companion state channel yet.');
            } else if (res.status === 401 || res.status === 403) {
                disabled = true;
                api.logger.warn('Avatar state updates are off: Prometheus rejected the agent API key (check the apiKey setting; it must be a pak_… key from the Prometheus agent-keys page).');
            } else {
                api.logger.debug?.(`Avatar state update failed (HTTP ${res.status}).`);
            }
        } catch (err) {
            if (!networkWarned) {
                networkWarned = true;
                api.logger.debug?.(`Avatar state update failed: ${(err as Error).message}`);
            }
        } finally {
            inFlight = false;
        }
    };

    const flush = () => {
        timer = undefined;
        const p = pending;
        pending = null;
        if (p && !disabled) void send(p).then(() => { if (pending) schedule(); });
    };
    const schedule = () => {
        if (timer || inFlight) return;
        const wait = Math.max(0, lastSentAt + minInterval - now());
        timer = setTimeout(flush, wait) as unknown as { unref?: () => void };
        timer.unref?.();
    };
    const push = (p: CompanionPayload) => {
        if (disabled) return;
        if (JSON.stringify(p) === last && !pending) return;     // no transition
        pending = p;                                             // the newest payload wins
        schedule();
    };

    let analyzer: Promise<AnalyzerLike> | undefined;

    api.on('model_call_started', () => { push({ state: 'thinking' }); });
    api.on('model_call_ended', (event: { outcome?: string }) => {
        if (event?.outcome === 'error') push({ emotion: 'surprised' });
    });
    api.on('message_sent', async (event: { content?: string; success?: boolean }) => {
        if (!event?.content || event.success === false) return;
        if (config.enableEmotion === false) { push({ state: 'done' }); return; }
        try {
            analyzer ??= d.loadAnalyzer();
            const { emotion } = (await analyzer).analyze(event.content);
            push({ state: 'done', emotion });
        } catch {
            push({ state: 'done' });
        }
    });
}
