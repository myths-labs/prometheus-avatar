# Prometheus Telegram Bot

A simple Telegram bot that opens the Prometheus Avatar as a Mini App.

## Setup

### 1. Create a bot with @BotFather

1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Follow instructions (name: "Prometheus Avatar", username: something like `prometheus_avatar_bot`)
4. Copy the API token

### 2. Configure Web App URL

Tell BotFather about your Mini App:
1. Send `/mybots` to @BotFather
2. Select your bot → Bot Settings → Menu Button → Edit Menu Button URL
3. Set URL to: `https://prometheus.mythslabs.ai/telegram`

### 3. Run the bot

```bash
export TELEGRAM_BOT_TOKEN=your_token_here
cd apps/telegram-bot
npm install
npm start
```

### 4. Test

1. Open Telegram
2. Search for your bot
3. Send `/start`
4. Tap "🎭 Open Avatar Chat"
5. Avatar appears inside Telegram!

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `MINI_APP_URL` | ❌ | Default: `https://prometheus.mythslabs.ai/telegram` |
