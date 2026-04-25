# 🔥 Prometheus Avatar — OpenClaw Plugin

> Give your OpenClaw agent a Live2D avatar with real-time lip-sync, emotion, TTS — **plus AAA image generation** (`gpt-image-1` backed) for marketplace skin previews.

[![npm](https://img.shields.io/badge/npm-%40prometheusavatar%2Fopenclaw--plugin-blue)](https://www.npmjs.com/package/@prometheusavatar/openclaw-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-merged-purple)](https://github.com/openclaw/openclaw/pull/52752)

## 🚀 Install

```bash
openclaw plugins install @prometheusavatar/openclaw-plugin
```

## ✨ What it does

This plugin bridges OpenClaw agent events to the [Prometheus Avatar SDK](https://www.npmjs.com/package/@prometheusavatar/core), giving your AI agent a visual body and the ability to create marketplace assets:

- **🎭 Live2D Avatar** — Renders a Live2D model in your agent's UI
- **🗣️ Text-to-Speech** — Agent messages spoken aloud with lip-sync
- **😊 Emotion Detection** — Text sentiment drives expressions (happy / sad / angry / surprised / thinking)
- **🎨 AAA Image Generation (NEW v0.9)** — Generate game-store-tier skin preview cards directly from your agent conversation, backed by OpenAI GPT Image 2 (`gpt-image-1`)
- **🛒 Marketplace Asset Pipeline** — Generate thumbnails + deploy assets without leaving the agent loop

## ⚙️ Configuration

Add to your `openclaw.config.json`:

```json
{
  "plugins": {
    "prometheus-avatar": {
      "avatarId": "haru",
      "ttsProvider": "web-speech",
      "enableLipSync": true,
      "enableEmotion": true
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `avatarId` | `string` | — | Avatar model ID from Prometheus Marketplace |
| `modelUrl` | `string` | Haru (default) | Direct URL to a `.model3.json` file |
| `ttsProvider` | `string` | `"web-speech"` | TTS provider: `web-speech` / `elevenlabs` / `azure` / `sherpa-onnx` |
| `ttsVoice` | `string` | — | Voice name or ID |
| `enableLipSync` | `boolean` | `true` | Audio-driven lip synchronization |
| `enableEmotion` | `boolean` | `true` | Emotion analysis from text |

## 🛠️ Agent Tools (3)

When your OpenClaw agent has tool-use enabled, the plugin registers 3 creator tools:

| Tool | Description |
|------|-------------|
| `prometheus_generate_image_pro` | **NEW v0.9** Generate AAA-quality images via gpt-image-1 (skin preview cards, posters, UI mocks). Genshin / Overwatch / WoW shop card tier. 9 style presets · BYOK OpenAI · Free quota · Pro Credits. |
| `prometheus_generate_thumbnail` | Generate marketplace asset thumbnails (legacy FLUX route — kept for backward compat) |
| `prometheus_deploy_asset` | Deploy new assets (voices, skins, effects) to the Marketplace |

### Example: Generate a skin preview card

```
User: "Generate a cyberpunk anime girl skin in AAA Genshin Impact shop card tier"

Agent (via prometheus_generate_image_pro):
  {
    style: "cyberpunk",
    taskType: "aaa_skin",
    size: "1024x1536",
    quality: "high",
    prompt: "3D cel-shaded engine render, anime girl with neon hair and tech visor, slight elevated 3/4 hero pose, glossy game-art materials, clean dark studio backdrop with subtle radial gradient, cyan / magenta rim lighting, NOT flat 2D illustration, Genshin Impact / Overwatch shop preview tier, production-ready AAA skin preview card."
  }
```

Returns 1024×1536 base64 image (or `publicUrl` when `upload: true`) — ready to ship to the marketplace.

> **💡 Twin Prompt-Is-The-Ceiling rule**: Recommend ≥100-word prompts with explicit AAA benchmark named (Genshin / Overwatch / WoW / Pixar / Studio Ghibli). Lazy short prompts produce mediocre output — the model can render anything if you describe it precisely.

## 📡 Events

| Listens to | Emits |
|------------|-------|
| `agent:message` → speaks + animates | `avatar:speak` |
| `agent:thinking` → thinking expression | `avatar:emotion` |
| `agent:error` → surprised expression | `avatar:ready` |

## 🌍 Ecosystem

- **OpenClaw** — Merged into the official [community plugin registry](https://github.com/openclaw/openclaw/pull/52752) (4/21/2026, by Peter Steinberger)
- **Hermes Agent** — Plugin PR in queue at [`NousResearch/hermes-agent#9773`](https://github.com/NousResearch/hermes-agent/pull/9773)
- **Cursor / Claude Code / Any MCP Client** — Use the [`@prometheusavatar/mcp-server`](https://www.npmjs.com/package/@prometheusavatar/mcp-server) (9 tools) for direct MCP access to the same image engine

## 🔗 Links

- **SDK**: [@prometheusavatar/core](https://www.npmjs.com/package/@prometheusavatar/core) v0.11+
- **MCP server**: [@prometheusavatar/mcp-server](https://www.npmjs.com/package/@prometheusavatar/mcp-server) v0.3+
- **Marketplace**: [prometheus.mythslabs.ai](https://prometheus.mythslabs.ai)
- **Forge UI** (visual reference): [marketplace/create](https://prometheus.mythslabs.ai/marketplace/create) — 7-style picker
- **GitHub**: [myths-labs/prometheus-avatar](https://github.com/myths-labs/prometheus-avatar)

## 📄 License

MIT © [Myths Labs](https://mythslabs.ai)
