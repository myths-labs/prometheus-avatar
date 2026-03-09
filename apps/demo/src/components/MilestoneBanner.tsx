"use client";

import { useState, useEffect } from "react";

interface MilestoneData {
    current: { badge: string; label: string } | null;
    next: { badge: string; label: string; threshold: number } | null;
    progress: number;
    spotsLeft: number;
}

const MILESTONE_REWARDS: Record<string, { desc: string; color: string }> = {
    "Genesis (1K)": { desc: "🔥 Genesis badge + 500pts + Free Tier forever", color: "from-orange-500/20 to-red-500/20" },
    "Pioneer (10K)": { desc: "⚡ Pioneer badge + 200pts + 3mo membership", color: "from-blue-500/20 to-purple-500/20" },
    "Early Builder (50K)": { desc: "🌟 Early Builder + 100pts + 1mo membership", color: "from-[#00d4aa]/20 to-emerald-500/20" },
    "Explorer (100K)": { desc: "✨ Explorer badge + 50pts", color: "from-[#c9a84c]/20 to-yellow-500/20" },
    "Citizen (500K)": { desc: "🎯 Citizen badge + 20pts", color: "from-gray-500/20 to-slate-500/20" },
};

export default function MilestoneBanner() {
    const [milestone, setMilestone] = useState<MilestoneData | null>(null);
    const [totalUsers, setTotalUsers] = useState(0);

    useEffect(() => {
        fetch("/api/stats")
            .then(r => r.json())
            .then(data => {
                setMilestone(data.milestone);
                setTotalUsers(data.users?.total || 0);
            })
            .catch(() => { });
    }, []);

    if (!milestone?.next) return null;

    const reward = MILESTONE_REWARDS[milestone.next.label];
    const isClose = milestone.progress >= 80; // approaching milestone

    return (
        <div className={`w-full rounded-2xl border overflow-hidden transition-all ${isClose
            ? "border-[#c9a84c]/30 shadow-[0_0_30px_rgba(201,168,76,0.15)]"
            : "border-white/10"
            }`}>
            <div className={`bg-gradient-to-r ${reward?.color || "from-white/5 to-white/5"} p-5`}>
                <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                        <h3 className="text-sm font-semibold text-[#eae6df] flex items-center gap-2">
                            {milestone.next.badge} Next Milestone: {milestone.next.label}
                            {isClose && (
                                <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#c9a84c]/20 text-[#c9a84c] border border-[#c9a84c]/20 animate-pulse">
                                    ALMOST THERE
                                </span>
                            )}
                        </h3>
                        {reward && (
                            <p className="text-xs text-[#a8b8d0] mt-1">{reward.desc}</p>
                        )}
                    </div>
                    <div className="text-right shrink-0">
                        <div className="text-2xl font-bold text-[#eae6df] tabular-nums">
                            {totalUsers.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-[#7a8a9d]">
                            / {milestone.next.threshold.toLocaleString()}
                        </div>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="relative">
                    <div className="h-2 rounded-full bg-black/20 overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-1000 ${isClose
                                ? "bg-gradient-to-r from-[#c9a84c] to-[#e8c84a] animate-pulse"
                                : "bg-gradient-to-r from-[#00d4aa] to-[#c9a84c]"
                                }`}
                            style={{ width: `${Math.min(milestone.progress, 100)}%` }}
                        />
                    </div>
                    <div className="flex justify-between mt-1.5 text-[10px] text-[#7a8a9d]">
                        <span>{milestone.progress}% complete</span>
                        <span className="text-[#c9a84c] font-semibold">
                            {milestone.spotsLeft.toLocaleString()} spots left for {milestone.next.badge} rewards
                        </span>
                    </div>
                </div>

                {/* Early bird urgency */}
                {milestone.spotsLeft > 0 && milestone.spotsLeft <= 200 && (
                    <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 text-center animate-pulse">
                        ⚠️ Only {milestone.spotsLeft} {milestone.next.badge} slots remaining!
                    </div>
                )}
            </div>
        </div>
    );
}
