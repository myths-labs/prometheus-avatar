---
name: prometheus-avatar
description: Render a complete Prometheus digital character (2.5D / 3D · Forge-generated with rig + skin + voice + expressions + motion + personality) inside the agent's UI · plus generate AAA marketplace skin previews via gpt-image-1.
---

# Prometheus Avatar

This skill ships with `@prometheusavatar/openclaw-plugin`. It bridges OpenClaw agent events to the Prometheus Avatar SDK, giving your agent a complete visual body and tools to author marketplace assets.

## What a Prometheus character is

Each Marketplace bundle is a complete digital body assembled by **Forge** — the Prometheus generation pipeline — combining 6 alive-feel layers:

1. **Skeleton (rig)** — bone hierarchy for animation
2. **Skin (texture)** — vibrant 2.5D / 3D surface
3. **Voice** — cloned or preset TTS with audio-driven lipsync
4. **Expressions** — emotion reactions (happy / sad / thinking / surprised etc.)
5. **Motion** — animation library (idle sway, gestures, full-body motions)
6. **Personality** — chat tone and response style

Browse bundles at [prometheus.mythslabs.ai/marketplace](https://prometheus.mythslabs.ai/marketplace).

The plugin renders the character inside the agent's UI and connects it to the agent's event stream. The SDK + Marketplace do the heavy lifting; this plugin is the thin client integration surface plus 3 marketplace creator tools.

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
- The image must be deterministic / reproducible across runs — `gpt-image-1` outputs are stochastic.

## Tools

### `prometheus_generate_image_pro` (primary creator tool)

Generates AAA-quality images via OpenAI's `gpt-image-1`. Supports 14 style presets: `anime` · `cel-shade` · `cyberpunk` · `kawaii` · `fantasy` · `cartoon` · `realistic` · `photorealistic` · `pixar` · `chibi` · `gacha-aaa` · `guofeng` · `ghibli` · `pixel`.

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

### `prometheus_deploy_asset`

Push a generated asset (voice / skin / effect) to the Prometheus Marketplace catalog. Requires `name`, `category`, `description`, `fileData` (URL or base64), and `thumbnailData` (use `prometheus_generate_thumbnail` first if no thumbnail exists).

## Avatar events (automatic · no tool call needed)

Once the plugin is enabled with `enableLipSync: true` and `enableEmotion: true`, the avatar reacts automatically to the agent's normal event stream:

| Agent event | Avatar reaction |
|-------------|----------------|
| `agent:message` | Speaks the message with lip-sync |
| `agent:thinking` | Thinking expression |
| `agent:error` | Surprised expression |

The agent does NOT need to call a tool to trigger these — they fire automatically.

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

**TTS**: handled by the Prometheus SDK (`@prometheusavatar/core`) which routes to the Prometheus backend (Volcengine Voice Clone V3 protocol). No TTS API key needed — voices live on the Prometheus Marketplace and are referenced via `ttsVoice` (Marketplace voice ID).

**BYOK for image generation** (zero-marginal-cost path):
- `OPENAI_API_KEY` env var or `apiKey` argument → unlocks `gpt-image-1` for `prometheus_generate_image_pro` (bypasses platform billing). Get one at platform.openai.com.

## Safety

- Do NOT pass untrusted user input directly into `prompt` without sanitisation. The model itself is safe but downstream UI rendering may not be.
- AAA image generation incurs OpenAI cost ($0.07-0.19 per `high` quality image). Prefer `prometheus_generate_thumbnail` for previews / drafts.
- `prometheus_deploy_asset` is irreversible from the agent loop — the asset becomes visible on the public marketplace. Confirm with the user before deploying.

## Links

- npm: https://www.npmjs.com/package/@prometheusavatar/openclaw-plugin
- Marketplace: https://prometheus.mythslabs.ai
- Source: https://github.com/myths-labs/prometheus-avatar
- ClawHub: (pending publish · TBD)
