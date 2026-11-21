import type { PluginApi, PluginConfig } from './types';
import { DEFAULT_BASE, agentApiKey, safeOrigin } from './hostRules';

const STATE_PATH = '/api/agent/avatar/state';
/** A payload that could not be delivered this long after it was wanted is stale and is dropped. */
const STALE_MS = 30_000;

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
    /** How long to hold off after "this account has no avatar yet", ms. */
    noAvatarBackoffMs?: number;
}

/**
 * Agent activity -> the user's Prometheus avatar, through the companion-state channel the platform already runs
 * (`POST /api/agent/avatar/state`, the same one the MCP `set_avatar_state` tool uses). Any avatar page the user has
 * open follows within a few seconds, so this works in the OpenClaw gateway, which has no page of its own.
 *
 * The plugin keeps the newest state it wants to show until the server has it. Pushes happen on transitions only (a
 * state that is already on the server is not sent again), are spaced out, and a newer state replaces an older one that
 * has not gone out yet. The server replaces the whole state on every push, so a finished message is sent as
 * `{ emotion }` alone: that leaves "thinking" and shows the emotion (the avatar page reads `state` before `emotion`).
 * The hooks only observe; a failed push never touches the agent, and one that keeps failing is dropped after 30 s.
 * A 404 with an error text means the account has no avatar yet: pushes wait a minute and try again. A 404 without one
 * (the route does not exist) or a rejected key turns the pushes off for the rest of the process, with one log line.
 * Needs an agent API key (`apiKey` config, or PROMETHEUS_API_KEY for the production host). Turn it off with
 * `companionState: false`.
 */
export function attachCompanion(d: CompanionDeps): void {
    const { api, config } = d;
    if (config.companionState === false) return;

    const baseRaw = (config.channelBaseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    const apiKey = agentApiKey(config);
    if (!apiKey) return;                       // no key, nothing to push with; the tools explain how to get one
    if (!safeOrigin(baseRaw)) {
        api.logger.warn('Avatar state updates are off: the Prometheus address must be https (or http on localhost), so the API key is never sent unencrypted.');
        return;
    }

    const now = d.now ?? Date.now;
    const minInterval = d.minIntervalMs ?? 1500;
    const noAvatarBackoff = d.noAvatarBackoffMs ?? 60_000;
    let disabled = false;
    let delivered: string | null = null;       // JSON of the last payload the server accepted
    let desired: CompanionPayload | null = null;   // the newest payload still to deliver
    let desiredAt = 0;
    let lastSentAt = 0;
    let notBefore = 0;                         // no attempt before this time after a refusal or a failure
    let failures = 0;
    let timer: { unref?: () => void } | undefined;
    let inFlight = false;
    let networkWarned = false;
    let noAvatarLogged = false;

    /** true = the server has it. */
    const send = async (body: string): Promise<boolean> => {
        inFlight = true;
        lastSentAt = now();
        try {
            const res = await (d.fetchImpl ?? fetch)(`${baseRaw}${STATE_PATH}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body,
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) { delivered = body; failures = 0; networkWarned = false; return true; }
            if (res.status === 404) {
                const err = await res.json().then((j: { error?: unknown }) => j?.error, () => undefined);
                if (typeof err === 'string') {
                    notBefore = now() + noAvatarBackoff;
                    if (!noAvatarLogged) {
                        noAvatarLogged = true;
                        api.logger.info('Avatar state updates are waiting: this Prometheus account has no avatar yet (create one on the site). I will keep trying.');
                    }
                } else {
                    disabled = true;
                    api.logger.info('Avatar state updates are off: this Prometheus deployment has no companion state channel yet.');
                }
            } else if (res.status === 401 || res.status === 403) {
                disabled = true;
                api.logger.warn('Avatar state updates are off: Prometheus rejected the agent API key (check the apiKey setting; it must be a pak_… key from the Prometheus agent-keys page).');
            } else {
                failures++;
                notBefore = now() + Math.min(20_000, 1000 * 2 ** failures);
                api.logger.debug?.(`Avatar state update failed (HTTP ${res.status}).`);
            }
        } catch (err) {
            failures++;
            notBefore = now() + Math.min(20_000, 1000 * 2 ** failures);
            if (!networkWarned) {
                networkWarned = true;
                api.logger.debug?.(`Avatar state update failed: ${(err as Error).message}`);
            }
        } finally {
            inFlight = false;
        }
        return false;
    };

    const flush = () => {
        timer = undefined;
        if (disabled || inFlight || !desired) return;
        if (now() - desiredAt > STALE_MS) { desired = null; return; }
        const sending = desired;
        const body = JSON.stringify(sending);
        if (body === delivered) { desired = null; return; }      // already what the server shows
        void send(body).then((ok) => {
            if (ok && desired === sending) desired = null;        // a newer payload that arrived meanwhile stays
            if (desired && !disabled) schedule();
        });
    };
    const schedule = () => {
        if (timer || inFlight || disabled) return;
        const wait = Math.max(0, lastSentAt + minInterval - now(), notBefore - now());
        timer = setTimeout(flush, wait) as unknown as { unref?: () => void };
        timer.unref?.();
    };
    const push = (p: CompanionPayload) => {
        if (disabled) return;
        desired = p;                                             // the newest payload wins
        desiredAt = now();
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
            push({ emotion });
        } catch {
            push({ state: 'done' });
        }
    });
}
