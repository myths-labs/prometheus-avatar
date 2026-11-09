// The Call recognition lease ticket (ac1): what verifies, what never does, and the fixed vector shared with the
// marketplace app's copy (src/lib/callAsrTicket.ts has the same vector in its own test).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { mintCallAsrTicket, verifyCallAsrTicket } from '../src/call-asr-ticket.ts';
import { mintLiveVoiceGrant } from '../src/live-voice-grant.ts';

const secret = 'test-secret-not-a-real-key';
const now = 1_800_000_000_000;
const sub = '11111111-2222-4333-8444-555555555555';
const call = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const b64 = (buf) => Buffer.from(buf).toString('base64url');
// Independent signer (node:crypto, not the code under test) so a forged ticket is built without the implementation.
function forge(payload, { domain = 'prometheus-call-asr\n', key = secret, prefix = 'ac1' } = {}) {
    const body = prefix + '.' + b64(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return body + '.' + b64(createHmac('sha256', key).update(domain + body).digest());
}
const good = { aud: 'asr-call', sub, call, iat: now, exp: now + 23_000 };

// The vector: fixed key, fixed payload, one exact string. The marketplace app pins the same string.
const VECTOR = 'ac1.eyJhdWQiOiJhc3ItY2FsbCIsInN1YiI6IjExMTExMTExLTIyMjItNDMzMy04NDQ0LTU1NTU1NTU1NTU1NSIsImNhbGwiOiJhYWFhYWFhYS1iYmJiLTRjY2MtOGRkZC1lZWVlZWVlZWVlZWUiLCJpYXQiOjE4MDAwMDAwMDAwMDAsImV4cCI6MTgwMDAwMDAyMzAwMH0.6JqzUvPe1H_EIhQ_r2pSN0bey0_qScUDfQlT9O10e8k';

test('the fixed vector is exactly this string, and an independent signer produces the same one', async () => {
    const { ticket } = await mintCallAsrTicket(secret, sub, call, now, 23_000);
    assert.equal(ticket, VECTOR);
    assert.equal(forge(good), VECTOR);
});

test('a genuine ticket verifies and returns its grant; an account uuid and a guest subject both fit', async () => {
    assert.deepEqual(await verifyCallAsrTicket(secret, VECTOR, now + 1000), good);
    const { ticket } = await mintCallAsrTicket(secret, 'anon:abc123', call, now, 23_000);
    assert.equal((await verifyCallAsrTicket(secret, ticket, now))?.sub, 'anon:abc123');
});

test('a tampered ticket is refused (payload bit, signature bit, wrong secret, missing secret)', async () => {
    const [p, body, sig] = VECTOR.split('.');
    const flipped = body.slice(0, 10) + (body[10] === 'A' ? 'B' : 'A') + body.slice(11);
    assert.equal(await verifyCallAsrTicket(secret, [p, flipped, sig].join('.'), now), null);
    assert.equal(await verifyCallAsrTicket(secret, [p, body, sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA')].join('.'), now), null);
    assert.equal(await verifyCallAsrTicket('another-secret', VECTOR, now), null);
    assert.equal(await verifyCallAsrTicket(undefined, VECTOR, now), null);
    assert.equal(await verifyCallAsrTicket(secret, VECTOR + 'x', now), null);
});

test('the payload is exactly aud, sub, call, iat, exp: one key more or less is refused', async () => {
    assert.ok(await verifyCallAsrTicket(secret, forge(good), now));
    assert.equal(await verifyCallAsrTicket(secret, forge({ ...good, extra: 1 }), now), null);
    for (const k of Object.keys(good)) {
        const { [k]: _gone, ...rest } = good;
        assert.equal(await verifyCallAsrTicket(secret, forge(rest), now), null, `missing ${k}`);
    }
});

test('the audience, subject and call are checked', async () => {
    assert.equal(await verifyCallAsrTicket(secret, forge({ ...good, aud: 'doubao-live' }), now), null);
    assert.equal(await verifyCallAsrTicket(secret, forge({ ...good, call: 'not-a-uuid' }), now), null);
    assert.equal(await verifyCallAsrTicket(secret, forge({ ...good, sub: '' }), now), null);
    assert.equal(await verifyCallAsrTicket(secret, forge({ ...good, sub: 'x'.repeat(201) }), now), null);
    assert.equal(await verifyCallAsrTicket(secret, forge({ ...good, sub: 5 }), now), null);
});

test('more than 30 s of life is refused, exactly 30 s is allowed', async () => {
    assert.equal(await verifyCallAsrTicket(secret, forge({ ...good, exp: now + 30_001 }), now), null);
    assert.ok(await verifyCallAsrTicket(secret, forge({ ...good, exp: now + 30_000 }), now));
    await assert.rejects(mintCallAsrTicket(secret, sub, call, now, 30_001));
    await assert.rejects(mintCallAsrTicket(secret, sub, 'bad', now, 1000));
    await assert.rejects(mintCallAsrTicket('', sub, call, now, 1000));
});

test('an expired ticket and one issued in the future are refused', async () => {
    assert.equal(await verifyCallAsrTicket(secret, VECTOR, now + 23_000), null);
    assert.equal(await verifyCallAsrTicket(secret, VECTOR, now - 6000), null);
    assert.ok(await verifyCallAsrTicket(secret, VECTOR, now - 4000));
});

test('no other ticket kind signed with the same secret can pose as an ac1 ticket', async () => {
    // Same payload, same secret, but signed the way v1 (no domain) or lv (live-voice domain) tickets are.
    assert.equal(await verifyCallAsrTicket(secret, forge(good, { domain: '' }), now), null);
    assert.equal(await verifyCallAsrTicket(secret, forge(good, { domain: 'prometheus-live-voice\n' }), now), null);
    // A real v1 ticket for an "asr:" subject, and a real lv3 ticket, are not ac1 tickets either.
    const v1Body = 'v1.' + (now + 20_000) + '.' + b64('asr:' + sub);
    const v1 = v1Body + '.' + b64(createHmac('sha256', secret).update(v1Body).digest());
    assert.equal(await verifyCallAsrTicket(secret, v1, now), null);
    const { ticket: lv } = await mintLiveVoiceGrant(secret, { sub, assetId: null, speakerId: 'saturn_zh_female_tiexinnvyou_tob', model: '2.2.0.0', providerAppSha256: null }, now);
    assert.equal(await verifyCallAsrTicket(secret, lv, now), null);
    // and the prefix cannot be swapped on a genuine ticket
    assert.equal(await verifyCallAsrTicket(secret, VECTOR.replace(/^ac1/, 'lv3'), now), null);
    assert.equal(await verifyCallAsrTicket(secret, forge(good, { prefix: 'ac2' }), now), null);
});
