import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeSite } from './fake-site.mjs';
import { workspaceApi } from '../.test-build/workspace-api.js';
import { createWorkspaceState } from '../.test-build/workspace-state.js';
import { createWorkspaceWriter } from '../.test-build/workspace-writer.js';

export const signal = () => new AbortController().signal;

/** A fake website plus a way to start (and "restart") a writer against it. `start({ apiKey })` restarts with another key, same state folder. */
export async function harness(siteOptions = {}, { clock, writerOptions = {}, persist = false, apiKey } = {}) {
    const site = await startFakeSite(siteOptions);
    const directory = persist ? mkdtempSync(join(tmpdir(), 'k10-state-')) : null;
    const key = apiKey ?? site.key;
    const start = ({ apiKey: otherKey, ...extra } = {}) => {
        const api = workspaceApi(site.url, otherKey ?? key, 'test');
        const state = createWorkspaceState({ directory, apiKey: otherKey ?? key, now: clock ? () => clock().getTime() : undefined });
        const writer = createWorkspaceWriter(() => api, state, { now: clock, ...writerOptions, ...extra });
        return { api, state, writer };
    };
    return { site, directory, start, ...start(), async stop() { await site.close(); if (directory) rmSync(directory, { recursive: true, force: true }); } };
}
export const fixedClock = (iso = '2026-10-14T01:30:00.123Z') => { let t = Date.parse(iso); const clock = () => new Date(t); clock.advance = ms => { t += ms; }; return clock; };
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const ENTRY_KEYS = ['archived', 'categoryId', 'content', 'dueOn', 'entryId', 'expectedRevision', 'inputMode', 'kind', 'occurredAt', 'role', 'status'];

/** Everything under a state directory: relative path -> { directory, mode, text }. For checks on what the package leaves on disk. */
export function readTree(root) {
    const out = {};
    const walk = relative => {
        const path = relative ? join(root, relative) : root;
        const info = statSync(path), mode = (info.mode & 0o777).toString(8);
        if (info.isDirectory()) {
            out[relative || '.'] = { directory: true, mode };
            for (const name of readdirSync(path)) walk(relative ? join(relative, name) : name);
        } else out[relative] = { directory: false, mode, text: readFileSync(path, 'utf8') };
    };
    walk('');
    return out;
}
