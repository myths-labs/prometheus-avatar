-- ============================================
-- Prometheus Marketplace Schema
-- ============================================

-- Creators table
CREATE TABLE creators (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_url TEXT,
  is_official BOOLEAN DEFAULT false,
  is_agent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Assets table
CREATE TABLE assets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('skins', 'voices', 'effects', 'motions', 'accessories', 'scenes', 'personas', 'expressions', 'bundles')),
  price DECIMAL(10,2) DEFAULT 0,
  is_free BOOLEAN DEFAULT false,
  thumbnail TEXT,
  creator_id UUID REFERENCES creators(id),
  downloads INTEGER DEFAULT 0,
  rating DECIMAL(2,1) DEFAULT 0,
  badge TEXT CHECK (badge IN ('official', 'ai_created', 'popular', 'new', NULL)),
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

-- Public read access (marketplace is public)
CREATE POLICY "Anyone can read creators" ON creators FOR SELECT USING (true);
CREATE POLICY "Anyone can read assets" ON assets FOR SELECT USING (true);

-- ============================================
-- Seed Data — Official + Community Assets
-- ============================================

-- Insert creators
INSERT INTO creators (name, avatar_url, is_official, is_agent) VALUES
  ('Myths Labs', NULL, true, false),
  ('NekoCraft', NULL, false, false),
  ('ClaudeBot-7x', NULL, false, true),
  ('AvatarForge', NULL, false, false),
  ('GPT-Dance-42', NULL, false, true),
  ('PixelDreamor', NULL, false, false),
  ('SoundWave AI', NULL, false, true);

-- Insert assets with creator references
INSERT INTO assets (name, description, category, price, is_free, thumbnail, creator_id, downloads, rating, badge, tags) VALUES
  -- Official
  ('Arachne Preview Edition', 'Gothic demon spider with gothic lace Arachne-inspired cyberpunk design.', 'skins', 0, true, '🕷️', (SELECT id FROM creators WHERE name = 'Myths Labs'), 1240, 4.9, 'official', '{"gothic","cyberpunk","official"}'),
  ('Thunder God Aura', 'Electric aura effect with dynamic lightning bolts. Official Myths Labs creation.', 'effects', 3.99, false, '⚡', (SELECT id FROM creators WHERE name = 'Myths Labs'), 780, 4.8, 'official', '{"lightning","aura","premium"}'),

  -- Community
  ('Cat Ears Deluxe', 'Animated cat ears that react to avatar emotions. Twitches when surprised!', 'accessories', 0.49, false, '😺', (SELECT id FROM creators WHERE name = 'NekoCraft'), 4500, 4.9, NULL, '{"cat","ears","animated"}'),
  ('Scholar''s Study', 'Cozy library scene with floating books and warm lighting. Created by an AI agent.', 'scenes', 0.99, false, '📚', (SELECT id FROM creators WHERE name = 'ClaudeBot-7x'), 3200, 4.8, 'ai_created', '{"library","cozy","ai"}'),
  ('Cyber Neon Girl', 'Neon-lit cyberpunk avatar with LED eye effects and animated hair.', 'skins', 4.99, false, '👾', (SELECT id FROM creators WHERE name = 'AvatarForge'), 2100, 4.5, NULL, '{"cyberpunk","neon","premium"}'),
  ('Cosmic Dancer Motion Pack', 'Smooth dance animations choreographed by an AI agent. 8 unique motions.', 'motions', 2.49, false, '💃', (SELECT id FROM creators WHERE name = 'GPT-Dance-42'), 1800, 4.4, 'ai_created', '{"dance","animation","pack"}'),
  ('Sakura Breeze', 'Floating cherry blossom petals with gentle wind simulation.', 'effects', 2.99, false, '🌸', (SELECT id FROM creators WHERE name = 'PixelDreamor'), 890, 4.7, NULL, '{"sakura","particles","nature"}'),
  ('Velvet Voice Pack', 'Warm, rich AI voice with natural intonation. Supports EN/JP/ZH.', 'voices', 1.99, false, '🎙️', (SELECT id FROM creators WHERE name = 'SoundWave AI'), 550, 4.5, NULL, '{"voice","multilingual","warm"}'),

  -- More variety
  ('Pixel Art Skin', '8-bit retro pixel art avatar style. Perfect for indie game integrations.', 'skins', 1.49, false, '🎮', (SELECT id FROM creators WHERE name = 'PixelDreamor'), 3400, 4.6, 'popular', '{"pixel","retro","8bit"}'),
  ('Rain Ambience', 'Gentle rain drops falling around your avatar with puddle reflections.', 'effects', 0, true, '🌧️', (SELECT id FROM creators WHERE name = 'Myths Labs'), 6200, 4.8, 'official', '{"rain","ambient","free"}'),
  ('Shy Blush Expression', 'Subtle blushing expression with animated pink cheeks.', 'expressions', 0.99, false, '😊', (SELECT id FROM creators WHERE name = 'NekoCraft'), 2800, 4.7, NULL, '{"blush","expression","cute"}'),
  ('Robot Butler Persona', 'Pre-configured formal AI assistant with bow-tie avatar and polite voice.', 'personas', 3.99, false, '🤖', (SELECT id FROM creators WHERE name = 'ClaudeBot-7x'), 920, 4.3, 'ai_created', '{"robot","formal","persona"}');
