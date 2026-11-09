// P-07, the frame guard on its own: the two properties the relay's socket handling cannot show by itself. Each has its reverse proof
// (the guard's source with the rule removed must fail the same case).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadSrc, startConnection, startSession } from './support/workers-harness.mjs';

const { vectors } = JSON.parse(readFileSync(new URL('./fixtures/voice-prompt-sha256-vectors.json', import.meta.url), 'utf8'));
const IRIS = vectors.find((v) => v.name === 'all four fields');
const XIAOMENG = vectors.find((v) => v.name === 'Chinese');
const voice = { speaker: 'saturn_zh_female_tiexinnvyou_tob', model: '1.2.1.1' };
const real = await loadSrc('doubao-frame-guard.ts');

// The lease can end the socket (rejectFrame closes the guard) while a StartSession's prompt is still being hashed.
async function closedWhileHashing({ createDoubaoFrameGuard }) {
    const guard = createDoubaoFrameGuard(() => true, {
        promptSha256: () => { queueMicrotask(() => guard.close()); return IRIS.sha256; },
        required: false,
    });
    assert.equal(await guard.admit(startConnection()), true);
    return { admitted: await guard.admit(startSession('session-1', IRIS.dialog, voice)), refusal: guard.refusal() };
}

test('a socket that ends while its prompt is hashed admits nothing and reports no prompt refusal', async () => {
    assert.deepEqual(await closedWhileHashing(real), { admitted: false, refusal: null });
    // Reverse proof: without the check after hashing, the closed guard admits the StartSession.
    const mutant = await loadSrc('doubao-frame-guard.ts', { 'doubao-frame-guard.ts': [
        ['if (closed) return false; // the socket ended while the prompt was hashed', '// (removed)'],
    ] });
    assert.equal((await closedWhileHashing(mutant)).admitted, true);
});

async function afterRefusal({ createDoubaoFrameGuard }) {
    const guard = createDoubaoFrameGuard(() => true, { promptSha256: () => IRIS.sha256, required: false });
    assert.equal(await guard.admit(startConnection()), true);
    const refused = await guard.admit(startSession('session-1', XIAOMENG.dialog, voice));
    return { refused: !refused, refusal: guard.refusal(), later: await guard.admit(startSession('session-2', IRIS.dialog, voice)) };
}

test('a StartSession refused by its binding ends the guard: no later frame is admitted, even with the approved prompt', async () => {
    assert.deepEqual(await afterRefusal(real), { refused: true, refusal: 'Voice prompt not approved', later: false });
    // Reverse proof: a guard that stays open after the refusal admits the next StartSession if its caller does not close the socket.
    const mutant = await loadSrc('doubao-frame-guard.ts', { 'doubao-frame-guard.ts': [
        ['promptRefusal = VOICE_PROMPT_NOT_APPROVED; closed = true;', 'promptRefusal = VOICE_PROMPT_NOT_APPROVED;'],
    ] });
    assert.equal((await afterRefusal(mutant)).later, true);
});
