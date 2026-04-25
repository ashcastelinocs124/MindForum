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

Set OpenAI monthly spend cap on the dedicated MindForum key. Then send the faculty invitation email for the 01-sequence AI ethics brainstorm room (`-xM9Qgfk4g`). Article is live: <https://chatwithgpt.substack.com/p/email-to-tested-app-in-under-ten>.

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
- [ ] Set OpenAI monthly spend cap on the dedicated MindForum key (defense-in-depth #2)
- [ ] Send faculty invitation for room `-xM9Qgfk4g`
- [ ] Collect feedback from first facilitated session; iterate on prompts

## Session Log

### 2026-04-21 → 2026-04-25
- Completed (build + Postgres): MVP end-to-end from Ash's spec, VPS deploy, per-IP rate limits, `/api/admin/seed`, Postgres persistence migration (Codex-reviewed).
- Completed (in-class experiment): Used MindForum live in BADM 350 (room `a2-QCVJ5m7`) to collect end-of-semester feedback from 18 students in 25 min. Drafted Spring 2027 change list (`/Users/vishal/teaching/badm350/spring2026/feedback/reports/`) cross-referencing student quotes against teaching-philosophy notes.
- Completed (article): Hybrid Builder article drafted around the 10-hour build + classroom second-use story. Trimmed 3057 → 2394 words. Named **Personal Software** (Litt / Ink & Switch) and **Build to Learn / Learn to Build** as recurring frames. RSA-Animate cover images generated via `gpt-image-1` (v1 picked); cropped to LinkedIn 1200×628, X 1200×675, Substack banner 1100×220 via PIL.
- Completed (security + public flip): Scrubbed prod URL from `CLAUDE.md` (now in auto-memory). Gated `POST /api/room` behind `ADMIN_TOKEN` (constant-time compare); homepage picks up `?token=...` and caches in localStorage. Stripped `rooms/` directory from full git history via `git filter-repo`. Force-pushed. Repo flipped PUBLIC with MIT LICENSE, description, topics (`personal-software` included).
- Completed (drafts loaded): Substack draft `195027435`. LinkedIn Article `7452703510472724480` ("Draft - saved" confirmed). X thread composed in compose modal — 15 tweets, all under 280 chars, `[INSERT SUBSTACK URL AFTER PUBLISH]` placeholder in tweet 15.
- Completed (process learnings): Parallel-subagent sanity check passed; LinkedIn + X drafts produced concurrently in ~24 min wall time (vs ~34 min serial). Saved memories: Personal Software framing rules; intermediate-artifact cleanup discipline; MindForum prod URL.
- Completed (live publish): Article live on all three platforms (2026-04-25). Substack: <https://chatwithgpt.substack.com/p/email-to-tested-app-in-under-ten>.
- Carry-forward: OpenAI monthly spend cap on dedicated MindForum key.
- Next: Faculty invitation email for room `-xM9Qgfk4g`. Then: collect first-session feedback, iterate.
