"use client";

import { useState } from "react";

export default function Header() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-gray-800/50">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                {/* Logo */}
                <a href="/" className="flex items-center gap-3 group">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm group-hover:scale-110 transition-transform">
                        P
                    </div>
                    <span className="text-lg font-bold tracking-tight">
                        <span className="text-white">Prometheus</span>
                    </span>
                </a>

                {/* Nav */}
                <nav className="hidden md:flex items-center gap-8">
                    <a href="#demo" className="text-sm text-gray-400 hover:text-white transition-colors">
                        Demo
                    </a>
                    <a href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">
                        Features
                    </a>
                    <a
                        href="https://github.com/myths-labs/prometheus"
                        className="text-sm text-gray-400 hover:text-white transition-colors"
                        target="_blank"
                        rel="noopener"
                    >
                        GitHub
                    </a>
                    <a href="/marketplace" className="btn-primary text-sm !py-2 !px-5">
                        Marketplace
                    </a>
                </nav>

                {/* Mobile */}
                <button
                    className="md:hidden text-gray-400"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {mobileMenuOpen ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        )}
                    </svg>
                </button>
            </div>

            {/* Mobile menu */}
            {mobileMenuOpen && (
                <div className="md:hidden glass border-t border-gray-800/50 px-6 py-4 space-y-3">
                    <a href="#demo" className="block text-gray-400 hover:text-white transition-colors">
                        Demo
                    </a>
                    <a href="#features" className="block text-gray-400 hover:text-white transition-colors">
                        Features
                    </a>
                    <a href="/marketplace" className="block text-purple-400 hover:text-purple-300 transition-colors">
                        Marketplace
                    </a>
                </div>
            )}
        </header>
    );
}
