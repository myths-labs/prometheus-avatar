"use client";

interface Avatar {
    id: string;
    name: string;
    description: string;
    modelUrl: string;
    thumbnail: string;
    badge: string;
}

interface AvatarSelectorProps {
    avatars: Avatar[];
    selected: Avatar;
    onSelect: (avatar: Avatar) => void;
}

export default function AvatarSelector({
    avatars,
    selected,
    onSelect,
}: AvatarSelectorProps) {
    return (
        <div className="flex items-center justify-center gap-4">
            {avatars.map((avatar) => (
                <button
                    key={avatar.id}
                    onClick={() => onSelect(avatar)}
                    className={`relative glass p-4 text-center transition-all duration-200 min-w-[120px] hover:bg-white/[0.06] ${selected.id === avatar.id
                            ? "!border-purple-500/50 glow-purple scale-105"
                            : ""
                        }`}
                >
                    {/* Official badge */}
                    {avatar.badge === "official" && (
                        <div className="absolute -top-2 -right-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                            OFFICIAL
                        </div>
                    )}

                    {/* Avatar thumbnail */}
                    <div className="text-3xl mb-2">{avatar.thumbnail}</div>

                    {/* Name */}
                    <div className="text-sm font-medium text-white">{avatar.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                        {avatar.description}
                    </div>
                </button>
            ))}
        </div>
    );
}
