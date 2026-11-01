// CHANGELOG.md keeps one [Unreleased] section. A version that has been published has a dated heading
// and does not say "Not published": a second [Unreleased] heading, left behind after a release, claims
// a released version is still a candidate.
// Run: node --test packages/sdk/tests-node/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lines = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8').split('\n');

function sections(text) {
    const out = [];
    for (const line of text) {
        if (/^## /.test(line)) out.push({ heading: line, body: [] });
        else if (out.length) out[out.length - 1].body.push(line);
    }
    return out;
}

test('CHANGELOG.md has at most one [Unreleased] section', () => {
    const unreleased = sections(lines).filter((s) => /^## \[Unreleased\]/i.test(s.heading));
    assert.ok(unreleased.length <= 1, unreleased.map((s) => s.heading).join(' | '));
});

test('a section with a dated heading never says "Not published"', () => {
    const wrong = sections(lines).filter((s) => /^## \[[^\]]+\] — \d{4}-\d{2}-\d{2}/.test(s.heading) && /\bNot published\b/i.test(s.body.join('\n')));
    assert.deepEqual(wrong.map((s) => s.heading), []);
});

test('only the [Unreleased] section may say "Not published", and the section reader tells two [Unreleased] headings apart', () => {
    const stray = sections(lines).filter((s) => /\bNot published\b/i.test(s.body.join('\n')) && !/^## \[Unreleased\]/i.test(s.heading));
    assert.deepEqual(stray.map((s) => s.heading), []);
    const sample = sections(['## [Unreleased] — core 0.11.4', 'Not published. Candidate.', '', '## [Unreleased] — core 0.11.5', 'Not published yet.']);
    assert.equal(sample.filter((s) => /^## \[Unreleased\]/i.test(s.heading)).length, 2);
});
