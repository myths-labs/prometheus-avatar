/**
 * Embed bridge: drive a hosted Prometheus avatar page framed in an <iframe>.
 *
 * The embed page (`https://prometheus.mythslabs.ai/embed/<avatarId>`, the `embedUrl` that
 * `POST /api/agent/avatar` answers) draws the avatar. A parent page talks to it with
 * `postMessage`:
 *
 *   embed → parent, once per page load and in this order
 *     { type: "prometheus:ready",  id }  its message listener is attached (it is listening)
 *     { type: "prometheus:loaded", id }  the avatar has loaded and can speak
 *     { type: "prometheus:message", text }  the viewer typed something
 *
 *   parent → embed
 *     { type: "prometheus:emotion", emotion }  happy | sad | angry | surprised | thinking | neutral
 *     { type: "prometheus:state", state }      listening | thinking | acting | done
 *     { type: "prometheus:speak", text }
 *
 * Rules this bridge follows:
 *   - emotion and state are queued until `prometheus:ready`, then the queue is sent once, in order;
 *   - speak is held until `prometheus:loaded` (a speak sent while the avatar is still loading fails
 *     in the embed); to greet on load, prefer `?speak=Hello` on the embed URL;
 *   - messages are posted to the embed's own origin only (never "*"), and incoming messages are
 *     accepted only from that origin and from this iframe's window;
 *   - fallback for embeds that predate the ready/loaded messages: if no `prometheus:ready` arrives
 *     within `readyTimeoutMs` (8 s), everything queued is sent anyway and later messages go straight
 *     through (the old behaviour). If `prometheus:ready` arrived but `prometheus:loaded` does not
 *     within `loadedTimeoutMs` (30 s), held speak messages are sent anyway.
 *
 * This file has no runtime imports, so it also runs in Node for tests.
 */

import type { Emotion } from './types';

/** Companion task states the embed understands. */
export type EmbedCompanionState = 'listening' | 'thinking' | 'acting' | 'done';

/** Messages a parent page sends to the embed. */
export type EmbedOutgoingMessage =
    | { type: 'prometheus:emotion'; emotion: Emotion }
    | { type: 'prometheus:state'; state: EmbedCompanionState }
    | { type: 'prometheus:speak'; text: string };

/** What happened to a message handed to the bridge. */
export type EmbedSendResult = 'sent' | 'queued' | 'dropped';

/** Why the bridge stopped waiting and sent anyway. */
export type EmbedFallbackReason = 'ready-timeout' | 'loaded-timeout';

/** The parts of an HTMLIFrameElement the bridge uses. */
export interface EmbedFrameLike {
    readonly contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null;
    readonly src?: string;
}

/** The parts of a MessageEvent the bridge reads. */
export interface EmbedMessageEventLike {
    readonly origin: string;
    readonly source: unknown;
    readonly data: unknown;
}

/** The parts of `window` the bridge uses (the parent page's window). */
export interface EmbedHostWindowLike {
    addEventListener(type: 'message', listener: (event: EmbedMessageEventLike) => void): void;
    removeEventListener(type: 'message', listener: (event: EmbedMessageEventLike) => void): void;
}

export interface EmbedBridgeOptions {
    /** The embed's origin. Default: the origin of `iframe.src`. Required when the iframe has no src yet. */
    origin?: string;
    /** When set, `prometheus:ready` / `prometheus:loaded` carrying a different `id` are ignored. */
    avatarId?: string;
    /** How long to wait for `prometheus:ready` before sending anyway (default 8000 ms). */
    readyTimeoutMs?: number;
    /** How long after `prometheus:ready` to wait for `prometheus:loaded` before sending held speak messages anyway (default 30000 ms). */
    loadedTimeoutMs?: number;
    /** Maximum queued emotion/state messages and, separately, held speak messages; the oldest is dropped beyond it (default 20). */
    maxQueue?: number;
    /** The parent window to listen on. Default: `globalThis.window`. */
    hostWindow?: EmbedHostWindowLike;
    /** The embed is listening (`prometheus:ready`). */
    onReady?: (id: string | undefined) => void;
    /** The avatar has loaded and can speak (`prometheus:loaded`). */
    onLoaded?: (id: string | undefined) => void;
    /** The viewer typed a message in the embed (`prometheus:message`). */
    onViewerMessage?: (text: string) => void;
    /** The bridge stopped waiting and sent anyway (see the file header). */
    onFallback?: (reason: EmbedFallbackReason) => void;
}

/** Default wait for `prometheus:ready` before falling back to sending anyway. */
export const EMBED_READY_TIMEOUT_MS = 8000;
/** Default wait for `prometheus:loaded` after `prometheus:ready` before sending held speak messages anyway. */
export const EMBED_LOADED_TIMEOUT_MS = 30000;
const DEFAULT_MAX_QUEUE = 20;

const EMOTIONS: readonly string[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking'];
const STATES: readonly string[] = ['listening', 'thinking', 'acting', 'done'];

type TimerHandle = ReturnType<typeof setTimeout>;

function originOf(url: string | undefined): string | null {
    if (!url) return null;
    try {
        const origin = new URL(url).origin;
        return origin && origin !== 'null' ? origin : null;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export class EmbedBridge {
    private readonly frame: EmbedFrameLike;
    private readonly origin: string;
    private readonly options: EmbedBridgeOptions;
    private readonly hostWindow: EmbedHostWindowLike;
    private readonly maxQueue: number;
    private readonly listener: (event: EmbedMessageEventLike) => void;
    private controlQueue: EmbedOutgoingMessage[] = [];
    private speakQueue: EmbedOutgoingMessage[] = [];
    private readyTimer: TimerHandle | null = null;
    private loadedTimer: TimerHandle | null = null;
    private isReadyFlag = false;
    private isLoadedFlag = false;
    private destroyed = false;

    constructor(frame: EmbedFrameLike, options: EmbedBridgeOptions = {}) {
        const origin = originOf(options.origin) ?? originOf(frame.src);
        if (!origin) {
            throw new Error('EmbedBridge: cannot tell the embed origin. Set the iframe src to the embed URL first, or pass options.origin.');
        }
        const hostWindow = options.hostWindow
            ?? (globalThis as { window?: EmbedHostWindowLike }).window;
        if (!hostWindow) {
            throw new Error('EmbedBridge: no window to listen on. Pass options.hostWindow outside a browser.');
        }
        this.frame = frame;
        this.origin = origin;
        this.options = options;
        this.hostWindow = hostWindow;
        this.maxQueue = Math.max(1, options.maxQueue ?? DEFAULT_MAX_QUEUE);
        this.listener = (event) => this.handleMessage(event);
        this.hostWindow.addEventListener('message', this.listener);
        this.readyTimer = setTimeout(() => this.onReadyTimeout(), options.readyTimeoutMs ?? EMBED_READY_TIMEOUT_MS);
    }

    /** The embed has said it is listening (or the ready wait ran out). */
    get ready(): boolean {
        return this.isReadyFlag;
    }

    /** The avatar has said it can speak (or a wait ran out). */
    get loaded(): boolean {
        return this.isLoadedFlag;
    }

    /** Emotion/state messages waiting for `prometheus:ready`, and speak messages waiting for `prometheus:loaded`. */
    get pending(): { control: number; speak: number } {
        return { control: this.controlQueue.length, speak: this.speakQueue.length };
    }

    setEmotion(emotion: Emotion): EmbedSendResult {
        return this.send({ type: 'prometheus:emotion', emotion });
    }

    setState(state: EmbedCompanionState): EmbedSendResult {
        return this.send({ type: 'prometheus:state', state });
    }

    speak(text: string): EmbedSendResult {
        return this.send({ type: 'prometheus:speak', text });
    }

    /** Send a message now, or queue it until the embed can take it. Unknown or malformed messages are dropped. */
    send(message: EmbedOutgoingMessage): EmbedSendResult {
        if (this.destroyed || !isValidOutgoing(message)) return 'dropped';
        if (message.type === 'prometheus:speak') {
            if (this.isLoadedFlag && this.post(message)) return 'sent';
            this.enqueue(this.speakQueue, message);
            return 'queued';
        }
        if (this.isReadyFlag && this.post(message)) return 'sent';
        this.enqueue(this.controlQueue, message);
        return 'queued';
    }

    /** Stop listening and drop anything still queued. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.hostWindow.removeEventListener('message', this.listener);
        this.clearTimers();
        this.controlQueue = [];
        this.speakQueue = [];
    }

    private handleMessage(event: EmbedMessageEventLike): void {
        if (this.destroyed) return;
        if (event.origin !== this.origin) return;
        if (!this.frame.contentWindow || event.source !== this.frame.contentWindow) return;
        const data = event.data;
        if (!isRecord(data) || typeof data.type !== 'string') return;
        const id = typeof data.id === 'string' ? data.id : undefined;

        switch (data.type) {
            case 'prometheus:ready':
                if (this.options.avatarId && id !== undefined && id !== this.options.avatarId) return;
                this.markReady(id);
                return;
            case 'prometheus:loaded':
                if (this.options.avatarId && id !== undefined && id !== this.options.avatarId) return;
                if (!this.isReadyFlag) this.markReady(id);
                this.markLoaded(id);
                return;
            case 'prometheus:message':
                if (typeof data.text === 'string') this.options.onViewerMessage?.(data.text);
                return;
            default:
                return;
        }
    }

    private markReady(id: string | undefined): void {
        // A second ready means the embed page loaded again: it is listening, but its avatar is not loaded yet.
        this.isReadyFlag = true;
        this.isLoadedFlag = false;
        if (this.readyTimer) {
            clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
        this.flush(this.controlQueue);
        if (this.loadedTimer) clearTimeout(this.loadedTimer);
        this.loadedTimer = setTimeout(
            () => this.onLoadedTimeout(),
            this.options.loadedTimeoutMs ?? EMBED_LOADED_TIMEOUT_MS,
        );
        this.options.onReady?.(id);
    }

    private markLoaded(id: string | undefined): void {
        this.isLoadedFlag = true;
        if (this.loadedTimer) {
            clearTimeout(this.loadedTimer);
            this.loadedTimer = null;
        }
        this.flush(this.speakQueue);
        this.options.onLoaded?.(id);
    }

    private onReadyTimeout(): void {
        this.readyTimer = null;
        if (this.destroyed || this.isReadyFlag) return;
        // An embed without the ready/loaded messages: behave as before and send everything now.
        this.isReadyFlag = true;
        this.isLoadedFlag = true;
        this.flush(this.controlQueue);
        this.flush(this.speakQueue);
        this.options.onFallback?.('ready-timeout');
    }

    private onLoadedTimeout(): void {
        this.loadedTimer = null;
        if (this.destroyed || this.isLoadedFlag) return;
        this.isLoadedFlag = true;
        this.flush(this.speakQueue);
        this.options.onFallback?.('loaded-timeout');
    }

    private enqueue(queue: EmbedOutgoingMessage[], message: EmbedOutgoingMessage): void {
        queue.push(message);
        while (queue.length > this.maxQueue) queue.shift();
    }

    /** Send every queued message once, in order. Messages that cannot be posted (no iframe window) stay queued. */
    private flush(queue: EmbedOutgoingMessage[]): void {
        while (queue.length > 0) {
            if (!this.post(queue[0])) return;
            queue.shift();
        }
    }

    private post(message: EmbedOutgoingMessage): boolean {
        const target = this.frame.contentWindow;
        if (!target) return false;
        target.postMessage(message, this.origin);
        return true;
    }

    private clearTimers(): void {
        if (this.readyTimer) clearTimeout(this.readyTimer);
        if (this.loadedTimer) clearTimeout(this.loadedTimer);
        this.readyTimer = null;
        this.loadedTimer = null;
    }
}

function isValidOutgoing(message: unknown): message is EmbedOutgoingMessage {
    if (!isRecord(message)) return false;
    switch (message.type) {
        case 'prometheus:emotion':
            return typeof message.emotion === 'string' && EMOTIONS.includes(message.emotion);
        case 'prometheus:state':
            return typeof message.state === 'string' && STATES.includes(message.state);
        case 'prometheus:speak':
            return typeof message.text === 'string' && message.text.trim().length > 0;
        default:
            return false;
    }
}

/**
 * Connect to an embed framed in `iframe`. Create it right after setting the iframe's src, before
 * the embed can post `prometheus:ready`.
 *
 * @example
 *   const frame = document.querySelector('iframe#prometheus-embed') as HTMLIFrameElement;
 *   frame.src = embedUrl + '?speak=' + encodeURIComponent('Hi there');
 *   const embed = connectEmbed(frame);
 *   embed.setState('thinking');   // queued until the embed is listening, then sent once
 *   embed.speak('Here you go.');  // held until the avatar has loaded
 */
export function connectEmbed(frame: EmbedFrameLike, options?: EmbedBridgeOptions): EmbedBridge {
    return new EmbedBridge(frame, options);
}
