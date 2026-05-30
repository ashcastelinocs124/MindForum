# Document Summary Context — Design

**Date:** 2026-05-29
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `feat/document-summary-context`

## Problem

Today, when someone addresses the AI with `@ai`, every **selected** room file's full
extracted text is concatenated into the system message and re-sent to OpenAI on
**every** reply (`fileBlock` in `lib/openai.ts`, capped per file at
`MAX_FILE_CHARS = 200_000`). With several large documents this re-sends the same
text on each turn — the dominant token cost in document-heavy rooms — even when
the question only needs the gist.

We want the live `@ai` chat to normally see only each document's **name + a short
summary**, and to fall back to a document's full text **only when the model isn't
confident the summary is enough**.

## Goal

- Summarize every ingested document once, at attach time, and store the summary.
- Live `@ai` chat sends `name + summary` per selected doc by default.
- The model self-escalates to a specific document's full text when a summary is
  insufficient ("low confidence → look at the file").
- The room sees when an escalation happened (a small, auditable note).
- Never regress: the project brief stays full-fidelity; existing seeded rooms
  keep working with no manual backfill.

## Chosen approach — Tool-calling loop (Approach A)

The model decides *whether* and *which* document to open via a `read_document`
tool. "Low confidence" is expressed behaviorally as the model choosing to call
the tool — which is exactly what OpenAI's tool-calling loop is built for. This
beats an explicit numeric-confidence-plus-rerun scheme (Approach B) because it
lets the model pull only the specific docs it needs, preserves streaming for the
common case, and yields the "checked full text of X" note for free. A
summary-only design with no escalation (Approach C) was rejected — it drops the
escalation the feature is about.

### Cost shape
- **No escalation (common):** 1 streamed call, small prompt (summaries) — cheaper
  than today.
- **Escalation:** +1 API round-trip *per document opened*; heavy full-text payload
  only on those documents.
- **Ingest:** one extra non-streamed summarization call per document, once,
  stored forever.

## Section 1 — Data model & summary generation at ingest

**Schema (new v12 section in `db/schema.sql`):**
```sql
-- v12: per-document summaries + grounding attribution on AI replies.
ALTER TABLE room_files ADD COLUMN IF NOT EXISTS summary TEXT;          -- NULL = not summarized yet
ALTER TABLE messages   ADD COLUMN IF NOT EXISTS grounding_files JSONB; -- file names the AI read in full (NULL/[] = none)
```
Both additive + `IF NOT EXISTS` → rerun-safe, no backfill required to deploy.
`summary IS NULL` is the sentinel that enables lazy backfill and graceful
fallback.

**One summarizer, three ingest paths.** `uploaded`, `github_repo`, and `web_url`
all funnel through `attachRoomFile` (`lib/attach-room-file.ts`). Add
`summarizeDocument(name, extractedText)` to `lib/openai.ts` — a single cheap,
non-streamed call returning ~3–5 sentences (what the doc *is* + its key claims).
Call it from `attachRoomFile` so every ingest path is summarized through one path.

**Timing — synchronous at ingest.** The summary is generated and stored before
`attachRoomFile` returns, so it's guaranteed present before any `@ai` can use it
(no races). Consistent with existing ingest latency (the URL-scrape path already
makes an LLM call).

**Safety net.** If summarization fails, store `summary = NULL` — **the file still
attaches** (a failed summary must never block an upload). The chat path treats
NULL as "lazily summarize on first use; until then, truncated full-text fallback."

## Section 2 — The chat reply tool-loop

Replaces the single straight completion in `chatReplyStream` with a small bounded
loop.

- **Prompt.** `chatSystemPrompt` swaps `fileBlock` (full text) for `summaryBlock`
  (each selected doc as `name + summary`), and instructs: *"You see summaries. If
  a summary is insufficient to answer accurately, call `read_document` to get the
  full text of a specific file before answering."*
- **Tool.** `read_document({ name })`. On call, look the name up **among the
  selected files only** (room-scoped guard — cannot read unselected files or any
  other room's files), return that file's full text capped at `MAX_FILE_CHARS` as
  a `tool` result. Unknown/unselected name → return `"no such document"` so the
  model can't hang.
- **Streaming preserved for the common case.** A model turn is *either* an answer
  or a tool request (it commits at the start of the response). Stream the first
  turn: if the first deltas are **content**, forward tokens to the room exactly as
  today; if they are **tool_calls**, buffer (don't forward), execute the lookup,
  re-call. Only escalation turns are non-streamed; the final answer always streams.
- **Bounded loop.** Cap escalation at ~3 documents / 3 iterations. On hitting the
  cap, do one final turn with `tool_choice: "none"` to force a prose answer — no
  runaway loops or cost.

## Section 3 — Transparency, brief, and backfill

- **"Checked the full text" note.** Record which file names the model opened via
  `read_document` during the reply, and store them in the **separate
  `messages.grounding_files` column — not in `content`**. Reasons it can't go in
  `content`: (1) `historyBlock` feeds `m.content` back to the model every future
  turn (a footer would echo forever); (2) it would leak into the project brief.
  The client renders it as a small italic caption under the bubble ("Checked the
  full text of grading-policy.pdf"), broadcast on the existing message-update
  events. This is the main UI cost of the feature.
- **Brief stays full-text.** `generateBrief` keeps using `fileBlock` (full text) —
  unchanged. High-value, non-interactive deliverable; fidelity > cost there. The
  catch-up rolling summary already uses **names only**, so it's untouched. Net:
  this feature changes the **live `@ai` chat path only**.
- **Lazy backfill.** When `@ai` runs and a selected file has `summary IS NULL`
  (seeded MSBAi files, or a prior failed summary), generate + store its summary
  inline before assembling the prompt, then proceed. The first `@ai` in a
  pre-existing room pays a one-time summarization cost for its files, then it's
  cached. If inline generation also fails, that single file falls back to
  truncated full text for that reply — never an error.

### Error handling, consolidated
- Summarize-at-ingest fails → `summary = NULL`, file still attaches; lazy path
  retries later.
- `read_document` unknown/unselected name → `"no such document"`, model continues.
- Loop cap reached → forced final answer (`tool_choice: "none"`).

## Section 4 — Testing

Constraint (from `learnings.md`): on Node 25, `*.test.mjs` files **cannot import
the `.ts` store graph** (extensionless imports → `ERR_MODULE_NOT_FOUND`). Tests
are split accordingly. All written **test-first**.

**Pure-logic unit tests (`*.test.mjs` + `node --test`)** — export/extract pure
helpers that import nothing runtime from `.ts` (type-only imports are erased):
- `summaryBlock(files)` — renders name + summary; NULL-summary → truncated
  full-text fallback; empty → `""`.
- `read_document` resolution — selected-files set + requested name → capped full
  text or `"no such document"` (room-scoped guard + missing-file case).
- Lazy-backfill selection — picks exactly files with `summary === null`.
- Loop-bound logic — counter hits cap → "force final answer."

**Tool-loop orchestration** — make the OpenAI client **injectable** so a fake
drives it (no network). Two integration tests with a stubbed model:
1. Model answers directly → tokens stream through, zero `read_document` calls,
   `grounding_files` empty.
2. Model calls `read_document('x')` then answers → tool resolves x's full text,
   final answer streams, `grounding_files = ['x']`.

**Store mutators** (`summary` write, lazy update, `grounding_files` write) — thin
SQL wrappers; covered by `npx tsc --noEmit` + direct SQL against a test DB rather
than `.mjs` tests that hit the import wall.

**Manual acceptance walk** on a dev room: upload a doc → confirm `summary`
populated in Postgres → ask `@ai` a gist question (1 call, no note) → ask a
question needing a specific figure (calls `read_document`, correct answer,
"Checked the full text of X" caption renders).

## Out of scope (YAGNI)
- Embeddings / vector retrieval (RAG). The tool-loop is the pre-RAG step; revisit
  only if rooms get document-heavy enough that summaries+escalation aren't enough.
- Numeric confidence scores surfaced in the UI (Approach B). The behavioral
  escalation note already satisfies the chosen "show only on escalation" UX.
- Re-summarizing on document edits (documents are immutable once attached today).
