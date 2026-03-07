"use client";

interface Asset {
    id: string;
    name: string;
    category: string;
    price: number;
    priceLabel: string;
    creator: string;
    isOfficial: boolean;
    isAgentCreated?: boolean;
    downloads: number;
    rating: number;
    thumbnail: string;
    description: string;
}

interface AssetGridProps {
    assets: Asset[];
}

export default function AssetGrid({ assets }: AssetGridProps) {
    if (assets.length === 0) {
        return (
            <div className="text-center py-20">
                <p className="text-4xl mb-4">🔍</p>
                <p className="text-gray-400">No assets found. Try a different search or category.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {assets.map((asset) => (
                <div
                    key={asset.id}
                    className={`glass group cursor-pointer transition-all duration-200 hover:bg-white/[0.06] hover:-translate-y-1 overflow-hidden ${asset.isOfficial ? "ring-1 ring-purple-500/30" : ""
                        }`}
                >
                    {/* Thumbnail */}
                    <div className="relative h-44 bg-gradient-to-br from-gray-800/50 to-gray-900/50 flex items-center justify-center">
                        <span className="text-6xl group-hover:scale-110 transition-transform">
                            {asset.thumbnail}
                        </span>

                        {/* Badges */}
                        <div className="absolute top-3 left-3 flex gap-1.5">
                            {asset.isOfficial && <span className="official-badge">Official</span>}
                            {asset.isAgentCreated && <span className="agent-badge">AI Created</span>}
                        </div>

                        {/* Price */}
                        <div className="absolute top-3 right-3">
                            <span
                                className={`text-sm font-bold px-3 py-1 rounded-lg ${asset.price === 0
                                        ? "bg-green-500/20 text-green-300"
                                        : "bg-black/60 text-white"
                                    }`}
                            >
                                {asset.priceLabel}
                            </span>
                        </div>
                    </div>

                    {/* Info */}
                    <div className="p-4">
                        <h3 className="font-semibold text-white mb-1 truncate">{asset.name}</h3>
                        <p className="text-xs text-gray-500 mb-2 line-clamp-2">{asset.description}</p>

                        <div className="flex items-center justify-between text-xs text-gray-400">
                            <span className="flex items-center gap-1">
                                {asset.isAgentCreated ? "🤖" : "👤"} {asset.creator}
                            </span>
                            <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1">
                                    ⬇ {asset.downloads.toLocaleString()}
                                </span>
                                <span className="flex items-center gap-1">
                                    ⭐ {asset.rating}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
