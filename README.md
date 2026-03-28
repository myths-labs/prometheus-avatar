<p align="center">
  <a href="https://prometheus.mythslabs.ai">
    <img src="docs/images/hero-banner.png" alt="Prometheus Avatar SDK — Give Your AI A Body" width="100%" />
  </a>
</p>

<h1 align="center">🔥 Prometheus Avatar SDK</h1>

<p align="center">
  <strong>Give your AI an embodied avatar — in 5 lines of code.</strong>
</p>

<p align="center">
  Open-source SDK for driving Live2D & 3D avatars with any LLM output.<br/>
  Lip-sync · Emotion expressions · Real-time voice · Multi-language TTS · VTuber mode
</p>

<p align="center">
  <a href="https://prometheus.mythslabs.ai"><img src="https://img.shields.io/badge/🌐_Official_Site-prometheus.mythslabs.ai-00d4aa?style=for-the-badge" alt="Official Site" /></a>
</p>

<p align="center">
  <a href="https://prometheus.mythslabs.ai/"><img src="https://img.shields.io/badge/🔥_Try_Live_Demo-Click_Here-c9a84c?style=for-the-badge" alt="Live Demo" /></a>
  <a href="https://prometheus.mythslabs.ai/marketplace"><img src="https://img.shields.io/badge/🛒_Marketplace-Browse_Assets-00d4aa?style=for-the-badge" alt="Marketplace" /></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@prometheusavatar/core"><img src="https://img.shields.io/badge/npm-v0.8.0-00d4aa?style=for-the-badge&logo=npm&logoColor=white" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@prometheusavatar/mcp-server"><img src="https://img.shields.io/badge/MCP_Server-v0.1.0-c9a84c?style=for-the-badge&logo=npm&logoColor=white" alt="MCP Server" /></a>
  <a href="https://github.com/myths-labs/prometheus-avatar"><img src="https://img.shields.io/github/stars/myths-labs/prometheus-avatar?color=c9a84c&style=for-the-badge&logo=github" alt="Stars" /></a>
  <a href="https://github.com/myths-labs/prometheus-avatar/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/myths-labs/prometheus-avatar/ci.yml?style=for-the-badge&logo=github-actions&logoColor=white&label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/Live2D-Cubism_2_&_4-ff69b4.svg?style=for-the-badge" alt="Live2D" />
  <img src="https://img.shields.io/badge/LLMs-9_Providers-9c27b0.svg?style=for-the-badge" alt="9 LLMs" />
</p>

<p align="center">
  <a href="https://x.com/MythsLabs"><img src="https://img.shields.io/badge/𝕏_Twitter-@MythsLabs-000000?style=for-the-badge&logo=x&logoColor=white" alt="X (Twitter)" /></a>
  <a href="https://linkedin.com/company/mythslabs/"><img src="https://img.shields.io/badge/LinkedIn-Myths_Labs-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
  <a href="https://x.com/SunshiningDay"><img src="https://img.shields.io/badge/Creator-@SunshiningDay-1DA1F2?style=for-the-badge&logo=x&logoColor=white" alt="Creator" /></a>
</p>

---

> ### 🌐 **[prometheus.mythslabs.ai](https://prometheus.mythslabs.ai)** — Try the full experience: live avatar chat, marketplace, creator dashboard, and more.

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
| 🤖 **Connect Your Agent** | Plug in any OpenAI-compatible agent — [integration guide](docs/agent-integration.md) |
| 🧩 **MCP Server** | `npx @prometheusavatar/mcp-server` — any MCP client (Claude, GPT, Gemini) gets an avatar |
| 📦 **SDK** | Drop-in `@prometheusavatar/core` for your own apps |

## 🎬 Demo

<p align="center">
  <a href="https://prometheus.mythslabs.ai">
    <img src="https://img.shields.io/badge/▶_TRY_LIVE_DEMO-prometheus.mythslabs.ai-00d4aa?style=for-the-badge&labelColor=0a0f1a" alt="Try Live Demo" />
  </a>
</p>

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

### MCP Server (for AI Agents)

Any MCP-compatible AI client (Claude Desktop, Cursor, etc.) can connect:

```bash
npx @prometheusavatar/mcp-server
```

Or add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "prometheus": {
      "command": "npx",
      "args": ["-y", "@prometheusavatar/mcp-server"]
    }
  }
}
```

7 tools available: `create_avatar`, `equip_asset`, `generate_asset`, `list_marketplace`, `get_avatar_status`, `share_avatar`, `speak`.

## 🏗️ Architecture

```mermaid
graph TB
    subgraph SDK["@prometheusavatar/core"]
        PA[PrometheusAvatar] --> R[Live2DRenderer]
        PA --> TTS[WebSpeechTTS]
        PA --> LS[LipSyncEngine]
        PA --> EA[EmotionAnalyzer]
    end

    subgraph Platform["prometheus.mythslabs.ai"]
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
prometheus-avatar/           ← This repo (open-source SDK)
├── packages/
│   ├── sdk/                 # @prometheusavatar/core (npm)
│   │   └── src/
│   │       ├── avatar.ts    # PrometheusAvatar orchestrator
│   │       ├── renderer.ts  # Live2D rendering via PIXI.js
│   │       ├── tts.ts       # Pluggable TTS engine (ITTSEngine)
│   │       ├── lip-sync.ts  # Audio → mouth shape mapping
│   │       ├── emotion.ts   # Text → emotion detection
│   │       └── types.ts     # TypeScript interfaces
│   └── openclaw-plugin/     # OpenClaw marketplace integration
├── examples/                # Ready-to-run examples
├── docs/                    # API documentation + agent integration guide
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
- ✨ **Effects** — Particle effects and animations
- 💃 **Motions** — Dance, idle, and gesture animation packs
- 🏞️ **Scenes** — Backgrounds and environments
- 🎀 **Accessories** — Wearable items (ears, hats, glasses)
- 😜 **Expressions** — Extra emotion and face expression sets
- 🤖 **Personas** — Pre-configured personality + avatar bundles
- 📦 **Bundles** — Curated collections at a discount

Creators earn **80–90%** of every sale. AI agents can also create and sell assets.

> 🌐 **[Browse the Marketplace →](https://prometheus.mythslabs.ai/marketplace)**

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

## 💬 Community & Social

<p align="center">
  <a href="https://prometheus.mythslabs.ai"><img src="https://img.shields.io/badge/🌐_Official_Site-prometheus.mythslabs.ai-00d4aa?style=for-the-badge" alt="Official Site" /></a>
  <a href="https://x.com/MythsLabs"><img src="https://img.shields.io/badge/𝕏-@MythsLabs-000000?style=for-the-badge&logo=x&logoColor=white" alt="X" /></a>
  <a href="https://linkedin.com/company/mythslabs/"><img src="https://img.shields.io/badge/LinkedIn-Myths_Labs-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
</p>

- 🐛 **Issues**: [GitHub Issues](https://github.com/myths-labs/prometheus-avatar/issues)
- 💡 **Discussions**: [GitHub Discussions](https://github.com/myths-labs/prometheus-avatar/discussions)
- 🐦 **X (Twitter)**: [@MythsLabs](https://x.com/MythsLabs)
- 💼 **LinkedIn**: [Myths Labs](https://linkedin.com/company/mythslabs/)
- 👤 **Creator**: [@SunshiningDay](https://x.com/SunshiningDay) — Solo indie developer building Prometheus

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Clone & setup
git clone https://github.com/myths-labs/prometheus-avatar.git
cd prometheus-avatar
pnpm install

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

**让你的 AI 拥有一个有表情、会说话的虚拟化身 —— 只需 5 行代码。**

开源 SDK，用于驱动 Live2D 和 3D 虚拟形象。支持实时语音对话、唇形同步、表情识别、文字转语音（TTS）、多语言、以及数字资产市场。

### 🌐 在线体验

<p align="center">
  <a href="https://prometheus.mythslabs.ai">
    <img src="https://img.shields.io/badge/▶_在线体验-prometheus.mythslabs.ai-00d4aa?style=for-the-badge&labelColor=0a0f1a" alt="在线体验" />
  </a>
</p>

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
| 🤖 **接入你的 AI Agent** | 支持任何 OpenAI 兼容的 agent 端点 — [接入指南](docs/agent-integration.md) |
| 🧩 **MCP 服务器** | `npx @prometheusavatar/mcp-server` — Claude/GPT/Gemini 等 AI 客户端一键接入 |

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

### 🛒 数字市场

[Avatar 数字市场](https://prometheus.mythslabs.ai/marketplace)支持创作者和 AI 代理出售：

- 🎨 **皮肤** — 自定义虚拟形象外观
- 🎤 **声音** — 语音包和 TTS 风格
- ✨ **特效** — 粒子特效和动画
- 💃 **动作** — 舞蹈、待机、手势动画包
- 🏞️ **场景** — 背景和环境
- 🎀 **配件** — 可穿戴装饰品（猫耳、帽子、眼镜）
- 😜 **表情** — 额外表情和面部表情集
- 🤖 **人格** — 预配置的性格 + 虚拟形象套装
- 📦 **套装** — 精选合集优惠价

创作者获得 **80-90%** 的销售收入。

> 🌐 **[浏览数字市场 →](https://prometheus.mythslabs.ai/marketplace)**

### 💬 关注我们

- 🌐 **官网**: [prometheus.mythslabs.ai](https://prometheus.mythslabs.ai)
- 🐦 **X (Twitter)**: [@MythsLabs](https://x.com/MythsLabs)
- 💼 **LinkedIn**: [Myths Labs](https://linkedin.com/company/mythslabs/)
- 👤 **创始人**: [@SunshiningDay](https://x.com/SunshiningDay) — 独立开发者，一人全栈构建 Prometheus

### 📄 开源协议

MIT © [Myths Labs](https://github.com/myths-labs)

---

<p align="center">
  <sub>Built with 🔥 by <a href="https://github.com/myths-labs">Myths Labs</a> — Solo-developed by <a href="https://github.com/jc-myths">JC</a></sub>
</p>

<p align="center">
  <a href="https://prometheus.mythslabs.ai"><strong>🌐 prometheus.mythslabs.ai</strong></a>
</p>
