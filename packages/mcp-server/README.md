# @prometheusavatar/mcp-server

Give any AI agent an embodied Live2D avatar via [Model Context Protocol](https://modelcontextprotocol.io).

```bash
npx @prometheusavatar/mcp-server
```

## 15 Tools

| Tool | Description |
|------|-------------|
| `create_avatar` | Initialize a new avatar instance with model, voice, and persona |
| `equip_asset` | Equip/unequip marketplace assets (skins, voices, effects, etc.) |
| `generate_asset` | AI-generate new assets from text prompts (persona, expression, scene, etc.) |
| `update_asset` | Edit price, name, description, tags, or license of an existing marketplace asset |
| `generate_image_pro` | **NEW v0.3** AAA-quality image generation (skin preview cards / posters / UI mocks / XHS carousels) · BYOK · Free quota · Pro Credits |
| `list_marketplace` | Browse available marketplace assets by category |
| `get_avatar_status` | Get current avatar state and equipped assets |
| `share_avatar` | Generate shareable links and embed codes |
| `speak` | Generate TTS and return audio content for client playback |
| `prometheus_list_audio_hosts` | Discover paired local Avatar hosts and current voice selections |
| `prometheus_prepare_speech` | Prepare speech once with a durable request UUID; may invoke paid synthesis |
| `prometheus_get_prepared_speech` | Read original preparation status without generating |
| `prometheus_play_prepared_speech` | Deliver cached audio to one exact current host selection |
| `prometheus_stop_speech` | Stop one command while preserving its original receipts |
| `prometheus_get_speech_playback` | Read durable host receipts; optionally refresh without replay |
| `prometheus_read_workspace` | Read account-owned work or tasks with exact cursor pagination |
| `prometheus_save_workspace_entry` | Save one original work/task operation while preserving creation provenance |
| `prometheus_get_workspace_operation` | Recover an original work/task receipt without writing |

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
| `PROMETHEUS_API_KEY` | No | API key for authenticated operations |
| `PROMETHEUS_AUDIO_HOST_ORIGIN` | For local audio | Exact App Origin, e.g. `http://127.0.0.1:3000` or your HTTPS App Origin |
| `PROMETHEUS_AUDIO_HOST_KEY` | For local audio | Secret random 32–256 character base64url pairing key; enter the same key in the App |
| `PROMETHEUS_AUDIO_HOST_PORT` | No | Loopback port, default `8766`; keep it stable for recovery |
| `PROMETHEUS_AUDIO_HOST_DATA_DIR` | No | Private persistent storage, default `~/.local/share/prometheus-avatar/audio-host` |

### Paired host audio / 配对宿主音频

The local listener stays off until both Origin and pairing key are configured. Use a build containing these host tools and the matching App controls; this source checkout does not imply an npm release. In the App, open Memory & Agent, enter the endpoint and key, and connect the ready 3D Avatar. The key stays in App memory; a cold reload requires explicit reconnect. No pairing key is returned through MCP discovery.

本地监听仅在同时配置 Origin 和配对密钥后开启。需使用包含这些工具及对应 App 控件的版本；源码变更不代表 npm 已发布。在 App 的 Memory & Agent 中输入地址与密钥，并连接已加载的 3D Avatar。密钥只保留在页面内存中，刷新后需明确重新连接。

### Account workspace / 账号工作区

These three tools require the compatible `/api/agent/workspace` backend and an active `pak_` key with verified account ownership. First read a `markdown` or `tasks` category and retain the returned `accountId`. Work supports unchanged Markdown, code blocks, tables and emoji; tasks retain status, due date and revision. Chat is excluded. Reads return at most five entries; pass `nextCursor` unchanged for older entries.

Before the first save, choose stable operation and entry UUIDs and a fixed UTC `occurredAt`. New work uses `kind: message`, `role: assistant`, `inputMode: agent`, with null status/dueOn; a task uses `kind: task`, null role, `inputMode: agent`, and open/done status. New entries have revision zero. Updates use the current revision and preserve category, kind, role, input mode and original timestamp. An Agent can update an existing human task while retaining its manual origin; the human owner can complete an Agent task while retaining its Agent origin.

Every save first queries the original operation. An identical recorded receipt returns without another POST; changed intent is an error. A lost response, cancellation or revoked key does not prove that no write committed. Keep the original account, operation/entry IDs and full input; recover before retrying, including after an MCP restart. Do not create replacement IDs for uncertainty. The three tools generate no paid media. Source changes do not imply an npm/backend release or acceptance of the work/task UI.

三个工具需配套工作区后端和已验证账号归属的有效 Agent Key。先读取类别与账号 ID；工作内容和待办独立于聊天保存。首次写入前固定操作 ID、条目 ID 和创建时间，重试保持原始输入；丢失响应、取消或密钥撤销均不代表未写入。工具先查询原回执，不自动重写。更新待办保留原创建来源和版本约束，支持人和 Agent 互相更新。分页最多五条，使用原始游标继续读取。源码与本地验收不代表已发布或已完成工作区界面。

Maintainers: `src/workspace-contract.ts` is an exact snapshot of the matching marketplace `src/lib/appWorkspace.ts`. Keep the bytes identical and run the native MCP contract/hash and large-content tests when either changes; this prevents response validation from silently drifting across the two packages.

Discover the exact target, prepare with a stable request UUID, then deliver the returned audio reference using explicit command/playback UUIDs. Identical content reuses its original preparation. Query original status after a timeout; do not invent another text or request to bypass an uncertain result. Stop and status queries never synthesize. `accepted` means admitted by the host, `started` means its player started, and a terminal receipt records its reported outcome. Lost connections can leave `unknown`; transport send success alone is not playback confirmation.

先发现当前目标，使用稳定的请求 UUID 准备音频，再用明确的命令与播放 UUID 交付音频引用。相同内容复用原始生成记录；超时后查询原状态，不通过改写文本或请求来绕过“不确定”。Stop 和状态查询不会生成语音。只有宿主回执能说明播放器状态；发送成功不等于身体已播放。断线可能保留 `unknown`，更换宿主或声音不会自动重播。

Storage keeps private bounded history without silent eviction. A generation intent is persisted before the request; crashes or ambiguous results never authorize automatic regeneration. Cached audio stays bound to the agent principal, account, Avatar and selected voice. Pairing does not grant paid voice ownership or account delegation. Keep the same data directory and port across restarts. Restore or reconcile uncertain results from original evidence before attempting any separately authorized retry.

本地历史采用私有、有界持久化，空间不足会明确报错。生成意图先于请求保存，崩溃或结果不明不会自动重试。缓存绑定 Agent 身份、账号、Avatar 和所选声音；配对不授予付费声音或账号委托权限。重启时保留数据目录和端口，并依据原始证据处理不确定结果。

## Example Conversation

> **User**: "Create an avatar that looks like a cute anime girl and make her say hello"
>
> **AI Agent** (using MCP):
> 1. Calls `create_avatar` → gets embed URL
> 2. Calls `speak` with "Hello! Nice to meet you! 😊"
> 3. Returns the audio to a playback-capable client and shares the avatar embed URL

### Speech delivery / 语音交付

`speak` preserves the text metadata block first and adds the speech endpoint's original WAV or MP3 as a standard MCP `audio` content block. The metadata contains the exact decoded byte count and MIME type. Empty audio, invalid base64, incomplete WAV frames and non-finite float samples return a tool error. MP3 delivery validates complete MPEG Layer III frames, consistent stream parameters and bounded ID3 tags; it does not transcode or claim perceptual quality. PCM and IEEE-float WAV remain supported.

The result reports `status: "audio_generated"` and `playback_confirmed: false`. A client must play the audio; a connected avatar host must separately execute and acknowledge playback and lip-sync. An explicit `emotion` argument is rejected before synthesis because the current endpoint does not implement emotion control. No automatic emotion-detection result is claimed.

With the compatible agent speech backend, an unbound `speak` request uses the existing Doubao router. `voice` is an explicit legacy Gemini override; `voice_asset_id` selects a server-resolved Forge Voice asset, and `avatar` selects the avatar's existing default voice. Selected-asset results must acknowledge the same asset ID; missing or substituted voice acknowledgements are errors. Paid previews retain their existing limits and do not grant ownership or human-to-agent delegation. The response keeps provider/asset metadata while withholding an asset's private speaker ID. MCP cancellation is forwarded to the speech HTTP request.

The backend must acknowledge the configured Doubao engine for an unbound request. Older backends that omit this acknowledgement or substitute Gemini return a tool error; install the compatible agent route before releasing this MCP version for default or asset-selected speech.

`speak` 直接交付原始 WAV 或 MP3，并返回准确格式和字节数；空音频、无效 base64、残缺音频帧、损坏的 MP3 帧或标签及非有限 WAV 浮点采样会报错。返回状态只证明音频已生成并交付，真实播放、嘴型和执行回执由客户端/身体宿主负责。当前接口不支持情绪控制，显式传入 `emotion` 会在合成前报错。

配套 Agent 后端复用现有 Doubao 默认语音路由；明确指定的历史 Gemini 音色保持原选择，Forge Voice 资产由服务器解析。回执未确认所选声音时不会交付音频；取消信号会传递给语音 HTTP 请求。付费声音保留试听限制，不会授予购买权益或创建账号委托；语音交付也不代表身体已经播放。

Development checks: `npm test` exercises the real MCP stdio client/server with a local upstream fixture; `npm run test:coverage` checks audio result validation. These checks were run with Node 25 and do not establish paid-provider, physical-playback or avatar acceptance. To replay existing speech, set `MCP_SPEECH_FIXTURE_PATH`, set `MCP_SPEECH_FIXTURE_MIME=audio/mpeg` for MP3 (WAV is the default), and optionally set `MCP_SPEECH_CAPTURE_PATH` to save the received bytes. Repository MP3 fixtures are locally generated test tones, not recorded user speech.

开发验证使用本地上游测试服务，覆盖真实 MCP 传输和结果处理；不代表生产语音服务或角色端到端验收。已有语音样本可通过上述环境变量回放验证，无需再次调用付费合成。

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
