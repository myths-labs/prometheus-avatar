// The recognition lease: the socket ends when the lease does, a good renewal extends it, a bad one never does.
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createCallAsrLease } from '../src/call-asr-lease.ts';
import { sameCallAsr, mintCallAsrTicket, verifyCallAsrTicket } from '../src/call-asr-ticket.ts';

const secret = 'test-secret-not-a-real-key';
const T0 = 1_800_000_000_000;
const sub = '11111111-2222-4333-8444-555555555555', call = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const call2 = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function rig(setup) {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
    let expired = 0;
    const lease = createCallAsrLease({ aud: 'asr-call', sub, call, iat: T0, exp: T0 + 23_000 }, () => { expired++; },
        (t) => verifyCallAsrTicket(secret, t, Date.now()), sameCallAsr);
    return { lease, expiredCount: () => expired };
}
const ticketAt = (s, c, iat, ttl) => mintCallAsrTicket(secret, s, c, iat, ttl).then(r => r.ticket);

test('the lease ends the socket at its deadline, once', (t) => {
    t.after(() => mock.timers.reset());
    const { lease, expiredCount } = rig();
    mock.timers.tick(22_999);
    assert.equal(expiredCount(), 0); assert.equal(lease.active(), true);
    mock.timers.tick(1);
    assert.equal(expiredCount(), 1); assert.equal(lease.active(), false);
    mock.timers.tick(60_000);
    assert.equal(expiredCount(), 1);
});

test('a good renewal moves the deadline; the old one no longer ends the socket', async (t) => {
    t.after(() => mock.timers.reset());
    const { lease, expiredCount } = rig();
    mock.timers.tick(17_000);
    const exp = await lease.renew(await ticketAt(sub, call, T0 + 17_000, 23_000));
    assert.equal(exp, T0 + 40_000);
    mock.timers.tick(10_000); // past the original deadline
    assert.equal(expiredCount(), 0); assert.equal(lease.active(), true);
    mock.timers.tick(13_000);
    assert.equal(expiredCount(), 1);
});

test('a renewal for another call or another subject is refused and changes nothing', async (t) => {
    t.after(() => mock.timers.reset());
    const { lease, expiredCount } = rig();
    mock.timers.tick(10_000);
    assert.equal(await lease.renew(await ticketAt(sub, call2, T0 + 10_000, 23_000)), null);
    assert.equal(await lease.renew(await ticketAt('anon:someone', call, T0 + 10_000, 23_000)), null);
    mock.timers.tick(13_000);
    assert.equal(expiredCount(), 1, 'the original deadline still ends it');
});

test('a renewal whose expiry goes backwards, or whose issue time does, is refused', async (t) => {
    t.after(() => mock.timers.reset());
    const { lease } = rig();
    mock.timers.tick(5000);
    assert.equal(await lease.renew(await ticketAt(sub, call, T0 + 5000, 10_000)), null, 'exp T0+15s < T0+23s');
    // same exp but earlier iat than the current one (current iat = T0): iat T0-1000 with ttl 24 s
    assert.equal(await lease.renew(await ticketAt(sub, call, T0 - 1000, 24_000)), null, 'iat before the current one');
    assert.equal(await lease.renew(await ticketAt(sub, call, T0, 23_000)), T0 + 23_000, 'equal exp and iat is allowed');
});

test('a garbled, forged, expired renewal does not extend the old deadline', async (t) => {
    t.after(() => mock.timers.reset());
    const { lease, expiredCount } = rig();
    mock.timers.tick(10_000);
    assert.equal(await lease.renew('garbage'), null);
    assert.equal(await lease.renew((await ticketAt(sub, call, T0 + 10_000, 23_000)).slice(0, -3) + 'AAA'), null);
    const stale = await ticketAt(sub, call, T0, 23_000);
    assert.equal(await lease.renew(stale), T0 + 23_000, 'the same window again is a no-op renewal, not an extension');
    mock.timers.tick(13_000);
    assert.equal(expiredCount(), 1);
});

test('a renewal after the lease ended is refused, and so is one still verifying when it ends', async (t) => {
    t.after(() => mock.timers.reset());
    const { lease } = rig();
    const later = await ticketAt(sub, call, T0 + 20_000, 23_000);
    mock.timers.tick(23_000);
    assert.equal(await lease.renew(later), null);
    let release;
    const t1 = Date.now(); // a fresh lease from now, with its verifier left hanging
    const slow = createCallAsrLease({ aud: 'asr-call', sub, call, iat: t1, exp: t1 + 23_000 }, () => {},
        () => new Promise((r) => { release = r; }), sameCallAsr);
    const pending = slow.renew('x');
    mock.timers.tick(23_000);
    release({ aud: 'asr-call', sub, call, iat: t1 + 20_000, exp: t1 + 43_000 });
    assert.equal(await pending, null);
});

test('close() stops the timer: the socket is not ended twice', (t) => {
    t.after(() => mock.timers.reset());
    const { lease, expiredCount } = rig();
    lease.close();
    mock.timers.tick(60_000);
    assert.equal(expiredCount(), 0);
});
