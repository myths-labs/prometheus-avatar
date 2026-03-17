-- ═══════════════════════════════════════════════
-- Prometheus Marketplace — Supabase Schema v2
-- Run this in Supabase SQL Editor
-- 
-- WARNING: This will DROP and recreate tables!
-- Only run this on a fresh database or if you want to reset.
-- ═══════════════════════════════════════════════

-- Drop existing tables (CASCADE removes policies + indexes automatically)
DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS creators CASCADE;

-- ═══ Creators ═══
CREATE TABLE creators (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    avatar_url TEXT,
    is_official BOOLEAN DEFAULT FALSE,
    is_agent BOOLEAN DEFAULT FALSE,
    creator_type TEXT DEFAULT 'human',
    verified BOOLEAN DEFAULT FALSE,
    commission_rate DECIMAL(4,2) DEFAULT 0.20,
    total_earnings DECIMAL(12,2) DEFAULT 0,
    wallet_address TEXT,
    stripe_account_id TEXT,
    github_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ═══ Assets ═══
CREATE TABLE assets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    price DECIMAL(10,2) DEFAULT 0,
    is_free BOOLEAN DEFAULT TRUE,
    thumbnail TEXT,
    file_url TEXT,
    file_size INTEGER,
    downloads INTEGER DEFAULT 0,
    rating DECIMAL(3,1) DEFAULT 0,
    badge TEXT,
    tags TEXT[] DEFAULT '{}',
    creator_id UUID REFERENCES creators(id),
    creator_type TEXT,
    is_featured BOOLEAN DEFAULT FALSE,
    license TEXT DEFAULT 'personal',
    total_revenue DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ═══ Purchases ═══
CREATE TABLE purchases (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset_id UUID REFERENCES assets(id),
    buyer_email TEXT,
    payment_method TEXT,
    amount DECIMAL(10,2) DEFAULT 0,
    currency TEXT DEFAULT 'usd',
    commission_rate DECIMAL(4,2),
    platform_fee DECIMAL(10,2) DEFAULT 0,
    creator_payout DECIMAL(10,2) DEFAULT 0,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    x402_tx_hash TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ═══ RLS ═══
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read assets" ON assets FOR SELECT USING (true);
CREATE POLICY "Public read creators" ON creators FOR SELECT USING (true);
CREATE POLICY "Public insert assets" ON assets FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update assets" ON assets FOR UPDATE USING (true);
CREATE POLICY "Service role purchases" ON purchases FOR ALL USING (true);

-- ═══ Indexes ═══
CREATE INDEX idx_assets_category ON assets(category);
CREATE INDEX idx_assets_creator ON assets(creator_id);
CREATE INDEX idx_assets_featured ON assets(is_featured);
CREATE INDEX idx_purchases_asset ON purchases(asset_id);
CREATE INDEX idx_purchases_email ON purchases(buyer_email);

-- ═══════════════════════════════════════════════
-- Seed Data: 8 Creators + 16 Assets
-- ═══════════════════════════════════════════════

INSERT INTO creators (id, name, is_official, creator_type, verified, commission_rate) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Myths Labs', TRUE, 'official', TRUE, 0),
    ('00000000-0000-0000-0000-000000000002', 'VoiceCraft Studio', FALSE, 'human', TRUE, 0.20),
    ('00000000-0000-0000-0000-000000000003', 'SpeechForge AI', FALSE, 'agent', TRUE, 0.15),
    ('00000000-0000-0000-0000-000000000004', 'PixelDream', FALSE, 'human', FALSE, 0.20),
    ('00000000-0000-0000-0000-000000000005', 'MotionStudio', FALSE, 'human', TRUE, 0.20),
    ('00000000-0000-0000-0000-000000000006', 'CraftyLobster #42', FALSE, 'lobster', TRUE, 0.10),
    ('00000000-0000-0000-0000-000000000007', 'SceneGen AI', FALSE, 'agent', TRUE, 0.15),
    ('00000000-0000-0000-0000-000000000008', 'AudioLobster #7', FALSE, 'lobster', TRUE, 0.10);

INSERT INTO assets (name, description, category, price, is_free, thumbnail, downloads, rating, badge, tags, creator_id, creator_type, is_featured, license, total_revenue) VALUES
    ('Haru — School Uniform', 'Classic anime avatar with full expression set and idle animations', 'skins', 0, TRUE, '/previews/skin-haru.png', 12400, 4.9, 'official', ARRAY['live2d','anime'], '00000000-0000-0000-0000-000000000001', 'official', TRUE, 'mit', 0),
    ('Shizuku — Evening Dress', 'Elegant evening gown variant with sparkle effects', 'skins', 4.99, FALSE, '/previews/skin-evening.png', 8200, 4.8, 'official', ARRAY['live2d'], '00000000-0000-0000-0000-000000000001', 'official', TRUE, 'commercial', 24590),
    ('Sakura Voice Pack', 'Sweet Japanese female voice — warm, friendly', 'voices', 2.99, FALSE, '/previews/voice-sakura.png', 15600, 4.7, 'popular', ARRAY['voice','japanese'], '00000000-0000-0000-0000-000000000002', 'human', FALSE, 'personal', 37310),
    ('Natural Chinese Voice', 'Native Mandarin with natural intonation', 'voices', 3.99, FALSE, '/previews/voice-chinese.png', 9800, 4.9, 'popular', ARRAY['voice','chinese'], '00000000-0000-0000-0000-000000000003', 'agent', FALSE, 'commercial', 31206),
    ('Particle Aura', 'Glowing particles that react to emotions', 'effects', 1.99, FALSE, '/previews/effect-particle.png', 6300, 4.5, NULL, ARRAY['effect'], '00000000-0000-0000-0000-000000000004', 'human', FALSE, 'personal', 10017),
    ('Cherry Blossom Rain', 'Beautiful falling sakura petals background', 'effects', 0, TRUE, '/previews/effect-sakura.png', 18900, 4.8, 'official', ARRAY['effect','free'], '00000000-0000-0000-0000-000000000001', 'official', TRUE, 'mit', 0),
    ('K-pop Dance Pack', '5 dance animations: K-pop, waltz, hip-hop, ballet, folk', 'motions', 5.99, FALSE, '/previews/motion-kpop.png', 4200, 4.6, NULL, ARRAY['motion'], '00000000-0000-0000-0000-000000000005', 'human', FALSE, 'personal', 20118),
    ('Cat Ears & Tail', 'Nekomimi accessories — ears react to emotions', 'accessories', 1.49, FALSE, '/previews/skin-haru.png', 11200, 4.9, 'popular', ARRAY['accessory','cute'], '00000000-0000-0000-0000-000000000006', 'lobster', FALSE, 'commercial', 13328),
    ('Cyberpunk Neon Room', 'Futuristic scene with neon signs and rain', 'scenes', 3.49, FALSE, '/previews/scene-cyberpunk.png', 5700, 4.7, NULL, ARRAY['scene'], '00000000-0000-0000-0000-000000000007', 'agent', FALSE, 'commercial', 15894),
    ('Cozy Café Scene', 'Warm coffee shop with ambient sounds and steam', 'scenes', 0, TRUE, '/previews/scene-cafe.png', 14300, 4.8, 'official', ARRAY['scene','free'], '00000000-0000-0000-0000-000000000001', 'official', TRUE, 'mit', 0),
    ('Tsundere Persona', 'Classic tsundere behavior with dynamic emotion shifts', 'personas', 2.49, FALSE, '/previews/skin-evening.png', 7800, 4.6, NULL, ARRAY['persona'], '00000000-0000-0000-0000-000000000003', 'agent', FALSE, 'personal', 15522),
    ('Extended Emotion Pack', '12 extra expressions: smug, embarrassed, sleepy, excited', 'expressions', 1.99, FALSE, '/previews/effect-particle.png', 9100, 4.8, 'official', ARRAY['expression'], '00000000-0000-0000-0000-000000000001', 'official', TRUE, 'commercial', 14491),
    ('Starter Bundle', 'Haru skin + voice pack + effects + expressions', 'bundles', 0, TRUE, '/previews/bundle-starter.png', 22100, 4.9, 'official', ARRAY['bundle','starter'], '00000000-0000-0000-0000-000000000001', 'official', TRUE, 'mit', 0),
    ('Creator Pro Bundle', 'Premium: 3 skins + 2 voices + 5 scenes + all effects', 'bundles', 19.99, FALSE, '/previews/bundle-starter.png', 3400, 4.9, 'popular', ARRAY['bundle'], '00000000-0000-0000-0000-000000000001', 'official', TRUE, 'commercial', 54366),
    ('Deep Male Voice', 'Professional narrator — perfect for serious AI assistants', 'voices', 2.99, FALSE, '/previews/voice-sakura.png', 6700, 4.5, NULL, ARRAY['voice','male'], '00000000-0000-0000-0000-000000000008', 'lobster', FALSE, 'commercial', 16026),
    ('Idle Fidget Animations', 'Natural idle movements — hair play, stretching', 'motions', 0, TRUE, '/previews/motion-kpop.png', 16500, 4.7, 'official', ARRAY['motion','free'], '00000000-0000-0000-0000-000000000001', 'official', FALSE, 'mit', 0);

-- ═══════════════════════════════════════════════
-- Referral Program + Points Economy
-- ═══════════════════════════════════════════════

-- Drop if re-running
DROP TABLE IF EXISTS lifetime_memberships CASCADE;
DROP TABLE IF EXISTS point_transactions CASCADE;
DROP TABLE IF EXISTS point_accounts CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;

-- ═══ Points Accounts ═══
CREATE TABLE point_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_email TEXT UNIQUE NOT NULL,
    user_name TEXT,
    provider TEXT, -- 'github','google'
    provider_id TEXT,
    avatar_url TEXT,
    balance INTEGER DEFAULT 0,
    lifetime_earned INTEGER DEFAULT 0,
    referral_code TEXT UNIQUE NOT NULL,
    identity_type TEXT DEFAULT 'human', -- 'human','agent','lobster'
    is_airachne_user BOOLEAN DEFAULT false,
    airachne_points_imported INTEGER DEFAULT 0,
    has_lifetime_membership BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ Points Transactions ═══
CREATE TABLE point_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    account_id UUID REFERENCES point_accounts(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- positive=earn, negative=spend
    type TEXT NOT NULL, -- 'referral','purchase_bonus','daily','upload','redeem_membership','redeem_item','discount','airachne_import','signup_bonus'
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ Referral Tracking ═══
CREATE TABLE referrals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    referrer_account_id UUID REFERENCES point_accounts(id) ON DELETE CASCADE,
    referred_account_id UUID REFERENCES point_accounts(id) ON DELETE SET NULL,
    referral_code TEXT NOT NULL,
    referred_email TEXT,
    status TEXT DEFAULT 'pending', -- 'pending','registered','purchased'
    identity_type TEXT, -- 'human','agent','lobster'
    channel TEXT, -- 'web','moltbook','api','telegram','x','discord','wechat'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ Lifetime Membership Slots ═══
CREATE TABLE lifetime_memberships (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    account_id UUID REFERENCES point_accounts(id) ON DELETE CASCADE UNIQUE,
    airachne_points_used INTEGER NOT NULL DEFAULT 0,
    slot_number SERIAL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ RLS ═══
ALTER TABLE point_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifetime_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read point_accounts" ON point_accounts FOR SELECT USING (true);
CREATE POLICY "Public insert point_accounts" ON point_accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update point_accounts" ON point_accounts FOR UPDATE USING (true);
CREATE POLICY "Public all point_transactions" ON point_transactions FOR ALL USING (true);
CREATE POLICY "Public all referrals" ON referrals FOR ALL USING (true);
CREATE POLICY "Public read lifetime_memberships" ON lifetime_memberships FOR SELECT USING (true);
CREATE POLICY "Public insert lifetime_memberships" ON lifetime_memberships FOR INSERT WITH CHECK (true);

-- ═══ Indexes ═══
CREATE INDEX idx_point_accounts_email ON point_accounts(user_email);
CREATE INDEX idx_point_accounts_referral_code ON point_accounts(referral_code);
CREATE INDEX idx_point_transactions_account ON point_transactions(account_id);
CREATE INDEX idx_referrals_code ON referrals(referral_code);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_account_id);

-- ═══ Marketplace Transactions (Points-based purchases) ═══
CREATE TABLE IF NOT EXISTS marketplace_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset_id TEXT NOT NULL,
    asset_name TEXT,
    buyer_id TEXT NOT NULL,
    buyer_name TEXT,
    seller_id TEXT,
    payment_method TEXT DEFAULT 'points',
    amount_points INTEGER NOT NULL DEFAULT 0,
    platform_fee_points INTEGER DEFAULT 0,
    seller_payout_points INTEGER DEFAULT 0,
    commission_rate NUMERIC(4,2) DEFAULT 0.20,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ Withdrawal Requests (Points → USDC) ═══
CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount_points INTEGER NOT NULL,
    amount_usdc NUMERIC(10,2) NOT NULL,
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT DEFAULT 'pending',  -- pending → processing → completed → failed
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Add price_points column to marketplace_assets if not exists
ALTER TABLE marketplace_assets ADD COLUMN IF NOT EXISTS price_points INTEGER DEFAULT 0;
ALTER TABLE marketplace_assets ADD COLUMN IF NOT EXISTS sales_count INTEGER DEFAULT 0;
