/**
 * Live2D runtime loader
 *
 * pixi-live2d-display's default entry (`pixi-live2d-display`) throws while the
 * module is being evaluated unless BOTH Live2D runtimes (Cubism 2 `live2d.min.js`
 * and Cubism 4 `live2dcubismcore.min.js`) are already on the page. Nothing in a
 * normal bundler project puts them there, so `createAvatar()` used to hang on an
 * import error.
 *
 * This module imports only the entry that matches the model (`/cubism4` for
 * `.model3.json`, `/cubism2` for `.model.json`) and only after the matching
 * runtime is present, either already on the page or loaded from a URL the caller
 * chose.
 *
 * The SDK does not bundle or silently download Live2D's Cubism Core. It is
 * proprietary software under Live2D's own licence; the caller adds it (script tag
 * or `cubismCoreUrl`) and thereby accepts that licence.
 */

import { Ticker } from 'pixi.js';

/** Where Live2D publishes Cubism Core for the web (see README, "Live2D runtime"). */
const CUBISM_CORE_DOCS = 'https://www.live2d.com/en/sdk/license/';

type PixiLive2DModule = typeof import('pixi-live2d-display/cubism4');

export interface Live2DRuntimeOptions {
    /** URL of `live2dcubismcore.min.js`, loaded only if `window.Live2DCubismCore` is missing. */
    cubismCoreUrl?: string;
    /** URL of the Cubism 2 runtime `live2d.min.js`, loaded only if `window.Live2D` is missing (Cubism 2 models only). */
    cubism2RuntimeUrl?: string;
    debug?: boolean;
}

interface Live2DWindow {
    Live2DCubismCore?: unknown;
    Live2D?: unknown;
}

/** True for Cubism 2 model files (`*.model.json`); everything else is treated as Cubism 3/4 (`*.model3.json`). */
export function isCubism2Model(modelUrl: string): boolean {
    const path = modelUrl.split(/[?#]/)[0];
    return /\.model\.json$/i.test(path);
}

const scriptLoads = new Map<string, Promise<void>>();

/** Load a classic `<script>` once per URL. A failed load is not cached, so the caller can retry. */
function loadScript(url: string): Promise<void> {
    const cached = scriptLoads.get(url);
    if (cached) return cached;

    const pending = new Promise<void>((resolve, reject) => {
        const el = document.createElement('script');
        el.src = url;
        el.async = true;
        el.onload = () => resolve();
        el.onerror = () => {
            el.remove();
            scriptLoads.delete(url);
            reject(new Error(`[Prometheus] Could not load the Live2D runtime script: ${url}`));
        };
        document.head.appendChild(el);
    });
    scriptLoads.set(url, pending);
    return pending;
}

function missingRuntimeError(name: string, file: string, optionName: string): Error {
    return new Error(
        `[Prometheus] ${name} is not loaded. Add <script src="…/${file}"></script> before createAvatar(), ` +
        `or pass { ${optionName}: '<url of ${file}>' } to createAvatar(). ` +
        `The SDK does not bundle Live2D's runtime (proprietary licence: ${CUBISM_CORE_DOCS}). ` +
        `See the README section "Live2D runtime".`
    );
}

/**
 * Make sure the right Live2D runtime is on the page, then return the matching
 * pixi-live2d-display entry with the PixiJS ticker registered (without it the
 * model never updates when PixiJS comes from a bundler instead of `window.PIXI`).
 */
export async function loadLive2D(
    modelUrl: string,
    options: Live2DRuntimeOptions = {}
): Promise<PixiLive2DModule> {
    const win = window as unknown as Live2DWindow;
    let mod: PixiLive2DModule;

    if (isCubism2Model(modelUrl)) {
        if (!win.Live2D) {
            if (!options.cubism2RuntimeUrl) {
                throw missingRuntimeError('Live2D Cubism 2 runtime', 'live2d.min.js', 'cubism2RuntimeUrl');
            }
            await loadScript(options.cubism2RuntimeUrl);
        }
        // Same API surface as the Cubism 4 entry; only the runtime behind it differs.
        mod = (await import('pixi-live2d-display/cubism2')) as unknown as PixiLive2DModule;
    } else {
        if (!win.Live2DCubismCore) {
            if (!options.cubismCoreUrl) {
                throw missingRuntimeError('Live2D Cubism Core', 'live2dcubismcore.min.js', 'cubismCoreUrl');
            }
            await loadScript(options.cubismCoreUrl);
        }
        mod = await import('pixi-live2d-display/cubism4');
    }

    mod.Live2DModel.registerTicker(Ticker);

    if (options.debug) {
        console.log('[Prometheus] Live2D runtime ready', isCubism2Model(modelUrl) ? '(Cubism 2)' : '(Cubism 4)');
    }
    return mod;
}
