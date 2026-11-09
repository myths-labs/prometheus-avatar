import type { CallAsrGrant } from './call-asr-ticket';

/**
 * A renewable, bounded recognition lease (the /asr twin of live-voice-lease.ts). The socket ends when the lease does;
 * a renewal extends it only for the same subject and call, with no earlier expiry and no earlier issue time. A failed
 * renewal never extends the old deadline. `verify` and `same` are passed in so this file has no imports to load.
 */
export function createCallAsrLease(
    initial: CallAsrGrant, expired: () => void,
    verify: (ticket: string) => Promise<CallAsrGrant | null>, same: (a: CallAsrGrant, b: CallAsrGrant) => boolean,
) {
    let current = initial, closed = false, timer: ReturnType<typeof setTimeout> | null = null;
    const active = () => !closed && Date.now() < current.exp;
    const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            if (closed) return;
            if (Date.now() < current.exp) { schedule(); return; }
            closed = true; expired();
        }, Math.max(0, current.exp - Date.now()));
    };
    schedule();
    return {
        active,
        close() { closed = true; if (timer) clearTimeout(timer); },
        async renew(ticket: string): Promise<number | null> {
            if (!active()) return null;
            const next = await verify(ticket);
            if (!active() || !next || !same(current, next) || next.exp < current.exp || next.iat < current.iat) return null;
            current = next; schedule(); return current.exp;
        },
    };
}
