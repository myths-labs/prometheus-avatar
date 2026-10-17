import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Replace the browser-only libraries and the runtime loader; this test is about what the renderer asks for.
const loadLive2D = vi.hoisted(() => vi.fn());
vi.mock('../src/live2d-runtime', () => ({ loadLive2D }));
vi.mock('pixi.js', () => ({
    Application: class {
        view = { tag: 'canvas' };
        stage = { addChild: vi.fn(), removeChild: vi.fn() };
        renderer = { resize: vi.fn() };
        destroy = vi.fn();
    },
}));

import { Live2DRenderer } from '../src/renderer';

const fakeModel = () => ({
    width: 100,
    height: 200,
    scale: { set: vi.fn() },
    anchor: { set: vi.fn() },
    motion: vi.fn(),
    destroy: vi.fn(),
});

describe('Live2DRenderer.loadModel', () => {
    const from = vi.fn();

    beforeEach(() => {
        vi.stubGlobal('window', { devicePixelRatio: 1 });
        from.mockReset().mockResolvedValue(fakeModel());
        loadLive2D.mockReset().mockResolvedValue({ Live2DModel: { from } });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('gets the Live2D module from the runtime loader (not from the default pixi-live2d-display entry)', async () => {
        const container = { appendChild: vi.fn() } as unknown as HTMLElement;
        const renderer = new Live2DRenderer({
            container,
            cubismCoreUrl: 'https://cdn.test/core.js',
            cubism2RuntimeUrl: 'https://cdn.test/live2d.js',
        });

        await renderer.loadModel('https://cdn.test/haru.model3.json');

        expect(loadLive2D).toHaveBeenCalledTimes(1);
        expect(loadLive2D).toHaveBeenCalledWith('https://cdn.test/haru.model3.json', {
            cubismCoreUrl: 'https://cdn.test/core.js',
            cubism2RuntimeUrl: 'https://cdn.test/live2d.js',
            debug: false,
        });
        expect(from).toHaveBeenCalledWith('https://cdn.test/haru.model3.json');
        expect(renderer.getModel()).not.toBeNull();
    });

    it('passes the loader failure (missing Cubism Core) to the caller instead of swallowing it', async () => {
        loadLive2D.mockRejectedValue(new Error('[Prometheus] Live2D Cubism Core is not loaded.'));
        const renderer = new Live2DRenderer({ container: { appendChild: vi.fn() } as unknown as HTMLElement });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(renderer.loadModel('/m/haru.model3.json')).rejects.toThrow('Cubism Core is not loaded');
        expect(renderer.getModel()).toBeNull();
    });
});
