"use client";

import { useState, useCallback, useRef } from "react";
import MarketplaceHeader from "@/components/MarketplaceHeader";

const CATEGORIES = [
    { value: "skins", label: "🎨 Skins" },
    { value: "voices", label: "🗣️ Voices" },
    { value: "effects", label: "✨ Effects" },
    { value: "motions", label: "💃 Motion Packs" },
    { value: "accessories", label: "🎩 Accessories" },
    { value: "scenes", label: "🖼️ Scenes" },
    { value: "personas", label: "🧠 Personas" },
    { value: "expressions", label: "😊 Expression Packs" },
    { value: "bundles", label: "🎁 Theme Bundles" },
    { value: "plugins", label: "🔌 Ability Plugins" },
];

export default function UploadPage() {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");
    const [price, setPrice] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [previewReady, setPreviewReady] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const dropped = Array.from(e.dataTransfer.files);
        setFiles(dropped);
        // Auto-detect model3.json for preview
        const hasModel = dropped.some(f =>
            f.name.endsWith(".model3.json") || f.name.endsWith(".zip")
        );
        setPreviewReady(hasModel);
    }, []);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selected = Array.from(e.target.files);
            setFiles(selected);
            const hasModel = selected.some(f =>
                f.name.endsWith(".model3.json") || f.name.endsWith(".zip")
            );
            setPreviewReady(hasModel);
        }
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!name || !category || files.length === 0) return;
        setUploading(true);

        // TODO: Upload to Supabase Storage + create record in DB
        await new Promise((r) => setTimeout(r, 2000)); // Simulate

        setUploading(false);
        alert("Asset uploaded! It will be reviewed shortly.");
    }, [name, category, files]);

    const isValid = name.trim() && category && files.length > 0;

    return (
        <main className="min-h-screen">
            <MarketplaceHeader />

            <div className="max-w-3xl mx-auto px-6 pt-24 pb-12">
                <h1 className="text-3xl font-bold mb-2">Upload Asset</h1>
                <p className="text-gray-400 mb-8">
                    Share your creation with millions of AI agents. Earn 80-90% of every sale.
                </p>

                <div className="space-y-6">
                    {/* Drop Zone */}
                    <div
                        className={`drop-zone p-12 text-center cursor-pointer ${isDragging ? "dragover" : ""
                            }`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => inputRef.current?.click()}
                    >
                        <input
                            ref={inputRef}
                            type="file"
                            multiple
                            accept=".zip,.model3.json,.json,.png,.jpg,.mp3,.wav"
                            onChange={handleFileSelect}
                            className="hidden"
                        />

                        {files.length > 0 ? (
                            <div>
                                <p className="text-2xl mb-2">✅</p>
                                <p className="text-white font-medium">
                                    {files.length} file{files.length > 1 ? "s" : ""} selected
                                </p>
                                <div className="text-xs text-gray-500 mt-2 space-y-0.5">
                                    {files.map((f) => (
                                        <div key={f.name}>{f.name} ({(f.size / 1024).toFixed(1)} KB)</div>
                                    ))}
                                </div>
                                {previewReady && (
                                    <div className="mt-4 p-4 glass inline-block">
                                        <p className="text-sm text-green-400">✨ Live2D model detected — preview ready</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div>
                                <p className="text-4xl mb-4">📦</p>
                                <p className="text-white font-medium mb-1">
                                    Drag & drop your asset files here
                                </p>
                                <p className="text-sm text-gray-500">
                                    .zip, .model3.json, images, audio — or click to browse
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">
                            Asset Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Cyber Neon Girl"
                            className="w-full bg-white/5 border border-gray-700/50 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">
                            Description
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe your asset..."
                            rows={3}
                            className="w-full bg-white/5 border border-gray-700/50 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 resize-none"
                        />
                    </div>

                    {/* Category + Price */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">
                                Category
                            </label>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="w-full bg-white/5 border border-gray-700/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50"
                            >
                                <option value="">Select category</option>
                                {CATEGORIES.map((c) => (
                                    <option key={c.value} value={c.value}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">
                                Price (USD)
                            </label>
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder="0 = Free"
                                min="0"
                                step="0.01"
                                className="w-full bg-white/5 border border-gray-700/50 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                            />
                        </div>
                    </div>

                    {/* Revenue info */}
                    <div className="glass p-4 text-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-yellow-400">💰</span>
                            <span className="font-medium text-white">Revenue Split</span>
                        </div>
                        <p className="text-gray-400">
                            Community creators earn <span className="text-green-400 font-semibold">80-90%</span> of each sale.
                            Platform fee is 10-20% to cover hosting, payment processing, and discovery.
                        </p>
                        <p className="text-gray-500 text-xs mt-1">
                            Payments via Stripe (fiat) or x402 protocol (crypto stablecoins).
                        </p>
                    </div>

                    {/* Submit */}
                    <button
                        onClick={handleSubmit}
                        disabled={!isValid || uploading}
                        className={`w-full btn-primary !py-4 text-lg ${!isValid || uploading ? "opacity-40 cursor-not-allowed" : ""
                            }`}
                    >
                        {uploading ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Uploading...
                            </span>
                        ) : (
                            "📤 Submit for Review"
                        )}
                    </button>
                </div>
            </div>
        </main>
    );
}
