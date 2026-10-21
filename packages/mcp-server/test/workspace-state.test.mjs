// What the package keeps on disk between calls and across restarts of the MCP server (default ~/.prometheus-mcp/workspace-state/):
// the account id behind the key and, only while a write is unconfirmed, its operation id. One file per unconfirmed write, so that
// several MCP servers sharing the folder (Claude Desktop and Cursor) cannot erase each other's records of different calls, and private to the user.
// Unconfirmed writes are filed per account, so a new key of the same account (the old one revoked) still finds them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { keyFingerprint, createWorkspaceState } from '../.test-build/workspace-state.js';
import { uuidV5 } from '../.test-build/workspace-ids.js';
import { readTree } from './helpers.mjs';

const CHILD = fileURLToPath(new URL('./state-child.mjs', import.meta.url));
const KEY = 'pak_state_test_key_shared_by_all_processes';
const ACCOUNT = '5a1d0c3e-7b2f-4c8a-9e1d-3f6b8a0c2d47';
const NOW = Date.parse('2026-10-14T02:00:00.000Z');
const operation = (n, extra = {}) => ({ operationId: uuidV5(`operation-${n}`), entryId: uuidV5(`entry-${n}`), occurredAt: '2026-10-14T01:30:00.123Z',
    expectedRevision: 0, inputMode: 'agent', role: 'assistant', savedAt: NOW, ...extra });
const withFolder = async (name, body) => {
    const root = mkdtempSync(join(tmpdir(), `k10-state-${name}-`));
    try { return await body(root); } finally { rmSync(root, { recursive: true, force: true }); }
};
const pendingFolder = (directory, account = ACCOUNT) => join(directory, 'workspace-state', 'pending-by-account', account);
const pendingFiles = (directory, account = ACCOUNT) => { try { return readdirSync(pendingFolder(directory, account)).filter(name => name.endsWith('.json')); } catch { return []; } };
/** Where builds before the per-account layout kept unconfirmed writes: one folder per key fingerprint. */
const keyFolder = (directory, apiKey = KEY) => join(directory, 'workspace-state', 'pending', keyFingerprint(apiKey));
const intentFile = intent => `${createHash('sha256').update(intent).digest('hex')}.json`;

/** Starts one child process per entry of `children`, waits until all are loaded, releases them together, and waits for them to finish. */
async function race(store, directory, children, count = 100) {
    const running = children.map(config => {
        const child = spawn(process.execPath, [CHILD, JSON.stringify({ store, directory, apiKey: KEY, accountId: ACCOUNT, count, ...config })], { stdio: ['pipe', 'pipe', 'inherit'] });
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
    state.setPending(ACCOUNT, 'intent', operation(1));
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
    state.setPending(ACCOUNT, 'intent', operation(1));
    for (const path of files) assert.equal(readTree(directory)[path].mode, '600', `${path} is 0600 again`);
}));

test('state files: set, get, replace and delete work, one unconfirmed write per file, and a second instance reads what the first wrote', () => withFolder('basic', root => {
    const first = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.equal(first.getAccount(), undefined);
    assert.equal(first.getPending(ACCOUNT, 'a'), undefined);
    const account = randomUUID();
    first.setAccount(account);
    first.setPending(ACCOUNT, 'a', operation(1)); first.setPending(ACCOUNT, 'b', operation(2));
    assert.equal(pendingFiles(root).length, 2, 'two calls, two files');
    const second = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.equal(second.getAccount(), account);
    assert.deepEqual(second.getPending(ACCOUNT, 'a'), operation(1));
    first.setPending(ACCOUNT, 'a', operation(3)); // the same call again: replaced, not added
    assert.equal(pendingFiles(root).length, 2);
    assert.deepEqual(second.getPending(ACCOUNT, 'a'), operation(3));
    second.deletePending(ACCOUNT, 'b');
    assert.equal(pendingFiles(root).length, 1);
    assert.equal(first.getPending(ACCOUNT, 'b'), undefined, 'a delete by another instance is seen');
    second.clearAccount();
    assert.equal(createWorkspaceState({ directory: root, apiKey: KEY }).getAccount(), undefined);
    // Another account in the same folder is a different person's business.
    const other = createWorkspaceState({ directory: root, apiKey: 'pak_some_other_key', now: () => NOW });
    assert.equal(other.getPending(randomUUID(), 'a'), undefined);
    // Another key of the SAME account (the user replaced a revoked key) sees the same unconfirmed writes: the website counts them per account.
    assert.deepEqual(other.getPending(ACCOUNT, 'a'), operation(3));
    assert.deepEqual(other.getPending(ACCOUNT.toUpperCase(), 'a'), operation(3), 'the account id is matched the way the website matches it, case-insensitively');
}));

test('finishing a write removes only its own record: another MCP server\'s later try of the same call (same file) stays remembered', () => withFolder('own-delete', root => {
    const first = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }), second = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    first.setPending(ACCOUNT, 'same', operation(1));
    second.setPending(ACCOUNT, 'same', operation(2)); // the other server makes the same call; its unconfirmed try replaces the file
    first.deletePending(ACCOUNT, 'same', operation(1).operationId); // the first server's try was confirmed
    const fresh = () => createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.deepEqual(fresh().getPending(ACCOUNT, 'same'), operation(2), 'the second server\'s try is not erased by the first one finishing');
    assert.deepEqual(first.getPending(ACCOUNT, 'same'), operation(2));
    second.deletePending(ACCOUNT, 'same', operation(2).operationId);
    assert.equal(fresh().getPending(ACCOUNT, 'same'), undefined, 'each server removes its own record');
    first.setPending(ACCOUNT, 'any', operation(3));
    first.deletePending(ACCOUNT, 'any');
    assert.equal(fresh().getPending(ACCOUNT, 'any'), undefined, 'without an operation id the record goes whatever it holds');
    const memoryOnly = createWorkspaceState({ directory: null, apiKey: KEY, now: () => NOW });
    memoryOnly.setPending(ACCOUNT, 'm', operation(4));
    memoryOnly.deletePending(ACCOUNT, 'm', operation(5).operationId);
    assert.deepEqual(memoryOnly.getPending(ACCOUNT, 'm'), operation(4), 'in memory too, only the named operation is removed');
}));

test('state files: with no folder (memory only) everything still works and nothing is written', () => {
    const state = createWorkspaceState({ directory: null, apiKey: KEY, now: () => NOW });
    state.setAccount('acct'); state.setPending(ACCOUNT, 'a', operation(1));
    assert.equal(state.getAccount(), 'acct');
    assert.deepEqual(state.getPending(ACCOUNT, 'a'), operation(1));
    state.deletePending(ACCOUNT, 'a'); state.clearAccount();
    assert.equal(state.getPending(ACCOUNT, 'a'), undefined);
    assert.equal(state.getAccount(), undefined);
});

test('two MCP servers writing 100 unconfirmed operations each at the same moment: all 200 are there afterwards, none half-written', () => withFolder('race', async root => {
    await race('per-file', root, [{ prefix: 'A' }, { prefix: 'B' }]);
    assert.equal(pendingFiles(root).length, 200, 'one file per operation, no tmp leftovers counted');
    assert.deepEqual(readdirSync(pendingFolder(root)).filter(name => !name.endsWith('.json')), [], 'no temporary file is left behind');
    const reader = createWorkspaceState({ directory: root, apiKey: KEY });
    const lost = [];
    for (const prefix of ['A', 'B']) for (let index = 0; index < 100; index++) {
        const found = reader.getPending(ACCOUNT, `${prefix}-${index}`);
        if (!found || found.operationId !== uuidV5(`operation-${prefix}-${index}`)) lost.push(`${prefix}-${index}`);
    }
    assert.deepEqual(lost, [], `${lost.length} of 200 were lost`);
    for (const [path, item] of Object.entries(readTree(root))) if (!item.directory) { JSON.parse(item.text); assert.equal(item.mode, '600', path); }
}));

test('a delete in one MCP server does not touch what the other one wrote at the same time', () => withFolder('race-delete', async root => {
    // A writes 100 and deletes the odd-numbered ones as it goes; B writes 100 and deletes nothing.
    await race('per-file', root, [{ prefix: 'A', deleteOdd: true }, { prefix: 'B' }]);
    const reader = createWorkspaceState({ directory: root, apiKey: KEY });
    const present = prefix => Array.from({ length: 100 }, (_, index) => index).filter(index => reader.getPending(ACCOUNT, `${prefix}-${index}`)).length;
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
    assert.deepEqual(state.getPending('account-of-first-key', 'intent-live'), operation(1));
    assert.equal(state.getPending('account-of-first-key', 'intent-expired'), undefined);
    assert.equal(state.getPending('account-of-first-key', 'intent-broken'), undefined);
    assert.equal(existsSync(join(root, 'workspace-state.json')), false, 'the old file is gone once everything was moved');
    const second = createWorkspaceState({ directory: root, apiKey: other, now: () => NOW });
    assert.equal(second.getAccount(), 'account-of-second-key');
    assert.deepEqual(second.getPending('account-of-second-key', 'intent-other'), operation(3));
    assert.equal(state.getPending('account-of-first-key', 'intent-other'), undefined, 'each entry went to its own account');
    assert.equal(existsSync(join(root, 'workspace-state', 'pending')), false, 'both keys had a known account, so no per-key folder is left');
    assert.deepEqual(readdirSync(root), ['workspace-state'], 'nothing was written outside the state folder (no path taken from the old file)');
    for (const [path, item] of Object.entries(readTree(root))) assert.equal(item.mode, item.directory ? '700' : '600', path);
}));

test('moving an old single-file state never overwrites what the new layout already holds', () => withFolder('legacy-newer', root => {
    createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).setPending(ACCOUNT, 'intent', operation(9)); // already in the new layout
    writeFileSync(join(root, 'workspace-state.json'), JSON.stringify({ version: 1, accounts: {}, pending: { [keyFingerprint(KEY)]: { intent: operation(1) } } }));
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.deepEqual(state.getPending(ACCOUNT, 'intent'), operation(9), 'the newer entry wins');
    assert.equal(existsSync(join(root, 'workspace-state.json')), false);
}));

test('an old single-file state that cannot be moved is not lost: it stays usable, stays on disk, and is moved on a later call', () => withFolder('legacy-blocked', root => {
    writeFileSync(join(root, 'workspace-state.json'), JSON.stringify({ version: 1, accounts: { [keyFingerprint(KEY)]: 'acct' },
        pending: { [keyFingerprint(KEY)]: { 'intent-live': operation(1) } } }));
    writeFileSync(join(root, 'workspace-state'), 'a file where the folder should be, so nothing can be created there');
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.deepEqual(state.getPending('acct', 'intent-live'), operation(1), 'still answered, from memory');
    assert.equal(state.getAccount(), 'acct');
    assert.equal(existsSync(join(root, 'workspace-state.json')), true, 'the old file is kept while it could not be moved');
    assert.deepEqual(createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending('acct', 'intent-live'), operation(1),
        'a new process still finds the entry');
    rmSync(join(root, 'workspace-state'));
    assert.deepEqual(state.getPending('acct', 'intent-live'), operation(1));
    assert.equal(existsSync(join(root, 'workspace-state.json')), false, 'moved on the next call, now that the folder can be made');
    assert.deepEqual(createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending('acct', 'intent-live'), operation(1));
    assert.equal(existsSync(join(root, 'workspace-state', 'pending')), false, 'and on from the per-key folder to its account');
}));

test('entries expire after 24 hours, and files that are not valid are ignored and swept by the next write', () => withFolder('expiry', root => {
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    state.setPending(ACCOUNT, 'old', operation(1, { savedAt: NOW - 23 * 3600 * 1000 }));
    assert.ok(createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending(ACCOUNT, 'old'), 'still valid after 23 hours');
    const later = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW + 2 * 3600 * 1000 });
    assert.equal(later.getPending(ACCOUNT, 'old'), undefined, 'expired after 25 hours');
    writeFileSync(join(pendingFolder(root), 'garbage.json'), '{ not json');
    writeFileSync(join(pendingFolder(root), 'wrong-shape.json'), JSON.stringify({ operationId: 1 }));
    assert.equal(later.getPending(ACCOUNT, 'nothing here'), undefined, 'garbage in the folder does not disturb a read');
    later.setPending(ACCOUNT, 'fresh', operation(2, { savedAt: NOW + 2 * 3600 * 1000 }));
    assert.equal(pendingFiles(root).length, 1, 'only the fresh one is left: the expired and the two invalid files are swept');
}));

test('at most 200 unconfirmed operations are kept per account: the newest', () => withFolder('cap', root => {
    const busy = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    for (let n = 0; n < 205; n++) busy.setPending(ACCOUNT, `call-${n}`, operation(100 + n, { savedAt: NOW - 205 * 1000 + n * 1000 }));
    const fresh = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.equal(pendingFiles(root).length, 200);
    assert.equal(fresh.getPending(ACCOUNT, 'call-0'), undefined, 'the oldest are the ones dropped');
    assert.equal(fresh.getPending(ACCOUNT, 'call-4'), undefined);
    assert.ok(fresh.getPending(ACCOUNT, 'call-5'));
    assert.ok(fresh.getPending(ACCOUNT, 'call-204'));
}));

test('a folder that is deleted by hand while a write is unconfirmed does not make this process forget it; one that another server emptied does', () => withFolder('deleted', root => {
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    state.setPending(ACCOUNT, 'a', operation(1));
    rmSync(join(root, 'workspace-state'), { recursive: true, force: true });
    assert.deepEqual(state.getPending(ACCOUNT, 'a'), operation(1), 'the folder is gone, so this process falls back on what it remembers');
    assert.equal(createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending(ACCOUNT, 'a'), undefined, 'a restarted server has nothing to go on');
    state.setPending(ACCOUNT, 'b', operation(2)); // the folder is made again by the next write
    createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).deletePending(ACCOUNT, 'b');
    assert.equal(state.getPending(ACCOUNT, 'b'), undefined, 'finished by another server: not brought back from memory');
}));

test('when the folder cannot be written, the unconfirmed operation is still remembered by this process', () => withFolder('unwritable', root => {
    writeFileSync(join(root, 'workspace-state'), 'a file where the folder should be');
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    state.setAccount('acct'); state.setPending(ACCOUNT, 'a', operation(1));
    assert.equal(state.getAccount(), 'acct');
    assert.deepEqual(state.getPending(ACCOUNT, 'a'), operation(1));
    state.deletePending(ACCOUNT, 'a');
    assert.equal(state.getPending(ACCOUNT, 'a'), undefined);
}));

// ───────────── Per-key folders of earlier builds (before unconfirmed writes were filed per account) ─────────────
/** Writes a file the way an earlier build left it: private folder, private file. */
const plant = (path, value) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
};
const accountOnFile = (root, apiKey, accountId) => plant(join(root, 'workspace-state', 'accounts', `${keyFingerprint(apiKey)}.json`), { accountId });
const REVOKED = 'pak_the_key_the_user_replaced';

test('per-key folders of an earlier build move on start to the account each key belongs to: a new key of that account finds the write, and starting again changes nothing', () => withFolder('key-folders', root => {
    const OTHER = 'pak_a_key_of_someone_else', otherAccount = randomUUID();
    accountOnFile(root, REVOKED, ACCOUNT);
    accountOnFile(root, OTHER, otherAccount);
    plant(join(keyFolder(root, REVOKED), intentFile('intent-live')), operation(1));
    plant(join(keyFolder(root, OTHER), intentFile('intent-other')), operation(2));
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }); // a key never used on this machine before
    assert.equal(existsSync(join(root, 'workspace-state', 'pending')), false, 'moved on start, before any call: no per-key folder is left');
    assert.deepEqual(state.getPending(ACCOUNT, 'intent-live'), operation(1), 'the new key of the same account finds what the replaced key left unconfirmed');
    assert.equal(state.getPending(otherAccount, 'intent-live'), undefined);
    assert.deepEqual(createWorkspaceState({ directory: root, apiKey: OTHER, now: () => NOW }).getPending(otherAccount, 'intent-other'), operation(2),
        'the other key\'s write went to its own account');
    assert.equal(state.getPending(ACCOUNT, 'intent-other'), undefined, 'and not to this one');
    const before = readTree(root);
    createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending(ACCOUNT, 'intent-live');
    createWorkspaceState({ directory: root, apiKey: REVOKED, now: () => NOW }).getPending(ACCOUNT, 'intent-live');
    assert.deepEqual(readTree(root), before, 'starting again (with either key) moves nothing and changes nothing');
    for (const [path, item] of Object.entries(before)) assert.equal(item.mode, item.directory ? '700' : '600', path);
}));

test('nothing in an old per-key folder can stop a start or a call: broken and expired records are dropped, what is not ours is left, an unreadable folder waits', () => withFolder('key-folders-bad', root => {
    accountOnFile(root, REVOKED, ACCOUNT);
    const folder = keyFolder(root, REVOKED);
    plant(join(folder, intentFile('good')), operation(1));
    plant(join(folder, intentFile('expired')), operation(2, { savedAt: NOW - 25 * 3600 * 1000 }));
    plant(join(folder, 'garbage.json'), '{ not json');
    plant(join(folder, 'wrong-shape.json'), { operationId: 5 });
    plant(join(folder, 'notes.txt'), 'not a record');
    plant(join(root, 'workspace-state', 'pending', '0123456789abcdef'), 'a file where a key folder would be');
    plant(join(root, 'workspace-state', 'pending', 'not-a-fingerprint', intentFile('x')), operation(3));
    plant(join(root, 'workspace-state', 'accounts', '0123456789abcdef.json'), '{ broken');
    const LOCKED = 'pak_a_key_whose_folder_cannot_be_read';
    accountOnFile(root, LOCKED, ACCOUNT);
    plant(join(keyFolder(root, LOCKED), intentFile('later')), operation(4));
    chmodSync(keyFolder(root, LOCKED), 0o000);
    try {
        let state;
        assert.doesNotThrow(() => { state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }); });
        assert.deepEqual(state.getPending(ACCOUNT, 'good'), operation(1));
        assert.equal(state.getPending(ACCOUNT, 'expired'), undefined);
        assert.equal(state.getPending(ACCOUNT, 'later'), undefined, 'an unreadable folder is skipped, not fatal');
        assert.deepEqual(readdirSync(folder), ['notes.txt'], 'expired and malformed records are dropped; a file that is not a record stays');
        assert.deepEqual(pendingFiles(root), [intentFile('good')], 'only the good record arrived');
        assert.ok(existsSync(join(root, 'workspace-state', 'pending', 'not-a-fingerprint', intentFile('x'))), 'a folder not named like a key fingerprint is not touched');
        state.setPending(ACCOUNT, 'new', operation(5)); state.deletePending(ACCOUNT, 'good');
        assert.deepEqual(pendingFiles(root), [intentFile('new')], 'calls keep working');
    } finally { chmodSync(keyFolder(root, LOCKED), 0o700); }
    assert.deepEqual(createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).getPending(ACCOUNT, 'later'), operation(4), 'once readable, the next start moves it');
    assert.equal(existsSync(keyFolder(root, LOCKED)), false);
}));

test('this server\'s own per-key folder with no account on file moves as soon as a call names the account; another unknown key\'s folder is left alone', () => withFolder('key-folders-own', root => {
    plant(join(keyFolder(root), intentFile('mine')), operation(1));
    plant(join(keyFolder(root, 'pak_unknown_other_key'), intentFile('theirs')), operation(2));
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.ok(existsSync(join(keyFolder(root), intentFile('mine'))), 'the account behind this key is not known yet, so the record stays where it is');
    assert.deepEqual(state.getPending(ACCOUNT, 'mine'), operation(1), 'the first call, which knows the account, moves it and finds it');
    assert.equal(existsSync(keyFolder(root)), false);
    assert.deepEqual(pendingFiles(root), [intentFile('mine')]);
    assert.ok(existsSync(join(keyFolder(root, 'pak_unknown_other_key'), intentFile('theirs'))), 'a key whose account is not known is not guessed at, and nothing is deleted');
    assert.equal(state.getPending(ACCOUNT, 'theirs'), undefined);
}));

test('a per-key record never overwrites what the account folder already holds for the same call; the old copy is dropped', () => withFolder('key-folders-newer', root => {
    createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).setPending(ACCOUNT, 'same', operation(9));
    accountOnFile(root, REVOKED, ACCOUNT);
    plant(join(keyFolder(root, REVOKED), intentFile('same')), operation(1));
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.deepEqual(state.getPending(ACCOUNT, 'same'), operation(9), 'the record in the current layout wins');
    assert.equal(existsSync(keyFolder(root, REVOKED)), false, 'the older copy is gone');
}));

test('a per-key record the disk will not let move stays usable from memory and in place, and moves on a later call', () => withFolder('key-folders-blocked', root => {
    accountOnFile(root, REVOKED, ACCOUNT);
    plant(join(keyFolder(root, REVOKED), intentFile('blocked')), operation(1));
    plant(join(root, 'workspace-state', 'pending-by-account'), 'a file where the folder should be, so nothing can be created there');
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.deepEqual(state.getPending(ACCOUNT, 'blocked'), operation(1), 'answered from memory');
    assert.ok(existsSync(join(keyFolder(root, REVOKED), intentFile('blocked'))), 'and still on disk where it was, for the next process');
    rmSync(join(root, 'workspace-state', 'pending-by-account'));
    assert.deepEqual(state.getPending(ACCOUNT, 'blocked'), operation(1));
    assert.equal(existsSync(keyFolder(root, REVOKED)), false, 'moved on the next call, now that the folder can be made');
    assert.deepEqual(pendingFiles(root), [intentFile('blocked')]);
}));

test('two MCP servers starting at the same moment over the same old per-key folder: each record arrives exactly once, intact', () => withFolder('key-folders-race', async root => {
    accountOnFile(root, REVOKED, ACCOUNT);
    const savedAt = Date.now(); // the children run on the real clock
    const expected = [];
    for (let n = 0; n < 150; n++) { plant(join(keyFolder(root, REVOKED), intentFile(`old-${n}`)), operation(1000 + n, { savedAt })); expected.push(intentFile(`old-${n}`)); }
    await race('per-file', root, [{ prefix: 'A', count: 0, startOnGo: true }, { prefix: 'B', count: 0, startOnGo: true }]);
    assert.deepEqual(pendingFiles(root).sort(), expected.sort(), 'every record is in the account folder, once');
    assert.equal(existsSync(join(root, 'workspace-state', 'pending')), false, 'nothing is left behind in the old layout');
    const reader = createWorkspaceState({ directory: root, apiKey: KEY });
    for (let n = 0; n < 150; n++) assert.deepEqual(reader.getPending(ACCOUNT, `old-${n}`), operation(1000 + n, { savedAt }), `old-${n}`);
    for (const [path, item] of Object.entries(readTree(root))) assert.equal(item.mode, item.directory ? '700' : '600', path);
}));

// ───────────── Is there any record of this call? (asked only when the account could not be looked up) ─────────────
test('hasPendingCall: a live record of the call under any account, or in an earlier build\'s per-key folder, counts; other calls, expired records and finished ones do not', () => withFolder('has-pending', root => {
    const OTHER_ACCOUNT = randomUUID();
    const state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW });
    assert.equal(state.hasPendingCall('call-a'), false, 'nothing anywhere');
    createWorkspaceState({ directory: root, apiKey: 'pak_another_key_of_another_account', now: () => NOW }).setPending(OTHER_ACCOUNT, 'call-a', operation(1));
    assert.equal(state.hasPendingCall('call-a'), true, 'a record under an account this key has not been linked to yet (a replaced key) is found');
    assert.equal(state.hasPendingCall('call-b'), false, 'another call is not');
    plant(join(keyFolder(root, 'pak_a_key_whose_account_is_unknown'), intentFile('call-c')), operation(3));
    assert.equal(state.hasPendingCall('call-c'), true, 'a per-key folder whose account is not known yet is looked into as well');
    plant(join(pendingFolder(root, OTHER_ACCOUNT), intentFile('call-d')), operation(4, { savedAt: NOW - 25 * 3600 * 1000 }));
    assert.equal(state.hasPendingCall('call-d'), false, 'an expired record does not count');
    createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }).deletePending(OTHER_ACCOUNT, 'call-a');
    assert.equal(state.hasPendingCall('call-a'), false, 'a record another server finished does not count');
    const memory = createWorkspaceState({ directory: null, apiKey: KEY, now: () => NOW });
    assert.equal(memory.hasPendingCall('call-e'), false);
    memory.setPending(ACCOUNT, 'call-e', operation(5));
    assert.equal(memory.hasPendingCall('call-e'), true, 'memory only: what this process remembers counts');
    memory.deletePending(ACCOUNT, 'call-e');
    assert.equal(memory.hasPendingCall('call-e'), false);
}));

// ───────────── Symbolic links are not folders of ours ─────────────
test('a per-key or account folder that is a symbolic link is skipped: nothing in the folder it points to is moved or removed', () => withFolder('symlink', root => {
    const elsewhere = join(root, 'elsewhere'), elsewhereToo = join(root, 'elsewhere-too');
    plant(join(elsewhere, 'settings.json'), { not: 'a record' });
    plant(join(elsewhere, intentFile('linked')), operation(1));
    plant(join(elsewhereToo, 'notes.json'), { not: 'a record either' });
    accountOnFile(root, REVOKED, ACCOUNT);
    mkdirSync(join(root, 'workspace-state', 'pending'), { recursive: true, mode: 0o700 });
    symlinkSync(elsewhere, keyFolder(root, REVOKED));
    mkdirSync(join(root, 'workspace-state', 'pending-by-account'), { recursive: true, mode: 0o700 });
    const OTHER_ACCOUNT = randomUUID();
    symlinkSync(elsewhereToo, pendingFolder(root, OTHER_ACCOUNT));
    const before = { one: readTree(elsewhere), two: readTree(elsewhereToo) };
    let state;
    assert.doesNotThrow(() => { state = createWorkspaceState({ directory: root, apiKey: KEY, now: () => NOW }); });
    state.setPending(OTHER_ACCOUNT, 'call', operation(2)); // a write prunes that account's folder
    state.deletePending(OTHER_ACCOUNT, 'call');
    assert.deepEqual(readTree(elsewhere), before.one, 'the folder a per-key link points to is untouched');
    assert.deepEqual(Object.keys(readTree(elsewhereToo)).sort(), Object.keys(before.two).sort(), 'the folder an account link points to keeps its other files');
    assert.ok(existsSync(join(elsewhereToo, 'notes.json')));
    assert.equal(state.getPending(ACCOUNT, 'linked'), undefined, 'a record behind a link is not adopted');
}));
