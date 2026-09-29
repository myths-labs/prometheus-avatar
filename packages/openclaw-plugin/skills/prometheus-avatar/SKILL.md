---
name: prometheus-avatar
description: Sell on Prometheus Marketplace from OpenClaw (connect a seller account, publish listings at the OpenClaw seller rate) · generate AAA marketplace skin previews · show a complete Prometheus digital character (2.5D / 3D, Forge-generated) where the host has a page for it via the Prometheus image engine.
---

# Prometheus Avatar

This skill ships with `@prometheusavatar/openclaw-plugin`. It lets your agent sell on the Prometheus Marketplace at the OpenClaw seller rate, author marketplace assets, and (where the host gives the plugin a page element) drive a visual avatar.

## What a Prometheus character is

Each Marketplace bundle is a complete digital body assembled by **Forge** — the Prometheus generation pipeline — combining 6 alive-feel layers:

1. **Skeleton (rig)** — bone hierarchy for animation
2. **Skin (texture)** — vibrant 2.5D / 3D surface
3. **Voice** — cloned or preset TTS with audio-driven lipsync
4. **Expressions** — emotion reactions (happy / sad / thinking / surprised etc.)
5. **Motion** — animation library (idle sway, gestures, full-body motions)
6. **Personality** — chat tone and response style

Browse bundles at [prometheus.mythslabs.ai/marketplace](https://prometheus.mythslabs.ai/marketplace).

Where the host gives the plugin a page element, the plugin renders the character there and connects it to the agent's events. The SDK + Marketplace do the heavy lifting; this plugin is the thin client integration surface plus 3 marketplace creator tools.

## When to use

Use this skill when the user asks for any of:

- **A visible digital character representing the agent** in the UI ("show yourself", "give me an avatar", "render a character")
- **Real-time TTS with audio-driven lipsync** (not just plain audio)
- **Emotion / mood reflection** on the character (happy / sad / thinking / surprised)
- **A cloned or preset voice** for the agent — reference a Prometheus Marketplace voice ID
- **Generating an AAA-quality skin preview card** (Genshin Impact / Overwatch / WoW shop tier) for a marketplace listing or pitch deck
- **Deploying a generated asset** (voice / skin / motion / personality bundle) to the Prometheus Marketplace catalog

## When NOT to use

- The user just wants plain audio TTS without a visible avatar — use system audio tools instead.
- The user wants a quick low-fidelity thumbnail (not AAA-tier) — `prometheus_generate_thumbnail` is the lighter legacy route.
- The image must be deterministic / reproducible across runs — the image engine's outputs are stochastic.

## Tools

### `prometheus_generate_image_pro` (primary creator tool)

Generates AAA-quality images via the Prometheus image engine. Supports 14 style presets: `anime` · `cel-shade` · `cyberpunk` · `kawaii` · `fantasy` · `cartoon` · `realistic` · `photorealistic` · `pixar` · `chibi` · `gacha-aaa` · `guofeng` · `ghibli` · `pixel`.

**Sizes**:
- `1024x1024` — square (default)
- `1024x1536` — portrait · preferred for character preview cards (head + feet visible)
- `1536x1024` — landscape · social card / banner

**Quality**: `low` ($0.02) / `medium` / `high` ($0.07-0.19). Use `high` for any shippable marketplace asset or pitch deck visual.

**Prompt-is-the-ceiling rule**: write ≥100 words with an explicit AAA benchmark named (Genshin Impact / Overwatch / WoW / Pixar / Studio Ghibli). Lazy short prompts produce mediocre output — the model can render anything if you describe it precisely.

Example call:
```json
{
  "style": "cyberpunk",
  "taskType": "aaa_skin",
  "size": "1024x1536",
  "quality": "high",
  "prompt": "3D cel-shaded engine render, anime girl with neon hair and tech visor, slight elevated 3/4 hero pose, glossy game-art materials, clean dark studio backdrop with subtle radial gradient, cyan / magenta rim lighting, NOT flat 2D illustration, Genshin Impact / Overwatch shop preview tier, production-ready AAA skin preview card."
}
```

Returns base64 image (or `publicUrl` when `upload: true`).

### `prometheus_generate_thumbnail` (legacy)

Lighter thumbnails for non-AAA contexts. Faster and cheaper than `prometheus_generate_image_pro` but lower fidelity. Kept for backward compatibility. Prefer `prometheus_generate_image_pro` for anything marketplace-facing or pitch-deck-facing.

### Sell on Prometheus (seller channel)

Use when the user says "Connect my Prometheus seller account", "Publish this to Prometheus Marketplace", or asks to sell an asset they made.

1. **`prometheus_connect_seller`** — starts the connection. Tell the user the link and the code exactly as returned (they have 10 minutes; they must sign in to Prometheus and approve). The plugin completes the connection by itself once they approve; `prometheus_connection_status` shows where it is.
2. **`prometheus_connection_status`** — connected or not, the seller rates, whether the X account is linked, today's publish count. If X is not linked, publishing at the OpenClaw rate fails: give the user the link the tool returned.
3. **`prometheus_publish_listing`** — needs `name`, `category`, the file (`fileData`: URL or base64) — or `draft_asset_id` for a draft the account already holds. `personas` also need `description` and `persona_config`; `bundles` need `bundle_items`. Voices cannot be published this way (publish them in the Voice Creator on the site). Confirm with the user before publishing: the listing becomes public.
4. **`prometheus_disconnect_seller`** — only when the user asks to disconnect; pass `confirm: true`.

Rules: never invent a connection or a rate; when a tool returns a message and a fix link, tell the user both as written. If `prometheus_publish_listing` fails, do NOT retry with `prometheus_deploy_asset` and an API key to get around it: that sells at the lower AI agent rate and the user did not choose that. The connection key is never shown to you or the user; never ask for it.

### `prometheus_deploy_asset` (older name)

Same as `prometheus_publish_listing` when the plugin is connected. Not connected, it deploys with the configured API key (`pak_...`) at the AI agent rate. Category must be one of `skins` / `voices` / `effects` / `motions` / `accessories` / `scenes` / `personas` / `expressions`. Requires `name`, `category`, and `fileData` (URL or base64).

## Avatar events (automatic · no tool call needed)

Where the host gives the plugin a page element (`containerSelector`) and `enableLipSync` / `enableEmotion` are on, the avatar reacts to OpenClaw's normal event stream:

| OpenClaw hook | Avatar reaction |
|-------------|----------------|
| `message_sent` | Speaks the message with lip-sync |
| `model_call_started` | Thinking expression |
| `model_call_ended` (error) | Surprised expression |

The agent does NOT need to call a tool to trigger these. The OpenClaw gateway has no page, so there this part is skipped and the tools work as usual.

## Configuration

Set via `openclaw.config.json`:

```json
{
  "plugins": {
    "prometheus-avatar": {
      "avatarId": "<marketplace-bundle-id>",
      "ttsVoice": "<marketplace-voice-id>",
      "enableLipSync": true,
      "enableEmotion": true
    }
  }
}
```

Browse character bundles + voice IDs at [prometheus.mythslabs.ai/marketplace](https://prometheus.mythslabs.ai/marketplace).

**TTS**: handled by the Prometheus SDK (`@prometheusavatar/core`) which routes to the Prometheus voice backend. No TTS API key needed — voices live on the Prometheus Marketplace and are referenced via `ttsVoice` (Marketplace voice ID).

**BYOK for image generation** (zero-marginal-cost path):
- `OPENAI_API_KEY` env var or `apiKey` argument → unlocks BYOK image generation for `prometheus_generate_image_pro` (bypasses platform billing).

## Safety

- Do NOT pass untrusted user input directly into `prompt` without sanitisation. The model itself is safe but downstream UI rendering may not be.
- AAA image generation incurs provider cost ($0.07-0.19 per `high` quality image). Prefer `prometheus_generate_thumbnail` for previews / drafts.
- `prometheus_publish_listing` and `prometheus_deploy_asset` are irreversible from the agent loop — the asset becomes visible on the public marketplace. Confirm with the user before publishing.

## Links

- npm: https://www.npmjs.com/package/@prometheusavatar/openclaw-plugin
- Marketplace: https://prometheus.mythslabs.ai
- Source: https://github.com/myths-labs/prometheus-avatar
- ClawHub: `openclaw plugins install clawhub:@prometheusavatar/openclaw-plugin`
