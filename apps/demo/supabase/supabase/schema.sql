-- Prometheus Marketplace — Supabase Schema
-- Run these SQL statements in the Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== CREATORS =====
CREATE TABLE creators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  is_official BOOLEAN DEFAULT false,  -- Myths Labs official account
  is_agent BOOLEAN DEFAULT false,     -- AI agent creator
  agent_platform TEXT,                -- e.g. 'openclaw', 'claude', 'gpt'
  wallet_address TEXT,                -- for x402 crypto payments
  stripe_account_id TEXT,             -- for Stripe Connect payouts
  total_earnings DECIMAL(12,2) DEFAULT 0,
  total_sales INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== AVATAR ASSETS =====
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'skins', 'voices', 'effects', 'motions', 'accessories',
    'scenes', 'personas', 'expressions', 'bundles', 'plugins'
  )),
  price DECIMAL(8,2) DEFAULT 0,       -- 0 = free
  currency TEXT DEFAULT 'USD',
  is_official BOOLEAN DEFAULT false,   -- Official Myths Labs asset (100% revenue)
  is_agent_created BOOLEAN DEFAULT false,
  
  -- Files
  model_url TEXT,                      -- Main model file URL (Supabase Storage)
  preview_url TEXT,                    -- Preview image/GIF
  thumbnail_url TEXT,                  -- Thumbnail
  file_size_bytes BIGINT,
  
  -- Metadata
  tags TEXT[] DEFAULT '{}',
  compatibility TEXT[] DEFAULT '{live2d}',  -- 'live2d', 'vrm', 'both'
  version TEXT DEFAULT '1.0.0',
  
  -- Stats
  downloads INTEGER DEFAULT 0,
  rating_avg DECIMAL(3,2) DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  
  -- Review
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== TRANSACTIONS =====
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID REFERENCES assets(id),
  buyer_id UUID REFERENCES auth.users(id),
  creator_id UUID REFERENCES creators(id),
  
  amount DECIMAL(8,2) NOT NULL,
  platform_fee DECIMAL(8,2) NOT NULL,     -- 10-20% for community, 0% for official
  creator_payout DECIMAL(8,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  
  payment_method TEXT CHECK (payment_method IN ('stripe', 'x402_usdc', 'x402_usdt', 'free')),
  payment_id TEXT,                          -- Stripe payment intent ID or x402 tx hash
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'refunded')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== REVIEWS (User ratings) =====
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asset_id, user_id)  -- one review per user per asset
);

-- ===== INDEXES =====
CREATE INDEX idx_assets_category ON assets(category);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_creator ON assets(creator_id);
CREATE INDEX idx_assets_official ON assets(is_official) WHERE is_official = true;
CREATE INDEX idx_transactions_buyer ON transactions(buyer_id);
CREATE INDEX idx_transactions_creator ON transactions(creator_id);

-- ===== ROW LEVEL SECURITY =====
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Public read for approved assets
CREATE POLICY "Public read approved assets" ON assets
  FOR SELECT USING (status = 'approved');

-- Creators can manage their own assets
CREATE POLICY "Creators manage own assets" ON assets
  FOR ALL USING (creator_id IN (
    SELECT id FROM creators WHERE user_id = auth.uid()
  ));

-- Users can read their own transactions
CREATE POLICY "Users read own transactions" ON transactions
  FOR SELECT USING (buyer_id = auth.uid());

-- Users can create reviews
CREATE POLICY "Users create reviews" ON reviews
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Public read for reviews  
CREATE POLICY "Public read reviews" ON reviews
  FOR SELECT USING (true);
