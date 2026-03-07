"use client";

const FEATURES = [
    {
        icon: "🎭",
        title: "Live2D Avatars",
        description: "High-quality 2D avatars with real-time expression control. Cubism SDK for smooth, anime-style animations.",
        gradient: "from-purple-500 to-indigo-500",
    },
    {
        icon: "🗣️",
        title: "Lip Sync + TTS",
        description: "Audio-driven lip synchronization and text-to-speech out of the box. Zero config, just works.",
        gradient: "from-pink-500 to-rose-500",
    },
    {
        icon: "😊",
        title: "Emotion Engine",
        description: "Automatic emotion detection from text. Your avatar smiles when happy, frowns when sad, gasps when surprised.",
        gradient: "from-amber-500 to-orange-500",
    },
    {
        icon: "🔌",
        title: "Any LLM, Any Agent",
        description: "Works with Claude, GPT, Gemini, local models — or any OpenClaw agent. Pluggable architecture.",
        gradient: "from-emerald-500 to-teal-500",
    },
    {
        icon: "🏪",
        title: "Marketplace",
        description: "Browse, buy, and sell avatar skins, voices, effects, and accessories. Creators earn, agents create.",
        gradient: "from-blue-500 to-cyan-500",
    },
    {
        icon: "🤖",
        title: "Agent Creator SDK",
        description: "Let your AI agent design its own avatar. Text-to-image generation + reference-based remix. Millions of agents = millions of assets.",
        gradient: "from-violet-500 to-purple-500",
    },
];

export default function FeatureCards() {
    return (
        <section id="features" className="max-w-7xl mx-auto px-6 py-20">
            <div className="text-center mb-16">
                <h2 className="text-3xl md:text-4xl font-bold mb-4">
                    Everything you need to{" "}
                    <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                        embody your AI
                    </span>
                </h2>
                <p className="text-gray-400 text-lg max-w-2xl mx-auto">
                    A complete SDK with rendering, speech, emotion, and a thriving marketplace — all open source.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {FEATURES.map((feature) => (
                    <div
                        key={feature.title}
                        className="glass p-6 hover:bg-white/[0.06] transition-all duration-300 group cursor-default"
                    >
                        <div
                            className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform`}
                        >
                            {feature.icon}
                        </div>
                        <h3 className="text-lg font-semibold mb-2 text-white">
                            {feature.title}
                        </h3>
                        <p className="text-gray-400 text-sm leading-relaxed">
                            {feature.description}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
}
