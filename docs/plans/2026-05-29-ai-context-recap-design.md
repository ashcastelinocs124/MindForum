# AI Context: Threshold-Gated Recap — Design

**Date:** 2026-05-29
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `feat/document-summary-context` (builds on the same `@ai` path as the document-summary work)

## Problem

On every `@ai` reply, the chat path sends the **last 30 messages verbatim**
(`MAX_HISTORY = 30` in `lib/openai.ts`; `getRecentMessages(id, 30)` in the
message route). Two consequences:

1. **Cost:** in an active room, the same ~30 messages are re-sent on every reply.
2. **Silent forgetting:** anything older than message #30 is dropped from the
   prompt with no trace — in a long room the AI literally cannot see the start of
   the conversation.

We already maintain a **rolling catch-up summary** per room (`rolling_summary` +
`pinned_facts` on `rooms`, produced by `updateRollingSummary`), but it is only
refreshed by the `/catchup` route and is never used to ground `@ai`.

## Goal

Use the recap to give `@ai` **long-range memory** (stop forgetting at #30) **and**
cut history token cost — *without* adding cost, latency, or complexity to the
common case.

### Critical constraint discovered during brainstorm
Rooms are **usually under ~30 messages.** For the median room, today's last-30
already holds the entire conversation, so a recap+digest would add an LLM call,
latency, and a loss of verbatim fidelity to solve a problem that isn't occurring.
**Therefore the recap mechanism must be gated behind a room-length threshold and
only engage in the (rarer) long room.**

## Chosen approach — Threshold-gated recap, hybrid refresh-on-demand

Reuse the **existing** rolling summary (`updateRollingSummary` / `getRoomSummary`
/ `setRoomSummary`). Do **not** build a second summarizer and do **not** change
`/catchup` or the project brief. The message route decides which *context mode*
to assemble.

### Knobs
| Knob | Meaning | Value |
|---|---|---|
| `GATE` | At/under this chat-message count, behave exactly as today (all raw) | **20** |
| `WINDOW` | In recap mode, how many recent messages to send verbatim alongside the recap | **8** |

`GATE` replaces the duplicated `30` (route fetch + `historyBlock` slice) with a
**single constant** so the boundary lives in one place. (Today the smaller of the
two wins; raising one without the other is a no-op — a known gotcha.)

### Runtime flow at `@ai` time
1. **Count chat messages** in the room (cheap `COUNT(*)`; reuse
   `getRoomCatchupContext`-style query).
2. **`count <= GATE` (common case)** → today's path unchanged: send all messages
   raw/verbatim. No recap, no fold, no extra call, full fidelity. **Zero change.**
3. **`count > GATE`** → **recap mode**:
   - Load recap (`getRoomSummary`) + the delta (messages after
     `summary_up_to_msg_id`) via `getChatMessagesAfter`.
   - **Hybrid fold:**
     - **`delta <= WINDOW`** → no fold call. Context = recap + the delta raw
       (≤8 msgs; recap covers up to the high-water mark, delta covers the rest →
       no gap).
     - **`delta > WINDOW`** → fold the delta into the recap via
       `updateRollingSummary` + `setRoomSummary` (**persist**, optimistic lock),
       then context = fresh recap + **last `WINDOW` verbatim**.
4. **Assemble & stream:** system prompt = chat instructions + file summaries
   (from the document-summary work) + a **"conversation so far (summary)"** recap
   block (bullets + pinned facts); conversation turns = the recent verbatim
   window. The existing `read_document` tool-loop then runs unchanged.

### Why persist the digest (not ephemeral)
Persisting advances `summary_up_to_msg_id`, so each subsequent `@ai` only folds
what is new — the work compounds and `/catchup` gets the fresher recap for free.
An ephemeral per-reply digest re-summarizes an ever-growing delta on every call,
saving none of the work — strictly more wasteful the more `@ai` is used.

## Freshness & fallback — the "never block an answer" rule

In recap mode the fold can fail or lose the lock. Resolution order:

1. **Fold succeeds** → fresh recap + last `WINDOW`. ✅
2. **Fold loses the optimistic lock** (a concurrent `/catchup` or `@ai` already
   advanced `summary_up_to_msg_id`) → re-read `getRoomSummary`, use that fresh
   recap + last `WINDOW`. No wasted re-fold. ✅
3. **Fold throws** (OpenAI error/timeout) → **fall back to today's path**: last
   `GATE` raw, no recap. Logged. The reply degrades to current behavior, never
   errors or hangs. ⚠️

Worst case is "behaves like today" — consistent with the streaming path's
existing failure philosophy (a mid-stream crash loses only the unflushed tail).

## Concurrency

Two writers now advance the rolling summary: `/catchup` and the `@ai` route. The
existing optimistic lock in `setRoomSummary` (conditional on
`summary_up_to_msg_id IS NOT DISTINCT FROM expected`) already serializes them —
the loser re-reads (case 2 above). The `@ai` fold runs inside the existing
fire-and-forget streaming IIFE; a failure there must not abort the reply.

## Cost shape

- **`<= GATE` rooms (common):** identical to today.
- **`> GATE`, `delta <= WINDOW`:** recap (~400 tok) + ≤8 verbatim (~400) — cheaper
  than 20+ raw, no extra call.
- **`> GATE`, `delta > WINDOW`:** one fold call (input = prior recap + delta),
  then a cheap answer call. Amortized: the fold advances the high-water mark, so
  the next `@ai` folds only what is new.

## Accepted trade-offs (named, not blockers)

- **Digest vs verbatim past the gate.** In recap mode, messages older than the
  last `WINDOW` survive as a digest, not word-for-word. But today they are
  *silently dropped* past #30, so a digest is strictly better. A precise figure
  said deep in history survives only as a bullet — acceptable for a brainstorm
  room; recent specifics are covered by the verbatim window and file specifics by
  `read_document`.
- **21–30-message rooms change behavior most** under `GATE = 20`: they previously
  fit entirely in the verbatim window and now switch to recap + last 8. A
  deliberate choice to engage cost/memory savings sooner.
- **Latency:** the fold-call beat (before the first token) only ever hits a
  `> GATE` room with `delta > WINDOW`. Bounded, never the common case.

## Testing

- **Pure helper (no DB; `node --test` via tsx):**
  `decideContextMode({ chatCount, deltaSize, gate, window })`
  → `"raw" | "recap-nofold" | "recap-fold"`. Covers boundaries (20/21,
  delta 8 vs 9).
- **Injectable-client test:** in recap mode, assert the system prompt carries the
  recap block and only the last `WINDOW` turns are sent (not full history);
  assert a fold failure falls back to the raw path.
- **Store mutators** (`getRoomSummary`/`setRoomSummary`/`getChatMessagesAfter`)
  already exist and are exercised by `/catchup`; covered by `tsc` + that path.

## Out of scope (YAGNI)

- No second summarizer — reuse `updateRollingSummary`.
- No on-demand message-retrieval tool — the recap *is* the condensed older
  context; escalation is for files (`read_document`), not messages.
- No change to `/catchup` behavior or the project brief.
- No background/cron summary refresh — folding stays lazy (on `@ai` or
  `/catchup`).

## Integration points

- `lib/openai.ts` — `MAX_HISTORY`/`historyBlock` (collapse the dual-30 into one
  `GATE`); `chatReplyStream` gains an optional recap block injected into the
  system prompt; add the pure `decideContextMode` helper (or a zero-import
  module mirroring `lib/doc-context.ts`).
- `app/api/room/[id]/message/route.ts` — the `@ai` block (~113–200): count
  messages, pick mode, fold-on-demand with fallback, pass recap + recent window
  to `chatReplyStream`.
- `lib/store.ts` — reuse `getRoomSummary`, `setRoomSummary`,
  `getChatMessagesAfter`, `getRecentChatMessages`; possibly a cheap chat-count
  helper.
