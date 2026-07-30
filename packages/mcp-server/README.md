# @prometheusavatar/mcp-server

Give any AI agent an embodied Live2D avatar via [Model Context Protocol](https://modelcontextprotocol.io).

```bash
npx @prometheusavatar/mcp-server
```

## 10 Tools

| Tool | Description |
|------|-------------|
| `create_avatar` | Initialize a new avatar instance with model, voice, and persona |
| `set_avatar_state` | **NEW v0.3.5** Push companion state (thinking/acting/listening/done) + emotion to live embeds — open embed pages pick it up within ~3s |
| `equip_asset` | Equip a purchased marketplace asset (skins, voices, effects, etc.) — unequip is not supported for agent accounts yet; equipping in the same category replaces |
| `generate_asset` | AI-generate new assets from text prompts (persona, expression, scene, etc.) |
| `update_asset` | Edit price, name, description, tags, or license of an existing marketplace asset |
| `generate_image_pro` | **NEW v0.3** AAA-quality image generation (skin preview cards / posters / UI mocks / XHS carousels) · BYOK · Free quota · Pro Credits |
| `list_marketplace` | Browse available marketplace assets by category |
| `get_avatar_status` | Get current avatar state and equipped assets |
| `share_avatar` | Generate shareable links and embed codes |
| `speak` | Make the avatar speak text with TTS and lip-sync animation |

## Setup

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "prometheus": {
      "command": "npx",
      "args": ["-y", "@prometheusavatar/mcp-server"],
      "env": {
        "PROMETHEUS_API_KEY": "pak_your-agent-key",
        "GEMINI_API_KEY": "your-key-here"
      }
    }
  }
}
```

### Cursor / Windsurf / Any MCP Client

```json
{
  "command": "npx",
  "args": ["-y", "@prometheusavatar/mcp-server"]
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | For `generate_asset` | API key for asset generation |
| `OPENAI_API_KEY` | For `generate_image_pro` (BYOK) | Your image-provider API key for BYOK — without this, platform Free quota / Pro Credits routes apply |
| `PROMETHEUS_API_URL` | No | Custom API URL (default: `https://prometheus.mythslabs.ai`) |
| `PROMETHEUS_API_KEY` | For `create_avatar` / `set_avatar_state` / `equip_asset` / `get_avatar_status` / `speak` | Your `pak_` agent key — sign in at [prometheus.mythslabs.ai/settings/agent-keys](https://prometheus.mythslabs.ai/settings/agent-keys) and click Generate key (shown once) |

## Example Conversation

> **User**: "Create an avatar that looks like a cute anime girl and make her say hello"
>
> **AI Agent** (using MCP):
> 1. Calls `create_avatar` → gets embed URL
> 2. Calls `speak` with "Hello! Nice to meet you! 😊"
> 3. Returns the embed URL to the user

> **User**: "Browse the marketplace for cool effects"
>
> **AI Agent**:
> 1. Calls `list_marketplace` with category "effects"
> 2. Presents Cherry Blossom Rain, Starfield, etc.
> 3. User picks one → calls `equip_asset`

> **User**: "Generate a cyberpunk anime girl skin in AAA Genshin / Overwatch shop card tier"
>
> **AI Agent** (v0.3+):
> 1. Calls `generate_image_pro` with `{ style: 'cyberpunk', task: 'aaa_skin', size: '1024x1536', quality: 'high', prompt: '3D cel-shaded engine render, cyberpunk anime girl, neon hair...' }` (Twin Prompt-Is-The-Ceiling rule — recommend ≥100-word prompt with explicit AAA benchmark named for best quality)
> 2. Returns 1024×1536 base64 image (or `publicUrl` when `upload: true`) — ready to ship to marketplace as a skin preview card
> 3. Cost reported per call (Free quota / Pro Credits / BYOK $0)

## Links

- **Platform**: [prometheus.mythslabs.ai](https://prometheus.mythslabs.ai)
- **SDK**: `npm i @prometheusavatar/core`
- **GitHub**: [myths-labs/prometheus-avatar](https://github.com/myths-labs/prometheus-avatar)

## License

MIT — [Myths Labs](https://mythslabs.ai)
