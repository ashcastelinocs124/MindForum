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

After a restart wipes process memory (pre-Postgres behavior) or when preloading a canonical room setup, use the admin seed endpoint. Script template at `/tmp/seed-mindforum-room.py` from the initial setup — scp to VPS and run. Canonical room for the 01-sequence AI ethics exercise is `-xM9Qgfk4g` (config in `rooms/2026-04-20-ai-ethics-exercise-design/`).

## Rate limits (per-IP, in-memory)

`POST /api/room` 5/10min · `join` 10/min · `message` 60/min · `upload` 10/10min · `brief` 3/5min. Reset on process restart — by design.

## Architecture gotchas

- **`next start` doesn't read PORT from `.env.local`** — must be in shell env at `pm2 start` time. Already baked in; don't touch unless rebuilding the PM2 entry.
- **Admin seed `replaceMode: "metadata"` (default) preserves chat history**; `"full"` wipes the whole room. Matters for `/api/admin/seed` callers.
- **AI reply streaming flushes to Postgres every ~1s** during generation, plus a final flush. A mid-stream process crash loses only the unflushed tail; reconnecting clients see the last flushed state, never permanently-empty bubbles.

## Room configs

Per-room setup artifacts live under `rooms/YYYY-MM-DD-<slug>/`:
- `README.md` — room setup checklist
- `facilitator-system-prompt.md` — AI guidance to paste at room creation
- other supporting files (source transcripts, draft prompts, etc.) — uploaded to the room

## Current Focus

MSBAi room invitations sent. Now: monitor early engagement (faculty/corporate room activity) and tail `/var/log/mindforum-refresh.log` after first cron run tonight. Set the OpenAI monthly spend cap. File-content preview UX assigned to student collaborator via [issue #5](https://github.com/gies-ai-experiments/MindForum/issues/5).

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
- [ ] Set OpenAI monthly spend cap on the dedicated MindForum key (defense-in-depth #2)
- [ ] Send faculty invitation for room `-xM9Qgfk4g`
- [ ] Collect feedback from first facilitated session; iterate on prompts
- [ ] **2026-05-25 review:** four weeks after MSBAi rooms launch — check usage signal (faculty engagement vs lurking) to decide whether to keep brainstorm framing or convert to a K-ai-activity-mirror digest (see `.claude/plans/file-content-preview-ux.md` for the broader UX direction)
- [ ] File-content preview UX (modal with markdown render) — issue [#5](https://github.com/gies-ai-experiments/MindForum/issues/5), spec in `docs/feature-requests/file-content-preview.md`, owned by student collaborator

## Session Log

### 2026-04-27
- Completed: Stood up two MSBAi stakeholder rooms — `msbai-pilot-faculty` (22 files: full curriculum, 10 syllabi, design + strategy docs) and `msbai-corporate-partners` (8 curated strategy/capability files). Built `seed-msba-rooms.py` (idempotent admin-seed via localhost:3006 to bypass CF UA-block) and `refresh-msbai-kb.sh` daily cron (06:00 UTC) that pulls from `/root/repos/msba-online`, re-curates kb/, and re-seeds with `replaceMode=metadata`. System prompts auto-stamp `last refresh: YYYY-MM-DD` via `{{LAST_UPDATED}}` substitution. Faculty prompt scrubbed of Vishal/Amber attribution per request — directs updates to K-ai email (`msbai@illinihunt.org`); corporate prompt keeps Vishal as named contact. Drafted invitation messages for both audiences. PR #4 (catch-up modal) merged externally during session; deployed with v2 schema migration. Fixed two UI bugs along the way: (1) `@ai` replies were showing literal markdown chars — added react-markdown + remark-gfm, AI messages route through `<ReactMarkdown>` while human messages keep existing `@ai` mention badge; (2) catch-up modal "Got it" was clickable during summary fetch — now disabled with "Waiting for summary…" label until load completes. Plan stashed at `.claude/plans/file-content-preview-ux.md` for the file-content modal UX (deferred).
- Next: Send the two MSBAi room invitations (drafts ready in each room's `invitation-message.md`). Faculty/staff can go as one email; corporate partners must be individual emails (room is shared — partners can see each other's names by design, may need a heads-up sentence per email if any invitee would be uncomfortable being seen by competitors). Then OpenAI spend cap. Tail `/var/log/mindforum-refresh.log` after first cron run (~01:00 Central tonight) to confirm daily refresh works end-to-end.
