# 🔥 Prometheus Avatar — OpenClaw Plugin

> Sell on Prometheus Marketplace from OpenClaw at the OpenClaw seller rate, generate **AAA-quality images** for skin previews, and give your agent a 2D avatar (lip-sync, emotion, TTS) where the host has a page to draw it in.

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
3. On the Prometheus site, choose OpenClaw as the account's registration type (open `/join?type=openclaw` on the Prometheus site, sign in and press **Register**; or use Dashboard → Seller types → OpenClaw) and link your X account. The account becomes an OpenClaw seller only once it has chosen the type, has no earlier sales or listings, has a linked X account (at least 30 days old) and holds a connected key. Until then the connection status says what is missing, and listings are sold at the account's current rate. If the approving account already has sales or listings, or its account type is already set, it will not become an OpenClaw seller: the agent says so.
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
- **🎭 2D Avatar** — Renders the 2D model file (`.model3.json`) that `modelUrl` points at, in your agent's web UI. The plugin ships no model of its own, so set `modelUrl` (see Configuration). It draws into a page element, so it starts only where the host gives the plugin one (set `containerSelector`). The OpenClaw gateway has no page: there the avatar display is skipped and every other tool works as usual
- **🖼️ Hosted avatar** — With a Prometheus agent key (`apiKey`) and the id of one of your hosted avatars (`avatarId`), and no `modelUrl`, the plugin shows that hosted avatar in a frame inside the page element and drives its expression from the agent's events. It does not make the hosted avatar speak
- **🗣️ Text-to-Speech** — with a 2D model file's avatar, agent messages are spoken aloud with lip-sync
- **😊 Emotion Detection** — text sentiment drives expressions (happy / sad / angry / surprised / thinking)
- **🎨 AAA Image Generation (v0.9+)** — Generate game-store-tier skin preview cards directly from your agent conversation
- **🛒 Marketplace Asset Pipeline** — Generate thumbnails + deploy assets without leaving the agent loop
- **🎓 Bundled Skill (NEW v0.10)** — Plugin now ships with an AgentSkills-compatible `SKILL.md` at `skills/prometheus-avatar/` that teaches the agent when and how to use the tools. Auto-loaded when the plugin is enabled. See [OpenClaw Skills docs](https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md).

## ⚙️ Configuration

Set an option with `openclaw config set plugins.entries.prometheus-avatar.config.<option> <value>`, or put the options in your OpenClaw config under the same path:

```json
{
  "plugins": {
    "entries": {
      "prometheus-avatar": {
        "config": {
          "modelUrl": "https://your-cdn.example/models/your-model.model3.json",
          "containerSelector": "#avatar",
          "apiKey": "pak_...",
          "enableLipSync": true,
          "enableEmotion": true
        }
      }
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `avatarId` | `string` | — | ID of a hosted avatar made with your Prometheus agent key. With `apiKey` also set and no `modelUrl`, the plugin shows that hosted avatar (see below). Setting only `avatarId` shows no avatar and logs an error that says to set `apiKey` or `modelUrl`. A Marketplace listing ID cannot be shown |
| `apiKey` | `string` | `PROMETHEUS_API_KEY` env var | Prometheus agent API key (`pak_...`) — used for API-key deploys, the image tools and avatar state updates (the live gate rejects unauthenticated writes), and, together with `avatarId`, for showing a hosted avatar. It is never put into the avatar's page address or sent to it. Not needed for the seller channel. `PROMETHEUS_API_KEY` is used only when the plugin talks to the production address. Get one at [prometheus.mythslabs.ai/settings/agent-keys](https://prometheus.mythslabs.ai/settings/agent-keys) |
| `modelUrl` | `string` | — | Direct URL to a 2D model file (`.model3.json`). Wins over `avatarId`. Needed to draw your own model: without it the plugin logs an error that says how to set it and shows nothing, unless `apiKey` and `avatarId` are both set (the seller and image tools still work) |
| `companionState` | `boolean` | `true` | Push agent activity to your Prometheus avatar (needs an agent API key). `false` turns it off |
| `containerSelector` | `string` | — | CSS selector of the page element the avatar draws into (or the hosted avatar is framed in). Only browser-hosted OpenClaw UIs have one; without it the avatar display is skipped |
| `ttsProvider` | `string` | — | **DEPRECATED in v0.10.0** — ignored. TTS is now delegated to the Prometheus SDK. |
| `ttsVoice` | `string` | — | Name (or `voiceURI`) of a voice installed in the viewer's browser, as listed by `speechSynthesis.getVoices()`. An unknown name, a Marketplace voice ID included, is ignored and the default voice speaks. The plugin does not play cloned or Marketplace voices yet |
| `enableLipSync` | `boolean` | `true` | Speak agent messages aloud in the 2D model file's avatar, with mouth movement estimated from the text. `false` means agent messages are not spoken. No effect on a hosted avatar, which the plugin never makes speak |
| `enableEmotion` | `boolean` | `true` | Emotion analysis from text; the result drives the expression of the 2D model file's avatar and of a hosted avatar alike |

### Showing a hosted avatar

To show a hosted Prometheus avatar instead of a model file, leave `modelUrl` out and set both `apiKey` and `avatarId` (and `containerSelector`, the page element to show it in):

```json
{
  "plugins": {
    "entries": {
      "prometheus-avatar": {
        "config": {
          "containerSelector": "#avatar",
          "apiKey": "pak_...",
          "avatarId": "<id of your hosted avatar>"
        }
      }
    }
  }
}
```

- The plugin puts the hosted avatar page in a frame inside the page element that `containerSelector` names and connects the SDK's `connectEmbed` bridge to it. The frame's address is `https://prometheus.mythslabs.ai/embed/<avatarId>`, with nothing added to it. The OpenClaw gateway has no page element, so nothing is framed there (one log line).
- `avatarId` is the id of an avatar made with your Prometheus agent key. A Marketplace listing ID is not one, and the page answers "Avatar not found".
- Agent events move the expression only: `model_call_started` shows the thinking expression, `model_call_ended` with an error the surprised one, and `message_sent` the expression its text suggests (unless `enableEmotion` is `false`). The plugin does not make the hosted avatar speak, so `ttsVoice` and `enableLipSync` have no effect on it.
- When the page reports that the avatar loaded, the plugin logs "Hosted avatar ready." If it never does, the plugin logs a warning that names `avatarId`.
- If `modelUrl` is also set, the 2D model file is drawn and `avatarId` is not used.
- `connectEmbed` is in `@prometheusavatar/core` 0.11.5 and later; this plugin asks for 0.11.6 or later (the seller channel needs it).

## 🎓 Bundled Skill (NEW v0.10)

The plugin ships with a bundled OpenClaw Skill at `skills/prometheus-avatar/SKILL.md` so the agent knows **when** and **how** to use the tools below without explicit user prompting. The Skill covers:

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

Both publish tools (`prometheus_publish_listing` and `prometheus_deploy_asset`): a persona needs `persona_config` (or a persona JSON file); its public description is never the prompt. A motion needs `source` (`original` or `licensed_resale`) and `body_type`; library clips without resale rights cannot be listed.

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

| OpenClaw hook | Avatar state update (any open avatar page follows within a few seconds) | On-screen 2D model file (only with a page element, `containerSelector`) | Hosted avatar in the page element (`apiKey` + `avatarId`, no `modelUrl`) |
|------------|----------------|----------------|----------------|
| `model_call_started` | state `thinking` | thinking expression | thinking expression |
| `message_sent` | the emotion of the message (state `done` only when `enableEmotion` is off) | speaks the message with lip-sync (unless `enableLipSync` is `false`) | the expression the message suggests; never spoken |
| `model_call_ended` with an error | emotion `surprised` | surprised expression | surprised expression |

State updates need an agent API key (`apiKey` or `PROMETHEUS_API_KEY`), are sent only on transitions (repeats are dropped, pushes are spaced out), and turn themselves off for the rest of the process if the platform has no state channel (the route does not exist) or rejects the key. An account that has no avatar yet is tried again once a minute, and a failed push is retried for up to 30 seconds. An API key from `PROMETHEUS_API_KEY` is used only when the plugin talks to the production address. The OpenClaw gateway has no page, so the on-screen avatar is skipped there (one log line); the state updates and every tool still work.

## 🌍 Ecosystem

- **OpenClaw** — listed in OpenClaw's community plugin list: [PR #52752](https://github.com/openclaw/openclaw/pull/52752), merged April 20, 2026 (UTC) by Peter Steinberger ([archived copy of the list](https://web.archive.org/web/20260423093903/https://docs.openclaw.ai/plugins/community)). Install with `openclaw plugins install @prometheusavatar/openclaw-plugin` (OpenClaw 2026.9.6+) or from ClawHub
- **Hermes Agent** — Avatar skill PR submitted at [`NousResearch/hermes-agent#9754`](https://github.com/NousResearch/hermes-agent/pull/9754)
- **Cursor / Claude Code / Any MCP Client** — Use the [`@prometheusavatar/mcp-server`](https://www.npmjs.com/package/@prometheusavatar/mcp-server) (21 tools) for direct MCP access to the same image engine

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
