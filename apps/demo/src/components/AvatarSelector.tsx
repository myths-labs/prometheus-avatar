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

export default function AvatarSelector({ avatars, selected, onSelect }: AvatarSelectorProps) {
    return (
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            {avatars.map((avatar) => (
                <button
                    key={avatar.id}
                    onClick={() => onSelect(avatar)}
                    className={`relative glass p-3 sm:p-4 text-center transition-all duration-200 min-w-[100px] sm:min-w-[120px] hover:bg-[rgba(0,212,170,0.05)] ${selected.id === avatar.id ? "!border-[#00d4aa]/40 glow-teal scale-105" : ""
                        }`}
                >
                    {avatar.badge === "official" && (
                        <div className="absolute -top-2 -right-2 bg-gradient-to-r from-[#00d4aa] to-[#c9a84c] text-[#06080e] text-[10px] font-bold px-2 py-0.5 rounded-full">
                            OFFICIAL
                        </div>
                    )}
                    <div className="text-3xl mb-2">{avatar.thumbnail}</div>
                    <div className="text-sm font-medium text-[#eae6df]">{avatar.name}</div>
                    <div className="text-xs text-[#7a8a9d] mt-0.5">{avatar.description}</div>
                </button>
            ))}
        </div>
    );
}
