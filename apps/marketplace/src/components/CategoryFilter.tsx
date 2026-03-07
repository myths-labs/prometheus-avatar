"use client";

interface Category {
    id: string;
    label: string;
    icon: string;
}

interface CategoryFilterProps {
    categories: Category[];
    selected: string;
    onSelect: (id: string) => void;
}

export default function CategoryFilter({
    categories,
    selected,
    onSelect,
}: CategoryFilterProps) {
    return (
        <div className="flex flex-wrap justify-center gap-2">
            {categories.map((cat) => (
                <button
                    key={cat.id}
                    onClick={() => onSelect(cat.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm transition-all ${selected === cat.id
                            ? "bg-purple-500/20 border border-purple-500/40 text-purple-300"
                            : "bg-white/5 border border-transparent text-gray-400 hover:bg-white/8 hover:text-gray-300"
                        }`}
                >
                    <span>{cat.icon}</span>
                    <span>{cat.label}</span>
                </button>
            ))}
        </div>
    );
}
