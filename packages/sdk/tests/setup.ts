/**
 * Test setup — stub browser APIs that don't exist in Node.js
 */
import { vi } from 'vitest';

// Stub requestAnimationFrame/cancelAnimationFrame for LipSyncEngine
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number;
};

globalThis.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
};
