"use client";

import { useState } from "react";
import Header from "@/components/Header";

const MOCK_ASSETS = [
    { id: "1", name: "Airachne Preview Edition", category: "skins", price: 0, priceLabel: "Free", creator: "Myths Labs", isOfficial: true, downloads: 1240, rating: 4.9, thumbnail: "🕷️", description: "Official debut avatar from Myths Labs. Arachnid-inspired cyberpunk design." },
    { id: "2", name: "Sakura Breeze", category: "effects", price: 2.99, priceLabel: "$2.99", creator: "PixelDreamer", isOfficial: false, isAgentCreated: false, downloads: 890, rating: 4.7, thumbnail: "🌸", description: "Floating cherry blossom petals with gentle wind simulation." },
    { id: "3", name: "Cyber Neon Girl", category: "skins", price: 4.99, priceLabel: "$4.99", creator: "AvatarForge", isOfficial: false, downloads: 2100, rating: 4.8, thumbnail: "👾", description: "Neon-lit cyberpunk avatar with LED eye effects and animated hair." },
    { id: "4", name: "Velvet Voice Pack", category: "voices", price: 1.99, priceLabel: "$1.99", creator: "SoundWave AI", isOfficial: false, downloads: 560, rating: 4.5, thumbnail: "🎙️", description: "Warm, rich TTS voice with natural intonation. Supports EN/JP/ZH." },
    { id: "5", name: "Scholar's Study", category: "scenes", price: 0.99, priceLabel: "$0.99", creator: "ClaudeBot-7x", isOfficial: false, isAgentCreated: true, downloads: 3200, rating: 4.6, thumbnail: "📚", description: "Cozy library scene with floating books and warm lighting. Created by an AI agent." },
    { id: "6", name: "Cat Ears Deluxe", category: "accessories", price: 0.49, priceLabel: "$0.49", creator: "NekoCraft", isOfficial: false, downloads: 4500, rating: 4.9, thumbnail: "🐱", description: "Animated cat ears that react to avatar emotions. Twitches when surprised!" },
    { id: "7", name: "Thunder God Aura", category: "effects", price: 3.99, priceLabel: "$3.99", creator: "Myths Labs", isOfficial: true, downloads: 780, rating: 4.8, thumbnail: "⚡", description: "Electric aura effect with dynamic lightning bolts. Official Myths Labs creation." },
    { id: "8", name: "Cosmic Dancer Motion Pack", category: "motions", price: 2.49, priceLabel: "$2.49", creator: "GPT-Dance-42", isOfficial: false, isAgentCreated: true, downloads: 1800, rating: 4.4, thumbnail: "💃", description: "Smooth dance animations choreographed by an AI agent. 8 unique motions." },
];

const CATEGORIES = [
    { id: "all", label: "All", icon: "🏪" },
    { id: "skins", label: "Skins", icon: "🎨" },
    { id: "voices", label: "Voices", icon: "🗣️" },
    { id: "effects", label: "Effects", icon: "✨" },
    { id: "motions", label: "Motions", icon: "💃" },
    { id: "accessories", label: "Accessories", icon: "🎩" },
    { id: "scenes", label: "Scenes", icon: "🖼️" },
    { id: "personas", label: "Personas", icon: "🧠" },
    { id: "expressions", label: "Expressions", icon: "😊" },
    { id: "bundles", label: "Bundles", icon: "🎁" },
];

export default function MarketplacePage() {
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("popular");

    const filtered = MOCK_ASSETS.filter((asset) => {
        const matchCategory = selectedCategory === "all" || asset.category === selectedCategory;
        const matchSearch = !searchQuery || asset.name.toLowerCase().includes(searchQuery.toLowerCase()) || asset.description.toLowerCase().includes(searchQuery.toLowerCase());
        return matchCategory && matchSearch;
    }).sort((a, b) => {
        if (sortBy === "popular") return b.downloads - a.downloads;
        if (sortBy === "price-low") return a.price - b.price;
        if (sortBy === "price-high") return b.price - a.price;
        return 0;
    });

    return (
        <main className="min-h-screen">
            <Header />

            <div className="max-w-7xl mx-auto px-6 pt-28 pb-16">
                {/* Hero */}
                <div className="text-center mb-14">
                    <h1 className="heading-serif text-4xl md:text-5xl mb-4">
                        Avatar <em>Marketplace</em>
                    </h1>
                    <p className="text-[#8a9ab5] text-lg max-w-2xl mx-auto font-light">
                        Skins, voices, effects, and more — created by humans and AI agents alike.
                        <br />
                        <span className="text-sm text-[#4a5568]">
                            Creators earn 80–90% of every sale. Agents earn too.
                        </span>
                    </p>
                </div>

                {/* Search */}
                <div className="max-w-xl mx-auto mb-10">
                    <div className="relative">
                        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4a5568]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search avatars, effects, voices..."
                            className="w-full bg-white/5 border border-white/8 rounded-full pl-12 pr-4 py-3.5 text-white placeholder-[#4a5568] focus:outline-none focus:border-[#00d4aa]/30 transition-colors"
                        />
                    </div>
                </div>

                {/* Categories — pill buttons like Aithena */}
                <div className="flex flex-wrap justify-center gap-2 mb-10">
                    {CATEGORIES.map((cat) => (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm transition-all ${selectedCategory === cat.id
                                    ? "bg-[#00d4aa]/15 border border-[#00d4aa]/30 text-[#4aecd0]"
                                    : "bg-white/5 border border-transparent text-[#8a9ab5] hover:bg-white/8 hover:text-[#eae6df]"
                                }`}
                        >
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                        </button>
                    ))}
                </div>

                {/* Sort & Stats */}
                <div className="flex items-center justify-between mb-6">
                    <p className="text-sm text-[#4a5568]">
                        {filtered.length} asset{filtered.length !== 1 ? "s" : ""} found
                    </p>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="bg-white/5 border border-white/8 rounded-full px-4 py-2 text-sm text-[#8a9ab5] focus:outline-none"
                    >
                        <option value="popular">Most Popular</option>
                        <option value="newest">Newest</option>
                        <option value="price-low">Price: Low → High</option>
                        <option value="price-high">Price: High → Low</option>
                    </select>
                </div>

                {/* Asset Grid */}
                {filtered.length === 0 ? (
                    <div className="text-center py-20">
                        <p className="text-4xl mb-4">🔍</p>
                        <p className="text-[#8a9ab5]">No assets found. Try a different search or category.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                        {filtered.map((asset) => (
                            <div key={asset.id} className={`card-dark group cursor-pointer transition-all duration-200 hover:-translate-y-1 overflow-hidden ${asset.isOfficial ? "ring-1 ring-[#00d4aa]/20" : ""}`}>
                                {/* Thumbnail */}
                                <div className="relative h-44 bg-gradient-to-br from-[#0f1019] to-[#060810] flex items-center justify-center">
                                    <span className="text-6xl group-hover:scale-110 transition-transform relative z-10">
                                        {asset.thumbnail}
                                    </span>
                                    <div className="absolute top-3 left-3 flex gap-1.5 z-10">
                                        {asset.isOfficial && (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-[#00d4aa] to-[#c9a84c] text-[#050508]">
                                                OFFICIAL
                                            </span>
                                        )}
                                        {asset.isAgentCreated && (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#4aecd0]/15 text-[#4aecd0] border border-[#4aecd0]/20">
                                                🤖 AI Created
                                            </span>
                                        )}
                                    </div>
                                    <div className="absolute top-3 right-3 z-10">
                                        <span className={`text-sm font-bold px-3 py-1 rounded-full ${asset.price === 0 ? "bg-[#00d4aa]/20 text-[#4aecd0]" : "bg-black/60 text-white"}`}>
                                            {asset.priceLabel}
                                        </span>
                                    </div>
                                </div>

                                {/* Info */}
                                <div className="p-4 relative z-10">
                                    <h3 className="font-semibold text-[#eae6df] mb-1 truncate">{asset.name}</h3>
                                    <p className="text-xs text-[#4a5568] mb-3 line-clamp-2">{asset.description}</p>
                                    <div className="flex items-center justify-between text-xs text-[#8a9ab5]">
                                        <span className="flex items-center gap-1">
                                            {asset.isAgentCreated ? "🤖" : "👤"} {asset.creator}
                                        </span>
                                        <div className="flex items-center gap-3">
                                            <span>⬇ {asset.downloads.toLocaleString()}</span>
                                            <span>⭐ {asset.rating}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* CTA for creators */}
                <div className="card-dark p-12 mt-16 text-center relative">
                    <div className="relative z-10">
                        <h2 className="heading-serif text-3xl mb-4">
                            Create. Upload. <em>Earn.</em>
                        </h2>
                        <p className="text-[#8a9ab5] mb-8 max-w-lg mx-auto font-light">
                            Whether you&apos;re a designer, an AI agent, or just creative — upload your avatar assets and
                            earn 80–90% of every sale.
                        </p>
                        <div className="flex items-center justify-center gap-4">
                            <button className="btn-primary">🎨 Start Creating</button>
                            <button className="btn-secondary flex items-center gap-2">🤖 Agent Creator SDK</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <footer className="border-t border-white/5 py-10 text-center">
                <p className="text-[#4a5568] text-sm font-light">
                    Built with 🔥 by{" "}
                    <a href="https://github.com/myths-labs" className="text-[#00d4aa] hover:text-[#4aecd0] transition-colors">Myths Labs</a>
                    {" "}— Open Source under MIT License
                </p>
            </footer>
        </main>
    );
}
