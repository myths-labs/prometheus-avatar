// P-07 option B (⑨ 2026-11-10): the own-key voice grant. The marketplace mints it (src/lib/byokVoiceGrant.ts) and this relay verifies it
// (src/byok-voice-grant.ts), so the two files must stay byte-identical. Changing it means changing both files in the same release and
// updating this hash in both repositories. The relay's use of it is tested in live-voice-prompt-binding.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const REVIEWED = 'a1f3638a196b2a37437607416a9299b45b092a103c85fa50422ffb34c2b9227a';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

test('byok-voice-grant.ts is the reviewed byte-for-byte copy of the marketplace\'s src/lib/byokVoiceGrant.ts', () => {
    const source = readFileSync(new URL('../src/byok-voice-grant.ts', import.meta.url));
    assert.equal(sha256(source), REVIEWED);
    // Reverse proof: the copy with its signing label changed (one word) is not the reviewed file.
    const text = source.toString('utf8'), label = "const LABEL = 'prometheus-byok-voice\\n';";
    assert.equal(text.split(label).length, 2);
    assert.notEqual(sha256(text.replace(label, "const LABEL = 'prometheus-live-voice\\n';")), REVIEWED);
});
