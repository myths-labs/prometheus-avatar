import { verifyLiveVoiceGrant, sameLiveVoiceSelection, type LiveVoiceGrant } from './live-voice-grant';

/** A renewable, bounded grant. A failed renewal never extends the old deadline. */
export function createLiveVoiceLease(secret: string, initial: LiveVoiceGrant, expired: () => void) {
    let current = initial, closed = false, timer: ReturnType<typeof setTimeout> | null = null;
    const active = () => !closed && Date.now() < current.exp;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (closed) return;
            if (Date.now() < current.exp) { schedule(); return; }
            closed = true; expired();
        }, Math.max(0, current.exp - Date.now()));
    };
    schedule();
    return {
        active,
        authorize(speaker: string, model: string) { return active() && current.speakerId === speaker && current.model === model; },
        /** P-07: the prompt the CURRENT grant binds (lv4), or null (lv2/lv3). A renewal keeps it: sameLiveVoiceSelection compares it. */
        promptSha256(): string | null { return current.promptSha256; },
        close() { closed = true; clearTimeout(timer); },
        async renew(ticket: string): Promise<number | null> {
            if (!active()) return null;
            const next = await verifyLiveVoiceGrant(secret, ticket);
            if (!active() || !next || !sameLiveVoiceSelection(current, next) || next.exp < current.exp || next.iat < current.iat) return null;
            current = next; schedule(); return current.exp;
        },
    };
}
