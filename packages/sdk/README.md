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
