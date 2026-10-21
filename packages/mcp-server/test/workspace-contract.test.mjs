import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
    describeWorkspaceInputProblem, parseWorkspaceEntry, parseWorkspaceReceipt, parseWorkspaceSnapshot, readWorkspaceInput,
} from '../.test-build/workspace-contract.js';
import { deriveEntryId, normalizeExternalKey, uuidV5 } from '../.test-build/workspace-ids.js';

const accountId = randomUUID(), operationId = randomUUID();
const entryRow = (over = {}) => ({
    id: randomUUID(), sequence: '7', categoryId: 'work', kind: 'message', content: '# Report', occurredAt: '2026-10-14T01:30:00.123Z', role: 'assistant',
    inputMode: 'agent', status: null, dueOn: null, archived: false, revision: 1, createdAt: '2026-10-14T01:30:00.456789+00:00', updatedAt: '2026-10-14T01:30:00.456789+00:00', ...over,
});
const categories = [{ id: 'work', title: 'Work', presentation: 'markdown' }, { id: 'todo', title: 'To-do', presentation: 'tasks' }];
const snapshot = (over = {}) => ({ accountId, categories, entries: [entryRow()], nextCursor: null, ...over });
const scope = { accountId, categoryId: 'work', limit: 5 };

test('a snapshot with keys this version has never seen still parses, at every level', () => {
    const future = snapshot({
        schemaVersion: 2, regionHint: null,
        categories: categories.map(c => ({ ...c, icon: null, accessLevel: 'agent' })),
        entries: [entryRow({ source: null, labels: ['a'], pinned: false })],
    });
    const parsed = parseWorkspaceSnapshot(future, scope);
    assert.ok(parsed, 'extra keys must not invalidate the snapshot');
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].content, '# Report');
    assert.deepEqual(parsed.categories.map(c => c.id), ['work', 'todo']);
    assert.equal('schemaVersion' in parsed, false, 'unknown keys are dropped, not passed through');
    assert.equal('source' in parsed.entries[0], false);
});

test('a receipt with extra keys on the receipt and on its entry parses and still matches what was sent', () => {
    const input = { entryId: randomUUID(), expectedRevision: 0, categoryId: 'work', kind: 'message', content: 'Body', occurredAt: '2026-10-14T01:30:00.123Z', role: 'assistant', inputMode: 'agent', status: null, dueOn: null, archived: false };
    const { entryId, expectedRevision, ...fields } = input;
    const receipt = { accountId, operationId, ledger: { replayed: false }, entry: { id: entryId, sequence: '3', revision: 1, ...fields, createdAt: '2026-10-14T01:30:01Z', updatedAt: '2026-10-14T01:30:01Z', source: null } };
    const parsed = parseWorkspaceReceipt(receipt, { accountId, operationId, input });
    assert.ok(parsed);
    assert.equal(parsed.entry.id, entryId);
    // …but the receipt is still bound to what was sent: a changed body is not adopted.
    assert.equal(parseWorkspaceReceipt({ ...receipt, entry: { ...receipt.entry, content: 'Changed' } }, { accountId, operationId, input }), null);
    // …and to the account and operation it was asked about.
    assert.equal(parseWorkspaceReceipt({ ...receipt, accountId: randomUUID() }, { accountId, operationId, input }), null);
    assert.equal(parseWorkspaceReceipt({ ...receipt, operationId: randomUUID() }, { accountId, operationId, input }), null);
});

test('an entry kind or value the package does not know is skipped and counted instead of failing the read', () => {
    const odd = entryRow({ sequence: '9', kind: 'link', inputMode: 'browser' });
    const ok = entryRow({ sequence: '8' });
    const parsed = parseWorkspaceSnapshot(snapshot({ entries: [odd, ok] }), scope);
    assert.ok(parsed);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.skippedEntries, 1);
    // a category presentation that does not exist yet is kept as given
    const future = parseWorkspaceSnapshot(snapshot({ categories: [...categories, { id: 'links', title: 'Links', presentation: 'links' }] }), scope);
    assert.equal(future.categories.find(c => c.id === 'links').presentation, 'links');
    // the cursor check still counts skipped rows as part of the page
    const paged = parseWorkspaceSnapshot(snapshot({ entries: [odd, ok], nextCursor: '8' }), { ...scope, limit: 2 });
    assert.ok(paged);
});

test('leniency stops where trust stops: foreign account, unlisted category, shuffled rows and a lying cursor are still refused', () => {
    assert.equal(parseWorkspaceSnapshot(snapshot({ accountId: randomUUID() }), scope), null);
    assert.equal(parseWorkspaceSnapshot(snapshot({ entries: [entryRow({ categoryId: 'secret' })] }), scope), null);
    assert.equal(parseWorkspaceSnapshot(snapshot({ entries: [entryRow({ categoryId: 'todo', kind: 'task', role: null, status: 'open' })] }), scope), null, 'asked for work, got todo');
    assert.equal(parseWorkspaceSnapshot(snapshot({ entries: [entryRow({ sequence: '5' }), entryRow({ sequence: '6' })] }), { ...scope, limit: 2 }), null, 'rows must be newest first');
    assert.equal(parseWorkspaceSnapshot(snapshot({ nextCursor: '99' }), scope), null, 'a cursor with no full page behind it');
    assert.equal(parseWorkspaceSnapshot(snapshot({ entries: [entryRow()], nextCursor: '3' }), { ...scope, limit: 1 }), null, 'cursor must be the last row on the page');
    assert.equal(parseWorkspaceSnapshot({ accountId, entries: [], nextCursor: null }, scope), null, 'required keys must still be there');
});

test('what the package SENDS stays strict: exactly the 11 entry keys, no extras, no missing key, milliseconds required', () => {
    const base = { entryId: randomUUID(), expectedRevision: 0, categoryId: 'work', kind: 'message', content: 'x', occurredAt: '2026-10-14T01:30:00.123Z', role: 'assistant', inputMode: 'agent', status: null, dueOn: null, archived: false };
    assert.ok(readWorkspaceInput(base));
    assert.equal(readWorkspaceInput({ ...base, futureField: null }), null, 'an extra key would be refused by the website');
    const { dueOn, ...missing } = base;
    assert.equal(readWorkspaceInput(missing), null);
    assert.equal(readWorkspaceInput({ ...base, occurredAt: '2026-10-14T01:30:00Z' }), null, 'no milliseconds');
    assert.equal(readWorkspaceInput({ ...base, occurredAt: '2026-10-14T01:30:00.123+00:00' }), null, 'must end in Z');
    assert.equal(readWorkspaceInput({ ...base, content: '   ' }), null);
    assert.equal(readWorkspaceInput({ ...base, content: 'a\u0000b' }), null);
    assert.equal(readWorkspaceInput({ ...base, content: 'x'.repeat(65537) }), null);
    assert.ok(readWorkspaceInput({ ...base, content: 'x'.repeat(65536) }));
    assert.equal(readWorkspaceInput({ ...base, kind: 'task', role: null, status: 'open', dueOn: '2026-02-30' }), null, 'impossible date');
    assert.ok(readWorkspaceInput({ ...base, kind: 'task', role: null, status: 'open', dueOn: '2026-10-15' }));
});

test('describeWorkspaceInputProblem names the field that is wrong, in words a model can act on', () => {
    const base = { entryId: randomUUID(), expectedRevision: 0, categoryId: 'work', kind: 'message', content: 'x', occurredAt: '2026-10-14T01:30:00.123Z', role: 'assistant', inputMode: 'agent', status: null, dueOn: null, archived: false };
    assert.equal(describeWorkspaceInputProblem(base), null);
    assert.equal(describeWorkspaceInputProblem({ ...base, occurredAt: '2026-10-14T01:30:00Z' }).field, 'occurredAt');
    assert.match(describeWorkspaceInputProblem({ ...base, occurredAt: '2026-10-14T01:30:00Z' }).problem, /milliseconds/);
    assert.equal(describeWorkspaceInputProblem({ ...base, content: 'é'.repeat(40000) }).field, 'content');
    assert.match(describeWorkspaceInputProblem({ ...base, content: 'é'.repeat(40000) }).problem, /80000 bytes/);
    const { archived, ...missing } = base;
    assert.deepEqual(describeWorkspaceInputProblem(missing).field, 'archived');
    assert.equal(describeWorkspaceInputProblem({ ...base, extra: 1 }).field, 'extra');
    assert.equal(describeWorkspaceInputProblem({ ...base, kind: 'task', role: null, status: 'later' }).field, 'status');
});

test('entry ids derived from an external_key are stable, distinct per category, and match an independent UUIDv5 implementation', () => {
    // Reference values computed with Python's uuid.uuid5 over the same namespace and name layout.
    assert.equal(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
    assert.equal(deriveEntryId('work', 'weekly-report-2026-10-14'), '9d47e825-43aa-5c42-b2b9-0506123d3401');
    assert.equal(deriveEntryId('todo', 'pay-rent-2026-11'), 'e4ef6354-3355-5aa4-a151-a1ff467a490a');
    assert.equal(deriveEntryId('todo', '交周报'), 'e4d14051-3b46-597a-bd8b-de7bb20078eb');
    assert.notEqual(deriveEntryId('work', 'same'), deriveEntryId('todo', 'same'));
    assert.equal(deriveEntryId('work', 'k'), deriveEntryId('work', 'k'));
    // visible-identical keys map to one entry: surrounding spaces and Unicode composition do not matter
    assert.equal(normalizeExternalKey('  école  '), normalizeExternalKey('école'));
    assert.equal(normalizeExternalKey(''), null);
    assert.equal(normalizeExternalKey('a'.repeat(201)), null);
    assert.equal(normalizeExternalKey('a\nb'), null);
});

test('parseWorkspaceEntry needs all 14 known keys', () => {
    assert.ok(parseWorkspaceEntry(entryRow()));
    const { revision, ...rest } = entryRow();
    assert.equal(parseWorkspaceEntry(rest), null);
});
