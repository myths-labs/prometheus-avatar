# GitHub OAuth 设置教程（小学生版）

## 第 1 步：打开 GitHub Developer Settings

1. 登录你的 GitHub 账号
2. 点右上角头像 → **Settings**
3. 左侧最底部 → **Developer settings**
4. 左侧 → **OAuth Apps**
5. 点 **New OAuth App**

## 第 2 步：填写信息

| 字段 | 填什么 |
|------|--------|
| **Application name** | `Prometheus Avatar` |
| **Homepage URL** | `https://prometheus.mythslabs.ai` |
| **Authorization callback URL** | `https://prometheus.mythslabs.ai/api/auth/callback/github` |

> 填完点 **Register application**

## 第 3 步：获取密钥

注册完会看到两个值：
- **Client ID** → 复制保存（类似 `Ov23lixxx...`）
- **Client Secret** → 点 **Generate a new client secret** → 复制保存

⚠️ **Client Secret 只显示一次！立刻复制保存！**

## 第 4 步：告诉我

把这两个值告诉我：
```
GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_SECRET=xxx...
```

我会添加到 Vercel 环境变量里并部署代码。

---

# Google OAuth 设置教程

## 第 1 步：打开 Google Cloud Console

1. 打开 https://console.cloud.google.com
2. 选择或创建一个项目（比如 `Prometheus Avatar`）

## 第 2 步：启用 API

1. 左上角菜单 → **APIs & Services** → **Library**
2. 搜 **Google Identity** 或 **Google+ API**
3. 点进去 → **Enable**

## 第 3 步：创建凭证

1. 左侧 → **Credentials**
2. 点 **+ CREATE CREDENTIALS** → **OAuth client ID**
3. 如果没配过 OAuth consent screen：
   - 点 **Configure Consent Screen**
   - 选 **External** → Create
   - App name: `Prometheus Avatar`
   - User support email: 你的邮箱
   - Developer email: 你的邮箱
   - 其他都跳过 → **Save**
4. 回到 Credentials → **+ CREATE CREDENTIALS** → **OAuth client ID**
5. Application type: **Web application**
6. Name: `Prometheus Web`
7. Authorized redirect URIs → **+ ADD URI**:
   ```
   https://prometheus.mythslabs.ai/api/auth/callback/google
   ```
8. 点 **Create**

## 第 4 步：获取密钥

创建完会弹出窗口：
- **Client ID** → 复制（类似 `xxx.apps.googleusercontent.com`）
- **Client Secret** → 复制

## 第 5 步：告诉我

```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOxxx...
```
