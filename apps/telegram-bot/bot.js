const { Bot, InlineKeyboard } = require("grammy");

// ─── Configuration ───
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || "https://prometheus.mythslabs.ai/telegram";

if (!BOT_TOKEN) {
    console.error("❌ Set TELEGRAM_BOT_TOKEN environment variable");
    console.log("   1. Message @BotFather on Telegram");
    console.log("   2. Send /newbot and follow instructions");
    console.log("   3. Copy the token and set it: export TELEGRAM_BOT_TOKEN=your_token");
    process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ─── /start command ───
bot.command("start", async (ctx) => {
    const userName = ctx.from?.first_name || "there";

    const keyboard = new InlineKeyboard().webApp(
        "🎭 Open Avatar Chat",
        MINI_APP_URL
    );

    await ctx.reply(
        `Hey ${userName}! 👋\n\n` +
        `I'm Prometheus — your AI avatar companion.\n` +
        `Tap the button below to start chatting with me! 🚀`,
        { reply_markup: keyboard }
    );
});

// ─── /help command ───
bot.command("help", async (ctx) => {
    await ctx.reply(
        "🎭 *Prometheus Avatar Bot*\n\n" +
        "Commands:\n" +
        "/start — Open the avatar chat\n" +
        "/help — Show this help\n\n" +
        "Just tap the button to chat with your AI avatar companion!",
        { parse_mode: "Markdown" }
    );
});

// ─── Handle any text message ───
bot.on("message:text", async (ctx) => {
    const keyboard = new InlineKeyboard().webApp(
        "🎭 Chat with Avatar",
        MINI_APP_URL
    );

    await ctx.reply(
        "Tap the button to open the avatar chat! 💬",
        { reply_markup: keyboard }
    );
});

// ─── Start bot ───
bot.start();
console.log("🤖 Prometheus Telegram Bot is running!");
console.log(`📱 Mini App URL: ${MINI_APP_URL}`);
