"use client";

import { useEffect, useRef } from "react";

interface HeroSectionProps {
    onTryDemo: () => void;
}

export default function HeroSection({ onTryDemo }: HeroSectionProps) {
    const canvasRef = useRef<HTMLDivElement>(null);

    // Create floating particles
    useEffect(() => {
        if (!canvasRef.current) return;
        const container = canvasRef.current;

        const particles: HTMLDivElement[] = [];
        for (let i = 0; i < 30; i++) {
            const particle = document.createElement("div");
            particle.className = "particle";
            const size = Math.random() * 4 + 2;
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            const duration = Math.random() * 8 + 6;
            const delay = Math.random() * 4;
            const opacity = Math.random() * 0.3 + 0.1;

            Object.assign(particle.style, {
                width: `${size}px`,
                height: `${size}px`,
                left: `${x}%`,
                top: `${y}%`,
                opacity: String(opacity),
                background: `hsl(${270 + Math.random() * 30}, 80%, ${60 + Math.random() * 20}%)`,
                animationDuration: `${duration}s`,
                animationDelay: `${delay}s`,
            });

            container.appendChild(particle);
            particles.push(particle);
        }

        return () => particles.forEach((p) => p.remove());
    }, []);

    return (
        <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
            {/* Background particles */}
            <div ref={canvasRef} className="absolute inset-0 pointer-events-none" />

            {/* Ambient glow orbs */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-purple-600/10 blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-pink-600/10 blur-3xl" />

            {/* Content */}
            <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm font-medium mb-8">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    Open Source — MIT License
                </div>

                {/* Title */}
                <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tight mb-6 leading-[0.95]">
                    <span className="text-white">Give Your AI</span>
                    <br />
                    <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent text-glow">
                        A Body
                    </span>
                </h1>

                {/* Subtitle */}
                <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
                    The open-source SDK that gives any LLM agent a Live2D avatar with
                    real-time <span className="text-purple-300">lip-sync</span>,{" "}
                    <span className="text-pink-300">emotion expressions</span>, and{" "}
                    <span className="text-purple-300">TTS</span>.
                    <br />
                    <span className="text-gray-500">
                        5 minutes to integrate. Infinite ways to customize.
                    </span>
                </p>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                    <button onClick={onTryDemo} className="btn-primary text-lg !py-4 !px-10">
                        🔥 Try Live Demo
                    </button>
                    <a
                        href="https://github.com/myths-labs/prometheus"
                        className="btn-secondary text-lg !py-4 !px-10 flex items-center gap-2"
                        target="_blank"
                        rel="noopener"
                    >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                        Star on GitHub
                    </a>
                </div>

                {/* Quick start code */}
                <div className="glass inline-block px-8 py-4 text-left font-mono text-sm">
                    <div className="text-gray-500 mb-2">// 5 lines to bring your AI to life</div>
                    <div>
                        <span className="text-purple-400">import</span>{" "}
                        <span className="text-green-300">{"{ createAvatar }"}</span>{" "}
                        <span className="text-purple-400">from</span>{" "}
                        <span className="text-yellow-300">&apos;@prometheus-avatar/core&apos;</span>
                    </div>
                    <div className="mt-1">
                        <span className="text-purple-400">const</span>{" "}
                        <span className="text-blue-300">avatar</span>{" "}
                        <span className="text-gray-500">=</span>{" "}
                        <span className="text-purple-400">await</span>{" "}
                        <span className="text-yellow-300">createAvatar</span>
                        <span className="text-gray-400">({"{ "}container, modelUrl{" }"})</span>
                    </div>
                    <div>
                        <span className="text-purple-400">await</span>{" "}
                        <span className="text-blue-300">avatar</span>
                        <span className="text-gray-400">.</span>
                        <span className="text-yellow-300">speak</span>
                        <span className="text-gray-400">(</span>
                        <span className="text-green-300">&apos;Hello world! 😊&apos;</span>
                        <span className="text-gray-400">)</span>
                    </div>
                </div>
            </div>

            {/* Scroll indicator */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
                <svg
                    className="w-6 h-6 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 14l-7 7m0 0l-7-7m7 7V3"
                    />
                </svg>
            </div>
        </section>
    );
}
