import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHermesAncestor } from '../dist/sellerChannel.js';

// A fake process table: pid -> { ppid, args }.
const table = (rows) => (pid) => rows[pid] ?? null;

test('finds Hermes at the parent (depth 1) and higher up, returning only the token and the depth', () => {
    const ps = table({ 100: { ppid: 90, args: '/Users/x/.local/bin/hermes chat' } });
    assert.deepEqual(findHermesAncestor(100, ps), { ancestor: 'hermes', depth: 1 });
    const deep = table({
        100: { ppid: 99, args: 'npm exec @prometheusavatar/mcp-server' },
        99: { ppid: 98, args: 'sh -c prometheus-mcp' },
        98: { ppid: 97, args: '/opt/venv/bin/python -m hermes_cli.main' },
    });
    assert.deepEqual(findHermesAncestor(100, deep), { ancestor: 'hermes', depth: 3 });
});

test('matches the spec pattern: hermes / hermes-agent as a word, or hermes_cli; not look-alikes', () => {
    const one = (args) => findHermesAncestor(5, table({ 5: { ppid: 1, args } }));
    for (const yes of ['hermes', '/usr/local/bin/hermes gateway', 'node /x/hermes-agent run', 'python -m hermes_cli.main chat']) assert.ok(one(yes), yes);
    for (const no of ['/usr/bin/vim hermes.txt', 'bash -c echo hermesque', '/Users/x/.hermes/cache/tool', 'node /x/not-hermes/app.js']) assert.equal(one(no), null, no);
});

test('gives up after 8 parents, at pid 1, or when a process is gone', () => {
    const rows = {};
    for (let pid = 100; pid > 88; pid--) rows[pid] = { ppid: pid - 1, args: 'sh' };
    rows[91] = { ppid: 90, args: 'hermes' };                     // 10th parent: too far
    assert.equal(findHermesAncestor(100, table(rows)), null);
    rows[93] = { ppid: 92, args: 'hermes' };                     // 8th parent: still counted
    assert.deepEqual(findHermesAncestor(100, table(rows)), { ancestor: 'hermes', depth: 8 });
    assert.equal(findHermesAncestor(100, table({ 100: { ppid: 1, args: 'sh' } })), null);
    assert.equal(findHermesAncestor(100, () => null), null);
});
