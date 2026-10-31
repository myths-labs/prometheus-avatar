import assert from 'node:assert/strict';
import test from 'node:test';
import {
    mintLiveVoiceGrant, verifyLiveVoiceGrant, DEFAULT_LIVE_SPEAKER, OFFICIAL_IRIS_LIVE_SPEAKER, OFFICIAL_IRIS_APP_SHA256,
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
