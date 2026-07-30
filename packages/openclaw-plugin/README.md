# 🔥 Prometheus Avatar — OpenClaw Plugin

> Give your OpenClaw agent a Live2D avatar with real-time lip-sync, emotion, TTS — **plus AAA image generation** for marketplace skin previews.

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
- **🎨 AAA Image Generation (v0.9+)** — Generate game-store-tier skin preview cards directly from your agent conversation
- **🛒 Marketplace Asset Pipeline** — Generate thumbnails + deploy assets without leaving the agent loop
- **🎓 Bundled Skill (NEW v0.10)** — Plugin now ships with an AgentSkills-compatible `SKILL.md` at `skills/prometheus-avatar/` that teaches the agent when and how to use the 3 creator tools. Auto-loaded when the plugin is enabled. See [OpenClaw Skills docs](https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md).

## ⚙️ Configuration

Add to your `openclaw.config.json`:

```json
{
  "plugins": {
    "prometheus-avatar": {
      "modelUrl": "https://your-cdn.example/models/your-model.model3.json",
      "apiKey": "pak_...",
      "enableLipSync": true,
      "enableEmotion": true
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `avatarId` | `string` | — | Reserved — ID-based model resolution is not available yet; use `modelUrl` (when only `avatarId` is set the default model is used) |
| `apiKey` | `string` | `PROMETHEUS_API_KEY` env var | Prometheus agent API key (`pak_...`) — required for marketplace deploys (the live gate rejects unauthenticated writes). Get one at [prometheus.mythslabs.ai/settings/agent-keys](https://prometheus.mythslabs.ai/settings/agent-keys) |
| `modelUrl` | `string` | Haru (default) | Direct URL to a `.model3.json` file |
| `ttsProvider` | `string` | — | **DEPRECATED in v0.10.0** — ignored. TTS is now delegated to the Prometheus SDK. |
| `ttsVoice` | `string` | — | Prometheus Marketplace voice ID (e.g. `saturn_zh_female_keainvsheng_tob`). Browse voices at [prometheus.mythslabs.ai/marketplace](https://prometheus.mythslabs.ai/marketplace) |
| `enableLipSync` | `boolean` | `true` | Audio-driven lip synchronization |
| `enableEmotion` | `boolean` | `true` | Emotion analysis from text |

## 🎓 Bundled Skill (NEW v0.10)

The plugin ships with a bundled OpenClaw Skill at `skills/prometheus-avatar/SKILL.md` so the agent knows **when** and **how** to use the 3 creator tools below without explicit user prompting. The Skill covers:

- **When to use** — visible character / avatar mascot · real-time TTS with mouth movement · emotion reflection · AAA skin preview card · marketplace asset deploy
- **When NOT to use** — plain audio TTS · low-fidelity thumbnails · deterministic image requirements
- **Tool selection rules** — `prometheus_generate_image_pro` (AAA-tier · primary) vs `prometheus_generate_thumbnail` (legacy lighter) vs `prometheus_deploy_asset`
- **Prompt-is-the-ceiling** — recommend ≥100-word prompts with explicit AAA benchmark (Genshin / Overwatch / WoW / Pixar / Studio Ghibli)
- **Safety** — cost awareness · marketplace deploy confirmation · prompt sanitisation

The Skill auto-loads when the plugin is enabled — no separate install step.

## 🛠️ Agent Tools (3)

When your OpenClaw agent has tool-use enabled, the plugin registers 3 creator tools:

| Tool | Description |
|------|-------------|
| `prometheus_generate_image_pro` | **NEW v0.9** Generate AAA-quality images (skin preview cards, posters, UI mocks). Genshin / Overwatch / WoW shop card tier. 9 style presets · BYOK · Free quota · Pro Credits. |
| `prometheus_generate_thumbnail` | Generate marketplace asset thumbnails (legacy route — kept for backward compat) |
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
- **Hermes Agent** — Avatar skill PR submitted at [`NousResearch/hermes-agent#9754`](https://github.com/NousResearch/hermes-agent/pull/9754)
- **Cursor / Claude Code / Any MCP Client** — Use the [`@prometheusavatar/mcp-server`](https://www.npmjs.com/package/@prometheusavatar/mcp-server) (10 tools) for direct MCP access to the same image engine

## 🔗 Links

- **SDK**: [@prometheusavatar/core](https://www.npmjs.com/package/@prometheusavatar/core) v0.11+
- **MCP server**: [@prometheusavatar/mcp-server](https://www.npmjs.com/package/@prometheusavatar/mcp-server) v0.3+
- **Marketplace**: [prometheus.mythslabs.ai](https://prometheus.mythslabs.ai)
- **Forge UI** (visual reference): [marketplace/create](https://prometheus.mythslabs.ai/marketplace/create) — 7-style picker
- **GitHub**: [myths-labs/prometheus-avatar](https://github.com/myths-labs/prometheus-avatar)

## 📄 License

MIT © [Myths Labs](https://mythslabs.ai)
