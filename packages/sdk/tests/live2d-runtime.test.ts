import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// pixi.js and pixi-live2d-display need a browser; replace them with recorders.
const registerTicker = vi.hoisted(() => vi.fn());
vi.mock('pixi.js', () => ({ Ticker: { shared: {} } }));
vi.mock('pixi-live2d-display/cubism4', () => ({ Live2DModel: { registerTicker, tag: 'cubism4' } }));
vi.mock('pixi-live2d-display/cubism2', () => ({ Live2DModel: { registerTicker, tag: 'cubism2' } }));

import { loadLive2D, isCubism2Model } from '../src/live2d-runtime';

type FakeScript = { src: string; async: boolean; onload?: () => void; onerror?: () => void; remove: () => void };

/** Minimal DOM: every appended <script> fires `outcome` on the next tick. */
function stubDom(win: Record<string, unknown>, outcome: 'load' | 'error', onAppend?: () => void) {
    const appended: FakeScript[] = [];
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', {
        createElement: () => ({ src: '', async: false, remove: vi.fn() }) as FakeScript,
        head: {
            appendChild: (el: FakeScript) => {
                appended.push(el);
                onAppend?.();
                setTimeout(() => (outcome === 'load' ? el.onload?.() : el.onerror?.()), 0);
            },
        },
    });
    return appended;
}

describe('isCubism2Model', () => {
    it('is true only for *.model.json (query and hash ignored)', () => {
        expect(isCubism2Model('/m/shizuku.model.json')).toBe(true);
        expect(isCubism2Model('https://x.test/a/Shizuku.MODEL.JSON?v=2#x')).toBe(true);
        expect(isCubism2Model('https://x.test/haru_greeter_t03.model3.json')).toBe(false);
        expect(isCubism2Model('blob:https://x.test/1234')).toBe(false);
    });
});

describe('loadLive2D', () => {
    beforeEach(() => registerTicker.mockClear());
    afterEach(() => vi.unstubAllGlobals());

    it('fails with a message that says how to fix it when Cubism Core is missing', async () => {
        stubDom({}, 'load');
        const err = await loadLive2D('/m/haru.model3.json').catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('live2dcubismcore.min.js');
        expect((err as Error).message).toContain('cubismCoreUrl');
        expect((err as Error).message).toContain('https://www.live2d.com/en/sdk/license/');
        expect(registerTicker).not.toHaveBeenCalled();
    });

    it('does not touch the page when Cubism Core is already there, and registers the PixiJS ticker', async () => {
        const appended = stubDom({ Live2DCubismCore: {} }, 'load');
        const mod = await loadLive2D('/m/haru.model3.json', { cubismCoreUrl: 'https://cdn.test/core.js' });
        expect(appended).toHaveLength(0);
        expect((mod.Live2DModel as unknown as { tag: string }).tag).toBe('cubism4');
        expect(registerTicker).toHaveBeenCalledTimes(1);
        expect(registerTicker.mock.calls[0][0]).toEqual({ shared: {} });
    });

    it('loads the script from cubismCoreUrl exactly once across calls', async () => {
        const win: Record<string, unknown> = {};
        // The real script defines window.Live2DCubismCore when it runs.
        const appended = stubDom(win, 'load', () => { win.Live2DCubismCore = {}; });
        await loadLive2D('/m/a.model3.json', { cubismCoreUrl: 'https://cdn.test/core-once.js' });
        await loadLive2D('/m/b.model3.json', { cubismCoreUrl: 'https://cdn.test/core-once.js' });
        expect(appended.map((s) => s.src)).toEqual(['https://cdn.test/core-once.js']);
    });

    it('reports a script that cannot be loaded and lets the caller retry', async () => {
        const appended = stubDom({}, 'error');
        await expect(
            loadLive2D('/m/a.model3.json', { cubismCoreUrl: 'https://cdn.test/broken.js' })
        ).rejects.toThrow('https://cdn.test/broken.js');
        await expect(
            loadLive2D('/m/a.model3.json', { cubismCoreUrl: 'https://cdn.test/broken.js' })
        ).rejects.toThrow('https://cdn.test/broken.js');
        expect(appended).toHaveLength(2); // the failure was not cached
    });

    it('picks the Cubism 2 entry for *.model.json and asks for the Cubism 2 runtime', async () => {
        stubDom({}, 'load');
        const err = await loadLive2D('/m/shizuku.model.json').catch((e: Error) => e);
        expect((err as Error).message).toContain('live2d.min.js');
        expect((err as Error).message).toContain('cubism2RuntimeUrl');

        stubDom({ Live2D: {} }, 'load');
        const mod = await loadLive2D('/m/shizuku.model.json');
        expect((mod.Live2DModel as unknown as { tag: string }).tag).toBe('cubism2');
    });
});
