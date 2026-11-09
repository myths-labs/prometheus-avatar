// P-07: the relay hashes the four StartSession dialog fields exactly as the marketplace does when it mints an lv4 ticket. Both sides run
// against the same vectors; the expected hashes were computed with Python hashlib, independently of either implementation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { voicePromptSha256 } from '../src/voice-prompt-sha256.ts';
import { loadSrc } from './support/workers-harness.mjs';

const fixtureBytes = readFileSync(new URL('./fixtures/voice-prompt-sha256-vectors.json', import.meta.url));
const { vectors } = JSON.parse(fixtureBytes.toString('utf8'));

// The marketplace's tests/fixtures/voice-prompt-sha256-vectors.json, byte for byte. Changing it means changing both copies.
test('the vectors are the marketplace\'s fixture, byte for byte', () => {
    assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), '8502c8f39e5adcc54b40bc2dadd78077f66e51500c52ef23968dcdd49c15e7f3');
    assert.equal(vectors.length, 10);
});

const mismatches = async (hash) => {
    const wrong = [];
    for (const { name, dialog, sha256 } of vectors) if (await hash(dialog) !== sha256) wrong.push(name);
    return wrong;
};

test('the Web Crypto port gives every vector its expected hash', async () => {
    assert.deepEqual(await mismatches(voicePromptSha256), []);
    // Reverse proof: the vectors tell a canonical form from its near misses.
    const swapped = await loadSrc('voice-prompt-sha256.ts', { 'voice-prompt-sha256.ts': [[
        "['bot_name', 'character_manifest', 'system_role', 'speaking_style']",
        "['character_manifest', 'bot_name', 'system_role', 'speaking_style']",
    ]] });
    assert.deepEqual(await mismatches(swapped.voicePromptSha256), ['all four fields', 'Chinese', 'emoji (surrogate pair) and a symbol',
        'LF and CRLF inside fields', 'leading and trailing spaces and tabs are kept']);
    const trimmed = await loadSrc('voice-prompt-sha256.ts', { 'voice-prompt-sha256.ts': [["return value ?? '';", "return (value ?? '').trim();"]] });
    assert.deepEqual(await mismatches(trimmed.voicePromptSha256), ['LF and CRLF inside fields', 'leading and trailing spaces and tabs are kept']);
});

test('the frame\'s dialog.extra (model, input_mod) is not part of the hash', async () => {
    const withExtra = (dialog) => voicePromptSha256({ ...dialog, extra: { input_mod: 'keep_alive', model: '1.2.1.1' } });
    assert.deepEqual(await mismatches(withExtra), []);
});

test('a field that is present and not text is refused (TypeError), as in the marketplace\'s implementation', async () => {
    const notText = [{ system_role: 7 }, { bot_name: null }, { speaking_style: ['calm'] }, { character_manifest: { text: 'x' } }];
    for (const dialog of notText) await assert.rejects(voicePromptSha256(dialog), TypeError, JSON.stringify(dialog));
    // Reverse proof: a port that read such a field as "" would give it the hash of the dialog without it.
    const lenient = await loadSrc('voice-prompt-sha256.ts', { 'voice-prompt-sha256.ts': [[
        "if (value !== undefined && typeof value !== 'string') throw new TypeError(`voice dialog field ${field} must be a string`);",
        "if (typeof value !== 'string') return '';",
    ]] });
    assert.equal(await lenient.voicePromptSha256({ system_role: 7 }), vectors[0].sha256);
});
