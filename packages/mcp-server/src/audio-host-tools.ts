import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AudioHostRuntime } from './audio-host-runtime.js';

export async function configuredAudioHost(apiBase: string, apiKey: string, version: string) {
    const origin = process.env.PROMETHEUS_AUDIO_HOST_ORIGIN, key = process.env.PROMETHEUS_AUDIO_HOST_KEY;
    if (!origin && !key) return undefined;
    if (!origin || !key) throw Error('audio_host_configuration_incomplete');
    const rawPort = process.env.PROMETHEUS_AUDIO_HOST_PORT ?? '8766';
    if (!/^\d{1,5}$/.test(rawPort)) throw Error('invalid_host_port');
    return AudioHostRuntime.start({ origin, key, port: Number(rawPort),
        directory: process.env.PROMETHEUS_AUDIO_HOST_DATA_DIR ?? path.join(os.homedir(), '.local/share/prometheus-avatar/audio-host'),
        apiBase, apiKey, version });
}

const target = z.object({ accountId: z.string().min(1).max(200), avatarId: z.string().min(1).max(200),
    hostSessionId: z.string().uuid(), selectionId: z.string().uuid() }).strict();
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const playback = { ...readOnly, readOnlyHint: false };
async function result(action: () => unknown | Promise<unknown>): Promise<CallToolResult> {
    try {
        const value = await action(), failed = !!value && typeof value === 'object' && 'error' in value;
        return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(failed ? { isError: true } : {}) };
    } catch (error) {
        const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'audio_host_operation_failed';
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code }) }] };
    }
}

export function registerAudioHostTools(server: McpServer, runtime: AudioHostRuntime | undefined): number {
    const active = () => { if (!runtime) throw Error('audio_host_disabled'); return runtime; };
    server.registerTool('prometheus_list_audio_hosts', {
        description: 'List explicitly paired local Avatar hosts and their exact current voice and selection. No pairing key is returned. Local audio requires configured PROMETHEUS_AUDIO_HOST_ORIGIN and PROMETHEUS_AUDIO_HOST_KEY.',
        inputSchema: {}, annotations: readOnly,
    }, () => result(() => runtime?.hosts() ?? { enabled: false, hosts: [] }));
    server.registerTool('prometheus_prepare_speech', {
        description: 'Prepare speech once for an exactly selected connected host. This can invoke paid synthesis. Supply a stable request UUID; identical request/content retries reuse durable intent. Uncertain results never automatically regenerate. Does not play audio.',
        inputSchema: { request_id: z.string().uuid(), target, text: z.string().trim().min(1).max(2000) },
        annotations: { ...playback, openWorldHint: true },
    }, ({ request_id, target, text }, { signal }) => result(() => active().prepare(request_id, target, text, signal)));
    server.registerTool('prometheus_get_prepared_speech', {
        description: 'Read the original prepared-speech status by request UUID for this agent principal, including after host disconnect or process restart. Never synthesizes or plays.',
        inputSchema: { request_id: z.string().uuid() }, annotations: readOnly,
    }, ({ request_id }) => result(() => active().preparation(request_id)));
    server.registerTool('prometheus_play_prepared_speech', {
        description: 'Send an existing prepared audio reference to its matching current account, Avatar and voice. Supply explicit command/playback UUIDs and the complete discovered target. Exact retries return the original ledger; cold selections never replay automatically. Never synthesizes.',
        inputSchema: { audio_id: z.string().uuid(), command_id: z.string().uuid(), playback_id: z.string().uuid(), target }, annotations: playback,
    }, ({ audio_id, command_id, playback_id, target }) => result(() => active().play(audio_id, command_id, playback_id, target)));
    server.registerTool('prometheus_stop_speech', {
        description: 'Request Stop for one original command and its exact host selection. Returns the current durable history; the host interrupted receipt confirms Stop. Does not stop unrelated commands or generate speech.',
        inputSchema: { command_id: z.string().uuid() }, annotations: playback,
    }, ({ command_id }) => result(() => active().stop(command_id)));
    server.registerTool('prometheus_get_speech_playback', {
        description: 'Read the original durable playback history. Optional refresh requests original receipts from that same connected host; it never replays or synthesizes. This returns the latest snapshot, not a wait for completion. Disconnect/crash may leave unknown status.',
        inputSchema: { command_id: z.string().uuid(), refresh: z.boolean().optional() }, annotations: readOnly,
    }, ({ command_id, refresh }) => result(() => active().playback(command_id, refresh)));
    return 6;
}
