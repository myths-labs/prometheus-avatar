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

### 第 5 步：设置 Interactions Endpoint

1. 回到 **「General Information」**
2. **INTERACTIONS ENDPOINT URL** 填：
   ```
   https://prometheus.mythslabs.ai/api/messaging/discord
   ```
3. 点 **Save Changes**（Discord 会发一个 PING 验证，我们的代码已经处理了）

### 第 6 步：Vercel 添加环境变量

1. 打开 [Vercel Dashboard](https://vercel.com) → 进 `prometheus-avatar` 项目
2. **Settings** → **Environment Variables**
3. 添加：

   | Key | Value |
   |-----|-------|
   | `DISCORD_PUBLIC_KEY` | 第 2 步复制的 Public Key |

4. 点 **Save** → **Redeploy**（Settings → Deployments → 最新的 → ⋯ → Redeploy）

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

## 📖 LINE Bot 配置

### 第 1 步：注册 LINE Developers

1. 打开 [LINE Developers Console](https://developers.line.biz/console/)
2. 用你的 LINE 账号登录
3. 如果没有 Provider，点 **「Create」** 新建一个（名字填 `Myths Labs`）

### 第 2 步：创建 Messaging API Channel

1. 点你的 Provider → **「Create a new channel」**
2. 选 **「Messaging API」**
3. 填写信息：
   - **Channel name**: `Prometheus Avatar`
   - **Channel description**: `AI Avatar with voice & marketplace`
   - **Category**: `Web services`
   - **Subcategory**: `Web services (general)`
4. 同意条款 → **Create**

### 第 3 步：拿到 Channel Access Token

1. 进入你的 Channel → 点顶部 **「Messaging API」** tab
2. 滚到最底部 → **Channel access token** → 点 **「Issue」**
3. 复制这个超长的 token

### 第 4 步：设置 Webhook

1. 还是 **「Messaging API」** tab
2. **Webhook URL** 填：
   ```
   https://prometheus.mythslabs.ai/api/messaging/webhook
   ```
3. 点 **Update** → 点 **Verify**（应该显示 Success）
4. **Use webhook** 开关打开 ✅
5. **Auto-reply messages** 关掉 ❌（不然 LINE 自带的自动回复会和我们的 AI 冲突）

### 第 5 步：Vercel 添加环境变量

1. 打开 [Vercel Dashboard](https://vercel.com) → 进 `prometheus-avatar` 项目
2. **Settings** → **Environment Variables**
3. 添加：

   | Key | Value |
   |-----|-------|
   | `LINE_CHANNEL_ACCESS_TOKEN` | 第 3 步复制的 token |

4. 点 **Save** → **Redeploy**

### 第 6 步：加好友测试

1. 回到 LINE Developers → **「Messaging API」** tab
2. 找到 **Bot basic ID** 或扫 **QR code**
3. 用 LINE app 加好友
4. 发一条消息 → 应该收到 AI 回复 + Avatar / Marketplace 按钮

### ✅ 完成！

用户加你的 LINE Bot 好友后，直接发消息就能和 Avatar AI 聊天。

---

## 🔑 环境变量速查

| 变量 | 平台 | 在哪拿 |
|------|------|--------|
| `DISCORD_PUBLIC_KEY` | Discord | Developer Portal → Application → General → PUBLIC KEY |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE | Developers Console → Channel → Messaging API → Issue token |

> 都填到 **Vercel → Settings → Environment Variables** 然后 Redeploy。
