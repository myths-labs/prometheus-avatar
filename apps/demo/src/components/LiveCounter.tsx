"use client";

import { useState, useEffect } from "react";

interface StatsData {
    users: { total: number; human: number; agent: number; lobster: number };
    assets: number;
    milestone: {
        current: { badge: string; label: string } | null;
        next: { badge: string; label: string; threshold: number } | null;
        progress: number;
        spotsLeft: number;
    };
}

export default function LiveCounter({ variant = "hero" }: { variant?: "hero" | "compact" | "marketplace" }) {
    const [stats, setStats] = useState<StatsData | null>(null);

    useEffect(() => {
        fetch("/api/stats")
            .then(r => r.json())
            .then(setStats)
            .catch(() => {
                // Fallback demo stats
                setStats({
                    users: { total: 14832, human: 11200, agent: 2341, lobster: 847 },
                    assets: 16,
                    milestone: { current: null, next: { badge: "🔥", label: "Genesis (1K)", threshold: 1000 }, progress: 0, spotsLeft: 1000 },
                });
            });
    }, []);

    if (!stats) return null;

    // Hero variant — large, for homepage
    if (variant === "hero") {
        return (
            <div className="flex flex-col items-center gap-3">
                {/* Live user count */}
                <div className="flex flex-wrap justify-center gap-3 text-sm">
                    <span className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[#eae6df]">
                        🔥 <strong className="text-[#00d4aa] tabular-nums">{stats.users.total.toLocaleString()}</strong> Builders
                    </span>
                    <span className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[#eae6df]">
                        🤖 <strong className="text-[#c9a84c] tabular-nums">{stats.users.agent.toLocaleString()}</strong> Agents
                    </span>
                    <span className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[#eae6df]">
                        🦞 <strong className="text-red-400 tabular-nums">{stats.users.lobster.toLocaleString()}</strong> Lobsters
                    </span>
                </div>

                {/* Milestone progress bar */}
                {stats.milestone.next && (
                    <div className="w-full max-w-md">
                        <div className="flex justify-between text-[10px] text-[#7a8a9d] mb-1">
                            <span>{stats.milestone.next.badge} Next: {stats.milestone.next.label}</span>
                            <span className="text-[#c9a84c]">{stats.milestone.spotsLeft.toLocaleString()} spots left</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-[#00d4aa] to-[#c9a84c] transition-all duration-1000"
                                style={{ width: `${Math.min(stats.milestone.progress, 100)}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Compact variant — for header/inline
    if (variant === "compact") {
        return (
            <span className="text-xs text-[#7a8a9d]">
                🔥 {stats.users.total.toLocaleString()} registered
            </span>
        );
    }

    // Marketplace variant
    return (
        <div className="flex items-center gap-4 text-xs text-[#7a8a9d]">
            <span>📊 <strong className="text-[#eae6df]">{stats.users.total.toLocaleString()}</strong> registered</span>
            <span>🛒 <strong className="text-[#eae6df]">{stats.assets.toLocaleString()}</strong>+ assets</span>
            {stats.milestone.next && (
                <span className="text-[#c9a84c]">
                    {stats.milestone.next.badge} {stats.milestone.spotsLeft.toLocaleString()} spots to {stats.milestone.next.label}
                </span>
            )}
        </div>
    );
}
