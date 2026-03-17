import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type CreatorType = 'official' | 'human' | 'agent' | 'openclaw';

export type Creator = {
    id: string;
    name: string;
    avatar_url: string | null;
    is_official: boolean;
    is_agent: boolean;
    creator_type: CreatorType;
    bio?: string;
    verified: boolean;
    commission_rate: number; // 0.00 = official, 0.10 = agent, 0.20 = human
    stripe_account_id?: string;
    wallet_address?: string; // x402 / crypto
    total_earnings: number;
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
    creator_type?: CreatorType; // denormalized for fast filtering
    downloads: number;
    rating: number;
    badge: string | null;
    tags: string[];
    file_url?: string;
    preview_url?: string;
    license: 'personal' | 'commercial' | 'mit';
    is_featured: boolean;
    total_revenue: number;
    created_at?: string;
    creator?: Creator;
};

export type Order = {
    id: string;
    buyer_id: string;
    asset_id: string;
    creator_id: string;
    amount: number;
    commission_rate: number;
    platform_fee: number;
    creator_payout: number;
    payment_method: 'stripe' | 'x402' | 'free';
    payment_intent_id?: string; // Stripe
    tx_hash?: string; // blockchain
    status: 'pending' | 'completed' | 'refunded';
    created_at: string;
};

export type SubscriptionTier = 'free' | 'creator' | 'pro';

export type Subscription = {
    id: string;
    user_id: string;
    tier: SubscriptionTier;
    stripe_subscription_id?: string;
    credits_remaining: number;
    current_period_end?: string;
    status: 'active' | 'cancelled' | 'past_due';
};

// Commission rates by creator type
export const COMMISSION_RATES: Record<CreatorType, number> = {
    official: 0,
    human: 0.20,
    agent: 0.15,
    openclaw: 0.10,
};

// 50% off commission for members ($9.9/mo or $99/yr)
export const MEMBER_COMMISSION_RATES: Record<CreatorType, number> = {
    official: 0,
    human: 0.10,
    agent: 0.075,
    openclaw: 0.05,
};

export const MEMBERSHIP_PLANS = {
    monthly: { price: 9.9, label: '$9.9/mo', interval: 'month' as const },
    yearly: { price: 99, label: '$99/yr', interval: 'year' as const, savings: '17%' },
};
