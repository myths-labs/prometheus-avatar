# @prometheusavatar/mcp-server

Give any AI agent an embodied 3D / 2.5D avatar via [Model Context Protocol](https://modelcontextprotocol.io) — and a place to put what it makes: reports, code, to-dos and the pages it visited land in your [Prometheus](https://prometheus.mythslabs.ai) workspace.

```bash
npx @prometheusavatar/mcp-server
```

[English](#17-tools) · [中文](#中文文档)

## 17 Tools

### Avatar and marketplace (10)

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

### Workspace (7) — **NEW in v0.3.6**

What your agent produces is saved to your Prometheus account and shows up in your workspace panes. The first four are the ones a model should use: it supplies the least it can, and this server fills in everything else (ids, timestamps with milliseconds, the account header, who wrote it).

| Tool | What it does | Arguments |
|------|--------------|-----------|
| `save_work` | Save a finished piece of work (Markdown) to the **Work** pane | `content` (required) · `title` · `external_key` |
| `upsert_task` | Add a to-do to the **To-do** pane, or update one | `text` (required) · `due_on` (`YYYY-MM-DD`) · `external_key` · `done` |
| `complete_task` | Mark a to-do done | `task_id` **or** `external_key` |
| `log_visited_page` | Record a page the agent visited (the "pages the Agent visited" list) | `url` (http/https only, required) · `title` |
| `prometheus_read_workspace` | Low level: read entries (≤ 5 per page) and the category list | `category` · `cursor` · `limit` · `account_id` |
| `prometheus_save_workspace_entry` | Low level: write one entry with every field under your control | `account_id` · `operation_id` · `entry` |
| `prometheus_get_workspace_operation` | Low level: look up the receipt of an earlier write | `account_id` · `operation_id` |

## Requirements

- **Node.js 18.17 or newer** (Node 20 LTS or 22 recommended). Check with `node -v`. `npx` ships with Node; there is nothing else to install.
- A Prometheus **Agent key** (starts with `pak_`). Sign in at [prometheus.mythslabs.ai/settings/agent-keys](https://prometheus.mythslabs.ai/settings/agent-keys) and click **Generate key**. It is shown **once**, and generating a new key **revokes the previous one** — so if you use several clients, give them all the same key and generate a new one only when you mean to replace it.
- In the snippets below, `PASTE_YOUR_AGENT_KEY_HERE` is a placeholder. Paste your own key there, keep it out of git, and never share it.

## Setup

### Claude Desktop

Open the config file (Settings → Developer → Edit Config), which is `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows, add this, then quit and reopen Claude Desktop:

```json
{
  "mcpServers": {
    "prometheus": {
      "command": "npx",
      "args": ["-y", "@prometheusavatar/mcp-server"],
      "env": {
        "PROMETHEUS_API_KEY": "PASTE_YOUR_AGENT_KEY_HERE"
      }
    }
  }
}
```

If Claude Desktop reports that it cannot start the server, it usually cannot find Node: put the full path from `which npx` (macOS/Linux) or `where npx` (Windows) in `"command"`.

### Claude Code

```bash
claude mcp add prometheus --env PROMETHEUS_API_KEY=PASTE_YOUR_AGENT_KEY_HERE -- npx -y @prometheusavatar/mcp-server
```

To share the setup with a team without sharing the key, put this in the project's `.mcp.json` and let each person export `PROMETHEUS_API_KEY` in their own shell:

```json
{
  "mcpServers": {
    "prometheus": {
      "command": "npx",
      "args": ["-y", "@prometheusavatar/mcp-server"],
      "env": { "PROMETHEUS_API_KEY": "${PROMETHEUS_API_KEY}" }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (this project; do not commit the key), then restart Cursor:

```json
{
  "mcpServers": {
    "prometheus": {
      "command": "npx",
      "args": ["-y", "@prometheusavatar/mcp-server"],
      "env": {
        "PROMETHEUS_API_KEY": "PASTE_YOUR_AGENT_KEY_HERE"
      }
    }
  }
}
```

### Windsurf / any other MCP client

Run `npx -y @prometheusavatar/mcp-server` as a stdio server and set `PROMETHEUS_API_KEY` in its environment.

## Three ways to save: work, to-do, browse

An MCP tool only runs when the model decides to call it, so you can either ask in words ("save this to Prometheus", "add a to-do for tomorrow") or install a standing rule (next section) so it happens on its own.

**Work** — a finished piece of writing or code, kept as Markdown in the Work pane:

```json
{ "content": "# Q3 plan\n\n| Goal | Owner |\n|---|---|\n| Ship v2 | Ana |", "title": "Q3 plan", "external_key": "q3-plan" }
```

**To-do** — one short sentence, optionally with a due **date**. There is no time of day and **no reminder**; Prometheus stores the task, it does not alert you:

```json
{ "text": "Send the invoice to ACME", "due_on": "2026-10-15", "external_key": "invoice-acme-10" }
```

then later `{ "external_key": "invoice-acme-10" }` to `complete_task`.

**Browse** — a web page the agent visited for you (`http://` or `https://` only; addresses with a user name or password are refused):

```json
{ "url": "https://example.com/pricing", "title": "Pricing" }
```

The "pages the Agent visited" list is the website's `browse` category, live on prometheus.mythslabs.ai since 2026-10-19. If a website does not list that category for your key, `log_visited_page` answers with a plain explanation and saves nothing, and works by itself, with no update on your side, once the category is listed.

### No duplicates

- **`external_key`** is any label that stays the same for the same thing (`"weekly-report-2026-10-14"`). The entry's id is derived from it, so calling `save_work` or `upsert_task` again with the same key **updates that entry** instead of adding another — on any machine, in any session. Without a key, every successful call adds a new entry.
- **If the network drops** mid-save (or the key stops working mid-save), the tool says the result is unknown and tells the model to call it again with the same arguments. The operation id is remembered for 24 hours (in memory and in a small file, see below), filed under your Prometheus account rather than under the key, so the repeat sends the very same operation even after you replace the key, and Prometheus returns the original result: one entry, never two. A repeat after those 24 hours, or after the state folder was deleted, counts as a new save.
- Without an `external_key`, an identical call that succeeded in the last two minutes is answered from memory (MCP clients sometimes time out and retry calls that had finished).
- If someone edits the same entry elsewhere at the same moment (a 409 conflict), the server reads the latest version and tries once more.

## Standing rules: make it happen without asking

Paste the matching block once. Each says the same thing in the place that client reads.

**Claude Code** — add to the project's `CLAUDE.md` (or `~/.claude/CLAUDE.md` for every project):

```markdown
## Prometheus workspace
- When you finish something I will want to keep (a report, a document, an analysis, a plan, the final text of code you wrote), save it with the `save_work` tool: full Markdown in `content`, and a stable `external_key` if you may revise it later.
- When I ask you to remember a task, or you leave a follow-up, add it with `upsert_task` (`text`, and `due_on` as YYYY-MM-DD when there is a date). There are no reminders; never promise one. Mark finished tasks with `complete_task`.
- When you open a web page that matters to the task, record it with `log_visited_page`.
- Only tell me something is saved when the tool result says `saved: true`. If a result says the outcome is unknown, call the same tool again with the same arguments.
```

**Cursor** — create `.cursor/rules/prometheus.mdc`:

```markdown
---
description: Save finished work, tasks and visited pages to the Prometheus workspace
alwaysApply: true
---
- When you finish a deliverable the user will want to keep (report, document, analysis, plan), call the `save_work` MCP tool with the full Markdown in `content` (add a stable `external_key` if you may revise it).
- When the user asks you to remember a task or you leave a follow-up, call `upsert_task` (`text`, `due_on` as YYYY-MM-DD if there is a date). Prometheus has no reminders; never promise one. Finish tasks with `complete_task`.
- When you open a web page that matters to the task, call `log_visited_page`.
- Say something is saved only if the result contains `saved: true`. If the outcome is unknown, call the same tool again with the same arguments.
```

**Claude Desktop** — in a Project, choose **Set project instructions** and paste:

```text
You have the Prometheus tools. When you finish something I will want to keep (a report, a document, an analysis, a plan), save it with save_work: the full Markdown in "content", plus a stable "external_key" if you may revise it later. When I ask you to remember a task, or you leave a follow-up, add it with upsert_task (text, and due_on as YYYY-MM-DD if there is a date; there are no reminders, so never promise one) and mark finished tasks with complete_task. When you open a web page that matters to the task, record it with log_visited_page. Tell me something is saved only when the tool result says saved: true; if it says the outcome is unknown, call the same tool again with the same arguments.
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PROMETHEUS_API_KEY` | For `create_avatar` / `set_avatar_state` / `equip_asset` / `get_avatar_status` / `speak` and all 7 workspace tools | Your `pak_` agent key — see [Requirements](#requirements) |
| `GEMINI_API_KEY` | For `generate_asset` | API key for asset generation |
| `OPENAI_API_KEY` | For `generate_image_pro` (BYOK) | Your image-provider API key for BYOK — without this, platform Free quota / Pro Credits routes apply |
| `PROMETHEUS_API_URL` | No | Custom API URL (default: `https://prometheus.mythslabs.ai`). Must be `https://` with no path (`http://` only for localhost) |
| `PROMETHEUS_MCP_STATE_DIR` | No | Where the workspace tools keep their small state files (default `~/.prometheus-mcp`). `off` keeps everything in memory, so an unconfirmed save is forgotten when the client restarts the server (for example after a key change) |

**What is stored on your machine:** the `workspace-state` folder inside it holds one small file per key with the account id behind it and, only while a save is unconfirmed (at most 24 hours), one small file per unconfirmed save with its operation id, entry id and timestamp, filed under your account so that a new key of the same account still finds it. It never contains your key (only a 16-character fingerprint of it), your text, titles or URLs; a file's name is a hash of the call, which could only confirm a guess of the exact text, never reveal it. Several MCP servers (for example Claude Desktop and Cursor) can use the same folder at once without erasing each other's entries. You can delete the folder at any time and the tools keep working. The one thing it guards against: if you delete it while a save is still unconfirmed, retrying that save can leave a duplicate entry, because the operation id that would have prevented it is gone.

## When something goes wrong

Every workspace error says what was wrong, whether anything was saved, and what to do next.

| You see | It means |
|---------|----------|
| `workspace_key_missing` / `workspace_key_rejected` | `PROMETHEUS_API_KEY` is unset, mistyped, or was revoked by generating a newer key. Once a working key is in place, repeat the same call: a save that was left unconfirmed is re-sent, not duplicated |
| `workspace_invalid_argument` with a `field` | The named argument is wrong (for example `due_on` must be a real date written `YYYY-MM-DD`); nothing was sent |
| `workspace_result_unconfirmed` | The connection dropped; it may or may not have been saved. Call again with the same arguments, which cannot duplicate |
| `workspace_browse_unavailable` | The website did not list the visited-pages category (`browse`) for this key; nothing saved, do not retry now |
| `workspace_category_full` | Work, To-do and Browse each hold at most 2,000 entries that are not archived; nothing saved, do not retry until you archive or delete some older entries |
| `workspace_lookup_timeout` | Looking for the task (or reading an entry back) took longer than 60 seconds; nothing was changed. Try once more later |
| `workspace_rate_limited` | The website is limiting how fast this key reads or writes; nothing was saved by that call. Wait the `retry_after_seconds` it gives, then send the same call again. If it answered the repeat of an unconfirmed save, `outcome` is `unknown_may_have_been_saved`: the earlier try may already be stored, and the same call re-sends it rather than adding a second entry |

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

> **User**: "Summarise this contract and keep it in Prometheus, and remind me to send it on Friday"
>
> **AI Agent** (using MCP):
> 1. Calls `save_work` with the summary → `{ "saved": true, "action": "created", "entry_id": "…" }`
> 2. Calls `upsert_task` with `text: "Send the contract summary"`, `due_on` set to Friday's date
> 3. Tells the user the summary is in the Work pane and the task is in the To-do pane (and that Prometheus does not send reminders)

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

---

<a id="中文文档"></a>

# 🇨🇳 中文文档

让任何 AI Agent 拥有一个 3D / 2.5D 虚拟形象（通过 [Model Context Protocol](https://modelcontextprotocol.io)），并且有地方存放它的产出：报告、代码、待办、访问过的网页，都会进入你在 [Prometheus](https://prometheus.mythslabs.ai) 的工作区。

```bash
npx @prometheusavatar/mcp-server
```

## 17 个工具

### 形象与市场（10 个）

| 工具 | 说明 |
|------|------|
| `create_avatar` | 创建虚拟形象（模型、声音、人设） |
| `set_avatar_state` | 推送伴侣状态（思考/行动/聆听/完成）和情绪到已打开的嵌入页，约 3 秒内生效 |
| `equip_asset` | 装备已购买的市场资产（皮肤、声音、特效等）；同类别会替换，Agent 账号暂不支持卸下 |
| `generate_asset` | 用文字提示词 AI 生成新资产（人设、表情、场景等） |
| `update_asset` | 修改已有市场资产的价格、名称、描述、标签或许可 |
| `generate_image_pro` | AAA 级图像生成（皮肤预览卡 / 海报 / UI 稿 / 小红书轮播）· 自带密钥 · 免费额度 · Pro 点数 |
| `list_marketplace` | 按类别浏览市场资产 |
| `get_avatar_status` | 查看当前形象状态和已装备资产 |
| `share_avatar` | 生成分享链接和嵌入代码 |
| `speak` | 让形象用 TTS 说话并同步口型 |

### 工作区（7 个）—— v0.3.6 新增

Agent 的产出会存到你的 Prometheus 账号，显示在工作区的窗格里。前四个是给模型用的：模型只需给最少的字段，条目 id、带毫秒的时间、账号请求头、来源等全部由本服务器补齐。

| 工具 | 作用 | 参数 |
|------|------|------|
| `save_work` | 把写好的成果（Markdown）存进「工作」窗格 | `content`（必填）· `title` · `external_key` |
| `upsert_task` | 在「待办」窗格新增或更新一条待办 | `text`（必填）· `due_on`（`YYYY-MM-DD`）· `external_key` · `done` |
| `complete_task` | 把一条待办标成完成 | `task_id` **或** `external_key` |
| `log_visited_page` | 记录 Agent 访问过的网页（「Agent 访问过的页面」） | `url`（只收 http/https，必填）· `title` |
| `prometheus_read_workspace` | 底层：读取条目（每页最多 5 条）和类别列表 | `category` · `cursor` · `limit` · `account_id` |
| `prometheus_save_workspace_entry` | 底层：逐字段精确写入一条 | `account_id` · `operation_id` · `entry` |
| `prometheus_get_workspace_operation` | 底层：按操作号查回执 | `account_id` · `operation_id` |

## 前置条件

- **Node.js 18.17 或更高**（推荐 Node 20 LTS 或 22）。用 `node -v` 检查。`npx` 随 Node 一起安装，不需要再装别的。
- 一把 Prometheus **Agent 密钥**（以 `pak_` 开头）。登录 [prometheus.mythslabs.ai/settings/agent-keys](https://prometheus.mythslabs.ai/settings/agent-keys)，点 **Generate key**。密钥**只显示一次**，而且**生成新密钥会让旧密钥立刻失效**——多个客户端请共用同一把，只有想替换时才重新生成。
- 下面配置里的 `PASTE_YOUR_AGENT_KEY_HERE` 只是占位符：换成你自己的密钥，不要提交到 git，不要发给别人。

## 配置

### Claude Desktop

打开配置文件（设置 → 开发者 → 编辑配置）：macOS 在 `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows 在 `%APPDATA%\Claude\claude_desktop_config.json`。加入下面内容，然后完全退出并重新打开 Claude Desktop：

```json
{
  "mcpServers": {
    "prometheus": {
      "command": "npx",
      "args": ["-y", "@prometheusavatar/mcp-server"],
      "env": {
        "PROMETHEUS_API_KEY": "PASTE_YOUR_AGENT_KEY_HERE"
      }
    }
  }
}
```

如果 Claude Desktop 提示启动不了，多半是找不到 Node：把 `which npx`（macOS/Linux）或 `where npx`（Windows）输出的完整路径填进 `"command"`。

### Claude Code

```bash
claude mcp add prometheus --env PROMETHEUS_API_KEY=PASTE_YOUR_AGENT_KEY_HERE -- npx -y @prometheusavatar/mcp-server
```

想让团队共用配置又不共用密钥：把下面内容放进项目的 `.mcp.json`，每个人在自己的 shell 里 `export PROMETHEUS_API_KEY`：

```json
{
  "mcpServers": {
    "prometheus": {
      "command": "npx",
      "args": ["-y", "@prometheusavatar/mcp-server"],
      "env": { "PROMETHEUS_API_KEY": "${PROMETHEUS_API_KEY}" }
    }
  }
}
```

### Cursor

加到 `~/.cursor/mcp.json`（所有项目）或 `.cursor/mcp.json`（当前项目，不要把密钥提交进去），然后重启 Cursor：

```json
{
  "mcpServers": {
    "prometheus": {
      "command": "npx",
      "args": ["-y", "@prometheusavatar/mcp-server"],
      "env": {
        "PROMETHEUS_API_KEY": "PASTE_YOUR_AGENT_KEY_HERE"
      }
    }
  }
}
```

### Windsurf / 其他 MCP 客户端

把 `npx -y @prometheusavatar/mcp-server` 作为 stdio 服务启动，并在它的环境变量里设置 `PROMETHEUS_API_KEY`。

## 三种写法：work、todo、browse

MCP 工具只有在模型决定调用时才会运行。所以要么你用话说出来（「把这个存到 Prometheus」「加一条明天到期的待办」），要么装一条常驻规则（见下一节），让它自己发生。

**work（成果）**——写好的文字或代码，以 Markdown 存进「工作」窗格：

```json
{ "content": "# Q3 计划\n\n| 目标 | 负责人 |\n|---|---|\n| 发布 v2 | Ana |", "title": "Q3 计划", "external_key": "q3-plan" }
```

**todo（待办）**——一句话，可带到期**日期**。没有具体时刻，也**没有提醒**：Prometheus 只保存待办，不会到点通知你：

```json
{ "text": "把发票发给 ACME", "due_on": "2026-10-15", "external_key": "invoice-acme-10" }
```

之后用 `{ "external_key": "invoice-acme-10" }` 调 `complete_task` 完成它。

**browse（访问过的页面）**——Agent 替你打开过的网页（只收 `http://` 和 `https://`；带用户名密码的地址会被拒绝）：

```json
{ "url": "https://example.com/pricing", "title": "价格页" }
```

「Agent 访问过的页面」就是网站的 `browse` 类别，prometheus.mythslabs.ai 已于 2026-10-19 上线。如果网站没有为你的密钥列出这个类别，`log_visited_page` 会用一段清楚的说明回答，并且什么都不保存；类别一旦列出它会自动生效，你这边不用更新。

### 不会重复

- **`external_key`** 是同一件事永远不变的标签（如 `"weekly-report-2026-10-14"`）。条目 id 由它推出，所以用同一个 key 再次调用 `save_work` 或 `upsert_task`，是**更新那一条**而不是再加一条——换机器、换会话都一样。不给 key 时，每次成功的调用都会新增一条。
- **保存途中断网**（或保存途中密钥失效）：工具会说明结果未知，并让模型用相同参数再调一次。操作号会记住 24 小时（内存里和一个小文件里，见下），按你的 Prometheus 账户记、不按密钥记，所以即使你换了新密钥，重试发送的仍是同一个操作，Prometheus 返回原来的结果：一条，不会两条。超过 24 小时、或状态文件夹被删之后再重试，算作一次新的保存。
- 没给 `external_key` 时，两分钟内完全相同的调用刚成功过，会直接用内存里的结果回答（MCP 客户端有时会对已经完成的调用超时重试）。
- 如果同一条正好在别处被编辑（409 版本冲突），服务器会读回最新版本再试一次。

## 常驻规则：不用开口也会存

把对应的一段粘贴一次即可。三段说的是同一件事，放在各家会读到的位置。

**Claude Code**——加到项目的 `CLAUDE.md`（或 `~/.claude/CLAUDE.md`，对所有项目生效）：

```markdown
## Prometheus 工作区
- 完成我会想留着的东西（报告、文档、分析、计划、你写的代码的最终文本）时，用 `save_work` 存起来：完整 Markdown 放在 `content`；之后可能修改的话给一个稳定的 `external_key`。
- 我让你记一件事，或你留下后续事项时，用 `upsert_task`（`text`，有日期就给 `due_on`，格式 YYYY-MM-DD）。没有提醒功能，不要许诺会提醒。做完的用 `complete_task` 标记。
- 打开了对任务重要的网页，用 `log_visited_page` 记录。
- 只有工具结果里是 `saved: true` 才能告诉我已保存。结果说明结果未知时，用相同参数再调一次同一个工具。
```

**Cursor**——新建 `.cursor/rules/prometheus.mdc`：

```markdown
---
description: 把完成的成果、待办和访问过的网页存到 Prometheus 工作区
alwaysApply: true
---
- 完成用户会想留着的成果（报告、文档、分析、计划）时，调用 `save_work` MCP 工具，完整 Markdown 放 `content`（之后可能修改就加一个稳定的 `external_key`）。
- 用户让你记一件事或你留下后续事项时，调用 `upsert_task`（`text`，有日期就给 `due_on`，格式 YYYY-MM-DD）。Prometheus 没有提醒功能，不要许诺提醒。完成用 `complete_task`。
- 打开了对任务重要的网页，调用 `log_visited_page`。
- 只有结果里有 `saved: true` 才说已保存。结果未知时，用相同参数再调一次同一个工具。
```

**Claude Desktop**——在项目（Project）里选 **Set project instructions**，粘贴：

```text
你有 Prometheus 工具。完成我会想留着的东西（报告、文档、分析、计划）时，用 save_work 存起来：完整 Markdown 放在 "content"，之后可能修改就加一个稳定的 "external_key"。我让你记一件事或你留下后续事项时，用 upsert_task（text；有日期就给 due_on，格式 YYYY-MM-DD；没有提醒功能，所以不要许诺会提醒），做完的用 complete_task 标记。打开了对任务重要的网页，用 log_visited_page 记录。只有工具结果里是 saved: true 才告诉我已保存；结果说明结果未知时，用相同参数再调一次同一个工具。
```

## 环境变量

| 变量 | 是否必需 | 说明 |
|------|----------|------|
| `PROMETHEUS_API_KEY` | `create_avatar` / `set_avatar_state` / `equip_asset` / `get_avatar_status` / `speak` 以及全部 7 个工作区工具需要 | 你的 `pak_` Agent 密钥，见[前置条件](#前置条件) |
| `GEMINI_API_KEY` | `generate_asset` 需要 | 资产生成用的 API 密钥 |
| `OPENAI_API_KEY` | `generate_image_pro`（自带密钥）需要 | 自带图像服务密钥；不填则走平台免费额度 / Pro 点数 |
| `PROMETHEUS_API_URL` | 否 | 自定义 API 地址（默认 `https://prometheus.mythslabs.ai`）。必须是不带路径的 `https://`（只有本机地址允许 `http://`） |
| `PROMETHEUS_MCP_STATE_DIR` | 否 | 工作区工具的小状态文件放哪个文件夹（默认 `~/.prometheus-mcp`）。填 `off` 则只放内存，客户端重启 MCP 服务（例如换密钥后）时，未确认的保存就记不住了 |

**本机存了什么：** 该文件夹里的 `workspace-state` 子文件夹放着几个很小的文件：每把密钥一个，记着它对应的账户号；另外，只在「保存结果尚未确认」期间（最多 24 小时），每一次未确认的保存各有一个文件，记着它的操作号、条目号和时间，按账户归档，所以同一账户换了新密钥也找得到。里面没有你的密钥（只有密钥的 16 位指纹）、没有你的文字、标题或网址；文件名是这次调用的哈希，最多只能用来核对「是不是某段一模一样的文字」，无法还原出内容。多个 MCP 服务（例如 Claude Desktop 和 Cursor）可以同时用同一个文件夹，不会互相覆盖。随时可以删掉这个文件夹，工具照常工作；只有一种情况会受影响：某次保存还没有确认时你把它删了，之后重试这次保存，可能多出一条重复的条目，因为本来用来防重复的操作号已经没了。

## 出错时

工作区的每个错误都会说清：哪里不对、有没有保存、下一步怎么做。

| 你看到 | 含义 |
|--------|------|
| `workspace_key_missing` / `workspace_key_rejected` | `PROMETHEUS_API_KEY` 没设、填错了，或被后来生成的新密钥作废了。换上能用的密钥后，原样重试即可：之前未确认的那次保存会被重新发送，不会重复 |
| `workspace_invalid_argument` 并带 `field` | 指出的那个参数不对（例如 `due_on` 必须是真实日期，写成 `YYYY-MM-DD`）；什么都没发出去 |
| `workspace_result_unconfirmed` | 连接断了，不知道有没有存上。用相同参数再调一次，不会重复 |
| `workspace_browse_unavailable` | 网站没有为这把密钥列出「访问过的页面」类别（`browse`）；没有保存，现在不要重试 |
| `workspace_category_full` | Work、To-do、Browse 每类最多 2,000 条未归档条目；没有保存，先归档或删掉一些旧条目再试，不要直接重试 |
| `workspace_lookup_timeout` | 查找那条待办（或把条目读回来）超过 60 秒；什么都没改。稍后再试一次 |
| `workspace_rate_limited` | 网站在限制这把密钥的读写频率，这次调用什么都没存；等它给的 `retry_after_seconds` 秒后原样再调。如果被限的是一次「未确认保存」的重试，`outcome` 会是 `unknown_may_have_been_saved`：之前那次可能已经存上，原样再调只会重发那一次，不会多出一条 |

## 对话示例

> **用户**：「帮我总结这份合同，存到 Prometheus，周五提醒我发出去」
>
> **AI Agent**（通过 MCP）：
> 1. 调用 `save_work` 存入总结 → `{ "saved": true, "action": "created", "entry_id": "…" }`
> 2. 调用 `upsert_task`：`text: "发送合同总结"`，`due_on` 填周五的日期
> 3. 告诉用户：总结在「工作」窗格，待办在「待办」窗格（并说明 Prometheus 不会发提醒）

## 链接

- **平台**：[prometheus.mythslabs.ai](https://prometheus.mythslabs.ai)
- **SDK**：`npm i @prometheusavatar/core`
- **GitHub**：[myths-labs/prometheus-avatar](https://github.com/myths-labs/prometheus-avatar)

## 许可证

MIT — [Myths Labs](https://mythslabs.ai)
