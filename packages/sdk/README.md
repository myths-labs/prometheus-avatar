# @prometheusavatar/core

[![npm](https://img.shields.io/npm/v/@prometheusavatar/core)](https://www.npmjs.com/package/@prometheusavatar/core)
[![license](https://img.shields.io/npm/l/@prometheusavatar/core)](./LICENSE)

Give your AI agent an embodied avatar — Live2D rendering, TTS, lip-sync, and emotion analysis in one SDK.

中文说明见本文末尾 · [Chinese version at the end](#中文说明)

## What is in this package

| In the npm package — runs in your page, no Prometheus account, no key | Not in the package — only in the hosted app at [prometheus.mythslabs.ai](https://prometheus.mythslabs.ai) |
|---|---|
| Live2D rendering (Cubism 2 and 4 models, via PixiJS) | Gemini Live real-time voice, Gemini TTS voices |
| Lip sync, driven by the audio your TTS engine reports | Camera face tracking (VTuber mode) |
| Rule-based emotion detection (emoji, English/Chinese keywords, punctuation) | The 9-provider chat backend and its API keys |
| Browser speech output (Web Speech API) and the `ITTSEngine` interface for your own TTS | Marketplace accounts, purchases, creator dashboard |
| The `ILLMProvider` interface (types only) | |

**There is no LLM and no speech recognition in this package.** You bring your own LLM (your own key, called from your own code) and, if you want voice input, your own recognizer; the SDK turns the *text* your LLM produces into an expression, a voice and a moving mouth. You do not need a Prometheus account for any of that.

`AssetCreator` (see below) is the one class that talks to our servers, and it needs a `pak_` agent key. `AssetManager` only applies asset manifests you hand it.

## Quick Start

```bash
npm install @prometheusavatar/core
```

Works with any bundler (Vite, webpack 5, esbuild, …) or an ESM CDN. You need a page with WebGL, a Live2D model, and Live2D's runtime (next section).

```ts
import { createAvatar } from '@prometheusavatar/core';

const avatar = await createAvatar({
  container: document.getElementById('avatar')!,
  // Any Cubism 4 model (*.model3.json). This public sample is Live2D's "Haru".
  modelUrl: 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@0.4.0/test/assets/haru/haru_greeter_t03.model3.json',
  // Live2D's Cubism Core — read "Live2D runtime" below before you keep this line.
  cubismCoreUrl: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
});

// Browsers only start speech after a user gesture: call speak() from a click handler.
button.addEventListener('click', () => avatar.speak('Hello! How are you today? 😊'));
```

## Live2D runtime (required, not included)

Live2D models need Live2D's **Cubism Core** (`live2dcubismcore.min.js`). It is Live2D Inc.'s proprietary software, so this package does not bundle or redistribute it, and the SDK never downloads it behind your back. You add it, and by doing so you accept [Live2D's licence](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html). Whether your project needs a paid publication licence depends on who you are and what you build — see [Live2D's licence overview](https://www.live2d.com/en/sdk/license/) (including the rules for apps that let users load their own models: [Expandable Application](https://www.live2d.com/en/sdk/license/expandable/)).

Pick one:

1. **Pass the URL** — `createAvatar({ …, cubismCoreUrl })`. The SDK loads that script once, only if `window.Live2DCubismCore` is not already there. Live2D publishes Cubism Core for web use at `https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js`.
2. **Script tag** before your code runs: `<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>`.
3. **Self-host**: download the Cubism SDK for Web from [Live2D's download page](https://www.live2d.com/en/sdk/download/web/) (it shows the licence first), copy `live2dcubismcore.min.js` next to your app, and point `cubismCoreUrl` or the script tag at it.

If Cubism Core is missing, `createAvatar()` rejects with an error that names this section; it does not hang.

**Cubism 2 models** (`*.model.json`) additionally need Live2D's Cubism 2 runtime `live2d.min.js` on the page or passed as `cubism2RuntimeUrl`; we do not host or link it. Everything else in this README assumes Cubism 4.

Third-party licences (Live2D, PixiJS, the sample models): [THIRD_PARTY_LICENSES.md](https://github.com/myths-labs/prometheus-avatar/blob/main/THIRD_PARTY_LICENSES.md), also included in this package.

## Install notes

- **Dependencies.** `pixi.js@^6.5.10` and `pixi-live2d-display@^0.4.0` are regular dependencies and install with the SDK. This SDK needs **PixiJS 6.5.10**, not 7 or 8. If your own project already uses another PixiJS major, your app will contain two copies of PixiJS (yours, and 6.5.10 under the SDK); that works, but do not hand them objects from each other. If you install PixiJS yourself next to the SDK, choose `6.5.10`.
- **`npm audit` reports 3 critical issues** (`gh-pages` → `pixi-live2d-display` → `@prometheusavatar/core`). The advisory (prototype pollution in `gh-pages` < 5, GHSA-8mmm-9v2q-x3f9) is in a GitHub-Pages publishing tool that `pixi-live2d-display@0.4.0` lists among its dependencies by mistake; no file of `pixi-live2d-display` or of this SDK ever loads it, and it never reaches your bundle. There is no fixed release of `pixi-live2d-display` 0.4.x to upgrade to. Do not run `npm audit fix --force`: it would downgrade this package.
- **Node.** Only needed for your build tools and for `MemoryBridge`. The SDK itself runs in the browser.

## API Reference

### `createAvatar(options): Promise<PrometheusAvatar>`

Factory function to create and initialize an avatar.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `container` | `HTMLElement` | required | DOM element to render into |
| `modelUrl` | `string` | required | URL of the Live2D model: `*.model3.json` (Cubism 4) or `*.model.json` (Cubism 2) |
| `cubismCoreUrl` | `string` | none | URL of `live2dcubismcore.min.js`, loaded if `window.Live2DCubismCore` is missing. See [Live2D runtime](#live2d-runtime-required-not-included) |
| `cubism2RuntimeUrl` | `string` | none | URL of `live2d.min.js`; Cubism 2 models only |
| `width` | `number` | `800` | Canvas width |
| `height` | `number` | `600` | Canvas height |
| `backgroundColor` | `number` | `0x00000000` | Canvas background (hex) |
| `ttsEngine` | `ITTSEngine` | `WebSpeechTTS` | Custom TTS engine |
| `ttsOptions` | `TTSOptions` | `{ rate: 1, pitch: 1, volume: 1, lang: 'en-US' }` | Voice settings for the default engine, passed to every `speak()` call: `voice`, `rate` (0.1–10), `pitch` (0–2), `volume` (0–1), `lang` (a BCP 47 tag such as `'fi-FI'`). Which voices exist depends on the browser and operating system |
| `debug` | `boolean` | `false` | Enable debug logging |

### `PrometheusAvatar`

#### Methods

```ts
avatar.speak(text: string): Promise<void>     // Speak with auto emotion + lip-sync
avatar.setEmotion(emotion: Emotion): void      // Manually set emotion
avatar.processText(text: string): EmotionResult // Process LLM stream (no TTS)
avatar.loadModel(modelUrl: string): Promise<void> // Switch avatar model
avatar.stop(): void                            // Stop speech + lip-sync
avatar.resize(width, height): void             // Resize canvas
avatar.getEmotion(): Emotion                   // Get current emotion
avatar.destroy(): void                         // Cleanup resources
```

#### Events

```ts
avatar.on('speech:start', ({ text }) => { ... });
avatar.on('speech:end', ({ text }) => { ... });
avatar.on('emotion:change', ({ result, previous }) => { ... });
avatar.on('lipsync:frame', ({ frame }) => { ... });
avatar.on('model:loaded', ({ modelUrl }) => { ... });
avatar.on('model:error', ({ error, modelUrl }) => { ... });
```

#### Emotions

`'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking'`

The built-in analyzer is rule-based (emoji, English and Chinese keywords, punctuation). Text without such a cue stays `neutral`, whatever its language.

### Voice

The default engine (`WebSpeechTTS`) uses the browser's Web Speech API: the language is `en-US` unless you set `ttsOptions.lang`, and because the API does not expose the audio, the mouth is animated from the letters of the text, not from the sound. To use real audio (a cloud TTS, a recorded voice), plug in your own engine.

### Custom TTS Engine

Implement `ITTSEngine` to use any TTS provider. The avatar sets `onAudioData` and `onEnd` on your engine: call `onAudioData` with audio samples while you play (that drives the mouth), and `onEnd` when playback finishes. `isSpeaking` is read-only, so implement it as a getter.

```ts
import { createAvatar } from '@prometheusavatar/core';
import type { ITTSEngine, TTSOptions } from '@prometheusavatar/core';

class MyTTSEngine implements ITTSEngine {
  private speaking = false;

  get isSpeaking(): boolean {
    return this.speaking;
  }

  onAudioData?: (data: Float32Array) => void; // set by the avatar
  onEnd?: () => void;                         // set by the avatar

  async speak(text: string, options?: TTSOptions): Promise<void> {
    this.speaking = true;
    // …fetch/play audio; while it plays: this.onAudioData?.(samples)
    this.speaking = false;
    this.onEnd?.();
  }

  stop(): void {
    this.speaking = false;
  }
}

const avatar = await createAvatar({
  container: el,
  modelUrl: url,
  cubismCoreUrl,
  ttsEngine: new MyTTSEngine(),
});
```

### Bring your own LLM

The SDK does not call any LLM. Call your provider yourself (with your own key), then hand the text to the avatar: `await avatar.speak(reply)` for a finished reply, or `avatar.processText(chunk)` on each streamed chunk to update expression and mouth without TTS. `ILLMProvider` is only a shape you may follow; [`examples/multi-llm`](https://github.com/myths-labs/prometheus-avatar/tree/main/examples/multi-llm) shows one way to wire several providers.

## AssetCreator — talks to Prometheus servers

> **Everything `AssetCreator` does is a request to `https://prometheus.mythslabs.ai`** (or the `apiBaseUrl` you pass). It needs a Prometheus agent key (`pak_…`, from [Settings → Agent API Key](https://prometheus.mythslabs.ai/settings/agent-keys)) for deploys. **If you pass `apiKey` to `createImage()`, that key — meant for the image provider (for example your OpenAI key) — is sent in the request body to our server**, which uses it to call the provider for you (`POST /api/creator/generate-image-pro`). Do not pass a key you would not hand to a hosted service; prefer a restricted, revocable one. Nothing else in the SDK sends keys anywhere.

`AssetCreator.createImage()` — image generation with automatic multi-provider fallback, aimed at game-store skin preview cards.

```ts
import { AssetCreator } from '@prometheusavatar/core';

const creator = new AssetCreator(); // uses PROMETHEUS_API_KEY from the environment in Node, or pass a pak_ key as 2nd argument

// Simple
const img = await creator.createImage({
  prompt: 'Anime shrine maiden with sakura petals, cel-shaded, Genshin Impact shop preview tier',
  style: 'anime',
});

// AAA Skin Preview Card (recommend ≥100-word prompts with explicit AAA benchmark named)
const skin = await creator.createImage({
  prompt: `3D cel-shaded engine render, anime shrine maiden character, slight elevated 3/4 hero pose,
glossy game-art materials, clean dark studio backdrop with subtle radial gradient, pink/peach gradient
lighting, NOT flat 2D illustration. Genshin Impact / Overwatch shop preview tier. Production-ready
AAA skin preview card.`,
  style: 'anime',
  taskType: 'aaa_skin',
  size: '1024x1536',
  quality: 'high',
  apiKey: process.env.OPENAI_API_KEY, // optional BYOK: SENT TO prometheus.mythslabs.ai (see the note above)
  upload: true,                       // upload to Supabase + return publicUrl
});

console.log(skin.publicUrl, skin.platformCostUsd);
```

### `AssetCreator.createImage(options): Promise<CreateImageResult>`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prompt` | `string` | required | Recommend ≥100 words with explicit AAA benchmark named for best quality. |
| `style` | `ImageStyle` | none | `anime` / `cel-shade` / `cyberpunk` / `kawaii` / `fantasy` / `cartoon` / `realistic` / `photorealistic` / `pixar` |
| `taskType` | `ImageTaskType` | `'character'` | Routes to the optimal provider per task. |
| `size` | `'1024x1024'\|'1024x1536'\|'1536x1024'\|'auto'` | `'1024x1024'` | `1024x1536` for vertical (XHS / 9:16). `1536x1024` for landscape (X / LinkedIn / 16:9). |
| `quality` | `'low'\|'medium'\|'high'\|'auto'` | `'high'` | $0.02 low → $0.07-0.19 high (per image). |
| `numVariants` | `number` | `1` | 1-4 variants. |
| `referenceImages` | `string[]` | none | Data URLs or HTTPS URLs · character consistency chain across multiple calls. |
| `provider` | `'openai'\|'gemini'\|'gemini-flash'` | auto | Override · default routes per `taskType`. |
| `apiKey` | `string` | env | Your own image-provider key (BYOK) · platform billing skipped. **Sent to our server in the request body.** |
| `upload` | `boolean` | `false` | Upload to Supabase Storage and return `publicUrl`. |

Returns `CreateImageResult`:
```ts
{
  provider: 'openai' | 'gemini' | 'gemini-flash';
  taskId: string;
  imageUrl: string;       // data URL OR https URL
  publicUrl?: string;     // when upload: true
  variants?: string[];
  width: number;
  height: number;
  durationSec: number;
  platformCostUsd?: number;
}
```

**Forge UI live at** [prometheus.mythslabs.ai/marketplace/create](https://prometheus.mythslabs.ai/marketplace/create) — visual 7-style picker reference.

## MemoryBridge (Node.js)

Shares a local memory file (JSON / TXT / MD) with the Prometheus app over a local WebSocket. The app reads the file
when it connects and whenever it changes, and appends each conversation to it at the end of a session.

`MemoryBridge` uses Node's `fs`, `path` and `events`, so it lives in its own entry, **`@prometheusavatar/core/node`**, which keeps the main entry bundle-able for the browser. (Under Node, `import { MemoryBridge } from '@prometheusavatar/core'` still works as in 0.11.0–0.11.4; TypeScript projects that resolve modules with `bundler` should import from `/node`.)

```ts
import { MemoryBridge } from '@prometheusavatar/core/node';

const bridge = new MemoryBridge({ memoryFilePath: './memory.md' }); // ws://127.0.0.1:8765
await bridge.start();
```

Then in the app: Settings → SDK Memory Bridge → on (default URL `ws://localhost:8765`).

Defaults that protect the file (since 0.11.4):

| Option | Default | What it does |
|--------|---------|--------------|
| `host` | `"127.0.0.1"` | Listens on this machine only. A non-loopback value such as `"0.0.0.0"` prints a warning; use it only on a network you trust. |
| `allowedOrigins` | `MEMORY_BRIDGE_DEFAULT_ORIGINS` | Browser pages allowed to connect: `https://prometheus.mythslabs.ai` and pages served from `localhost` / `127.0.0.1` / `[::1]` on any port. Other sites get HTTP 403. Spread the default list to add your own origin. Connections without an `Origin` header (Node clients) are allowed. |
| `allowedHosts` | — | Extra names accepted in the `Host` header besides `localhost`, `127.0.0.1`, `[::1]` and an explicit `host`. |
| `maxPayloadBytes` | 1 MiB | Larger messages close the connection. |
| `maxMemoryFileBytes` | 10 MiB | A conversation that would grow the file past this is not written; the client gets `{ type: "error", data: { code: "memory_file_full" } }`. |

## Architecture

```
PrometheusAvatar (orchestrator)
├── Live2DRenderer  — PIXI.js + pixi-live2d-display (needs Live2D's Cubism Core, supplied by you)
├── WebSpeechTTS    — pluggable TTS (Web Speech API default)
├── LipSyncEngine   — audio → mouth shape mapping
└── EmotionAnalyzer — text → emotion detection
```

## License

MIT — [Myths Labs](https://github.com/myths-labs) · see [LICENSE](./LICENSE) (included in this package). Live2D's runtime and sample models are under Live2D's own terms: [THIRD_PARTY_LICENSES.md](https://github.com/myths-labs/prometheus-avatar/blob/main/THIRD_PARTY_LICENSES.md).

---

## 中文说明

给你的 AI agent 一个有表情、会说话的 Live2D 虚拟形象：渲染、语音输出、口型同步、情绪识别，一个 SDK。

### 这个包里有什么、没有什么

- **包内（在你的网页里运行，不需要 Prometheus 账号和任何 key）**：Live2D 渲染（Cubism 2/4，基于 PixiJS）、口型同步、规则式情绪识别（emoji、中英文关键词、标点）、浏览器语音输出（Web Speech API）以及接入你自己 TTS 的 `ITTSEngine` 接口。
- **包内没有**：LLM、语音识别。LLM 要你自己调用（用你自己的 key），再把回复文本交给 `avatar.speak(text)` 或 `avatar.processText(chunk)`。Gemini Live 实时语音、Gemini TTS、摄像头面部追踪、九家 LLM 的聊天后端、数字市场账号，都只在托管应用 [prometheus.mythslabs.ai](https://prometheus.mythslabs.ai) 里，不在 npm 包里。

### 快速开始

```bash
npm install @prometheusavatar/core
```

用法见上面的 Quick Start：`createAvatar({ container, modelUrl, cubismCoreUrl })`，语音要在用户点击之后再调用 `speak()`。

### Live2D 运行库（必须自己提供）

Live2D 模型需要 Live2D 公司的 **Cubism Core**（`live2dcubismcore.min.js`）。它是 Live2D 的专有软件，所以本包不打包、不转发，SDK 也不会背着你去下载。你自己加进来，同时表示你接受 [Live2D 的许可协议](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)；是否需要付费发布许可取决于你是谁、做什么，见 [Live2D 许可说明](https://www.live2d.com/en/sdk/license/)（让用户自己加载模型的应用属于 [Expandable Application](https://www.live2d.com/en/sdk/license/expandable/)，条款另有规定）。

三种方式任选其一：

1. `createAvatar({ …, cubismCoreUrl })`：页面里没有 `window.Live2DCubismCore` 时，SDK 加载这个地址的脚本（只加载一次）。Live2D 提供的网页用地址：`https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js`。
2. 在你的代码之前放一个 `<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>`。
3. 自托管：从 [Live2D 下载页](https://www.live2d.com/en/sdk/download/web/)下载 Cubism SDK for Web（下载前会先显示许可协议），把 `live2dcubismcore.min.js` 放到你的站点，再用方式 1 或 2 指向它。

没有 Cubism Core 时 `createAvatar()` 会直接报错并指向这一节，不会卡住。Cubism 2 模型（`*.model.json`）另需 `live2d.min.js`（`cubism2RuntimeUrl`），我们不托管。

### 安装须知

- 本 SDK 使用 **PixiJS 6.5.10**（不是 7 或 8），自己装 PixiJS 时请选 `6.5.10`；项目里若已有别的 PixiJS 大版本，会同时存在两份，能用，但不要把两边的对象互相传。
- `npm audit` 会报 3 个 critical（`gh-pages` → `pixi-live2d-display` → 本包）。问题出在 `pixi-live2d-display@0.4.0` 误列进依赖的 GitHub Pages 发布工具 `gh-pages`；它的运行代码和本 SDK 都不会加载它，也不会进你的打包产物。目前没有可升级的修复版，请勿执行 `npm audit fix --force`（会把本包降级）。
- 默认语音（Web Speech）的语言是 `en-US`，要说芬兰语、中文等请设置 `ttsOptions.lang`（如 `'fi-FI'`），可用声音取决于浏览器和系统。默认引擎拿不到真实音频，嘴型是按文字字母模拟的；要真实口型请接入自己的 `ITTSEngine`。
- 情绪识别是规则式的，只认 emoji、中英文关键词和标点；其他语言没有这些线索时保持 `neutral`。

### AssetCreator 会把 key 发到我们的服务器

`AssetCreator` 的所有调用都是请求 `https://prometheus.mythslabs.ai`（或你传入的 `apiBaseUrl`），部署需要 Prometheus 的 `pak_` agent key。**给 `createImage()` 传 `apiKey`（给图像供应商用的 key，例如你的 OpenAI key）时，这个 key 会放在请求体里发到我们的服务器**，由服务器替你调用供应商。不愿交给托管服务的 key 不要传，最好用受限、可随时作废的 key。SDK 的其他部分不会把任何 key 发到别处。

### MemoryBridge（Node.js）

`MemoryBridge` 依赖 Node 的 `fs` / `path` / `events`，所以放在独立入口 **`@prometheusavatar/core/node`**，主入口因此可以直接用于浏览器打包：`import { MemoryBridge } from '@prometheusavatar/core/node'`。在 Node 下，`import { MemoryBridge } from '@prometheusavatar/core'` 仍然可用（与 0.11.0–0.11.4 一致）。

### 许可

MIT，见包内 [LICENSE](./LICENSE)。Live2D 运行库和示例模型适用 Live2D 自己的条款：[THIRD_PARTY_LICENSES.md](https://github.com/myths-labs/prometheus-avatar/blob/main/THIRD_PARTY_LICENSES.md)（也随包发布）。
