# MindForum

Shared AI brainstorming room app for small faculty groups. Next.js 15 + SSE + Postgres.

## Key paths

| | |
|---|---|
| Prod URL | (private — see `~/.claude/projects/-Users-vishal-research-mindforum/memory/`) |
| VPS path | `/root/repos/mindforum` (ssh alias `vps`) |
| Process | PM2 id `mindforum`, port 3006 |
| Database | Postgres: role `mindforum`, db `mindforum`, localhost:5432 |
| Repo | `gies-ai-experiments/MindForum` (public, MIT; deploy key `mindforum_deploy` on VPS) |

## Required env vars

`OPENAI_API_KEY` · `POSTGRES_URL` · `ADMIN_TOKEN` (for `/api/admin/seed`) · optional `OPENAI_MODEL` (default `gpt-5.4`).

## Deploy recipe

Push locally, then on VPS:

```bash
cd /root/repos/mindforum
git checkout -- package-lock.json    # npm install dirties this; clean before pull
git pull
npm install
npm run migrate                       # if db/schema.sql changed
npm run build
pm2 restart mindforum --update-env    # --update-env re-reads .env.local
```

See `~/.claude/references/vps-deployment.md` for shared-VPS gotchas (deploy keys, port binding, nginx).

## Reseeding a room at a specific ID

After a restart wipes process memory (pre-Postgres behavior) or when preloading a canonical room setup, use the admin seed endpoint. Script template at `/tmp/seed-mindforum-room.py` from the initial setup — scp to VPS and run. Canonical room for the 01-sequence AI ethics exercise is `ai-ethics-exercise` (config in `rooms/2026-04-20-ai-ethics-exercise-design/`).

## Rate limits (per-IP, in-memory)

`POST /api/room` 5/10min · `join` 10/min · `message` 60/min · `upload` 10/10min · `brief` 3/5min. Reset on process restart — by design.

## Architecture gotchas

- **`next start` doesn't read PORT from `.env.local`** — must be in shell env at `pm2 start` time. Already baked in; don't touch unless rebuilding the PM2 entry.
- **Admin seed `replaceMode: "metadata"` (default) preserves chat history**; `"full"` wipes the whole room. Matters for `/api/admin/seed` callers.
- **AI reply streaming flushes to Postgres every ~1s** during generation, plus a final flush. A mid-stream process crash loses only the unflushed tail; reconnecting clients see the last flushed state, never permanently-empty bubbles.
- **Don't write synthetic rows into `participants`** for non-membership purposes (e.g. file attribution, system messages). The participants table is the source of truth for the Participants sidebar, mention suggestions, the SSE snapshot, and `upsertParticipant` matches by `lower(email)` — so a synthetic row with a real user's email gets *adopted* by that user when they join, binding their cookie to the synthetic id. Attribute via lookup of an existing real participant instead, and accept "Unknown" as the fallback. Caught by codex-review on 2026-05-06.
- **Renaming a room id orphans cookies.** Browser sessions store `mindforum_pid_<roomid>`; if you rename the room PK (insert-new → repoint children → delete-old transaction), users who joined the old id can't auth into the new id and must re-join. No FK ON UPDATE CASCADE on schema. Only safe before invitations go out.

## Room configs

Per-room setup artifacts live under `rooms/YYYY-MM-DD-<slug>/`:
- `README.md` — room setup checklist
- `facilitator-system-prompt.md` — AI guidance to paste at room creation
- other supporting files (source transcripts, draft prompts, etc.) — uploaded to the room

## Current Focus

Implement v1 creator-owned rooms per `docs/plans/2026-05-07-creator-rooms-v1-min.md` — fresh branch off main, migrations v6/v7/v8 first, then `/dashboard` + `/admin/users`, verify against the doc's Acceptance Checklist. Side items: OpenAI monthly spend cap, faculty invitation for `ai-ethics-exercise`, monitor MSBAi + `ai-ready-illinois-scoping` rooms, tail `/var/log/mindforum-refresh.log`.

## Auto-deploy

Push to `main` (or run workflow_dispatch) → GitHub Actions SSHes to the VPS and runs `scripts/deploy.sh` (pull → install → migrate → build → pm2 restart → localhost health check). Dedicated SSH key (`~/.ssh/mindforum_actions` locally) is locked to `command="bash /root/repos/mindforum/scripts/deploy.sh"` in VPS `~/.ssh/authorized_keys` — even if the GitHub `VPS_SSH_KEY` secret leaks, the key can only run the deploy. **If `scripts/deploy.sh` ever moves or gets renamed, update the `command=` prefix on the VPS at the same time** or the workflow silently fails with "No such file or directory". Bypass: regular `ssh vps` still works for ad-hoc shell access via `~/.ssh/id_ed25519`.

## Roadmap

- [x] MVP from Ash's spec
- [x] Deploy to VPS behind nginx + Cloudflare
- [x] Token-streamed `@ai` replies
- [x] Per-room system prompt + file upload
- [x] Project brief with `↓ Download .md`
- [x] Admin seed endpoint (URL-stable rooms)
- [x] Per-IP rate limiter
- [x] Postgres persistence (chat history survives restarts)
- [x] Repo flipped public + MIT LICENSE + topics; `rooms/` stripped from history
- [x] `POST /api/room` gated behind `ADMIN_TOKEN` (defense-in-depth for public repo)
- [x] Hybrid Builder article drafted, trimmed, RSA-Animate cover images generated (v1 picked)
- [x] Substack + LinkedIn drafts loaded; X thread composed in modal
- [x] Final publish on Substack + LinkedIn + X (live 2026-04-25)
- [x] GPM stakeholder brainstorm room (`gpm-brainstorm`) seeded with Marketplace Co-pilot prompt + proposal file uploaded
- [x] MSBAi stakeholder rooms seeded (`msbai-pilot-faculty` 22 files, `msbai-corporate-partners` 8 files); daily KB refresh via `rooms/refresh-msbai-kb.sh` cron at 06:00 UTC; system prompts auto-stamp `last refresh` date
- [x] Render `@ai` replies as markdown (react-markdown + remark-gfm); human messages keep existing renderer
- [x] Catch-up modal now blocks "Got it" until summary lands (prevents fast-clickers dismissing before bullets render)
- [x] Send MSBAi room invitations (faculty/staff list + corporate partners individually) — sent 2026-04-27
- [x] Admin rooms dashboard `/admin/rooms` (sortable activity table, name filter, copy-link, cookie auth via existing `ADMIN_TOKEN`) — shipped 2026-04-28, [PR #6](https://github.com/gies-ai-experiments/MindForum/pull/6)
- [x] `@`-mention notifications + live in-input mention coloring — [PR #8](https://github.com/gies-ai-experiments/MindForum/pull/8), shipped 2026-05-01
- [x] GitHub Actions auto-deploy on push to `main` (restricted SSH key, idempotent `scripts/deploy.sh`, ~32s end-to-end) — shipped 2026-05-01
- [x] File-content preview UX (modal with markdown render) — issue [#5](https://github.com/gies-ai-experiments/MindForum/issues/5), [PR #10](https://github.com/gies-ai-experiments/MindForum/pull/10), shipped 2026-05-06
- [x] Multi-line chat input (TextareaAutosize, Enter/Shift+Enter, IME-safe) — shipped 2026-05-06
- [x] File uploader attribution in Files panel + preview modal; seeded files attribute via email lookup to existing real participant — shipped 2026-05-06
- [x] Mobile/narrow-viewport pass: drawer-based Participants/Files, single-column chat, `100dvh` for iOS keyboard — shipped 2026-05-07
- [x] Faculty brainstorm room for Gies AI Teaching Showcase (`ai-in-teaching-research`) — seeded with co-facilitator system prompt + AI starter message, 2026-05-07
- [x] Co-authoring room for Innovation & Transformation group (`innovation-transformation`) — 2026-05-07
- [x] Creator-owned rooms design spec + v1-minimum trim — 3 rounds Codex Plan Reviewer, APPROVED, merged via [PR #11](https://github.com/gies-ai-experiments/MindForum/pull/11). v1 spec at `docs/plans/2026-05-07-creator-rooms-v1-min.md` is the implementation contract.
- [ ] **Implement v1 creator-owned rooms** per `docs/plans/2026-05-07-creator-rooms-v1-min.md`. Fresh branch off main; migrations v6/v7/v8 first; `/dashboard` + `/admin/users` second; verify against the doc's Acceptance Checklist. **Note:** migration v6 was used by the polls feature (2026-05-13). Renumber creator-rooms migrations to v9/v10/v11 at merge time.
- [x] **Polls & Decisions v1** — `/poll` command with AI option draft, single-choice hidden-tally voting (5m/15m/1h/24h/manual), lazy expiry, automatic inclusion in project brief's new "Decisions & Votes" section. Branch `polls-and-decisions` off main. Design at `docs/plans/2026-05-13-polls-and-decisions-design.md`, implementation plan at `docs/plans/2026-05-13-polls-and-decisions.md`.
- [ ] Set OpenAI monthly spend cap on the dedicated MindForum key (defense-in-depth #2)
- [ ] Send faculty invitation for room `ai-ethics-exercise`
- [ ] Collect feedback from first facilitated session; iterate on prompts
- [ ] **2026-05-25 review:** four weeks after MSBAi rooms launch — check usage signal (faculty engagement vs lurking) to decide whether to keep brainstorm framing or convert to a K-ai-activity-mirror digest

## Session Log

### 2026-05-13
- Completed: Polls & Decisions feature on branch `polls-and-decisions` (off main, ignores `creator-rooms-v1`). Schema v6: `polls` + `poll_options` + `poll_votes` with `(poll_id, participant_id)` PK for UPSERT vote-change semantics. Pure-logic module `lib/poll-logic.ts` with 13 passing TDD tests. Store CRUD: `createPoll`, `getPoll`, `getOpenPollsForRoom` (hidden tallies enforced server-side), `getClosedPollsForRoom`, `castVote` (UPSERT tx), `closePoll` (idempotent), `closeExpiredPolls` (lazy-expiry helper invoked at top of `/stream` + `/message` + every poll route). AI used in two spots: `draftPollFromHistory` (json_schema strict, graceful empty-fallback) called by `POST /poll/draft`, and `generateBrief` now accepts `closedPolls` and echoes them into `Brief.decisions[]` (post-validated against DB to defeat hallucination). Four new routes under `/api/room/[id]/poll/...` (draft, create, vote, close) each rate-limited per `lib/ratelimit.ts` documentation. UI: `PollLaunchModal` (AI draft + edit + 5m/15m/1h/24h/manual duration), `PollCard` (open: hidden tallies + countdown + close-now for author; closed: bars + winner). Three SSE events: `poll_opened`, `poll_vote` (totalVotes only — breakdown hidden), `poll_closed`. Snapshot extended with `openPolls` + `recentClosedPolls`; chat stream interleaves messages + polls by `createdAt`. Brief renderer + markdown serializer get a "Decisions & Votes" section. `requireRoomParticipant` extracted from `/message` + `/upload` for DRY.
- Next: Run manual smoke (Task 21 in plan) — local dev with two browsers, walk golden path (`/poll` → AI draft → edit → launch → vote → close → brief). Integration tests at `lib/poll-store.test.mjs` need a Postgres throwaway DB to run. After smoke passes, `/gitpush` to deploy.

### 2026-05-08
- Completed: Started v1 creator-owned rooms on branch `creator-rooms-v1` (off `main`). Two commits: (1) `4cf2d31` migrations v6/v7/v8 — `allowlisted_creators` table with synthetic `cr_super_admin` row (sentinel token_hash = 64 zeros, unreachable by sha256), `rooms.owner_id` (FK ON DELETE RESTRICT) + `archived_at`, append-only `audit_log` (no FK on room_id so entries survive hard-delete). Verified rerun-safe + backfill against a throwaway DB on VPS (`mindforum_migrate_test`, dropped after). (2) `ff67f30` `lib/creator-auth.ts` (token hashing, constant-time compare, getCreator/getActor/requireCreator/checkRoomOwner) + `lib/audit.ts` (append-only logAudit, listAuditForRoom/Actor) + `lib/store.ts` patch defaulting `owner_id='cr_super_admin'` in `createRoom` and `adminUpsertRoom`. Codex review caught the missing-default P1 (every legacy room create would have failed post-deploy with NULL `owner_id`); fixed before commit.
- Next: Continue on `creator-rooms-v1` — extend `lib/store.ts` with creator CRUD + ownership filters + archive-state checks; add new routes (`/api/creator/session`, `/api/creator/me`, `/api/admin/users[...]`, archive/restore/transfer); modify `/api/room` for dual-auth + slug validation; build pages (`/dashboard`, `/dashboard/rooms/[id]/settings`, `/admin/users`); add middleware gate for `/dashboard/*`. Bump `MAX_SYSTEM_PROMPT_CHARS` from 4000 → 51200 per spec decision #2 when the route is touched. Branch is **not** merged to `main` yet, so auto-deploy hasn't fired and the migrations haven't run on the live DB — that's part of the merge step.
