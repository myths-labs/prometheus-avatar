"use client";

export default function MarketplaceHeader() {
    return (
        <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-gray-800/50">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                <a href="/" className="flex items-center gap-3 group">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm group-hover:scale-110 transition-transform">
                        P
                    </div>
                    <span className="text-lg font-bold">
                        <span className="text-white">Prometheus</span>
                        <span className="text-gray-500 ml-1.5 text-sm font-normal">Marketplace</span>
                    </span>
                </a>

                <nav className="hidden md:flex items-center gap-6">
                    <a href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
                        Browse
                    </a>
                    <a href="/upload" className="text-sm text-gray-400 hover:text-white transition-colors">
                        Upload
                    </a>
                    <a href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
                        Dashboard
                    </a>
                    <button className="btn-primary text-sm !py-2 !px-4">
                        Connect Wallet
                    </button>
                </nav>
            </div>
        </header>
    );
}
