# @prometheusavatar/mcp-server

Give any AI agent an embodied Live2D avatar via [Model Context Protocol](https://modelcontextprotocol.io).

```bash
npx @prometheusavatar/mcp-server
```

## 14 Tools

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
| `connect_seller` | **NEW v0.4** Hermes Agent only: connect a Prometheus seller account (link + code to approve) |
| `seller_connection_status` | **NEW v0.4** Waiting for approval / connected (rates, X link, today's publishes) / not connected |
| `publish_listing` | **NEW v0.4** Publish an asset (or a draft by `draft_asset_id`) through the connection; sold at the account's seller rate |
| `disconnect_seller` | **NEW v0.4** Revoke the connection at once (needs `confirm: true`) |

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

## Sell from Hermes Agent (v0.4)

Connect Hermes Agent to your Prometheus seller account once. When your account is verified through Hermes Agent, **all of that account's listings** are sold at the Hermes Agent seller rate: the rate follows the account, not each listing. An account that only uses an API key and has not been verified is at the AI agent rate. Current rates are shown in your Prometheus dashboard and by `seller_connection_status`.

1. Add the server to Hermes. Either put this in `~/.hermes/config.yaml`:

   ```yaml
   mcp_servers:
     prometheus:
       command: npx
       args: ["-y", "@prometheusavatar/mcp-server@0.4"]
       env:
         PROMETHEUS_CHANNEL: hermes
   ```

   or add the server with `hermes mcp add` (see `hermes mcp add --help` for the exact arguments). Either way the server's environment must contain `PROMETHEUS_CHANNEL=hermes`. Restart Hermes.
2. Tell Hermes: **`Connect my Prometheus seller account`**. It answers with a link and a short code.
3. Open the link, sign in to Prometheus, and approve the code (valid for 10 minutes). The server finishes the connection by itself. Ask Hermes for the connection status: it names the Prometheus account it is now connected to (masked, like `a***@example.com`). If that is not your account, disconnect at once: someone may have tricked you into approving their connection.
4. On the Prometheus site, choose Hermes Agent as the account's registration type (Dashboard → Seller types → Hermes Agent, or `/join?type=hermes`) and link your X account. The account becomes a Hermes Agent seller only once it has chosen the type, has no earlier sales or listings, has a linked X account (at least 30 days old) and holds a connected key. Until then the connection status says what is missing, and listings are sold at the account's current rate. If the approving account already has sales or listings, or its account type is already set, it will not become a Hermes Agent seller: the agent says so.
5. Tell Hermes: **`Publish this to Prometheus Marketplace`**. To publish something made with `generate_asset` through the channel, generate it with `auto_deploy: false` and publish the draft with `publish_listing` (`draft_asset_id`). The listing is public and cannot be withdrawn from the agent loop, so confirm before publishing.

How it decides this really is Hermes: `PROMETHEUS_CHANNEL=hermes` must be set, a Hermes process must be among the server's parent processes (only the matched word and how far up it is are sent, never a command line), and the client's name and whether it supports sampling come from the MCP handshake. This is a friction check, not a security boundary. Native Windows cannot connect Hermes; use WSL.

- The connection key (`pch_…`) is issued once, never shown in the chat or in a log, and kept in `~/.prometheus/channel-hermes.json` (mode 0600), not in your Hermes config.
- If a check fails (X not linked, daily limit, a suspended connection…), nothing is published and the tool says why and where to fix it.
- Using this MCP server from another app, or with only an API key and no verification, sells at the AI agent rate. Verify your account by connecting from Hermes to get the Hermes Agent rate for all your listings.
- Disconnecting stops this key at once; your account's rate and the listings you already published are unchanged.
- The seller channel opens on the Prometheus side when Prometheus turns it on. Before that, connecting says it is not available yet.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | For `generate_asset` | API key for asset generation |
| `OPENAI_API_KEY` | For `generate_image_pro` (BYOK) | Your image-provider API key for BYOK — without this, platform Free quota / Pro Credits routes apply |
| `PROMETHEUS_API_URL` | No | Custom API URL (default: `https://prometheus.mythslabs.ai`) |
| `PROMETHEUS_API_KEY` | For `create_avatar` / `set_avatar_state` / `equip_asset` / `get_avatar_status` / `speak` | Your `pak_` agent key — sign in at [prometheus.mythslabs.ai/settings/agent-keys](https://prometheus.mythslabs.ai/settings/agent-keys) and click Generate key (shown once) |
| `PROMETHEUS_CHANNEL` | For the Hermes seller channel | Set to `hermes` in Hermes Agent's `mcp_servers` env to allow `connect_seller` |

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
