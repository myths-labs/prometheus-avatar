import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeSite } from './fake-site.mjs';
import { workspaceApi } from '../.test-build/workspace-api.js';
import { createWorkspaceState } from '../.test-build/workspace-state.js';
import { createWorkspaceWriter } from '../.test-build/workspace-writer.js';

export const signal = () => new AbortController().signal;

/** A fake website plus a way to start (and "restart") a writer against it. */
export async function harness(siteOptions = {}, { clock, writerOptions = {}, persist = false, apiKey } = {}) {
    const site = await startFakeSite(siteOptions);
    const directory = persist ? mkdtempSync(join(tmpdir(), 'k10-state-')) : null;
    const key = apiKey ?? site.key;
    const start = (extra = {}) => {
        const api = workspaceApi(site.url, key, 'test');
        const state = createWorkspaceState({ directory, apiKey: key, now: clock ? () => clock().getTime() : undefined });
        const writer = createWorkspaceWriter(() => api, state, { now: clock, ...writerOptions, ...extra });
        return { api, state, writer };
    };
    return { site, directory, start, ...start(), async stop() { await site.close(); if (directory) rmSync(directory, { recursive: true, force: true }); } };
}
export const fixedClock = (iso = '2026-10-14T01:30:00.123Z') => { let t = Date.parse(iso); const clock = () => new Date(t); clock.advance = ms => { t += ms; }; return clock; };
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const ENTRY_KEYS = ['archived', 'categoryId', 'content', 'dueOn', 'entryId', 'expectedRevision', 'inputMode', 'kind', 'occurredAt', 'role', 'status'];
