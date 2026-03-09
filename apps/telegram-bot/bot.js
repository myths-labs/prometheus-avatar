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
        `Welcome to Prometheus — give your AI an embodied avatar with voice and expressions.\n` +
        `Tap below to start talking! 🚀`,
        { reply_markup: keyboard }
    );
});

// ─── /help command ───
bot.command("help", async (ctx) => {
    await ctx.reply(
        "🎭 *Prometheus Avatar*\n\n" +
        "Commands:\n" +
        "/start — Open the avatar interface\n" +
        "/help — Show this help\n\n" +
        "Tap the button to talk with your AI avatar!",
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
