"use client";

import { useState } from "react";
import Image from "next/image";

export default function Header() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <header className="fixed top-0 left-0 right-0 z-50 border-b border-[rgba(0,212,170,0.06)] backdrop-blur-md" style={{ background: 'rgba(5,5,8,0.35)' }}>
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                {/* Logo */}
                <a href="/" className="flex items-center gap-1.5 group">
                    <Image src="/logo-small.png" alt="Prometheus" width={48} height={48} className="group-hover:scale-110 transition-transform drop-shadow-[0_0_8px_rgba(0,212,170,0.4)]" />
                    <span
                        className="heading-serif text-lg tracking-[0.18em] uppercase"
                        style={{ fontWeight: 400 }}
                    >
                        <span className="bg-gradient-to-r from-[#00d4aa] via-[#4aecd0] to-[#c9a84c] bg-clip-text text-transparent">
                            Prometheus
                        </span>
                    </span>
                </a>

                {/* Nav */}
                <nav className="hidden md:flex items-center gap-8">
                    <a href="#demo" className="text-sm text-[#a0b4cc] hover:text-[#00f0c8] transition-colors">Demo</a>
                    <a href="#features" className="text-sm text-[#a0b4cc] hover:text-[#00f0c8] transition-colors">Features</a>
                    <a href="https://github.com/myths-labs/prometheus-avatar" className="text-sm text-[#a0b4cc] hover:text-[#00f0c8] transition-colors" target="_blank" rel="noopener">GitHub</a>
                    <a href="/marketplace" className="btn-primary text-sm !py-2 !px-5">Marketplace</a>
                </nav>

                {/* Mobile toggle */}
                <button className="md:hidden text-[#a0b4cc]" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {mobileMenuOpen ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        )}
                    </svg>
                </button>
            </div>

            {mobileMenuOpen && (
                <div className="md:hidden glass border-t border-[rgba(0,212,170,0.06)] px-6 py-4 space-y-3">
                    <a href="#demo" className="block text-[#a0b4cc] hover:text-[#00f0c8] transition-colors">Demo</a>
                    <a href="#features" className="block text-[#a0b4cc] hover:text-[#00f0c8] transition-colors">Features</a>
                    <a href="/marketplace" className="block text-[#00d4aa] hover:text-[#00f0c8] transition-colors">Marketplace</a>
                </div>
            )}
        </header>
    );
}
