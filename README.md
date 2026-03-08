<p align="center">
  <img src="https://img.icons8.com/emoji/96/fire.png" width="80" alt="Prometheus" />
</p>

<h1 align="center">Prometheus Avatar SDK</h1>

<p align="center">
  <strong>Give your AI an embodied avatar — in 3 lines of code.</strong>
</p>

<p align="center">
  Open-source SDK for driving Live2D & 3D avatars with LLM output.<br/>
  Lip-sync · Emotion expressions · Real-time voice · Multi-language · Marketplace
</p>

<p align="center">
  <a href="https://prometheus.mythslabs.ai/">🌐 Live Demo</a> ·
  <a href="https://prometheus.mythslabs.ai/marketplace">🛒 Marketplace</a> ·
  <a href="#quick-start">🚀 Quick Start</a> ·
  <a href="#中文文档">🇨🇳 中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@prometheusavatar/core"><img src="https://img.shields.io/badge/npm-v0.8.0-00d4aa?style=for-the-badge&logo=npm&logoColor=white" alt="npm" /></a>
  <a href="https://github.com/myths-labs/prometheus-avatar"><img src="https://img.shields.io/github/stars/myths-labs/prometheus-avatar?color=c9a84c&style=for-the-badge&logo=github" alt="Stars" /></a>
  <a href="https://github.com/myths-labs/prometheus-avatar/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/myths-labs/prometheus-avatar/ci.yml?style=for-the-badge&logo=github-actions&logoColor=white&label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/Live2D-Cubism_2_&_4-ff69b4.svg?style=for-the-badge" alt="Live2D" />
  <img src="https://img.shields.io/badge/LLMs-9_Providers-9c27b0.svg?style=for-the-badge" alt="9 LLMs" />
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎭 **Live2D Avatars** | Render Cubism 2 & 4 models with auto-scaling and centering |
| ⚡ **Real-Time Voice** | Gemini Live API — WebSocket streaming, ~200ms latency, built-in VAD + interruption |
| 🗣️ **Text-to-Speech** | Gemini TTS with natural voices, multi-language (EN/CN/JP/+) |
| 👄 **Lip Sync** | Real-time mouth animation synchronized with speech audio |
| 😊 **Emotion Engine** | Auto-detect emotions from text → avatar expressions + motions |
| 🎨 **Marketplace** | Browse, buy, and sell avatar skins, voices, effects, and personas |
| 📷 **VTuber Mode** | Camera face tracking → real-time avatar head movement |
| 🔌 **Multi-LLM** | 9 providers: Gemini, OpenAI, Anthropic, Groq, Grok, DeepSeek, Qwen, Kimi, MiniMax |
| 📦 **SDK** | Drop-in `@prometheusavatar/core` for your own apps |

## 🎬 Demo

**[→ Try it live at prometheus.mythslabs.ai](https://prometheus.mythslabs.ai/)**

- Select an avatar (Haru, Shizuku, Koharu)
- Switch to **⚡ Live** mode for real-time voice conversation
- Or type a message — the avatar speaks with emotion + lip sync
- Try different emotions: "I'm so happy!" vs "That's so sad..."

## 🚀 Quick Start

### Install

```bash
npm install @prometheusavatar/core
```

### Usage

```typescript
import { createAvatar } from '@prometheusavatar/core';

// Initialize — loads model, TTS, lip-sync, emotion
const avatar = await createAvatar({
  container: document.getElementById('avatar')!,
  modelUrl: 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@0.4.0/test/assets/haru/haru_greeter_t03.model3.json',
});

// Avatar speaks with auto-detected emotion + lip-sync
await avatar.speak('Hello! I\'m your AI assistant. 😊');

// React to emotion changes
avatar.on('emotion:change', ({ result }) => {
  console.log(`Emotion: ${result.emotion} (${result.confidence})`);
});
```

## 🏗️ Architecture

```mermaid
graph TB
    subgraph SDK["@prometheusavatar/core"]
        PA[PrometheusAvatar] --> R[Live2DRenderer]
        PA --> TTS[WebSpeechTTS]
        PA --> LS[LipSyncEngine]
        PA --> EA[EmotionAnalyzer]
    end

    subgraph Demo["apps/demo"]
        NX[Next.js App] --> AC[AvatarCanvas]
        NX --> CP[ChatPanel]
        NX --> MP[Marketplace]
        AC --> IF["iframe sandbox"]
        IF --> L2D[Live2D Cubism SDK]
    end

    subgraph Voice["Voice Pipeline"]
        LIVE["⚡ Live Voice"] --> WS["WebSocket"]
        WS --> GLIVE["Gemini Live API"]
        CHAT["/api/chat SSE"] --> GEM["Gemini 2.0 Flash"]
        TTSR["/api/tts"] --> GTTS["Gemini TTS"]
    end

    CP --> LIVE
    CP --> CHAT
    AC --> TTSR
```

```
prometheus-avatar/
├── packages/
│   ├── sdk/                  # @prometheusavatar/core (npm)
│   │   └── src/
│   │       ├── avatar.ts     # PrometheusAvatar orchestrator
│   │       ├── renderer.ts   # Live2D rendering via PIXI.js
│   │       ├── tts.ts        # Pluggable TTS engine (ITTSEngine)
│   │       ├── lip-sync.ts   # Audio → mouth shape mapping
│   │       ├── emotion.ts    # Text → emotion detection
│   │       └── types.ts      # TypeScript interfaces
│   └── openclaw-plugin/      # OpenClaw marketplace integration
├── apps/
│   └── demo/                 # prometheus.mythslabs.ai
│       └── src/
│           ├── components/   # AvatarCanvas, ChatPanel, HomeClient
│           ├── lib/
│           │   └── useLiveVoice.ts  # Gemini Live API WebSocket hook
│           └── app/
│               ├── api/chat/       # LLM endpoint (Gemini/Groq SSE)
│               ├── api/tts/        # TTS endpoint (Gemini TTS)
│               ├── api/live-token/ # Ephemeral token for Live Voice
│               ├── marketplace/    # Asset marketplace
│               └── telegram/       # Telegram Mini App
└── README.md
```

## 🎭 Supported Models

| Model | Cubism | Source | License |
|-------|--------|--------|---------|
| Haru | 4 | Live2D Inc. | [Free Material License](https://www.live2d.com/en/terms/live2d-free-material-license-agreement/) |
| Shizuku | 2 | Live2D Inc. | Free Material License |
| Koharu | 2 | Community | Open Source |

> 💡 Any `.model.json` (Cubism 2) or `.model3.json` (Cubism 4) file works — load from URL or local path.

## 🛒 Marketplace

The [Avatar Marketplace](https://prometheus.mythslabs.ai/marketplace) lets creators and AI agents sell:

- 🎨 **Skins** — Custom avatar appearances
- 🎤 **Voices** — Voice packs and TTS styles
- ✨ **Effects** — Particle effects, backgrounds, animations
- 🤖 **Personas** — Pre-configured personality + avatar bundles

Creators earn **80–90%** of every sale. AI agents can also create and sell assets.

## 📚 API Documentation

Full TypeScript API reference generated with TypeDoc:

**[→ docs/api/](docs/api/)**

Key exports:
- `createAvatar()` — Factory function to create and initialize an avatar
- `PrometheusAvatar` — Main orchestrator class
- `ILLMProvider` — Interface for pluggable LLM providers
- `ITTSEngine` — Interface for pluggable TTS engines
- `EmotionAnalyzer` — Text → emotion detection

## 📂 Examples

| Example | Description |
|---------|-------------|
| [`examples/basic/`](examples/basic/) | Minimal HTML — zero build tools, loads from CDN |
| [`examples/react/`](examples/react/) | React component with hooks and emotion tracking |
| [`examples/multi-llm/`](examples/multi-llm/) | 9-provider configuration with auto-fallback |
| [`examples/live-voice/`](examples/live-voice/) | Gemini Live API real-time voice via WebSocket |

## 💬 Community

- 🐛 **Issues**: [GitHub Issues](https://github.com/myths-labs/prometheus-avatar/issues)
- 💡 **Discussions**: [GitHub Discussions](https://github.com/myths-labs/prometheus-avatar/discussions)
- 🐦 **Twitter**: [@MythsLabs](https://twitter.com/MythsLabs)

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Clone & setup
git clone https://github.com/myths-labs/prometheus-avatar.git
cd prometheus-avatar
pnpm install

# Run demo locally
cd apps/demo
cp .env.example .env.local  # Add your API keys
pnpm dev

# Run SDK tests
cd packages/sdk
pnpm test
```

## 📄 License

MIT © [Myths Labs](https://github.com/myths-labs)

---

<a id="中文文档"></a>

# 🇨🇳 中文文档

## Prometheus Avatar SDK

**让你的 AI 拥有一个有表情、会说话的虚拟化身 —— 只需 3 行代码。**

开源 SDK，用于驱动 Live2D 和 3D 虚拟形象。支持实时语音对话、唇形同步、表情识别、文字转语音（TTS）、多语言、以及数字资产市场。

### ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🎭 **Live2D 虚拟形象** | 支持 Cubism 2 & 4，自动缩放居中 |
| ⚡ **实时语音** | Gemini Live API — WebSocket 流式，~200ms 延迟，内置 VAD + 打断 |
| 🗣️ **文字转语音** | Gemini TTS 自然语音，支持中英日多语言 |
| 👄 **唇形同步** | 说话时嘴巴实时跟随语音动 |
| 😊 **情感引擎** | 从文字自动检测情绪 → 触发表情 + 动作 |
| 🛒 **数字市场** | 浏览/购买/出售虚拟形象皮肤、声音、特效 |
| 📷 **VTuber 模式** | 摄像头面部跟踪 → 实时驱动 avatar 头部运动 |
| 🔌 **多 LLM 支持** | Gemini 2.0 Flash (主) + Groq Llama 3.3 70B (备) |

### 🚀 快速开始

```bash
npm install @prometheusavatar/core
```

```typescript
import { createAvatar } from '@prometheusavatar/core';

const avatar = await createAvatar({
  container: document.getElementById('avatar')!,
  modelUrl: 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@0.4.0/test/assets/haru/haru_greeter_t03.model3.json',
});

await avatar.speak('你好！我是你的 AI 助手。😊');
```

### 🌐 在线体验

**[→ prometheus.mythslabs.ai](https://prometheus.mythslabs.ai/)**

### 🛒 数字市场

[Avatar 数字市场](https://prometheus.mythslabs.ai/marketplace)支持创作者和 AI 代理出售：

- 🎨 **皮肤** — 自定义虚拟形象外观
- 🎤 **声音** — 语音包和 TTS 风格
- ✨ **特效** — 粒子特效、背景、动画
- 🤖 **人格** — 预配置的性格 + 虚拟形象套装

创作者获得 **80-90%** 的销售收入。

### 📄 开源协议

MIT © [Myths Labs](https://github.com/myths-labs)

---

<p align="center">
  Built with 🔥 by <a href="https://github.com/myths-labs">Myths Labs</a>
</p>
