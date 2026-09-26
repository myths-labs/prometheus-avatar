# 🤖 Bot 配置教程（小学生版）

> 代码已经写好了，你只需要去平台注册 → 拿到 Key → 填到 Vercel 环境变量 → 完事。

---

## 📖 Discord Bot 配置

### 第 1 步：创建 Discord Application

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)
2. 点右上角 **「New Application」**
3. 名字填 `Prometheus Avatar`，点 **Create**

### 第 2 步：拿到 Public Key

1. 进入你刚创建的 Application
2. 左边点 **「General Information」**
3. 找到 **PUBLIC KEY**，复制它（一长串十六进制字符）

### 第 3 步：创建 Bot 用户

1. 左边点 **「Bot」**
2. 点 **「Add Bot」** → **「Yes, do it!」**
3. 可以改个头像和名字

### 第 4 步：注册 Slash Commands

1. 左边点 **「OAuth2」** → **「URL Generator」**
2. Scopes 勾选：`bot` + `applications.commands`
3. Bot Permissions 勾选：`Send Messages` + `Use Slash Commands` + `Embed Links`
4. 复制底部生成的 URL → 浏览器打开 → 选你的服务器 → 邀请

### 第 5 步：Vercel 添加环境变量

1. 打开 [Vercel Dashboard](https://vercel.com) → 进 `prometheus-avatar` 项目
2. **Settings** → **Environment Variables**
3. 添加：

   | Key | Value |
   |-----|-------|
   | `DISCORD_PUBLIC_KEY` | 第 2 步复制的 Public Key |

4. 点 **Save** → **Redeploy**（Settings → Deployments → 最新的 → ⋯ → Redeploy）

> ⚠️ 一定要先做这一步再做第 6 步。没配 `DISCORD_PUBLIC_KEY` 时接口对所有请求都返回 503，Discord 保存 Endpoint 会失败。

### 第 6 步：设置 Interactions Endpoint

1. 回到 **「General Information」**
2. **INTERACTIONS ENDPOINT URL** 填：
   ```
   https://prometheus.mythslabs.ai/api/messaging/discord
   ```
3. 点 **Save Changes**（Discord 会发 PING，并故意发几条签名错误的请求，我们的代码会回 401，验证才能通过）

### 第 7 步：注册 Slash Commands（一次性）

在终端运行（把 `YOUR_BOT_TOKEN` 和 `YOUR_APP_ID` 换成你的）：

```bash
curl -X PUT \
  "https://discord.com/api/v10/applications/YOUR_APP_ID/commands" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"name":"avatar","description":"Launch your Prometheus Avatar","type":1},
    {"name":"speak","description":"Make your avatar speak","type":1,"options":[{"name":"text","description":"What to say","type":3,"required":true}]},
    {"name":"marketplace","description":"Browse the avatar marketplace","type":1}
  ]'
```

### ✅ 完成！

用户在你的 Discord 服务器里输入 `/avatar`、`/speak hello`、`/marketplace` 就能用了。

---

## 📖 Telegram Bot 配置

### 第 1 步：拿到 Bot Token

1. 在 Telegram 里找 [@BotFather](https://t.me/BotFather)
2. 发 `/newbot`，按提示起名字
3. 复制它给你的 token（形如 `123456:ABC...`）

### 第 2 步：生成 Webhook Secret

在终端运行，复制输出的那串字符：

```bash
openssl rand -hex 32
```

Telegram 每次推送都会在 `X-Telegram-Bot-Api-Secret-Token` 头里带上它，我们的代码靠它确认请求真的来自 Telegram。

### 第 3 步：Vercel 添加环境变量

1. 打开 [Vercel Dashboard](https://vercel.com) → 进 `prometheus-avatar` 项目
2. **Settings** → **Environment Variables**
3. 添加：

   | Key | Value |
   |-----|-------|
   | `TELEGRAM_BOT_TOKEN` | 第 1 步的 token |
   | `TELEGRAM_WEBHOOK_SECRET` | 第 2 步生成的 secret |

4. 点 **Save** → **Redeploy**

> 没配 `TELEGRAM_WEBHOOK_SECRET` 时接口返回 503；secret 对不上返回 401，都不会处理消息。

### 第 4 步：注册 Webhook（一次性）

在终端运行（把 `YOUR_BOT_TOKEN` 和 `YOUR_WEBHOOK_SECRET` 换成你的）：

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -d "url=https://prometheus.mythslabs.ai/api/telegram/webhook" \
  -d "secret_token=YOUR_WEBHOOK_SECRET"
```

以后换 secret，Vercel 和 `setWebhook` 两边都要改；中间对不上的那几条推送，Telegram 会自动重试。

### ✅ 完成！

用户给 bot 发 `/start` 就能看到 Avatar 和 Marketplace 按钮，发普通消息会收到 AI 回复。

> LINE / WhatsApp 目前没有接入。原来的 `/api/messaging/webhook` 已下线：它解析不了 LINE 的推送格式，也不校验签名。

---

## 🔑 环境变量速查

| 变量 | 平台 | 在哪拿 |
|------|------|--------|
| `DISCORD_PUBLIC_KEY` | Discord | Developer Portal → Application → General → PUBLIC KEY |
| `TELEGRAM_BOT_TOKEN` | Telegram | @BotFather → `/newbot` |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram | 自己生成：`openssl rand -hex 32` |

> 都填到 **Vercel → Settings → Environment Variables** 然后 Redeploy。
