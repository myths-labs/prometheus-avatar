// The way the state used to be kept: ONE json file, read whole, changed in memory, written back whole.
// It is here only as the control for test/workspace-state.test.mjs: the same two-process race that the real store survives
// must visibly lose entries with this one, otherwise the race proves nothing. Do not use it anywhere else.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyFingerprint } from '../.test-build/workspace-state.js';

export function createSingleFileState({ directory, apiKey }) {
    const file = join(directory, 'workspace-state.json'), fingerprint = keyFingerprint(apiKey);
    const load = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { version: 1, accounts: {}, pending: {} }; } };
    const change = apply => {
        const state = load(); apply(state);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
        renameSync(temporary, file);
    };
    return {
        getPending: intent => load().pending[fingerprint]?.[intent],
        setPending: (intent, operation) => change(state => { (state.pending[fingerprint] ??= {})[intent] = operation; }),
        deletePending: intent => change(state => { delete state.pending[fingerprint]?.[intent]; }),
        count: () => Object.keys(load().pending[fingerprint] ?? {}).length,
    };
}
