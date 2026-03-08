import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Creator = {
    id: string;
    name: string;
    avatar_url: string | null;
    is_official: boolean;
    is_agent: boolean;
};

export type Asset = {
    id: string;
    name: string;
    description: string;
    category: string;
    price: number;
    is_free: boolean;
    thumbnail: string;
    creator_id: string;
    downloads: number;
    rating: number;
    badge: string | null;
    tags: string[];
    creator?: Creator;
};
