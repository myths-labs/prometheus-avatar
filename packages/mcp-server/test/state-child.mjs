// One of the "other MCP servers" in test/workspace-state.test.mjs: a separate process that writes unconfirmed operations to a
// shared state folder. Not a test file (the runner only picks up *.test.mjs).
//   node state-child.mjs '<json: { store, directory, apiKey, prefix, count, deleteOdd }>'
// It loads everything, says "ready", and starts only when the parent writes a line to stdin, so that both children begin at
// the same moment no matter how long each took to start.
import { uuidV5 } from '../.test-build/workspace-ids.js';

const config = JSON.parse(process.argv[2]);
const { createWorkspaceState } = await import('../.test-build/workspace-state.js');
const { createSingleFileState } = await import('./single-file-state.mjs');
const state = (config.store === 'single-file' ? createSingleFileState : createWorkspaceState)({ directory: config.directory, apiKey: config.apiKey });

const intentOf = (prefix, index) => `${prefix}-${index}`;
const operationOf = (prefix, index) => ({
    operationId: uuidV5(`operation-${prefix}-${index}`), entryId: uuidV5(`entry-${prefix}-${index}`), occurredAt: '2026-10-14T01:30:00.123Z',
    expectedRevision: 0, inputMode: 'agent', role: 'assistant', savedAt: Date.now(),
});

process.stdout.write('ready\n');
process.stdin.once('data', () => {
    for (let index = 0; index < config.count; index++) {
        state.setPending(intentOf(config.prefix, index), operationOf(config.prefix, index));
        if (config.deleteOdd && index % 2 === 1) state.deletePending(intentOf(config.prefix, index));
    }
    process.exit(0);
});
