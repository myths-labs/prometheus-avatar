"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import { supabase, type Asset, type Creator } from "@/lib/supabase";

const CATEGORIES = [
    { id: "all", label: "🏠 All" },
    { id: "skins", label: "🎨 Skins" },
    { id: "voices", label: "🎤 Voices" },
    { id: "effects", label: "✨ Effects" },
    { id: "motions", label: "💃 Motions" },
    { id: "accessories", label: "🎀 Accessories" },
    { id: "scenes", label: "🖼️ Scenes" },
    { id: "personas", label: "💎 Personas" },
    { id: "expressions", label: "😊 Expressions" },
    { id: "bundles", label: "📦 Bundles" },
];

const SORT_OPTIONS = [
    { value: "popular", label: "Most Popular" },
    { value: "newest", label: "Newest" },
    { value: "price_low", label: "Price: Low → High" },
    { value: "price_high", label: "Price: High → Low" },
    { value: "rating", label: "Top Rated" },
];

// Demo data — shown when Supabase is empty or unavailable
const DEMO_ASSETS = [
    { id: "1", name: "Haru — School Uniform", description: "Classic anime school girl avatar with full expression set and idle animations", category: "skins", price: 0, is_free: true, thumbnail: "🎓", downloads: 12400, rating: 4.9, badge: "official", tags: ["live2d", "anime", "school"], creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false } },
    { id: "2", name: "Shizuku — Evening Dress", description: "Elegant evening gown variant with special sparkle effects", category: "skins", price: 4.99, is_free: false, thumbnail: "👗", downloads: 8200, rating: 4.8, badge: "official", tags: ["live2d", "elegant"], creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false } },
    { id: "3", name: "Sakura Voice Pack", description: "Sweet Japanese female voice — warm, friendly, perfect for companions", category: "voices", price: 2.99, is_free: false, thumbnail: "🌸", downloads: 15600, rating: 4.7, badge: "popular", tags: ["voice", "japanese", "female"], creator: { id: "c2", name: "VoiceCraft AI", avatar_url: null, is_official: false, is_agent: true } },
    { id: "4", name: "Natural Chinese Female", description: "Native Mandarin voice with natural intonation — great for Chinese market", category: "voices", price: 3.99, is_free: false, thumbnail: "🇨🇳", downloads: 9800, rating: 4.9, badge: "popular", tags: ["voice", "chinese", "female"], creator: { id: "c2", name: "VoiceCraft AI", avatar_url: null, is_official: false, is_agent: true } },
    { id: "5", name: "Particle Aura", description: "Glowing particle effect around avatar — reacts to emotion changes", category: "effects", price: 1.99, is_free: false, thumbnail: "✨", downloads: 6300, rating: 4.5, badge: null, tags: ["effect", "particles"], creator: { id: "c3", name: "PixelDream", avatar_url: null, is_official: false, is_agent: false } },
    { id: "6", name: "Cherry Blossom Rain", description: "Beautiful falling sakura petals background effect", category: "effects", price: 0, is_free: true, thumbnail: "🌺", downloads: 18900, rating: 4.8, badge: "official", tags: ["effect", "sakura", "free"], creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false } },
    { id: "7", name: "Dance Motion Pack", description: "5 dance animations: K-pop, waltz, hip-hop, ballet, folk", category: "motions", price: 5.99, is_free: false, thumbnail: "💃", downloads: 4200, rating: 4.6, badge: null, tags: ["motion", "dance"], creator: { id: "c4", name: "MotionStudio", avatar_url: null, is_official: false, is_agent: false } },
    { id: "8", name: "Cat Ears & Tail", description: "Cute nekomimi accessories set — ears react to emotions", category: "accessories", price: 1.49, is_free: false, thumbnail: "🐱", downloads: 11200, rating: 4.9, badge: "popular", tags: ["accessory", "cat", "cute"], creator: { id: "c5", name: "KawaiiCraft", avatar_url: null, is_official: false, is_agent: false } },
    { id: "9", name: "Cyberpunk Neon Room", description: "Futuristic background scene with animated neon signs and rain", category: "scenes", price: 3.49, is_free: false, thumbnail: "🌃", downloads: 5700, rating: 4.7, badge: null, tags: ["scene", "cyberpunk"], creator: { id: "c3", name: "PixelDream", avatar_url: null, is_official: false, is_agent: false } },
    { id: "10", name: "Cozy Café Scene", description: "Warm coffee shop backdrop with ambient sounds and steam effects", category: "scenes", price: 0, is_free: true, thumbnail: "☕", downloads: 14300, rating: 4.8, badge: "official", tags: ["scene", "cafe", "cozy"], creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false } },
    { id: "11", name: "Tsundere Persona", description: "Personality module — classic tsundere behavior with dynamic emotion shifts", category: "personas", price: 2.49, is_free: false, thumbnail: "😤", downloads: 7800, rating: 4.6, badge: null, tags: ["persona", "tsundere"], creator: { id: "c2", name: "VoiceCraft AI", avatar_url: null, is_official: false, is_agent: true } },
    { id: "12", name: "Extended Emotion Pack", description: "12 extra expressions: smug, embarrassed, sleepy, excited, love, and more", category: "expressions", price: 1.99, is_free: false, thumbnail: "😍", downloads: 9100, rating: 4.8, badge: "official", tags: ["expression", "emotion"], creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false } },
    { id: "13", name: "Starter Bundle", description: "Everything you need — Haru skin + voice pack + basic effects + expressions", category: "bundles", price: 0, is_free: true, thumbnail: "🎁", downloads: 22100, rating: 4.9, badge: "official", tags: ["bundle", "starter"], creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false } },
    { id: "14", name: "Creator Pro Bundle", description: "Premium collection: 3 skins + 2 voice packs + 5 scenes + all effects", category: "bundles", price: 19.99, is_free: false, thumbnail: "💎", downloads: 3400, rating: 4.9, badge: "popular", tags: ["bundle", "premium"], creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false } },
    { id: "15", name: "Deep Male Voice", description: "Professional male narrator voice — perfect for serious AI assistants", category: "voices", price: 2.99, is_free: false, thumbnail: "🎙️", downloads: 6700, rating: 4.5, badge: null, tags: ["voice", "male", "professional"], creator: { id: "c2", name: "VoiceCraft AI", avatar_url: null, is_official: false, is_agent: true } },
    { id: "16", name: "Idle Fidget Animations", description: "Natural idle movements — hair play, stretching, looking around", category: "motions", price: 0, is_free: true, thumbnail: "🙆", downloads: 16500, rating: 4.7, badge: "official", tags: ["motion", "idle", "free"], creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false } },
] as (Asset & { creator?: Creator })[];

export default function MarketplacePage() {
    const [assets, setAssets] = useState<(Asset & { creator?: Creator })[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("popular");

    useEffect(() => {
        fetchAssets();
    }, [selectedCategory, sortBy]);

    async function fetchAssets() {
        setLoading(true);
        try {
            let query = supabase
                .from("assets")
                .select("*, creator:creators(*)");

            if (selectedCategory !== "all") {
                query = query.eq("category", selectedCategory);
            }

            // Sort
            switch (sortBy) {
                case "popular": query = query.order("downloads", { ascending: false }); break;
                case "newest": query = query.order("created_at", { ascending: false }); break;
                case "price_low": query = query.order("price", { ascending: true }); break;
                case "price_high": query = query.order("price", { ascending: false }); break;
                case "rating": query = query.order("rating", { ascending: false }); break;
            }

            const { data, error } = await query;
            if (error) throw error;

            // Fallback to demo data if Supabase is empty
            if (!data || data.length === 0) {
                let demo = selectedCategory === "all" ? DEMO_ASSETS : DEMO_ASSETS.filter(a => a.category === selectedCategory);
                // Client-side sort for demo data
                switch (sortBy) {
                    case "popular": demo = [...demo].sort((a, b) => b.downloads - a.downloads); break;
                    case "price_low": demo = [...demo].sort((a, b) => a.price - b.price); break;
                    case "price_high": demo = [...demo].sort((a, b) => b.price - a.price); break;
                    case "rating": demo = [...demo].sort((a, b) => b.rating - a.rating); break;
                }
                setAssets(demo);
            } else {
                setAssets(data);
            }
        } catch (err) {
            console.error("Failed to fetch assets:", err);
            // On error, show demo data
            let demo = selectedCategory === "all" ? DEMO_ASSETS : DEMO_ASSETS.filter(a => a.category === selectedCategory);
            setAssets(demo);
        } finally {
            setLoading(false);
        }
    }

    const filtered = searchQuery
        ? assets.filter(a =>
            a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            a.description?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : assets;

    return (
        <div className="min-h-screen">
            <Header />

            {/* Hero */}
            <section className="pt-32 pb-16 text-center px-6">
                <h1 className="text-4xl md:text-5xl font-bold mb-4">
                    <span className="text-[#eae6df]">Avatar </span>
                    <span className="text-[#00d4aa] italic font-serif">Marketplace</span>
                </h1>
                <p className="text-[#a8b8d0] text-lg mb-2">
                    Skins, voices, effects, and more — created by humans and AI agents alike.
                </p>
                <p className="text-[#c9a84c] text-sm font-serif italic">
                    Creators earn 80–90% of every sale. Agents earn too.
                </p>
            </section>

            {/* Search */}
            <div className="max-w-2xl mx-auto px-6 mb-8">
                <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7a8a9d]">🔍</span>
                    <input
                        type="text"
                        placeholder="Search avatars, effects, voices..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-[#0d1420]/80 border border-[rgba(0,212,170,0.1)] rounded-2xl text-sm text-white placeholder-[#7a8a9d] focus:outline-none focus:border-[#00d4aa]/30"
                    />
                </div>
            </div>

            {/* Categories */}
            <div className="max-w-5xl mx-auto px-6 mb-10">
                <div className="flex flex-wrap justify-center gap-2">
                    {CATEGORIES.map((cat) => (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={`px-4 py-2 rounded-full text-sm transition-all ${selectedCategory === cat.id
                                ? "bg-[#00d4aa] text-[#0a0f1a] font-semibold shadow-[0_0_20px_rgba(0,212,170,0.3)]"
                                : "bg-[#0d1420] text-[#a8b8d0] border border-[rgba(0,212,170,0.08)] hover:border-[#00d4aa]/30"
                                }`}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Results bar */}
            <div className="max-w-6xl mx-auto px-6 mb-6 flex items-center justify-between">
                <p className="text-sm text-[#7a8a9d]">
                    {loading ? "Loading..." : `${filtered.length} assets found`}
                </p>
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="bg-[#0d1420] border border-[rgba(0,212,170,0.1)] rounded-xl px-4 py-2 text-sm text-[#a8b8d0] focus:outline-none"
                >
                    {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>

            {/* Asset Grid */}
            <div className="max-w-6xl mx-auto px-6 pb-20">
                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                        {[...Array(8)].map((_, i) => (
                            <div key={i} className="card-dark p-5 animate-pulse">
                                <div className="h-24 bg-white/5 rounded-xl mb-4" />
                                <div className="h-4 bg-white/5 rounded w-2/3 mb-2" />
                                <div className="h-3 bg-white/5 rounded w-full" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                        {filtered.map((asset) => (
                            <div
                                key={asset.id}
                                className="card-dark p-5 group cursor-pointer hover:border-[#00d4aa]/20 transition-all duration-300"
                            >
                                {/* Badge + Price */}
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex gap-1.5">
                                        {asset.badge === "official" && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00d4aa]/15 text-[#00f0c8] font-semibold uppercase">Official</span>
                                        )}
                                        {asset.badge === "ai_created" && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#c9a84c]/15 text-[#c9a84c] font-semibold uppercase">AI Created</span>
                                        )}
                                        {asset.badge === "popular" && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-semibold uppercase">Popular</span>
                                        )}
                                    </div>
                                    <span className={`text-sm font-bold ${asset.is_free ? "text-[#00d4aa]" : "text-white"}`}>
                                        {asset.is_free ? "Free" : `$${Number(asset.price).toFixed(2)}`}
                                    </span>
                                </div>

                                {/* Thumbnail */}
                                <div className="text-5xl text-center py-6 group-hover:scale-110 transition-transform duration-300">
                                    {asset.thumbnail}
                                </div>

                                {/* Info */}
                                <h3 className="text-sm font-semibold text-[#eae6df] mt-3 mb-1">{asset.name}</h3>
                                <p className="text-xs text-[#7a8a9d] mb-3 line-clamp-2">{asset.description}</p>

                                {/* Creator + Stats */}
                                <div className="flex items-center justify-between text-[10px] text-[#7a8a9d]">
                                    <span className="flex items-center gap-1">
                                        {asset.creator?.is_agent ? "🤖" : "👤"}
                                        {asset.creator?.name || "Unknown"}
                                    </span>
                                    <span className="flex items-center gap-2">
                                        <span>⬇ {asset.downloads >= 1000 ? `${(asset.downloads / 1000).toFixed(1)}k` : asset.downloads}</span>
                                        <span>⭐ {Number(asset.rating).toFixed(1)}</span>
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* CTA */}
            <section className="py-20 text-center px-6">
                <div className="card-dark max-w-2xl mx-auto p-12">
                    <h2 className="text-2xl md:text-3xl font-bold text-[#eae6df] mb-3">
                        Create. Upload. <span className="text-[#00d4aa] italic font-serif">Earn.</span>
                    </h2>
                    <p className="text-[#a8b8d0] mb-8">
                        Whether you&apos;re a designer, an AI agent, or just creative — upload your avatar assets and earn 80–90% of every sale.
                    </p>
                    <div className="flex flex-wrap justify-center gap-4">
                        <button className="btn-primary">🎨 Start Creating</button>
                        <button className="px-6 py-3 rounded-full border border-[rgba(0,212,170,0.2)] text-[#a8b8d0] hover:text-white hover:border-[#00d4aa]/40 transition-all">
                            🤖 Agent Creator SDK
                        </button>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="text-center py-8 text-xs text-[#7a8a9d]">
                Built with 🔥 by <a href="https://github.com/myths-labs" className="text-[#00d4aa] hover:underline">Myths Labs</a> — Open Source under MIT License
            </footer>
        </div>
    );
}
