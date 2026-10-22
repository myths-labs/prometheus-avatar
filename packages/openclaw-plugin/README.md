# 🔥 Prometheus Avatar — OpenClaw Plugin

> Give your OpenClaw agent a 2D avatar with real-time lip-sync, emotion, TTS — **plus AAA image generation** for marketplace skin previews.

[![npm](https://img.shields.io/badge/npm-%40prometheusavatar%2Fopenclaw--plugin-blue)](https://www.npmjs.com/package/@prometheusavatar/openclaw-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-merged-purple)](https://github.com/openclaw/openclaw/pull/52752)

## 🚀 Install

```bash
openclaw plugins install @prometheusavatar/openclaw-plugin
```

## ✨ What it does

This plugin bridges OpenClaw agent events to the [Prometheus Avatar SDK](https://www.npmjs.com/package/@prometheusavatar/core), giving your AI agent a visual body and the ability to create marketplace assets:

- **🎭 2D Avatar** — Renders the 2D model file (`.model3.json`) that `modelUrl` points at, in your agent's UI. The plugin ships no model of its own, so set `modelUrl` (see Configuration)
- **🖼️ Hosted avatar** — With a Prometheus agent key (`apiKey`) and the id of one of your hosted avatars (`avatarId`), and no `modelUrl`, the plugin shows that hosted avatar in a frame and drives its expression from the agent's events. It does not make the hosted avatar speak
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
| `avatarId` | `string` | — | ID of a hosted avatar made with your Prometheus agent key. With `apiKey` also set and no `modelUrl`, the plugin shows that hosted avatar (see below). Setting only `avatarId` shows no avatar and logs an error that says to set `apiKey` or `modelUrl`. A Marketplace listing ID cannot be shown |
| `apiKey` | `string` | `PROMETHEUS_API_KEY` env var | Prometheus agent API key (`pak_...`) — required for marketplace deploys (the live gate rejects unauthenticated writes), and, together with `avatarId`, for showing a hosted avatar. It is never put into the avatar's page address or sent to it. Get one at [prometheus.mythslabs.ai/settings/agent-keys](https://prometheus.mythslabs.ai/settings/agent-keys) |
| `modelUrl` | `string` | — | Direct URL to a 2D model file (`.model3.json`). Wins over `avatarId`. Needed to draw your own model: without it the plugin logs an error that says how to set it and shows nothing, unless `apiKey` and `avatarId` are both set (the three creator tools below still work) |
| `ttsProvider` | `string` | — | **DEPRECATED in v0.10.0** — ignored. TTS is now delegated to the Prometheus SDK. |
| `ttsVoice` | `string` | — | Name (or `voiceURI`) of a voice installed in the viewer's browser, as listed by `speechSynthesis.getVoices()`. An unknown name, a Marketplace voice ID included, is ignored and the default voice speaks. The plugin does not play cloned or Marketplace voices yet |
| `enableLipSync` | `boolean` | `true` | Speak agent messages aloud in the 2D model file's avatar, with mouth movement estimated from the text. `false` means agent messages are not spoken. No effect on a hosted avatar, which the plugin never makes speak |
| `enableEmotion` | `boolean` | `true` | Emotion analysis from text; the result drives the expression of the 2D model file's avatar and of a hosted avatar alike |

### Showing a hosted avatar

To show a hosted Prometheus avatar instead of a model file, leave `modelUrl` out and set both `apiKey` and `avatarId`:

```json
{
  "plugins": {
    "prometheus-avatar": {
      "apiKey": "pak_...",
      "avatarId": "<id of your hosted avatar>"
    }
  }
}
```

- The plugin puts the hosted avatar page in a frame inside the container OpenClaw gives it and connects the SDK's `connectEmbed` bridge to it. The frame's address is `https://prometheus.mythslabs.ai/embed/<avatarId>`, with nothing added to it.
- `avatarId` is the id of an avatar made with your Prometheus agent key. A Marketplace listing ID is not one, and the page answers "Avatar not found".
- Agent events move the expression only: `agent:thinking` shows the thinking expression, `agent:error` the surprised one, and `agent:message` the expression its text suggests (unless `enableEmotion` is `false`). The plugin does not make the hosted avatar speak, so `ttsVoice` and `enableLipSync` have no effect on it.
- `avatar:ready` is emitted when the page reports that the avatar loaded. If it never does, the plugin logs a warning that names `avatarId`.
- If `modelUrl` is also set, the 2D model file is drawn and `avatarId` is not used.
- Needs `@prometheusavatar/core` 0.11.5 or later (the plugin's dependency range asks for it).
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
| `prometheus_deploy_asset` | Deploy new assets to the Marketplace. A persona needs `persona_config` (or a persona JSON file); its public description is never the prompt. A motion needs `source` (`original` or `licensed_resale`) and `body_type`; library clips without resale rights cannot be listed |

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
- **Cursor / Claude Code / Any MCP Client** — Use the [`@prometheusavatar/mcp-server`](https://www.npmjs.com/package/@prometheusavatar/mcp-server) (17 tools) for direct MCP access to the same image engine

## 🔗 Links

- **SDK**: [@prometheusavatar/core](https://www.npmjs.com/package/@prometheusavatar/core) v0.11+
- **MCP server**: [@prometheusavatar/mcp-server](https://www.npmjs.com/package/@prometheusavatar/mcp-server) v0.3+
- **Marketplace**: [prometheus.mythslabs.ai](https://prometheus.mythslabs.ai)
- **Forge UI** (visual reference): [marketplace/create](https://prometheus.mythslabs.ai/marketplace/create) — 7-style picker
- **GitHub**: [myths-labs/prometheus-avatar](https://github.com/myths-labs/prometheus-avatar)

## 📝 Changes in 0.10.3

- **Hosted avatar.** With `apiKey` and `avatarId` set and no `modelUrl`, the plugin frames the hosted avatar page and drives its expression through the SDK's `connectEmbed`. It never makes the hosted avatar speak, adds nothing to the page address and keeps the key out of it. Needs `@prometheusavatar/core` 0.11.5 or later.
- **No default model.** The plugin used to fall back to a sample path that was never part of the package, which could only fail to load. Without `modelUrl` it now logs one error that says how to set it (and, when only `avatarId` is set, that `avatarId` cannot choose a model yet), shows no avatar and keeps the creator tools working. If you relied on the old fallback, set `modelUrl` to a 2D model file you host.
- Public text says "2D avatar" / "2D model file (`.model3.json`)" instead of naming the runtime.
- `ttsVoice` is documented as it works: a voice installed in the viewer's browser, not a Marketplace voice ID (the core SDK matches browser voices only).
- `prometheus_deploy_asset` passes `persona_config` (personas: the prompt; the public description is never the prompt), `source` (motions: `original` or `licensed_resale`; library clips without resale rights cannot be listed) and `body_type`.

## 📄 License

MIT © [Myths Labs](https://mythslabs.ai)

Third-party components and the licences that come with them, including any you must get yourself to use a 2D model file: [THIRD_PARTY_LICENSES.md](https://github.com/myths-labs/prometheus-avatar/blob/main/THIRD_PARTY_LICENSES.md).
