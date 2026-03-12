# Changelog

All notable changes to Prometheus Avatar SDK are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [1.0.0] — 2026-03-09

### 🎉 First Public Release

Prometheus goes open-source! The avatar SDK is now available for anyone to give their AI an embodied avatar.

### Added
- **Open-source SDK** — `@prometheus-avatar/core` (21KB) published to npm
- **CONTRIBUTING.md** — contribution guidelines and development setup
- **README rewrite** — hero banner, social links, architecture diagrams, Quick Start guide
- **AI Agent integration guide** — step-by-step guide for connecting LLMs to avatars

### Changed
- Marketplace extracted to private repo (`myths-labs/prometheus-marketplace`)
- Demo app separated from public SDK repo for clean open-source structure
- Internal docs (STATUS, GAMIFICATION_ECONOMICS) moved to private repo

---

## [0.8.0] — 2026-03-09

### Added
- **Gamification System v2.0** — LiveCounter, stats API, milestone progress, leaderboard
- **Celebration effects** — fireworks, rainbow, golden particles on milestones
- **Referral module** — DB schema, API, landing page, share panel
- **Immersive companion UI** — full-screen avatar with glassmorphism overlay chat at `/app`
- **Real GitHub OAuth** — authentication via NextAuth
- **Google OAuth** — with Privacy & Terms pages for compliance
- **PWA install prompt** — installable progressive web app
- **Membership system** — payment page, commission structure, multiple payment methods
- **x402 protocol** — crypto payment method for membership
- **Creator earnings flow** — Points pricing, purchase API, dashboard with withdrawal
- **Airachne migration** — migration page and tiered conversion API (5:1 → 50:1)
- **Agent API key verification** — secure API key management

### Fixed
- Coinbase Commerce removed (HK not supported), kept 6 payment methods
- OAuth env var sanitization — trim trailing newlines from all env vars
- LiveCounter milestone text cleanup, marketplace layout centering
- CI env vars for demo build (Supabase, OAuth, NextAuth)

---

## [0.5.0] — 2026-03-08

### Added
- **Marketplace** — real Supabase data, search, sort, 8 categories
- **Bilingual README** — English + Chinese with features, architecture, quickstart
- **Emotion-based avatar motions** — happy=wave, angry=shake, surprised=head flick
- **Lip-sync mouth animation** — synced to TTS audio output
- **Multi-language TTS** — per-avatar voice personality
- **3 distinct avatars** — centered positioning, unique voice per character

### Fixed
- Chat container scroll — prevent page auto-scroll on new messages
- Live2D rendering via iframe — bypass webpack, load from CDN directly
- Cubism 2 + 4 runtime scripts for proper model rendering
- SSR crash prevention — dynamic imports for pixi.js and Live2D SDKs

---

## [0.1.0] — 2026-03-08

### Added
- **Initial Prometheus MVP** — SDK + Demo + Marketplace + OpenClaw Plugin
- Live2D avatar rendering engine
- Marketplace route with CDN models
- Open-source contribution infrastructure
- Vercel auto-deploy pipeline
