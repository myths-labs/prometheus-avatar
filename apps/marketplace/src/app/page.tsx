"use client";

import { useState } from "react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import AssetGrid from "@/components/AssetGrid";
import CategoryFilter from "@/components/CategoryFilter";

// Mock data — in production, this comes from Supabase
const MOCK_ASSETS = [
  {
    id: "1",
    name: "Airachne Preview Edition",
    category: "skins",
    price: 0,
    priceLabel: "Free",
    creator: "Myths Labs",
    isOfficial: true,
    downloads: 1240,
    rating: 4.9,
    thumbnail: "🕷️",
    description: "Official debut avatar from Myths Labs. Arachnid-inspired cyberpunk design.",
  },
  {
    id: "2",
    name: "Sakura Breeze",
    category: "effects",
    price: 2.99,
    priceLabel: "$2.99",
    creator: "PixelDreamer",
    isOfficial: false,
    isAgentCreated: false,
    downloads: 890,
    rating: 4.7,
    thumbnail: "🌸",
    description: "Floating cherry blossom petals with gentle wind simulation.",
  },
  {
    id: "3",
    name: "Cyber Neon Girl",
    category: "skins",
    price: 4.99,
    priceLabel: "$4.99",
    creator: "AvatarForge",
    isOfficial: false,
    downloads: 2100,
    rating: 4.8,
    thumbnail: "👾",
    description: "Neon-lit cyberpunk avatar with LED eye effects and animated hair.",
  },
  {
    id: "4",
    name: "Velvet Voice Pack",
    category: "voices",
    price: 1.99,
    priceLabel: "$1.99",
    creator: "SoundWave AI",
    isOfficial: false,
    downloads: 560,
    rating: 4.5,
    thumbnail: "🎙️",
    description: "Warm, rich TTS voice with natural intonation. Supports EN/JP/ZH.",
  },
  {
    id: "5",
    name: "Scholar's Study",
    category: "scenes",
    price: 0.99,
    priceLabel: "$0.99",
    creator: "ClaudeBot-7x",
    isOfficial: false,
    isAgentCreated: true,
    downloads: 3200,
    rating: 4.6,
    thumbnail: "📚",
    description: "Cozy library scene with floating books and warm lighting. Created by an AI agent.",
  },
  {
    id: "6",
    name: "Cat Ears Deluxe",
    category: "accessories",
    price: 0.49,
    priceLabel: "$0.49",
    creator: "NekoCraft",
    isOfficial: false,
    downloads: 4500,
    rating: 4.9,
    thumbnail: "🐱",
    description: "Animated cat ears that react to avatar emotions. Twitches when surprised!",
  },
  {
    id: "7",
    name: "Thunder God Aura",
    category: "effects",
    price: 3.99,
    priceLabel: "$3.99",
    creator: "Myths Labs",
    isOfficial: true,
    downloads: 780,
    rating: 4.8,
    thumbnail: "⚡",
    description: "Electric aura effect with dynamic lightning bolts. Official Myths Labs creation.",
  },
  {
    id: "8",
    name: "Cosmic Dancer Motion Pack",
    category: "motions",
    price: 2.49,
    priceLabel: "$2.49",
    creator: "GPT-Dance-42",
    isOfficial: false,
    isAgentCreated: true,
    downloads: 1800,
    rating: 4.4,
    thumbnail: "💃",
    description: "Smooth dance animations choreographed by an AI agent. 8 unique motions.",
  },
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
    const matchCategory =
      selectedCategory === "all" || asset.category === selectedCategory;
    const matchSearch =
      !searchQuery ||
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  }).sort((a, b) => {
    if (sortBy === "popular") return b.downloads - a.downloads;
    if (sortBy === "newest") return 0; // mock
    if (sortBy === "price-low") return a.price - b.price;
    if (sortBy === "price-high") return b.price - a.price;
    return 0;
  });

  return (
    <main className="min-h-screen">
      <MarketplaceHeader />

      <div className="max-w-7xl mx-auto px-6 pt-24 pb-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Avatar Marketplace
            </span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Skins, voices, effects, and more — created by humans and AI agents alike.
            <br />
            <span className="text-sm text-gray-500">
              Creators earn 80–90% of every sale. Agents earn too.
            </span>
          </p>
        </div>

        {/* Search */}
        <div className="max-w-xl mx-auto mb-8">
          <div className="relative">
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search avatars, effects, voices..."
              className="w-full bg-white/5 border border-gray-700/50 rounded-xl pl-12 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors"
            />
          </div>
        </div>

        {/* Categories */}
        <CategoryFilter
          categories={CATEGORIES}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />

        {/* Sort & Stats */}
        <div className="flex items-center justify-between mb-6 mt-8">
          <p className="text-sm text-gray-400">
            {filtered.length} asset{filtered.length !== 1 ? "s" : ""} found
          </p>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-white/5 border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none"
          >
            <option value="popular">Most Popular</option>
            <option value="newest">Newest</option>
            <option value="price-low">Price: Low → High</option>
            <option value="price-high">Price: High → Low</option>
          </select>
        </div>

        {/* Asset Grid */}
        <AssetGrid assets={filtered} />

        {/* CTA for creators */}
        <div className="glass text-center p-10 mt-16">
          <h2 className="text-2xl font-bold mb-3">
            Create. Upload. Earn.
          </h2>
          <p className="text-gray-400 mb-6 max-w-lg mx-auto">
            Whether you&apos;re a designer, an AI agent, or just creative — upload your avatar assets and
            earn 80–90% of every sale.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a href="/upload" className="btn-primary">
              🎨 Start Creating
            </a>
            <a
              href="/upload?mode=agent"
              className="bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 px-6 py-2.5 rounded-xl font-medium hover:bg-cyan-500/20 transition-all"
            >
              🤖 Agent Creator SDK
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
