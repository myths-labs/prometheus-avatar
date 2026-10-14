// The state file (~/.prometheus-mcp/workspace-state.json by default) holds the account id behind the key and the
// operation ids of unconfirmed writes. It must stay private to the user who runs the MCP server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorkspaceState } from '../.test-build/workspace-state.js';

const mode = path => (statSync(path).mode & 0o777).toString(8);

test('state file: the folder it creates is 0700, the file is 0600 after every write, and the key is never in it', () => {
    const root = mkdtempSync(join(tmpdir(), 'k10-mode-'));
    const directory = join(root, 'prometheus-mcp'); // does not exist yet: the package creates it
    try {
        const state = createWorkspaceState({ directory, apiKey: 'pak_permission_check_key' });
        state.setAccount(randomUUID());
        state.setPending('intent', { operationId: randomUUID(), entryId: randomUUID(), occurredAt: '2026-10-14T01:30:00.123Z',
            expectedRevision: 0, inputMode: 'agent', role: 'assistant', savedAt: Date.now() });
        const file = join(directory, 'workspace-state.json');
        assert.equal(mode(directory), '700', 'only the owner can list or enter the folder');
        assert.equal(mode(file), '600', 'only the owner can read the file');
        assert.doesNotMatch(readFileSync(file, 'utf8'), /pak_/, 'the key itself is never written');
        // A file loosened by hand (or by an older copy) is private again after the next write.
        chmodSync(file, 0o644);
        state.deletePending('intent');
        assert.equal(mode(file), '600');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
