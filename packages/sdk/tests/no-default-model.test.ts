/**
 * The core package ships no model and picks none. Whatever modelUrl it is given is the only thing it loads:
 * an empty modelUrl must never turn into a default model, a sample on a CDN, or a request of our own.
 * The 2D runtime is replaced by a recorder, so the test sees exactly which URL reaches the loader.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('pixi-live2d-display', () => ({ Live2DModel: { from: runtime.from } }));
vi.mock('pixi.js', () => ({
    Application: class {
        view = { tagName: 'CANVAS' };
        stage = { addChild: vi.fn(), removeChild: vi.fn() };
        destroy = vi.fn();
    },
}));

import { PrometheusAvatar, createAvatar } from '../src/avatar';
import type { PrometheusConfig } from '../src/types';

const container = { appendChild: vi.fn() } as unknown as HTMLElement;
const ttsEngine = { speak: vi.fn(), stop: vi.fn() } as unknown as NonNullable<PrometheusConfig['ttsEngine']>;
const fetchSpy = vi.fn();

const requested = () => runtime.from.mock.calls.map((call) => call[0]);

beforeEach(() => {
    runtime.from.mockReset();
    // Like the real loader, fail on every URL: nothing here needs a drawn model, only the URL that reached it.
    runtime.from.mockImplementation(async (url: unknown) => {
        throw new Error(`model not loaded: ${String(url)}`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchSpy.mockReset();
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('core loads only the model it is given', () => {
    it('control: a given URL reaches the loader unchanged (so the cases below are not vacuous)', async () => {
        const url = 'https://models.example.test/a/a.model3.json';
        const avatar = new PrometheusAvatar({ container, modelUrl: url, ttsEngine });
        await expect(avatar.init()).rejects.toThrow(url);
        expect(requested()).toEqual([url]);
    });

    for (const [label, modelUrl] of [['empty string', ''], ['blank string', '   '], ['undefined', undefined], ['null', null]] as const) {
        it(`init() with ${label} as modelUrl loads no other model and makes no request of its own`, async () => {
            const avatar = new PrometheusAvatar({ container, modelUrl: modelUrl as unknown as string, ttsEngine });
            await avatar.init().catch(() => undefined);
            expect(requested().filter((url) => url !== modelUrl)).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it(`createAvatar() with ${label} as modelUrl loads no other model and makes no request of its own`, async () => {
            await createAvatar({ container, modelUrl: modelUrl as unknown as string, ttsEngine }).catch(() => undefined);
            expect(requested().filter((url) => url !== modelUrl)).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it(`loadModel() with ${label} loads no other model and makes no request of its own`, async () => {
            const avatar = new PrometheusAvatar({ container, modelUrl: 'https://models.example.test/a/a.model3.json', ttsEngine });
            await avatar.init().catch(() => undefined);
            runtime.from.mockClear();
            await avatar.loadModel(modelUrl as unknown as string).catch(() => undefined);
            expect(requested().filter((url) => url !== modelUrl)).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });
    }
});
