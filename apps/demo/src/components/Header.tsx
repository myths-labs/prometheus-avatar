"use client";

import { useState } from "react";
import Image from "next/image";

export default function Header() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <header className="fixed top-0 left-0 right-0 z-50 border-b border-[rgba(0,212,170,0.04)] backdrop-blur-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between">
                {/* Logo — Myths Labs system style */}
                <a href="/" className="flex items-center gap-1.5 sm:gap-2.5 group min-w-0">
                    <Image src="/logo-small.png" alt="Prometheus" width={55} height={55} className="w-9 h-9 sm:w-[55px] sm:h-[55px] group-hover:scale-110 transition-transform drop-shadow-[0_0_12px_rgba(0,212,170,0.5)]" />
                    <span
                        className="heading-serif text-lg sm:text-2xl italic hidden min-[380px]:inline"
                        style={{ fontWeight: 400, letterSpacing: '0.02em' }}
                    >
                        <span className="bg-gradient-to-r from-[#00d4aa] via-[#4aecd0] to-[#c9a84c] bg-clip-text text-transparent">
                            Prometheus
                        </span>
                    </span>
                </a>

                {/* Desktop nav */}
                <nav className="hidden md:flex items-center gap-8">
                    <a href="/#demo" className="text-sm text-[#a0b4cc] hover:text-[#00f0c8] transition-colors">Demo</a>
                    <a href="/#features" className="text-sm text-[#a0b4cc] hover:text-[#00f0c8] transition-colors">Features</a>
                    <a href="https://github.com/myths-labs/prometheus-avatar" className="text-sm text-[#a0b4cc] hover:text-[#00f0c8] transition-colors" target="_blank" rel="noopener">GitHub</a>
                    <a href="https://www.npmjs.com/package/@prometheusavatar/core" className="text-sm px-3 py-1.5 rounded-full border border-[#c9a84c]/30 text-[#c9a84c] hover:bg-[#c9a84c]/10 transition-all" target="_blank" rel="noopener">📦 SDK</a>
                    <a href="/membership" className="text-sm text-[#a0b4cc] hover:text-[#00f0c8] transition-colors">Membership</a>
                    <a href="/dashboard" className="text-sm text-[#a0b4cc] hover:text-[#00f0c8] transition-colors">Dashboard</a>
                    <a href="/marketplace" className="btn-primary text-sm !py-2 !px-5">Marketplace</a>
                </nav>

                {/* Mobile: Marketplace button + hamburger */}
                <div className="md:hidden flex items-center gap-3">
                    <a href="/marketplace" className="btn-primary text-xs !py-1.5 !px-4">Marketplace</a>
                    <button className="text-[#a0b4cc] p-1" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {mobileMenuOpen ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            )}
                        </svg>
                    </button>
                </div>
            </div>

            {mobileMenuOpen && (
                <div className="md:hidden glass border-t border-[rgba(0,212,170,0.06)] px-6 py-4 space-y-3">
                    <a href="/#demo" className="block text-[#a0b4cc] hover:text-[#00f0c8] transition-colors" onClick={() => setMobileMenuOpen(false)}>Demo</a>
                    <a href="/#features" className="block text-[#a0b4cc] hover:text-[#00f0c8] transition-colors" onClick={() => setMobileMenuOpen(false)}>Features</a>
                    <a href="https://github.com/myths-labs/prometheus-avatar" className="block text-[#a0b4cc] hover:text-[#00f0c8] transition-colors" target="_blank" rel="noopener">GitHub</a>
                </div>
            )}
        </header>
    );
}
