# @prometheusavatar/core

Give your AI agent an embodied avatar — Live2D rendering, TTS, lip-sync, and emotion analysis in one SDK.

## Quick Start

```bash
npm install @prometheusavatar/core
```

```ts
import { createAvatar } from '@prometheusavatar/core';

const avatar = await createAvatar({
  container: document.getElementById('avatar')!,
  modelUrl: '/models/haru/haru.model3.json',
});

// Avatar speaks with auto-detected emotion + lip-sync
await avatar.speak('Hello! How are you today? 😊');
```

## API Reference

### `createAvatar(options): Promise<PrometheusAvatar>`

Factory function to create and initialize an avatar.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `container` | `HTMLElement` | required | DOM element to render into |
| `modelUrl` | `string` | required | URL to Live2D model JSON |
| `width` | `number` | `800` | Canvas width |
| `height` | `number` | `600` | Canvas height |
| `backgroundColor` | `number` | `0x00000000` | Canvas background (hex) |
| `ttsEngine` | `ITTSEngine` | `WebSpeechTTS` | Custom TTS engine |
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

### Custom TTS Engine

Implement `ITTSEngine` to use any TTS provider:

```ts
import type { ITTSEngine } from '@prometheusavatar/core';

class MyTTSEngine implements ITTSEngine {
  async speak(text: string): Promise<void> { /* ... */ }
  stop(): void { /* ... */ }
  onAudioData?: (data: Float32Array) => void;
  onEnd?: () => void;
}

const avatar = await createAvatar({
  container: el,
  modelUrl: url,
  ttsEngine: new MyTTSEngine(),
});
```

## What's New in v0.11 — Pro Image Generation

`AssetCreator.createImage()` — AAA-grade image generation with automatic multi-provider fallback. Game-store skin preview card tier output (Genshin / Overwatch / WoW quality). BYOK-friendly for zero-marginal-cost.

```ts
import { AssetCreator } from '@prometheusavatar/core';

const creator = new AssetCreator();

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
  apiKey: process.env.OPENAI_API_KEY, // BYOK = zero platform cost
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
| `apiKey` | `string` | env | BYOK — your own image-provider key · platform billing skipped. |
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

```ts
import { MemoryBridge } from '@prometheusavatar/core';

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
├── Live2DRenderer  — PIXI.js + Live2D Cubism SDK
├── WebSpeechTTS    — pluggable TTS (Web Speech API default)
├── LipSyncEngine   — audio → mouth shape mapping
└── EmotionAnalyzer — text → emotion detection
```

## License

MIT — [Myths Labs](https://github.com/myths-labs)
