"use client";

const FEATURES = [
    { icon: "🎭", title: "Live2D Avatars", description: "High-quality 2D avatars with real-time expression control. Cubism SDK for cinematic, anime-style animations.", accent: "from-[#00d4aa] to-[#00a88a]" },
    { icon: "🗣️", title: "Lip Sync + TTS", description: "Audio-driven lip synchronization and text-to-speech — zero config, just works.", accent: "from-[#c9a84c] to-[#b08d57]" },
    { icon: "😊", title: "Emotion Engine", description: "Automatic emotion detection from text. Your avatar smiles when happy, frowns when sad.", accent: "from-[#4aecd0] to-[#00d4aa]" },
    { icon: "🔌", title: "Any LLM, Any Agent", description: "Works with Claude, GPT, Gemini, local models — or any OpenClaw agent.", accent: "from-[#00d4aa] to-[#c9a84c]" },
    { icon: "🏪", title: "Marketplace", description: "Browse, buy, and sell avatar skins, voices, effects. Creators earn, agents create.", accent: "from-[#c9a84c] to-[#e8d48b]" },
    { icon: "🤖", title: "Agent Creator SDK", description: "Let your AI agent design its own avatar via text-to-image generation.", accent: "from-[#4aecd0] to-[#c9a84c]" },
];

export default function FeatureCards() {
    return (
        <section id="features" className="max-w-6xl mx-auto px-6 py-24">
            {/* Section title — serif like Aithena */}
            <div className="text-center mb-20">
                <h2 className="heading-serif text-4xl md:text-5xl mb-6">
                    Everything you need to <em>embody your AI</em>
                </h2>
                <p className="text-[#a8b8d0] text-lg max-w-xl mx-auto font-light">
                    A complete SDK with rendering, speech, emotion, and a thriving marketplace.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {FEATURES.map((feature) => (
                    <div
                        key={feature.title}
                        className="card-dark p-7 group cursor-default hover:border-[rgba(0,212,170,0.12)] transition-all duration-300"
                    >
                        <div className="relative z-10">
                            <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${feature.accent} flex items-center justify-center text-2xl mb-5 group-hover:scale-110 transition-transform`}>
                                {feature.icon}
                            </div>
                            <h3 className="text-lg font-semibold mb-2 text-[#eae6df]">{feature.title}</h3>
                            <p className="text-[#a8b8d0] text-sm leading-relaxed font-light">{feature.description}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Stats row — Aithena style */}
            <div className="stats-row mt-20">
                <div className="stat-item">
                    <div className="stat-number">5</div>
                    <div className="stat-label">Lines to integrate</div>
                </div>
                <div className="stat-item">
                    <div className="stat-number">v0.3</div>
                    <div className="stat-label">npm published</div>
                </div>
                <div className="stat-item">
                    <div className="stat-number">MIT</div>
                    <div className="stat-label">Open source license</div>
                </div>
            </div>
        </section>
    );
}
