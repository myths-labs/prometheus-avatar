// What the package keeps on disk between calls and across restarts of the MCP server (default ~/.prometheus-mcp/workspace-state/):
// the account id behind the key and, only while a write is unconfirmed, its operation id. One file per unconfirmed write, so that
// several MCP servers sharing the folder (Claude Desktop and Cursor) cannot erase each other's entries, and private to the user.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { keyFingerprint, createWorkspaceState } from '../.test-build/workspace-state.js';
import { uuidV5 } from '../.test-build/workspace-ids.js';
import { readTree } from './helpers.mjs';

const CHILD = fileURLToPath(new URL('./state-child.mjs', import.meta.url));
const KEY = 'pak_state_test_key_shared_by_all_processes';
const NOW = Date.parse('2026-10-14T02:00:00.000Z');
const operation = (n, extra = {}) => ({ operationId: uuidV5(`operation-${n}`), entryId: uuidV5(`entry-${n}`), occurredAt: '2026-10-14T01:30:00.123Z',
    expectedRevision: 0, inputMode: 'agent', role: 'assistant', savedAt: NOW, ...extra });
const withFolder = async (name, body) => {
    const root = mkdtempSync(join(tmpdir(), `k10-state-${name}-`));
    try { return await body(root); } finally { rmSync(root, { recursive: true, force: true }); }
};
const pendingFolder = (directory, apiKey = KEY) => join(directory, 'workspace-state', 'pending', keyFingerprint(apiKey));
const pendingFiles = (directory, apiKey = KEY) => { try { return readdirSync(pendingFolder(directory, apiKey)).filter(name => name.endsWith('.json')); } catch { return []; } };

/** Starts one child process per entry of `children`, waits until all are loaded, releases them together, and waits for them to finish. */
async function race(store, directory, children, count = 100) {
    const running = children.map(config => {
        const child = spawn(process.execPath, [CHILD, JSON.stringify({ store, directory, apiKey: KEY, count, ...config })], { stdio: ['pipe', 'pipe', 'inherit'] });
        const ready = new Promise((resolve, reject) => {
            let seen = ''; child.stdout.on('data', chunk => { seen += chunk; if (seen.includes('ready')) resolve(); });
            child.once('error', reject); child.once('exit', code => reject(new Error(`child ${config.prefix} exited (${code}) before it was ready`)));
        });
        const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ prefix: config.prefix, code, signal })));
        return { child, ready, exited };
    });
    const watchdog = setTimeout(() => running.forEach(({ child }) => child.kill()), 90_000); // only our own children
    try {
        await Promise.all(running.map(({ ready }) => ready));
        for (const { child } of running) child.stdin.write('go\n');
        const results = await Promise.all(running.map(({ exited }) => exited));
        for (const result of results) assert.deepEqual([result.code, result.signal], [0, null], `child ${result.prefix} finished cleanly`);
    } finally { clearTimeout(watchdog); running.forEach(({ child }) => child.kill()); }
}

test('state files: folders are 0700, files 0600 after every write, the key and any content are never written', () => withFolder('mode', root => {
    const directory = join(root, 'prometheus-mcp'); // does not exist yet: the package creates it
    const state = createWorkspaceState({ directory, apiKey: KEY, now: () => NOW });
    state.setAccount(randomUUID());
    state.setPending('intent', operation(1));
    const tree = readTree(directory);
    const paths = Object.keys(tree).filter(path => path !== '.');
    assert.ok(paths.some(path => !tree[path].directory), 'something was written');
    for (const [path, item] of Object.entries(tree)) {
        if (item.directory) assert.equal(item.mode, '700', `folder ${path}: only the owner can list or enter it`);
        else {
            assert.equal(item.mode, '600', `file ${path}: only the owner can read it`);
            assert.doesNotMatch(item.text, /pak_/, `file ${path} holds no key`);
            assert.doesNotMatch(path, /intent/, 'file names do not spell out the call');
        }
    }
    // A file loosened by hand (or by an older copy) is private again after the next write of the same thing.
    const files = paths.filter(path => !tree[path].directory);
    for (const path of files) chmodSync(join(directory, path), 0o644);
    state.setAccount(randomUUID());
    state.setPending('intent', operation(1));
    for (const path of files) assert.equal(readTree(directory)[path].mode, '600', `${path} is 0600 again`);
}));

test('state files: set, get, replace and delete work, one unconfirmed write per file, and a second instance reads what the first wrote', () => withFolder('basic', root => {
    const first = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.equal(first.getAccount(), undefined);
    assert.equal(first.getPending('a'), undefined);
    const account = randomUUID();
    first.setAccount(account);
    first.setPending('a', operation(1)); first.setPending('b', operation(2));
    assert.equal(pendingFiles(root).length, 2, 'two calls, two files');
    const second = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.equal(second.getAccount(), account);
    assert.deepEqual(second.getPending('a'), operation(1));
    first.setPending('a', operation(3)); // the same call again: replaced, not added
    assert.equal(pendingFiles(root).length, 2);
    assert.deepEqual(second.getPending('a'), operation(3));
    second.deletePending('b');
    assert.equal(pendingFiles(root).length, 1);
    assert.equal(first.getPending('b'), undefined, 'a delete by another instance is seen');
    second.clearAccount();
    assert.equal(createWorkspaceState({ directory: root, apiKey: KEY }).getAccount(), undefined);
    // Another key in the same folder is a different person's business.
    const other = createWorkspaceState({ directory: root, apiKey: 'pak_some_other_key', now: () => NOW });
    assert.equal(other.getPending('a'), undefined);
}));

test('state files: with no folder (memory only) everything still works and nothing is written', () => {
    const state = createWorkspaceState({ directory: null, apiKey: KEY, now: () => NOW });
    state.setAccount('acct'); state.setPending('a', operation(1));
    assert.equal(state.getAccount(), 'acct');
    assert.deepEqual(state.getPending('a'), operation(1));
    state.deletePending('a'); state.clearAccount();
    assert.equal(state.getPending('a'), undefined);
    assert.equal(state.getAccount(), undefined);
});

test('two MCP servers writing 100 unconfirmed operations each at the same moment: all 200 are there afterwards, none half-written', () => withFolder('race', async root => {
    await race('per-file', root, [{ prefix: 'A' }, { prefix: 'B' }]);
    assert.equal(pendingFiles(root).length, 200, 'one file per operation, no tmp leftovers counted');
    assert.deepEqual(readdirSync(pendingFolder(root)).filter(name => !name.endsWith('.json')), [], 'no temporary file is left behind');
    const reader = createWorkspaceState({ directory: root, apiKey: KEY });
    const lost = [];
    for (const prefix of ['A', 'B']) for (let index = 0; index < 100; index++) {
        const found = reader.getPending(`${prefix}-${index}`);
        if (!found || found.operationId !== uuidV5(`operation-${prefix}-${index}`)) lost.push(`${prefix}-${index}`);
    }
    assert.deepEqual(lost, [], `${lost.length} of 200 were lost`);
    for (const [path, item] of Object.entries(readTree(root))) if (!item.directory) { JSON.parse(item.text); assert.equal(item.mode, '600', path); }
}));

test('a delete in one MCP server does not touch what the other one wrote at the same time', () => withFolder('race-delete', async root => {
    // A writes 100 and deletes the odd-numbered ones as it goes; B writes 100 and deletes nothing.
    await race('per-file', root, [{ prefix: 'A', deleteOdd: true }, { prefix: 'B' }]);
    const reader = createWorkspaceState({ directory: root, apiKey: KEY });
    const present = prefix => Array.from({ length: 100 }, (_, index) => index).filter(index => reader.getPending(`${prefix}-${index}`)).length;
    assert.equal(present('B'), 100, 'everything B wrote is still there');
    assert.equal(present('A'), 50, 'A kept its even-numbered ones and deleted its odd-numbered ones');
    assert.equal(pendingFiles(root).length, 150);
}));

test('control: the same race against ONE shared file (how it used to be kept) does lose entries - so the test above can fail', async t => {
    // Losing an update needs the two processes to overlap; they are released together, and a round that happens not to overlap is repeated.
    let worst = 0;
    for (let round = 1; round <= 6; round++) {
        const lost = await withFolder('single', async root => {
            await race('single-file', root, [{ prefix: 'A' }, { prefix: 'B' }]);
            const file = JSON.parse(readFileSync(join(root, 'workspace-state.json'), 'utf8'));
            return 200 - Object.keys(file.pending[keyFingerprint(KEY)] ?? {}).length;
        });
        worst = Math.max(worst, lost);
        t.diagnostic(`round ${round}: one shared file kept ${200 - lost} of 200 entries (${lost} lost)`);
        if (lost > 0) break;
    }
    assert.ok(worst > 0, 'a single shared file that is read, changed and written back loses updates under this race; if it did not here, the race above would prove nothing');
});

test('an old single-file state is moved into the new layout (other keys too), expired entries are dropped, and the old file is removed', () => withFolder('legacy', root => {
    const other = 'pak_the_second_key_on_this_machine';
    const legacy = { version: 1,
        accounts: { [keyFingerprint(KEY)]: 'account-of-first-key', [keyFingerprint(other)]: 'account-of-second-key', '../../escape': 'must never be used as a path' },
        pending: {
            [keyFingerprint(KEY)]: { 'intent-live': operation(1), 'intent-expired': operation(2, { savedAt: NOW - 25 * 3600 * 1000 }), 'intent-broken': { operationId: 5 } },
            [keyFingerprint(other)]: { 'intent-other': operation(3) },
            '../../escape': { 'intent-x': operation(4) },
        } };
    writeFileSync(join(root, 'workspace-state.json'), JSON.stringify(legacy));
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.equal(state.getAccount(), 'account-of-first-key');
    assert.deepEqual(state.getPending('intent-live'), operation(1));
    assert.equal(state.getPending('intent-expired'), undefined);
    assert.equal(state.getPending('intent-broken'), undefined);
    assert.equal(existsSync(join(root, 'workspace-state.json')), false, 'the old file is gone once everything was moved');
    const second = createWorkspaceState({ directory: root, apiKey: other, now: () => NOW });
    assert.equal(second.getAccount(), 'account-of-second-key');
    assert.deepEqual(second.getPending('intent-other'), operation(3));
    assert.deepEqual(readdirSync(root), ['workspace-state'], 'nothing was written outside the state folder (no path taken from the old file)');
    for (const [path, item] of Object.entries(readTree(root))) assert.equal(item.mode, item.directory ? '700' : '600', path);
}));

test('moving an old single-file state never overwrites what the new layout already holds', () => withFolder('legacy-newer', root => {
    createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).setPending('intent', operation(9)); // already in the new layout
    writeFileSync(join(root, 'workspace-state.json'), JSON.stringify({ version: 1, accounts: {}, pending: { [keyFingerprint(KEY)]: { intent: operation(1) } } }));
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.deepEqual(state.getPending('intent'), operation(9), 'the newer entry wins');
    assert.equal(existsSync(join(root, 'workspace-state.json')), false);
}));

test('an old single-file state that cannot be moved is not lost: it stays usable, stays on disk, and is moved on a later call', () => withFolder('legacy-blocked', root => {
    writeFileSync(join(root, 'workspace-state.json'), JSON.stringify({ version: 1, accounts: { [keyFingerprint(KEY)]: 'acct' },
        pending: { [keyFingerprint(KEY)]: { 'intent-live': operation(1) } } }));
    writeFileSync(join(root, 'workspace-state'), 'a file where the folder should be, so nothing can be created there');
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.deepEqual(state.getPending('intent-live'), operation(1), 'still answered, from memory');
    assert.equal(state.getAccount(), 'acct');
    assert.equal(existsSync(join(root, 'workspace-state.json')), true, 'the old file is kept while it could not be moved');
    assert.deepEqual(createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending('intent-live'), operation(1),
        'a new process still finds the entry');
    rmSync(join(root, 'workspace-state'));
    assert.deepEqual(state.getPending('intent-live'), operation(1));
    assert.equal(existsSync(join(root, 'workspace-state.json')), false, 'moved on the next call, now that the folder can be made');
    assert.deepEqual(createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending('intent-live'), operation(1));
}));

test('entries expire after 24 hours, and files that are not valid are ignored and swept by the next write', () => withFolder('expiry', root => {
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    state.setPending('old', operation(1, { savedAt: NOW - 23 * 3600 * 1000 }));
    assert.ok(createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending('old'), 'still valid after 23 hours');
    const later = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW + 2 * 3600 * 1000 });
    assert.equal(later.getPending('old'), undefined, 'expired after 25 hours');
    writeFileSync(join(pendingFolder(root), 'garbage.json'), '{ not json');
    writeFileSync(join(pendingFolder(root), 'wrong-shape.json'), JSON.stringify({ operationId: 1 }));
    assert.equal(later.getPending('nothing here'), undefined, 'garbage in the folder does not disturb a read');
    later.setPending('fresh', operation(2, { savedAt: NOW + 2 * 3600 * 1000 }));
    assert.equal(pendingFiles(root).length, 1, 'only the fresh one is left: the expired and the two invalid files are swept');
}));

test('at most 200 unconfirmed operations are kept per key: the newest', () => withFolder('cap', root => {
    const busy = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    for (let n = 0; n < 205; n++) busy.setPending(`call-${n}`, operation(100 + n, { savedAt: NOW - 205 * 1000 + n * 1000 }));
    const fresh = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.equal(pendingFiles(root).length, 200);
    assert.equal(fresh.getPending('call-0'), undefined, 'the oldest are the ones dropped');
    assert.equal(fresh.getPending('call-4'), undefined);
    assert.ok(fresh.getPending('call-5'));
    assert.ok(fresh.getPending('call-204'));
}));

test('a folder that is deleted by hand while a write is unconfirmed does not make this process forget it; one that another server emptied does', () => withFolder('deleted', root => {
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    state.setPending('a', operation(1));
    rmSync(join(root, 'workspace-state'), { recursive: true, force: true });
    assert.deepEqual(state.getPending('a'), operation(1), 'the folder is gone, so this process falls back on what it remembers');
    assert.equal(createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending('a'), undefined, 'a restarted server has nothing to go on');
    state.setPending('b', operation(2)); // the folder is made again by the next write
    createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).deletePending('b');
    assert.equal(state.getPending('b'), undefined, 'finished by another server: not brought back from memory');
}));

test('when the folder cannot be written, the unconfirmed operation is still remembered by this process', () => withFolder('unwritable', root => {
    writeFileSync(join(root, 'workspace-state'), 'a file where the folder should be');
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    state.setAccount('acct'); state.setPending('a', operation(1));
    assert.equal(state.getAccount(), 'acct');
    assert.deepEqual(state.getPending('a'), operation(1));
    state.deletePending('a');
    assert.equal(state.getPending('a'), undefined);
}));
