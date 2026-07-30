# Changelog

All notable changes to Prometheus Avatar SDK are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased] — core 0.11.3 · mcp-server 0.3.5 · openclaw-plugin 0.10.2

### ⚠️ Release order (hard dependency — do not publish out of order)

1. **Backend first**: the Prometheus platform must be running a build that includes
   `POST /api/agent/avatar/state` (used by the new `set_avatar_state` tool) and the
   `/settings/agent-keys` self-serve key page (linked from every key-guidance message).
   Publishing the packages before that deploy makes the flagship tool 404 and every
   key link a dead link.
2. **`@prometheusavatar/core@0.11.3`** — must reach npm **before** the plugin:
   `openclaw-plugin@0.10.2` declares `^0.11.3`, so publishing the plugin first makes
   every fresh install fail with ETARGET.
3. **`@prometheusavatar/mcp-server@0.3.5`**, then **`@prometheusavatar/openclaw-plugin@0.10.2`**.

### Added
- **core**: `AssetCreator` accepts an agent API key (2nd constructor arg, falls back to
  `PROMETHEUS_API_KEY` env var on the default production host only) and sends
  `Authorization: Bearer` on deploy / thumbnail / image calls — the live marketplace
  gate rejects unauthenticated writes, so deploys without this always failed with 401.
- **mcp-server**: `set_avatar_state` tool (10 tools total) — pushes companion state
  (thinking/acting/listening/done) + emotion to live embeds.
- **openclaw-plugin**: `apiKey` config option; creator tools now register in headless
  (no-container) environments instead of being silently dropped.

### Fixed
- **mcp-server**: `equip_asset` and `get_avatar_status` now call the agent-key routes
  (`/api/agent/equip`, `GET /api/agent/avatar`) instead of a human-session-only route
  that rejected every agent key with 403.
- **core / openclaw-plugin**: marketplace deploy categories now match the server's
  accepted values (`skins`/`voices`/`effects`/`motions`/`accessories`/`scenes`/`personas`/`expressions`) —
  the previous enum had zero overlap with the server and every deploy failed with 400.
- Stale version carriers aligned (plugin manifest 0.10.0→0.10.2, root README badge and
  tool count, per-package npm lockfiles removed in favor of `pnpm-lock.yaml`).

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
