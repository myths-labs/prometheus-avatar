"use client";

import { useState, useEffect } from "react";

interface LeaderEntry {
    rank: number;
    name: string;
    avatar: string | null;
    identity: string;
    points: number;
    isWeeklyStar: boolean;
}

const IDENTITY_ICONS: Record<string, string> = {
    human: "👤",
    agent: "🤖",
    lobster: "🦞",
};

const RANK_STYLES: Record<number, string> = {
    1: "bg-gradient-to-r from-[#c9a84c]/20 to-[#e8c84a]/10 border-[#c9a84c]/30",
    2: "bg-gradient-to-r from-[#a8b8d0]/15 to-transparent border-[#a8b8d0]/20",
    3: "bg-gradient-to-r from-[#cd7f32]/15 to-transparent border-[#cd7f32]/20",
};

export default function LeaderboardTable({ filter = "all" }: { filter?: "all" | "human" | "agent" | "lobster" }) {
    const [entries, setEntries] = useState<LeaderEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState(filter);

    useEffect(() => {
        fetch("/api/stats")
            .then(r => r.json())
            .then(data => {
                setEntries(data.leaderboard || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const filtered = activeTab === "all"
        ? entries
        : entries.filter(e => e.identity === activeTab);

    return (
        <div className="w-full">
            {/* Identity tabs */}
            <div className="flex gap-1.5 mb-4 bg-white/[0.02] rounded-xl p-1 border border-white/5">
                {(["all", "human", "agent", "lobster"] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${activeTab === tab
                            ? "bg-[#00d4aa]/10 text-[#00d4aa] border border-[#00d4aa]/20"
                            : "text-[#7a8a9d] hover:text-[#a8b8d0]"
                            }`}
                    >
                        {tab === "all" ? "🏆 All" : `${IDENTITY_ICONS[tab]} ${tab.charAt(0).toUpperCase() + tab.slice(1)}`}
                    </button>
                ))}
            </div>

            {/* Leaderboard */}
            <div className="space-y-1.5">
                {loading ? (
                    <div className="text-center py-8 text-[#7a8a9d] text-sm">Loading leaderboard...</div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="text-3xl mb-2">🏆</div>
                        <p className="text-[#7a8a9d] text-sm">Be the first on the leaderboard!</p>
                        <p className="text-[#7a8a9d] text-xs mt-1">Refer friends to earn points and climb the ranks.</p>
                    </div>
                ) : (
                    filtered.map((entry, i) => {
                        const rankStyle = RANK_STYLES[entry.rank] || "bg-white/[0.02] border-white/5";
                        return (
                            <div
                                key={i}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:scale-[1.01] ${rankStyle}`}
                            >
                                {/* Rank */}
                                <div className="w-8 text-center shrink-0">
                                    {entry.rank <= 3 ? (
                                        <span className="text-xl">{["🥇", "🥈", "🥉"][entry.rank - 1]}</span>
                                    ) : (
                                        <span className="text-sm text-[#7a8a9d] font-mono">#{entry.rank}</span>
                                    )}
                                </div>

                                {/* Avatar */}
                                <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm shrink-0 overflow-hidden">
                                    {entry.avatar ? (
                                        <img src={entry.avatar} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        IDENTITY_ICONS[entry.identity] || "👤"
                                    )}
                                </div>

                                {/* Name + identity */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-sm text-[#eae6df] font-medium truncate">{entry.name}</span>
                                        {entry.isWeeklyStar && (
                                            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-[#c9a84c]/15 text-[#c9a84c] border border-[#c9a84c]/20 font-semibold whitespace-nowrap">
                                                ⭐ WEEKLY STAR
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[10px] text-[#7a8a9d]">
                                        {IDENTITY_ICONS[entry.identity]} {entry.identity}
                                    </span>
                                </div>

                                {/* Points */}
                                <div className="text-right shrink-0">
                                    <span className="text-sm font-bold text-[#eae6df] tabular-nums">
                                        {entry.points.toLocaleString()}
                                    </span>
                                    <span className="text-[10px] text-[#c9a84c] ml-1">pts</span>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Weekly reset notice */}
            <div className="flex items-center justify-center gap-2 mt-4 text-[10px] text-[#7a8a9d]">
                <span>⏰ Resets every Sunday 00:00 UTC</span>
                <span>·</span>
                <span>🏆 Top 10 = 500pts + Homepage feature</span>
            </div>
        </div>
    );
}
