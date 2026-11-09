import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
    mintLiveVoiceGrant, verifyLiveVoiceGrant, sameLiveVoiceSelection, DEFAULT_LIVE_SPEAKER, OFFICIAL_IRIS_LIVE_SPEAKER, OFFICIAL_IRIS_APP_SHA256,
} from '../src/live-voice-grant.ts';

// The grant is the only thing the relay trusts about which voice a session may use. These cases pin
// who may name the platform's own Iris slot, and that every ticket shape the relay accepted before
// still verifies (the relay is deployed before the marketplace starts minting the new shape).
const secret = 'test-secret-not-a-real-key';
const now = 1_800_000_000_000;
const sub = '11111111-2222-4333-8444-555555555555';
const asset = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const otherApp = 'b'.repeat(64);
const base = { sub, model: '2.2.0.0' };

async function roundTrip(selection) {
    const { ticket } = await mintLiveVoiceGrant(secret, selection, now);
    return verifyLiveVoiceGrant(secret, ticket, now);
}

test('the official Iris slot is accepted with no asset and its own application', async () => {
    const grant = await roundTrip({ ...base, assetId: null, speakerId: OFFICIAL_IRIS_LIVE_SPEAKER, providerAppSha256: OFFICIAL_IRIS_APP_SHA256 });
    assert.equal(grant?.speakerId, OFFICIAL_IRIS_LIVE_SPEAKER);
    assert.equal(grant?.assetId, null);
});

test('the official Iris slot is refused through a saved voice asset', async () => {
    await assert.rejects(mintLiveVoiceGrant(secret, { ...base, assetId: asset, speakerId: OFFICIAL_IRIS_LIVE_SPEAKER, providerAppSha256: OFFICIAL_IRIS_APP_SHA256 }, now));
});

test('the official Iris slot is refused with another application', async () => {
    await assert.rejects(mintLiveVoiceGrant(secret, { ...base, assetId: null, speakerId: OFFICIAL_IRIS_LIVE_SPEAKER, providerAppSha256: otherApp }, now));
});

test('the official Iris slot is refused on another dialog model', async () => {
    await assert.rejects(mintLiveVoiceGrant(secret, { ...base, model: '1.2.1.1', assetId: null, speakerId: OFFICIAL_IRIS_LIVE_SPEAKER, providerAppSha256: OFFICIAL_IRIS_APP_SHA256 }, now));
});

test('any other private slot still needs its saved voice asset', async () => {
    await assert.rejects(mintLiveVoiceGrant(secret, { ...base, assetId: null, speakerId: 'S_fdEc52RW1', providerAppSha256: OFFICIAL_IRIS_APP_SHA256 }, now));
    const grant = await roundTrip({ ...base, assetId: asset, speakerId: 'S_fdEc52RW1', providerAppSha256: otherApp });
    assert.equal(grant?.speakerId, 'S_fdEc52RW1');
});

test('the public default speaker still verifies with no asset and no application', async () => {
    const grant = await roundTrip({ ...base, assetId: null, speakerId: DEFAULT_LIVE_SPEAKER, providerAppSha256: null });
    assert.equal(grant?.speakerId, DEFAULT_LIVE_SPEAKER);
});

test('a ticket signed with another secret is refused', async () => {
    const { ticket } = await mintLiveVoiceGrant(secret, { ...base, assetId: null, speakerId: OFFICIAL_IRIS_LIVE_SPEAKER, providerAppSha256: OFFICIAL_IRIS_APP_SHA256 }, now);
    assert.equal(await verifyLiveVoiceGrant('another-secret', ticket, now), null);
});

// P-07: an lv4 ticket names the prompt it admits (voicePromptSha256 of the four StartSession dialog fields; here the shared vector
// "all four fields"); lv2 and lv3 name none.
const prompt = 'd054422bb456037cd89816af032d7e899551198aa8217e6feb2307d464629823';
const publicVoice = { ...base, assetId: null, speakerId: DEFAULT_LIVE_SPEAKER, providerAppSha256: null };

test('an lv4 ticket verifies with its promptSha256; an lv3 ticket verifies with none', async () => {
    const { ticket } = await mintLiveVoiceGrant(secret, { ...publicVoice, promptSha256: prompt }, now);
    assert.match(ticket, /^lv4\./);
    assert.equal((await verifyLiveVoiceGrant(secret, ticket, now))?.promptSha256, prompt);
    const lv3 = await mintLiveVoiceGrant(secret, publicVoice, now);
    assert.match(lv3.ticket, /^lv3\./);
    assert.equal((await verifyLiveVoiceGrant(secret, lv3.ticket, now))?.promptSha256, null);
});

test('the same selection with another prompt, or none, is not the same selection (a renewal cannot change the prompt)', async () => {
    const bound = await roundTrip({ ...publicVoice, promptSha256: prompt });
    assert.equal(sameLiveVoiceSelection(bound, await roundTrip({ ...publicVoice, promptSha256: prompt })), true);
    assert.equal(sameLiveVoiceSelection(bound, await roundTrip({ ...publicVoice, promptSha256: 'e'.repeat(64) })), false);
    assert.equal(sameLiveVoiceSelection(bound, await roundTrip(publicVoice)), false);
});

// live-voice-grant.ts must stay byte-identical with the marketplace app's src/lib/liveVoiceGrant.ts:
// the marketplace mints what this relay verifies. Changing it
// means changing both files in the same release and updating this hash in both repositories.
test('live-voice-grant.ts is the reviewed byte-for-byte copy', () => {
    const source = readFileSync(new URL('../src/live-voice-grant.ts', import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'), '0c5ccca715c130d4392d0ee28a5d27c77b287dbcfe92eac004dbc287dd68ec24');
});
