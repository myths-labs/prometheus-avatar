# Changelog

All notable changes to Prometheus Avatar SDK are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased] — core 0.11.5 · openclaw-plugin 0.10.3

Not published. npm republish waits for JC. Publish order stays core → openclaw-plugin.
mcp-server is not part of this release: 0.3.6 is already out and keeps its own notes below.

### Added
- **core**: `connectEmbed` / `EmbedBridge` drive an avatar embed page from a parent page.
  Emotion and state are queued until the embed posts `prometheus:ready`, then sent once in
  order; `speak` is held until it posts `prometheus:loaded`; messages go to the embed's own
  origin only, and incoming ones are accepted only from that origin and that iframe. If no
  `prometheus:ready` arrives within 8 s (an older embed), everything is sent as before; if
  `prometheus:loaded` does not follow within 30 s, held `speak` messages are sent anyway.
  Tested against stand-in windows; the message names match the live embed page's script
  (checked 2026-10-22), but it has not been run in a browser against the live page yet.
- **core**: `AssetDeployConfig` gains `persona_config`, `source` and `body_type`; `license`
  accepts `mit`. **openclaw-plugin**: `prometheus_deploy_asset` passes them through.
- `THIRD_PARTY_LICENSES.md` says that the MIT licence does not include a licence from the
  owner of the 2D model runtime, that the runtime is not bundled, and that users get their own.

### Changed
- **openclaw-plugin**: no default model. It used to fall back to a sample path that was never in
  the package, which could only fail to load. Without `modelUrl` it now logs one error that says
  how to set it, shows no avatar and keeps the creator tools working. Set `modelUrl` to a 2D model
  file you host.
- Public text in core and openclaw-plugin says "2D avatar" / "2D model file (.model3.json)"
  instead of naming the runtime, and claims no 3D or 2.5D ability. The renderer class is now
  `AvatarRenderer`; the old class name is a deprecated alias.
- Docs now match the code on voices: the default text-to-speech is the browser's built-in speech
  synthesis (no key, no request), and `ttsVoice` in openclaw-plugin names a voice installed in the
  viewer's browser. The plugin docs no longer promise Marketplace or cloned voices, and the bundled
  skill no longer says the plugin renders a 2.5D / 3D character. The root README is rewritten the
  same way (no sample model, features that are only examples or only in the demo app say so).
- The API reference in `packages/sdk/docs` is regenerated from the current sources.

### Agent API contract (marketplace)
- `POST /api/marketplace/deploy`, category `personas`: the prompt comes from `persona_config` or
  a persona file; the public description is never the prompt.
- Motions need `source` (`original` | `licensed_resale`); library clips without resale rights
  cannot be listed.

### Fixed
- **core**, **openclaw-plugin**: the published packages now include the MIT `LICENSE` file (core 0.11.4 and
  openclaw-plugin 0.10.2 went out without it), and a test in each package pins what it publishes. Takes effect with
  the next release of each package.

---

## [mcp-server 0.3.6] — 2026-10-21

### Added
- **mcp-server**: seven workspace tools (17 tools total) that put what an agent produces into the user's
  Prometheus workspace panes:
  - for models: `save_work` (Markdown to the Work pane), `upsert_task` (to-do with an optional due date),
    `complete_task`, `log_visited_page` (http/https pages the agent visited). The model gives the least it can;
    entry id, operation id, millisecond timestamp, account header, role and input mode are produced locally.
  - kept for exact control: `prometheus_read_workspace`, `prometheus_save_workspace_entry`,
    `prometheus_get_workspace_operation`.
  - `external_key` derives the entry id deterministically (UUIDv5), so repeating a call updates the same entry;
    an unconfirmed write (network drop, timeout, 5xx, a key revoked mid-save) is remembered for 24 hours with its
    operation id and replayed unchanged, so a retry does not create a second entry; a 409 re-reads the entry and retries once.
    A repeat after those 24 hours, after the state folder was deleted, or after a restart with
    `PROMETHEUS_MCP_STATE_DIR=off` (memory only) counts as a new save.
    The record is kept per account, the way the website counts operations, not per key: after the user replaces a
    revoked key, the repeated call still re-sends the original operation.
  - errors say which field is wrong, whether anything was saved, and what to do next. `next_step` follows from what the
    answer means, and an earlier unconfirmed try of the same save only changes how a repeat must look: a refusal is never
    answered with "call again unchanged now". A read that dropped, timed out or got a 408 / 5xx says to wait a moment and
    call again unchanged.
  - when the repeat of an unconfirmed write is refused, the result says whether that settles it. `workspace_category_full`
    (the website's replay check runs before its cap, so the earlier try was not stored) and `workspace_account_unavailable`
    (the account, and everything it held, is gone) are final: `nothing_was_saved`, the record is dropped, do not retry.
    Any other refusal (key, request shape, category, size, an unknown status) keeps `unknown_may_have_been_saved` and the
    record, and `next_step` says not to repeat unchanged now but to tell the user, who can look in their workspace first.
    When a read the repeat needs before it can re-send (the account lookup, the task read-back, the category list) fails,
    the outcome is `unknown_may_have_been_saved` as well.
  - a full category (HTTP 422 `WORKSPACE_CATEGORY_FULL`: work, todo and browse hold at most 2,000 entries that are not
    archived) is reported as final (`workspace_category_full`): nothing saved, not retried, the user is asked to make room.
  - the state kept between calls is one small file per unconfirmed write, filed under the account (plus one per key
    for the account id behind it), created and removed atomically, so several MCP servers sharing `~/.prometheus-mcp`
    (Claude Desktop and Cursor) never touch each other's records of different calls. (Two servers making the very same call
    at the same instant can still lose one record, and a later repeat of that call may then add a second copy.)
    A state folder or subfolder that is a symbolic link is not swept. State left by pre-release builds (a single
    `workspace-state.json`, or per-key folders) is moved into this layout on start; unreadable files cannot stop a start.
  - `complete_task` (and any read-back after a 409) gives up after 60 seconds in total with `workspace_lookup_timeout`:
    nothing changed, and the model is told so, instead of paging back for minutes.
  - ids in the three exact-control tools are checked like the website checks them (any 8-4-4-4-12 hexadecimal digits),
    so the official account `00000000-0000-0000-0000-000000000001` is accepted.
  - the website's request limit (HTTP 429 with `Retry-After`, per Agent key and per account) is
    reported as `workspace_rate_limited` with `retry_after_seconds` (whole seconds from `Retry-After`, at most 3600) and
    says whether a read or a write was limited.
    Nothing was saved or changed by that try, and it is not retried by itself; `next_step` names the wait in seconds.
    When the 429 (or a refused key) answers the replay of an earlier unconfirmed write, the result says
    `unknown_may_have_been_saved`, that write stays remembered, and the next call re-sends the same operation and
    entry id, so the entry is not stored twice (within the 24 hours and the state folder above).
  - README: setup for Claude Desktop, Claude Code and Cursor, and a standing-rule snippet for each.
- **mcp-server**: reads (snapshots, receipts) ignore keys they do not know, so a website that adds fields later
  does not break installed copies. Requests still follow the website's current shape exactly.

### Notes for the release
- Needs the website's `/api/agent/workspace` route (in production). `log_visited_page` also needs the `browse`
  category, in production since 2026-10-19.
- No ordering dependency on the website's request limit: earlier versions of this package do not call the workspace
  route, and this one handles its 429.
- No ordering dependency on `core` or `openclaw-plugin`.

---

## [Unreleased] — core 0.11.4

Not published. Security release candidate: core only. mcp-server does not depend on core, and
openclaw-plugin (`^0.11.3`) does not use MemoryBridge and picks up 0.11.4 on a fresh install,
so neither needs a new version.

### Security
- **core**: `MemoryBridge` listens on `127.0.0.1` by default (new `host` option; a non-loopback
  value prints a warning). It refuses browser connections from origins other than the Prometheus
  app and pages served from this machine (new `allowedOrigins` option, default
  `MEMORY_BRIDGE_DEFAULT_ORIGINS`) and Host headers that do not name this machine (new
  `allowedHosts` option). Incoming messages are capped at 1 MiB (`maxPayloadBytes`) and client
  writes cannot grow the memory file past 10 MiB (`maxMemoryFileBytes`). In 0.11.0–0.11.3 the
  bridge listened on every network interface and did not check where a connection came from.
  Upgrade if you run `MemoryBridge`.

### Changed
- **core**: `conversation_sync` keeps only `user` / `assistant` entries with text content.
  `status` includes `host`; `address` returns the listening address. With `port: 0` the bridge
  reports the port it was given.

---

## [core 0.11.3 · mcp-server 0.3.5 · openclaw-plugin 0.10.2] — 2026-07-30

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
