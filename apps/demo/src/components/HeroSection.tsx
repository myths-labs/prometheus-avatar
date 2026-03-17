"use client";

import { useEffect, useState } from "react";
import LiveCounter from "@/components/LiveCounter";

interface HeroSectionProps {
  onTryDemo: () => void;
}

interface Particle {
  id: number;
  size: number;
  x: number;
  y: number;
  hue: number;
  duration: number;
  delay: number;
}

export default function HeroSection({ onTryDemo }: HeroSectionProps) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const gen: Particle[] = [];
    for (let i = 0; i < 25; i++) {
      gen.push({
        id: i,
        size: Math.random() * 2.5 + 1,
        x: Math.random() * 100,
        y: Math.random() * 100,
        hue: 160 + Math.random() * 30,
        duration: Math.random() * 12 + 8,
        delay: Math.random() * 6,
      });
    }
    setParticles(gen);
  }, []);

  return (
    <section className="hero-bg relative min-h-screen flex items-center justify-center pt-20">
      {/* Particles */}
      <div className="absolute inset-0 pointer-events-none z-[3] overflow-hidden">
        {particles.map((p) => (
          <div
            key={p.id}
            className="particle"
            style={{
              width: `${p.size}px`,
              height: `${p.size}px`,
              left: `${p.x}%`,
              top: `${p.y}%`,
              background: `hsl(${p.hue}, 80%, 70%)`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        {/* Badge */}
        <div className="badge-shimmer inline-flex items-center gap-2 px-5 py-2 rounded-full bg-white/5 border border-white/10 text-[#a8b8d0] text-sm font-medium mb-10">
          <span className="w-2 h-2 rounded-full bg-[#00d4aa] animate-pulse" />
          Open Source — MIT License
        </div>

        {/* Serif Title — Aithena style */}
        <h1 className="heading-serif text-5xl md:text-7xl lg:text-[5.5rem] mb-8">
          <span className="text-[#eae6df]">Give Your AI</span>
          <br />
          <em className="text-gradient-animated">A Body</em>
        </h1>

        {/* Subtitle — clean, spacious */}
        <p className="text-lg md:text-xl text-[#a8b8d0] max-w-xl mx-auto mb-12 leading-relaxed font-light">
          The open-source SDK that gives any LLM agent a Live2D avatar with
          real-time lip-sync, emotion expressions, and TTS.
        </p>

        {/* CTAs — pill buttons like Aithena */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
          <button onClick={onTryDemo} className="btn-primary text-base">
            🔥 Try Live Demo
          </button>
          <a
            href="https://github.com/myths-labs/prometheus-avatar"
            className="btn-secondary text-base flex items-center gap-2"
            target="_blank"
            rel="noopener"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            Star on GitHub
          </a>
        </div>

        {/* 🦞 OpenClaw callout — cold start target audience */}
        <div className="inline-flex flex-wrap items-center gap-2 px-4 sm:px-5 py-2.5 rounded-full bg-gradient-to-r from-[#ff6b35]/10 to-[#00d4aa]/10 border border-[#ff6b35]/20 text-xs sm:text-sm mb-8 hover:border-[#ff6b35]/40 transition-colors cursor-default max-w-full">
          <span className="text-lg">🦞</span>
          <span className="text-[#e8d48b] font-medium">First-class OpenClaw plugin</span>
          <span className="text-[#a8b8d0] hidden sm:inline">— millions of lobsters, meet your new body.</span>
        </div>

        {/* npm + GitHub badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-8">
          <img src="https://img.shields.io/badge/npm-v0.8.0-00d4aa?style=for-the-badge&logo=npm&logoColor=white" alt="npm v0.8.0" className="h-5" />
          <img src="https://img.shields.io/github/stars/myths-labs/prometheus-avatar?color=c9a84c&style=for-the-badge&logo=github" alt="stars" className="h-5" />
          <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT" className="h-5" />
        </div>

        {/* Prophecy tagline */}
        <p className="prophecy-quote max-w-lg mx-auto mb-8">
          &ldquo;Like Prometheus bringing fire to humanity — we bring embodiment to AI.&rdquo;
        </p>

        {/* Live registration counter + milestone */}
        <div className="mb-10">
          <LiveCounter variant="hero" />
        </div>

        {/* Code snippet */}
        <div className="card-dark code-shimmer inline-block px-5 sm:px-8 py-4 sm:py-5 text-left font-mono text-xs sm:text-sm max-w-full overflow-x-auto">
          <div className="relative z-10">
            <div className="text-[#6b7a8d] mb-2">{"// 5 lines to bring your AI to life"}</div>
            <div>
              <span className="text-[#00d4aa]">import</span>{" "}
              <span className="text-[#c9a84c]">{"{ createAvatar }"}</span>{" "}
              <span className="text-[#00d4aa]">from</span>{" "}
              <span className="text-[#e8d48b]">&apos;@prometheusavatar/core&apos;</span>
            </div>
            <div className="mt-1">
              <span className="text-[#00d4aa]">const</span>{" "}
              <span className="text-[#c9a84c]">avatar</span>{" "}
              <span className="text-[#6b7a8d]">=</span>{" "}
              <span className="text-[#00d4aa]">await</span>{" "}
              <span className="text-[#e8d48b]">createAvatar</span>
              <span className="text-[#a8b8d0]">({"{ "}container, modelUrl{" }"})</span>
            </div>
            <div>
              <span className="text-[#00d4aa]">await</span>{" "}
              <span className="text-[#c9a84c]">avatar</span>
              <span className="text-[#6b7a8d]">.</span>
              <span className="text-[#e8d48b]">speak</span>
              <span className="text-[#a8b8d0]">(</span>
              <span className="text-[#4aecd0]">&apos;Hello world! 😊&apos;</span>
              <span className="text-[#a8b8d0]">)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce z-10">
        <svg className="w-6 h-6 text-[#6b7a8d]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>
    </section>
  );
}
