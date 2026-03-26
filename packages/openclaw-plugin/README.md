# 🔥 Prometheus Avatar — OpenClaw Plugin

> Give your OpenClaw agent a Live2D avatar with real-time lip-sync, emotion expressions, and TTS.

[![npm](https://img.shields.io/badge/npm-%40prometheus--avatar%2Fopenclaw--plugin-blue)](https://www.npmjs.com/package/@prometheus-avatar/openclaw-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-plugin-purple)](https://openclaw.ai)

## 🚀 Install

```bash
openclaw plugins install @prometheus-avatar/openclaw-plugin
```

## ✨ What it does

This plugin bridges OpenClaw agent events to the [Prometheus Avatar SDK](https://github.com/myths-labs/prometheus-avatar), giving your AI agent a visual body:

- **🎭 Live2D Avatar** — Renders a Live2D model in your agent's UI
- **🗣️ Text-to-Speech** — Agent messages are spoken aloud with lip-sync
- **😊 Emotion Detection** — Text sentiment drives avatar expressions (happy, sad, angry, surprised, thinking)
- **🎨 Marketplace Assets** — Equip skins, voices, personas, and effects from the [Prometheus Marketplace](https://prometheus.mythslabs.ai/marketplace)

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

## 🛠️ Agent Tools

When your OpenClaw agent has tool-use enabled, two creator tools are registered:

| Tool | Description |
|------|-------------|
| `prometheus_generate_thumbnail` | Generate AI thumbnails for marketplace assets |
| `prometheus_deploy_asset` | Deploy new assets (voices, skins, effects) to the Marketplace |

## 📡 Events

| Listens to | Emits |
|------------|-------|
| `agent:message` → speaks + animates | `avatar:speak` |
| `agent:thinking` → thinking expression | `avatar:emotion` |
| `agent:error` → surprised expression | `avatar:ready` |

## 🔗 Links

- **SDK**: [@prometheusavatar/core](https://www.npmjs.com/package/@prometheusavatar/core)
- **Marketplace**: [prometheus.mythslabs.ai](https://prometheus.mythslabs.ai)
- **GitHub**: [myths-labs/prometheus-avatar](https://github.com/myths-labs/prometheus-avatar)
- **Docs**: [Prometheus SDK Documentation](https://github.com/myths-labs/prometheus-avatar#readme)

## 📄 License

MIT © [Myths Labs](https://mythslabs.ai)
