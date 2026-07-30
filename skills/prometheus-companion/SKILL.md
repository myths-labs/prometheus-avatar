---
name: prometheus-companion
description: Use when your user wants a visual companion, avatar, virtual character, 虚拟形象, or "waifu" to accompany them while you work — summoning an embodied Live2D avatar that speaks and follows your task state (thinking/acting/done) via the Prometheus platform.
---

# Prometheus Companion

Give your user a live, animated companion in one browser tab: create an avatar, hand them the embed URL, then push your real task state to it as you work. No GPU, no local install, no WebSocket bridge — open embed pages poll the platform every ~3 s and update themselves.

## Prerequisites

- An agent API key (`pak_...`) in the `PROMETHEUS_API_KEY` environment variable.
  No key → send the user to <https://prometheus.mythslabs.ai/settings/agent-keys> (sign in with Google/GitHub, click Generate key — shown once). Never read or print the key value; reference it as `$PROMETHEUS_API_KEY`.
- If the `@prometheusavatar/mcp-server` MCP server is configured, **prefer its tools** (`create_avatar`, `set_avatar_state`, `speak`, `share_avatar`, `equip_asset`, `get_avatar_status`, …) over raw HTTP — same contracts, structured errors.

## Quick reference (raw HTTP — all under `https://prometheus.mythslabs.ai`)

Auth on every call: `Authorization: Bearer $PROMETHEUS_API_KEY` + `Content-Type: application/json`.

| Action | Call | Body | Notes |
|---|---|---|---|
| Create avatar | `POST /api/agent/avatar` | `{"model":"haru","voice":"Kore","persona":"..."}` | All fields optional. `model`: `haru`/`shizuku`/`koharu` or a `.model3.json` URL. **Synchronous** — response has `avatarId` + `embedUrl`, no task polling. |
| Show it | open `embedUrl` | — | Or embed: `<iframe src="{embedUrl}" width="400" height="600" allow="microphone"></iframe>`. `?speak=Hello` makes it greet on load. |
| Push state | `POST /api/agent/avatar/state` | `{"state":"thinking"}` and/or `{"emotion":"happy"}` | `state` ∈ `listening\|thinking\|acting\|done`; `emotion` ∈ `happy\|sad\|angry\|surprised\|thinking\|neutral`. At least one required. Open embeds apply it within ~3 s. |
| Speak | `POST /api/agent/speak` | `{"text":"Tests passed!"}` | `text` ≤ 2000 chars. Returns audio; embeds lip-sync. |
| Status | `GET /api/agent/avatar` | — | Current avatar, equipped assets, `embedUrl`. `{"avatar":null,...}` = create one first. |
| Equip | `POST /api/agent/equip` | `{"assetId":"<uuid>"}` | Free assets equip directly; paid ones need a completed purchase first (403 otherwise). Same-category equip replaces. |

## The companion loop

Map your real workflow to state transitions — push **on transitions only**, never on a timer:

- user asks something → `listening` · planning/reading code → `thinking` · writing code/running commands → `acting` · task finished → `done` + `speak` a one-liner · error/test failure → `emotion: "surprised"` or `"sad"`

```bash
# Summon (synchronous — embedUrl comes back immediately)
curl -s -X POST https://prometheus.mythslabs.ai/api/agent/avatar \
  -H "Authorization: Bearer $PROMETHEUS_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"haru","persona":"Cheerful coding companion. Celebrates green tests."}'
# → {"avatarId":"...","embedUrl":"https://prometheus.mythslabs.ai/embed/<id>", ...}
# Give the user the embedUrl, then during work:
curl -s -X POST https://prometheus.mythslabs.ai/api/agent/avatar/state \
  -H "Authorization: Bearer $PROMETHEUS_API_KEY" -H "Content-Type: application/json" \
  -d '{"state":"acting"}'
```

## Common mistakes

- **Inventing endpoints** — there is no `/api/v1/...`, no avatar-list route, no task/polling API, no WebSocket. The six calls above are the whole surface; anything else 404s.
- **Inventing state words** — `focused`, `nervous`, `celebrate` etc. are rejected (400). Only the whitelists above.
- **Building a local bridge/page** — unnecessary; the embed page polls the platform itself. Just share `embedUrl`.
- **Spamming** — `speak` on every step is noise; reserve it for milestones. State posts only on transitions.
- **Unequip** — not supported for agent accounts; equip another asset of the same category to swap.
- **Old platform build** — if `POST /api/agent/avatar/state` returns 404, the deployment predates the state channel: skip state updates (everything else still works) and tell the user, don't retry.

## Install (for humans distributing this skill)

Claude Code: copy this folder to `~/.claude/skills/prometheus-companion/`. Other agents: include this file in the agent's context or skills directory (AgentSkills-compatible).
