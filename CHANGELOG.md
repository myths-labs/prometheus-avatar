# Changelog

All notable changes to Prometheus Avatar SDK are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased] — core 0.11.4 · mcp-server 0.4.0 · openclaw-plugin 0.11.0

### ⚠️ Release order (hard dependency — do not publish out of order)

1. **Backend first**: Prometheus must be running the build with `POST /api/channels/link/start`, `/link/token`,
   `/publish`, `GET /whoami` and `POST /unlink-self` (seller channels). Without it, connecting says the channel
   is not available yet (the clients handle a 404 and gateway errors in plain words).
2. **`@prometheusavatar/core@0.11.4`** — must reach npm **before** the plugin: `openclaw-plugin@0.11.0`
   declares `^0.11.4`, so publishing the plugin first makes every fresh install fail with ETARGET.
3. **`@prometheusavatar/mcp-server@0.4.0`** (independent of core), then **`@prometheusavatar/openclaw-plugin@0.11.0`**.

### Why the plugin is a rewrite
`openclaw-plugin@0.10.2` cannot be installed on OpenClaw 2026.9.6 (`package.json missing openclaw.extensions`) and
its entry only exported a legacy `activate`. 0.11.0 is written for the current OpenClaw plugin API: a plain default
export with a synchronous `register(api)` and object-form tools, a manifest with `contracts.tools`, and a JSON-Schema
config. It is loaded and exercised against a real OpenClaw 2026.9.6 gateway by `test/loader.real-openclaw.test.mjs`.

### Added
- **core**: `SellerChannelApi` (device-flow client for the seller channels), `SellerChannelError`,
  `AssetCreator.publishViaChannel()` / `publishDraftViaChannel()`; `AssetDeployConfig` gains `price_points`,
  `price_currency`, `persona_config`, `bundle_items`.
- **openclaw-plugin**: seller channel tools `prometheus_connect_seller`, `prometheus_connection_status`,
  `prometheus_publish_listing`, `prometheus_disconnect_seller`; `prometheus_deploy_asset` kept as an alias (publishes
  through the connection when connected, else the API-key deploy). The channel key is kept in OpenClaw plugin state
  when OpenClaw allows it to a third-party plugin, otherwise in a 0600 file under the OpenClaw state directory.
  New config `containerSelector`. Requires OpenClaw 2026.9.6+.
- **mcp-server**: Hermes Agent seller channel: `connect_seller`, `seller_connection_status`, `publish_listing`,
  `disconnect_seller` (14 tools total). Checks `PROMETHEUS_CHANNEL=hermes`, a Hermes ancestor process and the MCP client
  handshake; key in `~/.prometheus/channel-hermes.json` (0600).
- **openclaw-plugin**: avatar state updates: with an agent API key, `model_call_started`, `message_sent` and `model_call_ended` push `thinking` / the emotion of the sent message / `surprised` to `POST /api/agent/avatar/state` (the channel `set_avatar_state` uses), so any open avatar page follows even though the gateway has no page. Transitions only, spaced out; off by itself when the route does not exist or the key is rejected (an account with no avatar yet is tried again once a minute); `companionState: false` turns it off.
- **core / openclaw-plugin / mcp-server**: the token response's `account_hint` (masked account email) is kept with the key and shown by the connection status ("connected to the Prometheus account a***@…"), so someone tricked into approving another person's connection can see the account is wrong; the skills tell the agent to say so and to disconnect on a mismatch.
- **core / openclaw-plugin / mcp-server**: contract v1.4: receiving a key no longer sets the account type. The token response's `next_step` (`link_x`) and `registration_note` (`ACCOUNT_HAS_SELLER_HISTORY`, `IDENTITY_LOCKED`) are told to the user right after approval and by the status (the account becomes an OpenClaw / Hermes seller only once the X account is linked; or why the account will not become one), and the note is kept in the saved key record.
- **skills**: "Sell on Prometheus" in `prometheus-companion` and the plugin's bundled skill.

### Changed
- **openclaw-plugin**: the on-screen avatar now runs only where the host gives the plugin a page element
  (`containerSelector`); the OpenClaw gateway has none, so it logs once and skips (state updates above still work).
  README states the OpenClaw community-list milestone in the past tense with its evidence (PR #52752, merged
  April 20, 2026).

---

### Removed
- **openclaw-plugin**: the `avatar:ready` / `avatar:speak` events and the `events` block of the manifest. They were emitted
  through `context.emit` of the old `activate(context)` entry, which OpenClaw 2026.9.x never calls (its loader only runs
  `register(api)`, checked on 2026.9.6), so they never fired on a current host. There is no replacement.

### Fixed (found by an independent review before release)
- **Status wording**: the connection status no longer calls an account an OpenClaw / Hermes seller unless the server says so
  (`whoami.account.identity_type`). The tier is set only when the account chose the type, has no earlier sales or listings,
  has a linked X account (30 days or older) and holds a valid key; until then the status says that, shows the account's
  current rate, and names the address where the type is chosen (`/join?type=openclaw` or `hermes`). Publish results now say
  "at your account's ... rate".
- **Waiting for approval**: a network drop, a 5xx or a rate limit no longer ends the wait (the approval may still come);
  the polling interval and expiry from the server are bounded (at least 1 s); an approval link that is not https (or http
  on this computer) is refused. Two connect calls at once share one code. Disconnecting while a poll is out drops that
  approval. An "inactive key" answer no longer deletes a key saved by a newer connection.
- **Keys**: a saved key is only sent back to the address that issued it; an API key from the environment goes only to
  the production host (the plugin's tools followed the configured address before); `prometheus_deploy_asset` no longer
  switches to the API key when a connection exists but a check failed, or while an approval is pending; a half-written key
  file is removed when saving fails; text from the server is cleaned before it reaches a model (control, format and direction characters, length; links must be one line and short; the account hint, X handle and dates are reduced to plain characters).
- **Publishing**: after a timeout or a gateway error the result says the listing may already exist instead of "try again"
  (a publish is public and not idempotent). Waits are shown in seconds, minutes or hours, and read from the body's
  `retry_after` when there is no `Retry-After` header.
- **Avatar state**: a finished message pushes `{ emotion }` alone (the server replaces the whole state and the avatar page
  reads `state` before `emotion`, so `done` + emotion always showed the same expression); a newer state is no longer lost
  behind a request still in flight; failed pushes are retried for up to 30 s; a 404 with an error text ("no avatar yet")
  pauses the pushes for a minute instead of switching them off for good.
- **Hermes detection**: the process-table probe has a per-call and a total time budget, so it cannot stall the stdio server.
- **Second review pass** (of the fixes above, against contract v1.6): an account that already has the other channel's tier is told it will not become this channel's seller, and an unlinked X is described as needed to *publish* (not to "become" a seller), and is not mentioned at all for an account that will not become one; `unlink-self`'s `kept` (listings with buyers stay visible) is shown, and asking to hide listings with an already inactive key says nothing was hidden; "the listing may already exist" is said only when the request may have been processed (dropped connection, an answer cut off after the status line, 500/502/504), not for a missing route or 503, and the server's own message stays; the API-key deploy keeps the server's explanation, fix link and wait; invisible and direction-changing Unicode characters are removed; the test double now keeps the tier once set and applies the X and daily gates only to a tiered account. Seen on a real server (contract v1.6, local run): asking to hide listings while the account has no tier yet hides nothing, so the disconnect says "the server hid no listing" instead of implying they were withdrawn.
- **Docs**: configuration paths follow the real host (`plugins.entries.prometheus-avatar.config`), tool counts are current,
  and the two version badges in the root README now read npm.

## [Released 2026-07-30] — core 0.11.3 · mcp-server 0.3.5 · openclaw-plugin 0.10.2

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
