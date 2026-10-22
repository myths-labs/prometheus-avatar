// Company rule: a public or user-facing surface carries the role address (support@mythslabs.ai) and the company name,
// never a founder's personal mailbox, initials or phone number. This guard reads every text file git tracks in the
// repository and fails on any of them, so a personal contact cannot come back through a page, a package manifest or a doc.
//
// The patterns are checked against known-bad and known-good samples first (a guard that never saw a wrong input proves
// nothing), then against the tracked files. Failures name path:line and the kind of hit but never print the matched
// number, so a phone number does not get copied into CI logs.
//
// It lives in packages/sdk/test/ next to package-files.test.mjs: `npm run test:package` (and so `npm test`) runs it, and
// it needs no build. It is the only file allowed to contain the sample strings below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SELF = 'packages/sdk/test/no-personal-contact-in-tracked-files.test.mjs';
// Only the guard itself may hold the sample strings. Do not add other files here.
const ALLOWED = new Set([SELF]);

// A "+" that starts a phone number is not part of a word, a version ("0.3.6+20261021"), base64 ("a+b") or an offset.
const NOT_AFTER = '(?<![\\w.+/=-])';
const RULES = [
    { kind: 'founder mailbox', pattern: /jc@mythslabs\.ai/i },
    // +86 130 0000 0000, +86-130-0000-0000, +86 (130) 0000 0000, +8613000000000, +886 900 000 000: 8 to 15 digits (E.164).
    { kind: 'international phone number', pattern: new RegExp(`${NOT_AFTER}\\+\\d(?:[\\s.()-]{0,2}\\d){7,14}(?!\\w)`) },
    // A mainland China mobile number written without the country code: 11 digits, 1 then 3-9, standing alone.
    { kind: 'mainland mobile number', pattern: new RegExp(`${NOT_AFTER}1[3-9]\\d{9}(?!\\w|\\.\\d)`) },
    // A tel: link with a number in it.
    { kind: 'tel: link', pattern: /\btel:\s*\+?\d/i },
];

// Every hit in one piece of text as { line, kind }, 1-based lines.
function findPersonalContact(text) {
    const hits = [];
    text.split(/\r\n|\r|\n/).forEach((lineText, index) => {
        for (const rule of RULES) {
            if (rule.pattern.test(lineText)) hits.push({ line: index + 1, kind: rule.kind });
        }
    });
    return hits;
}

// The names in a package.json author, contributors and maintainers, as plain strings.
function credits(manifest) {
    const people = [manifest.author, ...(manifest.contributors ?? []), ...(manifest.maintainers ?? [])].filter(Boolean);
    return people.map(person => (typeof person === 'string' ? person : [person.name, person.email, person.url].filter(Boolean).join(' ')));
}

const FOUNDER_INITIALS = /\bJC\b/;

function trackedTextFiles() {
    const listed = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const files = [];
    for (const path of listed.split('\0').filter(Boolean)) {
        let stat;
        try { stat = lstatSync(join(REPO_ROOT, path)); } catch { continue; } // tracked but deleted in this working tree
        if (!stat.isFile()) continue; // symlinks and submodules
        const bytes = readFileSync(join(REPO_ROOT, path));
        if (bytes.subarray(0, 8000).includes(0)) continue; // binary, the same rule git uses
        files.push({ path, text: bytes.toString('utf8') });
    }
    return files;
}

test('the patterns catch the personal contacts they are meant to catch', () => {
    const bad = [
        'contact us at jc@mythslabs.ai',
        'mailto:JC@MythsLabs.AI',
        'call +86 130 0000 0000',
        'call +86-130-0000-0000',
        'call +86 (130) 0000 0000',
        'call +8613000000000',
        'call +886 900 000 000',
        'call +886900000000',
        'tel:+8613000000000',
        'phone 13000000000.',
        '<a href="tel:13000000000">call</a>',
    ];
    for (const sample of bad) {
        assert.equal(findPersonalContact(sample).length > 0, true, `should have been caught: ${sample}`);
    }
});

test('the patterns leave versions, hashes, timestamps and role addresses alone', () => {
    const good = [
        'support@mythslabs.ai',
        'mailto:support@mythslabs.ai',
        '"version": "0.3.6+20261021"',
        '"version": "1.2.3-rc.1+build.5"',
        'sha512-Ab+12345678901234/xyz+98765432109876==',
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        'a30e821bbdc322539b3ff93d5bbd056ed64325af',
        'const startedAt = 1761100000000;',
        'const total = 2026102211;',
        'port 3480-3499',
        'x+12345678',
        'a + 12345678',
        '+1 chance in 5',
        'Phone-like but 10 digits: 1300000000',
        'Twelve digits: 130000000000',
    ];
    for (const sample of good) {
        assert.deepEqual(findPersonalContact(sample), [], `should have been left alone: ${sample}`);
    }
});

test('a founder name in a package author field is caught, the company name is not', () => {
    assert.equal(credits({ author: 'Myths Labs (JC)' }).some(entry => FOUNDER_INITIALS.test(entry)), true);
    assert.equal(credits({ author: { name: 'JC', email: 'x@example.com' } }).some(entry => FOUNDER_INITIALS.test(entry)), true);
    assert.equal(credits({ contributors: ['Someone (JC)'] }).some(entry => FOUNDER_INITIALS.test(entry)), true);
    assert.equal(credits({ author: 'Myths Labs' }).some(entry => FOUNDER_INITIALS.test(entry)), false);
});

test('no tracked text file contains a founder mailbox or a phone number', () => {
    const found = [];
    for (const { path, text } of trackedTextFiles()) {
        if (ALLOWED.has(path)) continue;
        for (const hit of findPersonalContact(text)) found.push(`${path}:${hit.line} ${hit.kind}`);
    }
    assert.deepEqual(found, []);
});

test('no tracked package.json names the founder as author, contributor or maintainer', () => {
    const found = [];
    for (const { path, text } of trackedTextFiles()) {
        if (basename(path) !== 'package.json') continue;
        let manifest;
        try { manifest = JSON.parse(text); } catch (error) { found.push(`${path} is not valid JSON`); continue; }
        for (const entry of credits(manifest)) {
            if (FOUNDER_INITIALS.test(entry)) found.push(`${path} author/contributors/maintainers: ${entry}`);
        }
    }
    assert.deepEqual(found, []);
});

test('the allow list holds the guard itself and nothing else', () => {
    assert.deepEqual([...ALLOWED], [SELF]);
    assert.equal(existsSync(join(REPO_ROOT, SELF)), true, 'the allow list must point at this file');
});
