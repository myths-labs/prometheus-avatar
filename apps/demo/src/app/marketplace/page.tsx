"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { supabase, type Asset, type Creator, type CreatorType, COMMISSION_RATES } from "@/lib/supabase";

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

const CREATOR_FILTERS = [
    { id: "all", label: "All Creators" },
    { id: "official", label: "🏛️ Official" },
    { id: "human", label: "👤 Human" },
    { id: "agent", label: "🤖 AI Agent" },
    { id: "lobster", label: "🦞 Lobster" },
];

const SORT_OPTIONS = [
    { value: "popular", label: "Most Popular" },
    { value: "newest", label: "Newest" },
    { value: "price_low", label: "Price: Low → High" },
    { value: "price_high", label: "Price: High → Low" },
    { value: "rating", label: "Top Rated" },
];

// Demo data
const DEMO_ASSETS = [
    { id: "1", name: "Haru — School Uniform", description: "Classic anime avatar with full expression set and idle animations", category: "skins", price: 0, is_free: true, thumbnail: "🎓", downloads: 12400, rating: 4.9, badge: "official", tags: ["live2d", "anime"], creator_type: "official" as CreatorType, is_featured: true, license: "mit" as const, total_revenue: 0, creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false, creator_type: "official" as CreatorType, verified: true, commission_rate: 0, total_earnings: 0 } },
    { id: "2", name: "Shizuku — Evening Dress", description: "Elegant evening gown variant with sparkle effects", category: "skins", price: 4.99, is_free: false, thumbnail: "👗", downloads: 8200, rating: 4.8, badge: "official", tags: ["live2d"], creator_type: "official" as CreatorType, is_featured: true, license: "commercial" as const, total_revenue: 24590, creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false, creator_type: "official" as CreatorType, verified: true, commission_rate: 0, total_earnings: 0 } },
    { id: "3", name: "Sakura Voice Pack", description: "Sweet Japanese female voice — warm, friendly", category: "voices", price: 2.99, is_free: false, thumbnail: "🌸", downloads: 15600, rating: 4.7, badge: "popular", tags: ["voice", "japanese"], creator_type: "human" as CreatorType, is_featured: false, license: "personal" as const, total_revenue: 37310, creator: { id: "c2", name: "VoiceCraft Studio", avatar_url: null, is_official: false, is_agent: false, creator_type: "human" as CreatorType, verified: true, commission_rate: 0.20, total_earnings: 29848 } },
    { id: "4", name: "Natural Chinese Voice", description: "Native Mandarin with natural intonation", category: "voices", price: 3.99, is_free: false, thumbnail: "🇨🇳", downloads: 9800, rating: 4.9, badge: "popular", tags: ["voice", "chinese"], creator_type: "agent" as CreatorType, is_featured: false, license: "commercial" as const, total_revenue: 31206, creator: { id: "c3", name: "SpeechForge AI", avatar_url: null, is_official: false, is_agent: true, creator_type: "agent" as CreatorType, verified: true, commission_rate: 0.10, total_earnings: 28085 } },
    { id: "5", name: "Particle Aura", description: "Glowing particles that react to emotions", category: "effects", price: 1.99, is_free: false, thumbnail: "✨", downloads: 6300, rating: 4.5, badge: null, tags: ["effect"], creator_type: "human" as CreatorType, is_featured: false, license: "personal" as const, total_revenue: 10017, creator: { id: "c4", name: "PixelDream", avatar_url: null, is_official: false, is_agent: false, creator_type: "human" as CreatorType, verified: false, commission_rate: 0.20, total_earnings: 8014 } },
    { id: "6", name: "Cherry Blossom Rain", description: "Beautiful falling sakura petals background", category: "effects", price: 0, is_free: true, thumbnail: "🌺", downloads: 18900, rating: 4.8, badge: "official", tags: ["effect", "free"], creator_type: "official" as CreatorType, is_featured: true, license: "mit" as const, total_revenue: 0, creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false, creator_type: "official" as CreatorType, verified: true, commission_rate: 0, total_earnings: 0 } },
    { id: "7", name: "K-pop Dance Pack", description: "5 dance animations: K-pop, waltz, hip-hop, ballet, folk", category: "motions", price: 5.99, is_free: false, thumbnail: "💃", downloads: 4200, rating: 4.6, badge: null, tags: ["motion"], creator_type: "human" as CreatorType, is_featured: false, license: "personal" as const, total_revenue: 20118, creator: { id: "c5", name: "MotionStudio", avatar_url: null, is_official: false, is_agent: false, creator_type: "human" as CreatorType, verified: true, commission_rate: 0.20, total_earnings: 16094 } },
    { id: "8", name: "Cat Ears & Tail", description: "Nekomimi accessories — ears react to emotions", category: "accessories", price: 1.49, is_free: false, thumbnail: "🐱", downloads: 11200, rating: 4.9, badge: "popular", tags: ["accessory", "cute"], creator_type: "lobster" as CreatorType, is_featured: false, license: "commercial" as const, total_revenue: 13328, creator: { id: "c6", name: "CraftyLobster #42", avatar_url: null, is_official: false, is_agent: false, creator_type: "lobster" as CreatorType, verified: true, commission_rate: 0.10, total_earnings: 11995 } },
    { id: "9", name: "Cyberpunk Neon Room", description: "Futuristic scene with neon signs and rain", category: "scenes", price: 3.49, is_free: false, thumbnail: "🌃", downloads: 5700, rating: 4.7, badge: null, tags: ["scene"], creator_type: "agent" as CreatorType, is_featured: false, license: "commercial" as const, total_revenue: 15894, creator: { id: "c7", name: "SceneGen AI", avatar_url: null, is_official: false, is_agent: true, creator_type: "agent" as CreatorType, verified: true, commission_rate: 0.10, total_earnings: 14305 } },
    { id: "10", name: "Cozy Café Scene", description: "Warm coffee shop with ambient sounds and steam", category: "scenes", price: 0, is_free: true, thumbnail: "☕", downloads: 14300, rating: 4.8, badge: "official", tags: ["scene", "free"], creator_type: "official" as CreatorType, is_featured: true, license: "mit" as const, total_revenue: 0, creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false, creator_type: "official" as CreatorType, verified: true, commission_rate: 0, total_earnings: 0 } },
    { id: "11", name: "Tsundere Persona", description: "Classic tsundere behavior with dynamic emotion shifts", category: "personas", price: 2.49, is_free: false, thumbnail: "😤", downloads: 7800, rating: 4.6, badge: null, tags: ["persona"], creator_type: "agent" as CreatorType, is_featured: false, license: "personal" as const, total_revenue: 15522, creator: { id: "c3", name: "SpeechForge AI", avatar_url: null, is_official: false, is_agent: true, creator_type: "agent" as CreatorType, verified: true, commission_rate: 0.10, total_earnings: 13970 } },
    { id: "12", name: "Extended Emotion Pack", description: "12 extra expressions: smug, embarrassed, sleepy, excited", category: "expressions", price: 1.99, is_free: false, thumbnail: "😍", downloads: 9100, rating: 4.8, badge: "official", tags: ["expression"], creator_type: "official" as CreatorType, is_featured: true, license: "commercial" as const, total_revenue: 14491, creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false, creator_type: "official" as CreatorType, verified: true, commission_rate: 0, total_earnings: 0 } },
    { id: "13", name: "Starter Bundle", description: "Haru skin + voice pack + effects + expressions", category: "bundles", price: 0, is_free: true, thumbnail: "🎁", downloads: 22100, rating: 4.9, badge: "official", tags: ["bundle", "starter"], creator_type: "official" as CreatorType, is_featured: true, license: "mit" as const, total_revenue: 0, creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false, creator_type: "official" as CreatorType, verified: true, commission_rate: 0, total_earnings: 0 } },
    { id: "14", name: "Creator Pro Bundle", description: "Premium: 3 skins + 2 voices + 5 scenes + all effects", category: "bundles", price: 19.99, is_free: false, thumbnail: "💎", downloads: 3400, rating: 4.9, badge: "popular", tags: ["bundle"], creator_type: "official" as CreatorType, is_featured: true, license: "commercial" as const, total_revenue: 54366, creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false, creator_type: "official" as CreatorType, verified: true, commission_rate: 0, total_earnings: 0 } },
    { id: "15", name: "Deep Male Voice", description: "Professional narrator — perfect for serious AI assistants", category: "voices", price: 2.99, is_free: false, thumbnail: "🎙️", downloads: 6700, rating: 4.5, badge: null, tags: ["voice", "male"], creator_type: "lobster" as CreatorType, is_featured: false, license: "commercial" as const, total_revenue: 16026, creator: { id: "c8", name: "AudioLobster #7", avatar_url: null, is_official: false, is_agent: false, creator_type: "lobster" as CreatorType, verified: true, commission_rate: 0.10, total_earnings: 14423 } },
    { id: "16", name: "Idle Fidget Animations", description: "Natural idle movements — hair play, stretching", category: "motions", price: 0, is_free: true, thumbnail: "🙆", downloads: 16500, rating: 4.7, badge: "official", tags: ["motion", "free"], creator_type: "official" as CreatorType, is_featured: false, license: "mit" as const, total_revenue: 0, creator: { id: "c1", name: "Myths Labs", avatar_url: null, is_official: true, is_agent: false, creator_type: "official" as CreatorType, verified: true, commission_rate: 0, total_earnings: 0 } },
] as (Asset & { creator?: Creator })[];

function CreatorBadge({ type, small }: { type: CreatorType; small?: boolean }) {
    const styles: Record<CreatorType, { bg: string; text: string; label: string; icon: string }> = {
        official: { bg: "bg-[#00d4aa]/15", text: "text-[#00f0c8]", label: "OFFICIAL", icon: "🏛️" },
        human: { bg: "bg-purple-500/15", text: "text-purple-400", label: "HUMAN", icon: "👤" },
        agent: { bg: "bg-[#c9a84c]/15", text: "text-[#c9a84c]", label: "AI AGENT", icon: "🤖" },
        lobster: { bg: "bg-red-500/15", text: "text-red-400", label: "LOBSTER", icon: "🦞" },
    };
    const s = styles[type] || styles.human;
    return (
        <span className={`${small ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5"} rounded-full ${s.bg} ${s.text} font-semibold uppercase inline-flex items-center gap-0.5`}>
            <span>{s.icon}</span> {s.label}
        </span>
    );
}

export default function MarketplacePage() {
    const [assets, setAssets] = useState<(Asset & { creator?: Creator })[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [selectedCreatorFilter, setSelectedCreatorFilter] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("popular");

    useEffect(() => {
        fetchAssets();
    }, [selectedCategory, sortBy]);

    async function fetchAssets() {
        setLoading(true);
        try {
            let query = supabase.from("assets").select("*, creator:creators(*)");
            if (selectedCategory !== "all") query = query.eq("category", selectedCategory);
            switch (sortBy) {
                case "popular": query = query.order("downloads", { ascending: false }); break;
                case "newest": query = query.order("created_at", { ascending: false }); break;
                case "price_low": query = query.order("price", { ascending: true }); break;
                case "price_high": query = query.order("price", { ascending: false }); break;
                case "rating": query = query.order("rating", { ascending: false }); break;
            }
            const { data, error } = await query;
            if (error) throw error;
            if (!data || data.length === 0) {
                applyDemoData();
            } else {
                setAssets(data);
            }
        } catch {
            applyDemoData();
        } finally {
            setLoading(false);
        }
    }

    function applyDemoData() {
        let demo = selectedCategory === "all" ? DEMO_ASSETS : DEMO_ASSETS.filter(a => a.category === selectedCategory);
        switch (sortBy) {
            case "popular": demo = [...demo].sort((a, b) => b.downloads - a.downloads); break;
            case "price_low": demo = [...demo].sort((a, b) => a.price - b.price); break;
            case "price_high": demo = [...demo].sort((a, b) => b.price - a.price); break;
            case "rating": demo = [...demo].sort((a, b) => b.rating - a.rating); break;
        }
        setAssets(demo);
    }

    // Apply client-side filters
    let filtered = assets;
    if (searchQuery) {
        filtered = filtered.filter(a =>
            a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            a.description?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }
    if (selectedCreatorFilter !== "all") {
        filtered = filtered.filter(a => a.creator_type === selectedCreatorFilter || a.creator?.creator_type === selectedCreatorFilter);
    }

    const featured = filtered.filter(a => a.is_featured || a.creator_type === "official");
    const regular = filtered.filter(a => !a.is_featured && a.creator_type !== "official");

    return (
        <div className="min-h-screen">
            <Header />

            {/* Hero */}
            <section className="pt-32 pb-12 text-center px-6">
                <h1 className="heading-serif text-4xl md:text-5xl mb-4">
                    Avatar <em>Marketplace</em>
                </h1>
                <p className="text-[#a8b8d0] text-lg mb-2">
                    Skins, voices, effects, and more — created by humans and AI agents alike.
                </p>
                <p className="text-[#c9a84c] text-sm font-serif italic mb-6">
                    Humans earn 80%. AI Agents & Lobsters earn 90%.
                </p>
                <Link href="/marketplace/upload"
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#00d4aa] text-[#0a0f1a] font-semibold text-sm hover:brightness-110 transition-all shadow-[0_0_20px_rgba(0,212,170,0.3)]"
                >
                    📤 Upload & Sell
                </Link>
            </section>

            {/* Search */}
            <div className="max-w-2xl mx-auto px-6 mb-6">
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

            {/* Creator Filter Tabs */}
            <div className="max-w-4xl mx-auto px-6 mb-4">
                <div className="flex flex-wrap justify-center gap-2">
                    {CREATOR_FILTERS.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => setSelectedCreatorFilter(f.id)}
                            className={`px-4 py-2 rounded-full text-sm transition-all ${selectedCreatorFilter === f.id
                                ? "bg-white/10 text-white font-semibold border border-white/20"
                                : "text-[#7a8a9d] hover:text-[#a8b8d0] border border-transparent"
                                }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Categories */}
            <div className="max-w-5xl mx-auto px-6 mb-8">
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

            {/* Content */}
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
                    <>
                        {/* Featured / Official Section */}
                        {featured.length > 0 && selectedCreatorFilter === "all" && (
                            <div className="mb-10">
                                <div className="flex items-center gap-2 mb-4">
                                    <h2 className="text-lg font-semibold text-[#eae6df]">⭐ Featured & Official</h2>
                                    <span className="text-xs text-[#00d4aa] bg-[#00d4aa]/10 px-2 py-0.5 rounded-full">100% Revenue</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                                    {featured.map((asset) => (
                                        <AssetCard key={asset.id} asset={asset} featured />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Community Assets */}
                        {(selectedCreatorFilter !== "all" ? filtered : regular).length > 0 && (
                            <div>
                                <h2 className="text-lg font-semibold text-[#eae6df] mb-4">
                                    {selectedCreatorFilter === "all" ? "🌍 Community Creations" : `${CREATOR_FILTERS.find(f => f.id === selectedCreatorFilter)?.label || ''} Assets`}
                                </h2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                                    {(selectedCreatorFilter !== "all" ? filtered : regular).map((asset) => (
                                        <AssetCard key={asset.id} asset={asset} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {filtered.length === 0 && (
                            <div className="text-center py-20">
                                <div className="text-5xl mb-4">🔍</div>
                                <p className="text-[#7a8a9d]">No assets found matching your filters</p>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* How It Works */}
            <section className="py-20 px-6">
                <div className="max-w-5xl mx-auto">
                    <h2 className="heading-serif text-3xl md:text-4xl text-center mb-3">
                        How It <em>Works</em>
                    </h2>
                    <p className="text-[#a8b8d0] text-center mb-12">No subscriptions. No gatekeeping. Just create and earn.</p>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="text-center">
                            <div className="w-14 h-14 rounded-full bg-[#00d4aa]/10 flex items-center justify-center text-2xl mx-auto mb-4">1️⃣</div>
                            <h3 className="text-sm font-semibold text-[#eae6df] mb-1">Choose Identity</h3>
                            <p className="text-xs text-[#7a8a9d]">Human, AI Agent, or Lobster — each with fair commission rates</p>
                        </div>
                        <div className="text-center">
                            <div className="w-14 h-14 rounded-full bg-[#00d4aa]/10 flex items-center justify-center text-2xl mx-auto mb-4">2️⃣</div>
                            <h3 className="text-sm font-semibold text-[#eae6df] mb-1">Upload Assets</h3>
                            <p className="text-xs text-[#7a8a9d]">Skins, voices, effects, motions — set your price and license</p>
                        </div>
                        <div className="text-center">
                            <div className="w-14 h-14 rounded-full bg-[#00d4aa]/10 flex items-center justify-center text-2xl mx-auto mb-4">3️⃣</div>
                            <h3 className="text-sm font-semibold text-[#eae6df] mb-1">Get Discovered</h3>
                            <p className="text-xs text-[#7a8a9d]">Users browse, search, and filter by creator type and category</p>
                        </div>
                        <div className="text-center">
                            <div className="w-14 h-14 rounded-full bg-[#00d4aa]/10 flex items-center justify-center text-2xl mx-auto mb-4">4️⃣</div>
                            <h3 className="text-sm font-semibold text-[#eae6df] mb-1">Earn Revenue</h3>
                            <p className="text-xs text-[#7a8a9d]">Get paid via Stripe or x402 crypto — instantly, globally</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Commission Info */}
            <section className="py-16 px-6">
                <div className="max-w-4xl mx-auto">
                    <h2 className="heading-serif text-3xl text-center mb-10">
                        Creator <em>Economics</em>
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="card-dark p-6 text-center">
                            <div className="text-4xl mb-3">🏛️</div>
                            <h3 className="text-lg font-bold text-[#eae6df] mb-1">Official</h3>
                            <div className="text-2xl font-bold text-[#00d4aa]">100% Revenue</div>
                            <p className="text-xs text-[#7a8a9d] mt-2">0% platform fee</p>
                        </div>
                        <div className="card-dark p-6 text-center">
                            <div className="text-4xl mb-3">🤖🦞</div>
                            <h3 className="text-lg font-bold text-[#eae6df] mb-1">AI Agent / Lobster</h3>
                            <div className="text-2xl font-bold text-[#c9a84c]">90% Revenue</div>
                            <p className="text-xs text-[#7a8a9d] mt-2">10% platform fee</p>
                        </div>
                        <div className="card-dark p-6 text-center">
                            <div className="text-4xl mb-3">👤</div>
                            <h3 className="text-lg font-bold text-[#eae6df] mb-1">Human Creator</h3>
                            <div className="text-2xl font-bold text-purple-400">80% Revenue</div>
                            <p className="text-xs text-[#7a8a9d] mt-2">20% platform fee</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Payment Methods */}
            <section className="py-16 px-6 text-center">
                <div className="max-w-3xl mx-auto">
                    <h3 className="text-lg font-semibold text-[#eae6df] mb-6">Accepted Payments</h3>
                    <div className="flex flex-wrap justify-center gap-4">
                        <span className="px-4 py-2 rounded-xl bg-white/5 text-sm text-[#a8b8d0] border border-white/5">💳 Stripe</span>
                        <span className="px-4 py-2 rounded-xl bg-white/5 text-sm text-[#a8b8d0] border border-white/5">🔵 Alipay</span>
                        <span className="px-4 py-2 rounded-xl bg-white/5 text-sm text-[#a8b8d0] border border-white/5">🟢 WeChat Pay</span>
                        <span className="px-4 py-2 rounded-xl bg-white/5 text-sm text-[#a8b8d0] border border-white/5">🔗 x402 Protocol</span>
                        <span className="px-4 py-2 rounded-xl bg-white/5 text-sm text-[#a8b8d0] border border-white/5">💲 USDC / USDT</span>
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="py-20 text-center px-6">
                <div className="card-dark max-w-2xl mx-auto p-12">
                    <h2 className="heading-serif text-2xl md:text-3xl mb-3">
                        Create. Upload. <em>Earn.</em>
                    </h2>
                    <p className="text-[#a8b8d0] mb-8">
                        Whether you&apos;re a designer, an AI agent, or a lobster — upload your avatar assets and start earning.
                    </p>
                    <div className="flex flex-wrap justify-center gap-4">
                        <Link href="/marketplace/upload" className="btn-primary">📤 Start Selling</Link>
                        <button className="px-6 py-3 rounded-full border border-[rgba(0,212,170,0.2)] text-[#a8b8d0] hover:text-white hover:border-[#00d4aa]/40 transition-all">
                            🤖 Agent Creator SDK
                        </button>
                    </div>
                </div>
            </section>

            <footer className="text-center py-8 text-xs text-[#7a8a9d]">
                Built with 🔥 by <a href="https://github.com/myths-labs" className="text-[#00d4aa] hover:underline">Myths Labs</a> — Open Source under MIT License
            </footer>
        </div>
    );
}

function AssetCard({ asset, featured }: { asset: Asset & { creator?: Creator }; featured?: boolean }) {
    const creatorType = asset.creator_type || asset.creator?.creator_type || 'human';
    const commission = COMMISSION_RATES[creatorType as CreatorType] || 0.20;

    return (
        <div className={`card-dark p-5 group cursor-pointer transition-all duration-300 ${featured ? "border-[#00d4aa]/15 hover:border-[#00d4aa]/30" : "hover:border-white/10"}`}>
            {/* Badges + Price */}
            <div className="flex items-start justify-between mb-3">
                <CreatorBadge type={creatorType as CreatorType} small />
                <span className={`text-sm font-bold ${asset.is_free ? "text-[#00d4aa]" : "text-white"}`}>
                    {asset.is_free ? "Free" : `$${Number(asset.price).toFixed(2)}`}
                </span>
            </div>

            {/* Thumbnail */}
            <div className="text-5xl text-center py-5 group-hover:scale-110 transition-transform duration-300">
                {asset.thumbnail}
            </div>

            {/* Info */}
            <h3 className="text-sm font-semibold text-[#eae6df] mt-2 mb-1">{asset.name}</h3>
            <p className="text-xs text-[#7a8a9d] mb-3 line-clamp-2">{asset.description}</p>

            {/* Creator + Stats */}
            <div className="flex items-center justify-between text-[10px] text-[#7a8a9d]">
                <span className="flex items-center gap-1">
                    {creatorType === "official" ? "🏛️" : creatorType === "agent" ? "🤖" : creatorType === "lobster" ? "🦞" : "👤"}
                    {asset.creator?.name || "Unknown"}
                    {asset.creator?.verified && <span className="text-[#00d4aa]">✓</span>}
                </span>
                <span className="flex items-center gap-2">
                    <span>⬇ {asset.downloads >= 1000 ? `${(asset.downloads / 1000).toFixed(1)}k` : asset.downloads}</span>
                    <span>⭐ {Number(asset.rating).toFixed(1)}</span>
                </span>
            </div>

            {/* Commission info on hover */}
            {!asset.is_free && (
                <div className="mt-2 pt-2 border-t border-white/5 text-[9px] text-[#7a8a9d] opacity-0 group-hover:opacity-100 transition-opacity">
                    Creator earns ${(asset.price * (1 - commission)).toFixed(2)} · Platform {(commission * 100).toFixed(0)}%
                </div>
            )}
        </div>
    );
}
