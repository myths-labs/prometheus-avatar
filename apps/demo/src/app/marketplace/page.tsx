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
            setAssets(data || []);
        } catch (err) {
            console.error("Failed to fetch assets:", err);
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
                <p className="text-[#8a9ab5] text-lg mb-2">
                    Skins, voices, effects, and more — created by humans and AI agents alike.
                </p>
                <p className="text-[#c9a84c] text-sm font-serif italic">
                    Creators earn 80–90% of every sale. Agents earn too.
                </p>
            </section>

            {/* Search */}
            <div className="max-w-2xl mx-auto px-6 mb-8">
                <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5a6a80]">🔍</span>
                    <input
                        type="text"
                        placeholder="Search avatars, effects, voices..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-[#0d1420]/80 border border-[rgba(0,212,170,0.1)] rounded-2xl text-sm text-white placeholder-[#5a6a80] focus:outline-none focus:border-[#00d4aa]/30"
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
                                    : "bg-[#0d1420] text-[#8a9ab5] border border-[rgba(0,212,170,0.08)] hover:border-[#00d4aa]/30"
                                }`}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Results bar */}
            <div className="max-w-6xl mx-auto px-6 mb-6 flex items-center justify-between">
                <p className="text-sm text-[#5a6a80]">
                    {loading ? "Loading..." : `${filtered.length} assets found`}
                </p>
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="bg-[#0d1420] border border-[rgba(0,212,170,0.1)] rounded-xl px-4 py-2 text-sm text-[#8a9ab5] focus:outline-none"
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
                                <p className="text-xs text-[#5a6a80] mb-3 line-clamp-2">{asset.description}</p>

                                {/* Creator + Stats */}
                                <div className="flex items-center justify-between text-[10px] text-[#5a6a80]">
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
                    <p className="text-[#8a9ab5] mb-8">
                        Whether you&apos;re a designer, an AI agent, or just creative — upload your avatar assets and earn 80–90% of every sale.
                    </p>
                    <div className="flex flex-wrap justify-center gap-4">
                        <button className="btn-primary">🎨 Start Creating</button>
                        <button className="px-6 py-3 rounded-full border border-[rgba(0,212,170,0.2)] text-[#8a9ab5] hover:text-white hover:border-[#00d4aa]/40 transition-all">
                            🤖 Agent Creator SDK
                        </button>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="text-center py-8 text-xs text-[#5a6a80]">
                Built with 🔥 by <a href="https://github.com/myths-labs" className="text-[#00d4aa] hover:underline">Myths Labs</a> — Open Source under MIT License
            </footer>
        </div>
    );
}
