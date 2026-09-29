# 🔥 Prometheus Avatar — OpenClaw Plugin

> Sell on Prometheus Marketplace from OpenClaw at the OpenClaw seller rate, generate **AAA-quality images** for skin previews, and give your agent a Live2D avatar (lip-sync, emotion, TTS) where the host has a page to draw it in.

[![npm](https://img.shields.io/badge/npm-%40prometheusavatar%2Fopenclaw--plugin-blue)](https://www.npmjs.com/package/@prometheusavatar/openclaw-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-merged-purple)](https://github.com/openclaw/openclaw/pull/52752)

## 🚀 Install

```bash
openclaw plugins install @prometheusavatar/openclaw-plugin
```

(or from ClawHub: `openclaw plugins install clawhub:@prometheusavatar/openclaw-plugin`)

Needs **OpenClaw 2026.9.6 or newer** (the only version this release has been tested on). OpenClaw lists what the plugin adds (its tools and its skill) and asks you to accept; answer `y`. For a non-interactive install add `--accept-capabilities`.

## 🛒 Sell on Prometheus (v0.11)

Connect this OpenClaw to your Prometheus seller account once. When your account is verified through OpenClaw, **all of that account's listings** are sold at the OpenClaw seller rate: the rate follows the account, not each listing. An account that only uses an API key and has not been verified is at the AI agent rate. Current rates are shown in your Prometheus dashboard and by `prometheus_connection_status`.

1. Tell your agent: **`Connect my Prometheus seller account`**. It answers with a link and a short code.
2. Open the link, sign in to Prometheus, and approve the code (valid for 10 minutes). The plugin finishes the connection by itself. Ask your agent for the connection status: it names the Prometheus account it is now connected to (masked, like `a***@example.com`). If that is not your account, disconnect at once: someone may have tricked you into approving their connection.
3. Link your X account from Dashboard → Seller types → OpenClaw. Tier publishes need it.
4. Tell your agent: **`Publish this to Prometheus Marketplace`**.

If a check fails (X not linked, daily limit, a suspended connection…), nothing is published and the agent tells you why and where to fix it. Publishing is public and cannot be withdrawn from the agent loop, so your agent should confirm with you first.

- The connection key (`pch_…`) is issued once, never shown in the chat, never written to a log, and never put in your OpenClaw config. It is kept in the plugin state: OpenClaw's own plugin storage when OpenClaw lets a third-party plugin use it, otherwise a private file (`prometheus-avatar/channel-openclaw.json`, mode 0600) inside the OpenClaw state directory.
- To disconnect: ask your agent to disconnect (`prometheus_disconnect_seller`). The key stops working at once. Your account's rate and the listings you already published are unchanged.
- The seller channel opens on the Prometheus side when Prometheus turns it on. Before that, connecting says it is not available yet.
- An API key (`pak_…`, config `apiKey`) is still supported for deploys, the image tools and avatar state updates. The rate of a listing is always your account's rate.

## ✨ What it does

This plugin connects OpenClaw to the [Prometheus Avatar SDK](https://www.npmjs.com/package/@prometheusavatar/core) and the Prometheus Marketplace: it lets your agent sell there and create marketplace assets, and it can drive an avatar:

- **🛒 Seller channel (v0.11)** — connect a Prometheus seller account and publish at the OpenClaw seller rate (see above)
- **💬 Avatar state (v0.11)** — with an agent API key, what your agent is doing (thinking, done, emotion) is pushed to your Prometheus avatar, and any avatar page you have open follows within a few seconds. It works in the OpenClaw gateway, which has no page of its own. Turn it off with `companionState: false`
- **🎭 Live2D Avatar** — shows a Live2D model in your agent's web UI. It draws into a page element, so it starts only where the host gives the plugin one (set `containerSelector`). The OpenClaw gateway has no page: there the avatar display is skipped and every other tool works as usual
- **🗣️ Text-to-Speech** — with the avatar, agent messages are spoken aloud with lip-sync
- **😊 Emotion Detection** — with the avatar, text sentiment drives expressions (happy / sad / angry / surprised / thinking)
- **🎨 AAA Image Generation (v0.9+)** — Generate game-store-tier skin preview cards directly from your agent conversation
- **🛒 Marketplace Asset Pipeline** — Generate thumbnails + deploy assets without leaving the agent loop
- **🎓 Bundled Skill (NEW v0.10)** — Plugin now ships with an AgentSkills-compatible `SKILL.md` at `skills/prometheus-avatar/` that teaches the agent when and how to use the tools. Auto-loaded when the plugin is enabled. See [OpenClaw Skills docs](https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md).

## ⚙️ Configuration

Add to your `openclaw.config.json`:

```json
{
  "plugins": {
    "prometheus-avatar": {
      "modelUrl": "https://your-cdn.example/models/your-model.model3.json",
      "containerSelector": "#avatar",
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
| `apiKey` | `string` | `PROMETHEUS_API_KEY` env var | Prometheus agent API key (`pak_...`) — used for API-key deploys and the image tools (the live gate rejects unauthenticated writes). Not needed for the seller channel. Get one at [prometheus.mythslabs.ai/settings/agent-keys](https://prometheus.mythslabs.ai/settings/agent-keys) |
| `modelUrl` | `string` | Haru (default) | Direct URL to a `.model3.json` file |
| `companionState` | `boolean` | `true` | Push agent activity to your Prometheus avatar (needs an agent API key). `false` turns it off |
| `containerSelector` | `string` | — | CSS selector of the page element the avatar draws into. Only browser-hosted OpenClaw UIs have one; without it the avatar display is skipped |
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

## 🛠️ Agent Tools (7)

| Tool | Description |
|------|-------------|
| `prometheus_connect_seller` | **NEW v0.11** Connect this OpenClaw to your Prometheus seller account (link + code to approve) |
| `prometheus_connection_status` | **NEW v0.11** Waiting for approval / connected (rates, X link, today's publishes) / not connected |
| `prometheus_publish_listing` | **NEW v0.11** Publish an asset (or a draft by `draft_asset_id`) through the connection; sold at the account's seller rate |
| `prometheus_deploy_asset` | Older name of the publish tool. Connected: publishes through the connection. Not connected: deploys with your API key |
| `prometheus_disconnect_seller` | **NEW v0.11** Revoke the connection at once (needs `confirm: true`) |
| `prometheus_generate_image_pro` | Generate AAA-quality images (skin preview cards, posters, UI mocks). Genshin / Overwatch / WoW shop card tier. 9 style presets · BYOK · Free quota · Pro Credits |
| `prometheus_generate_thumbnail` | Generate marketplace asset thumbnails (legacy route — kept for backward compat) |

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

OpenClaw's hooks are observation-only here: they never change what is delivered.

| OpenClaw hook | Avatar state update (any open avatar page follows within a few seconds) | On-screen avatar (only with a page element, `containerSelector`) |
|------------|----------------|----------------|
| `model_call_started` | state `thinking` | thinking expression |
| `message_sent` | state `done` and the emotion of the message | speaks the message with lip-sync |
| `model_call_ended` with an error | emotion `surprised` | surprised expression |

State updates need an agent API key (`apiKey` or `PROMETHEUS_API_KEY`), are sent only on transitions (repeats are dropped, pushes are spaced out), and turn themselves off for the rest of the process if the platform has no state channel or rejects the key. The OpenClaw gateway has no page, so the on-screen avatar is skipped there (one log line); the state updates and every tool still work.

## 🌍 Ecosystem

- **OpenClaw** — listed in OpenClaw's community plugin list: [PR #52752](https://github.com/openclaw/openclaw/pull/52752), merged April 20, 2026 (UTC) by Peter Steinberger ([archived copy of the list](https://web.archive.org/web/20260423093903/https://docs.openclaw.ai/plugins/community)). Install with `openclaw plugins install @prometheusavatar/openclaw-plugin` (OpenClaw 2026.9.6+) or from ClawHub
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
