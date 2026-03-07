/**
 * Live2D Renderer
 *
 * Wraps pixi-live2d-display to load and control Live2D models.
 * Handles model loading, expression parameters, motions, and layout.
 */

import { Application } from 'pixi.js';
import type { Emotion } from './types';

// pixi-live2d-display types (loaded at runtime)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Live2DModel = any;

/** Expression parameter presets for each emotion */
const EMOTION_PARAMS: Record<Emotion, Record<string, number>> = {
    neutral: {
        'ParamEyeLOpen': 1, 'ParamEyeROpen': 1,
        'ParamBrowLY': 0, 'ParamBrowRY': 0,
        'ParamMouthForm': 0,
    },
    happy: {
        'ParamEyeLOpen': 0.8, 'ParamEyeROpen': 0.8,
        'ParamBrowLY': 0.3, 'ParamBrowRY': 0.3,
        'ParamMouthForm': 1,  // smile
        'ParamEyeLSmile': 1, 'ParamEyeRSmile': 1,
    },
    sad: {
        'ParamEyeLOpen': 0.6, 'ParamEyeROpen': 0.6,
        'ParamBrowLY': -0.5, 'ParamBrowRY': -0.5,
        'ParamMouthForm': -0.3,
    },
    angry: {
        'ParamEyeLOpen': 1.2, 'ParamEyeROpen': 1.2,
        'ParamBrowLY': -1, 'ParamBrowRY': -1,
        'ParamBrowLAngle': -1, 'ParamBrowRAngle': -1,
        'ParamMouthForm': -0.5,
    },
    surprised: {
        'ParamEyeLOpen': 1.3, 'ParamEyeROpen': 1.3,
        'ParamBrowLY': 1, 'ParamBrowRY': 1,
        'ParamMouthOpenY': 0.8,
        'ParamMouthForm': 0,
    },
    thinking: {
        'ParamEyeLOpen': 0.7, 'ParamEyeROpen': 0.9,
        'ParamBrowLY': 0.3, 'ParamBrowRY': -0.2,
        'ParamAngleX': 15,
        'ParamMouthForm': 0,
    },
};

export interface RendererOptions {
    container: HTMLElement;
    width?: number;
    height?: number;
    backgroundColor?: number;
    debug?: boolean;
}

export class Live2DRenderer {
    private app: Application | null = null;
    private model: Live2DModel | null = null;
    private container: HTMLElement;
    private width: number;
    private height: number;
    private backgroundColor: number;
    private initialized = false;
    private debug: boolean;

    constructor(options: RendererOptions) {
        this.container = options.container;
        this.width = options.width ?? 800;
        this.height = options.height ?? 600;
        this.backgroundColor = options.backgroundColor ?? 0x00000000; // transparent
        this.debug = options.debug ?? false;
    }

    /**
     * Initialize the PixiJS application
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        // Dynamically import pixi-live2d-display to register Live2D with PixiJS
        await import('pixi.js');

        this.app = new Application({
            width: this.width,
            height: this.height,
            backgroundAlpha: this.backgroundColor === 0x00000000 ? 0 : 1,
            backgroundColor: this.backgroundColor,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
        });

        // Mount canvas to container (PixiJS v6 uses .view)
        this.container.appendChild(this.app.view as HTMLCanvasElement);
        this.initialized = true;

        if (this.debug) {
            console.log('[Prometheus] Renderer initialized', { width: this.width, height: this.height });
        }
    }

    /**
     * Load a Live2D model from URL
     */
    async loadModel(modelUrl: string): Promise<void> {
        if (!this.app) {
            await this.init();
        }

        try {
            // Dynamic import of pixi-live2d-display
            const { Live2DModel: L2DModel } = await import('pixi-live2d-display');

            // Remove current model if any
            if (this.model) {
                this.app!.stage.removeChild(this.model);
                this.model.destroy();
            }

            if (this.debug) {
                console.log('[Prometheus] Loading model:', modelUrl);
            }

            // Load the model
            this.model = await L2DModel.from(modelUrl);

            // Scale and position the model to fit the canvas
            this.fitModel();

            // Add to stage
            this.app!.stage.addChild(this.model);

            // Start idle motion
            this.model.motion?.('idle', 0, { loop: true });

            if (this.debug) {
                console.log('[Prometheus] Model loaded successfully');
            }
        } catch (error) {
            console.error('[Prometheus] Failed to load model:', error);
            throw error;
        }
    }

    /**
     * Set mouth open parameter (for lip sync)
     */
    setMouthOpen(value: number): void {
        if (!this.model) return;
        this.setParam('ParamMouthOpenY', Math.max(0, Math.min(1, value)));
    }

    /**
     * Set emotion expression parameters
     */
    setEmotion(emotion: Emotion, transition = true): void {
        if (!this.model) return;

        const params = EMOTION_PARAMS[emotion];
        if (!params) return;

        if (transition) {
            // Smooth transition to new expression
            this.transitionParams(params, 300);
        } else {
            for (const [param, value] of Object.entries(params)) {
                this.setParam(param, value);
            }
        }
    }

    /**
     * Set a single model parameter
     */
    setParam(paramId: string, value: number): void {
        if (!this.model?.internalModel?.coreModel) return;
        try {
            const coreModel = this.model.internalModel.coreModel;
            const paramIndex = coreModel.getParameterIndex(paramId);
            if (paramIndex >= 0) {
                coreModel.setParameterValueById(paramId, value);
            }
        } catch {
            // Parameter might not exist on this model — silently ignore
        }
    }

    /**
     * Get the current model instance
     */
    getModel(): Live2DModel | null {
        return this.model;
    }

    /**
     * Resize the renderer
     */
    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
        if (this.app) {
            this.app.renderer.resize(width, height);
            this.fitModel();
        }
    }

    /**
     * Destroy the renderer and clean up resources
     */
    destroy(): void {
        if (this.model) {
            this.model.destroy();
            this.model = null;
        }
        if (this.app) {
            this.app.destroy(true, { children: true, texture: true });
            this.app = null;
        }
        this.initialized = false;
    }

    /**
     * Fit model to canvas with proper scaling
     */
    private fitModel(): void {
        if (!this.model || !this.app) return;

        const scaleX = this.width / this.model.width;
        const scaleY = this.height / this.model.height;
        const scale = Math.min(scaleX, scaleY) * 0.8; // 80% of canvas

        this.model.scale.set(scale);
        this.model.x = this.width / 2;
        this.model.y = this.height / 2;
        this.model.anchor?.set(0.5, 0.5);
    }

    /**
     * Smoothly transition parameters over time
     */
    private transitionParams(
        targetParams: Record<string, number>,
        durationMs: number
    ): void {
        const startTime = performance.now();
        const startParams: Record<string, number> = {};

        // Capture current values
        for (const paramId of Object.keys(targetParams)) {
            startParams[paramId] = this.getParamValue(paramId) ?? 0;
        }

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / durationMs, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);

            for (const [paramId, targetValue] of Object.entries(targetParams)) {
                const startValue = startParams[paramId] ?? 0;
                const currentValue = startValue + (targetValue - startValue) * eased;
                this.setParam(paramId, currentValue);
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    }

    /**
     * Get current value of a parameter
     */
    private getParamValue(paramId: string): number | null {
        if (!this.model?.internalModel?.coreModel) return null;
        try {
            const coreModel = this.model.internalModel.coreModel;
            return coreModel.getParameterValueById(paramId);
        } catch {
            return null;
        }
    }
}
