# AI Context Recap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `@ai` keep long-range memory and cut history cost in long rooms by sending a recap + last 8 verbatim once a room exceeds 20 messages — while rooms ≤20 stay byte-for-byte identical to today.

**Architecture:** The message route picks a *context mode* by chat-message count. `≤ GATE(20)` → today's raw path (unchanged). `> GATE` → reuse the existing rolling summary (`updateRollingSummary`): if ≤ `WINDOW(8)` new messages since the recap's high-water mark, send recap + those raw (no fold); otherwise fold the delta into the recap (persist, optimistic lock) and send fresh recap + last 8. Any recap failure falls back to the raw path so a reply never blocks.

**Tech Stack:** Next.js 15 route handlers (`runtime = "nodejs"`), Postgres, OpenAI Chat Completions (streaming + the existing `read_document` tool-loop), `node --import tsx --test` for `*.test.mjs`.

**Key references (read before starting):**
- Design: `docs/plans/2026-05-29-ai-context-recap-design.md`
- `learnings.md` — **Node 25 `.mjs` tests need `tsx`**: run `npm test` (`node --import tsx --test lib/*.test.mjs`). Pure modules with no runtime imports still run under plain `node --test`.
- **Fold template:** `app/api/room/[id]/catchup/route.ts:49-112` — the exact `getRoomSummary` → `getChatMessagesAfter` → cold-start recency → `updateRollingSummary` → `setRoomSummary` (optimistic lock + re-read) sequence to mirror.
- Current `@ai` block: `app/api/room/[id]/message/route.ts:113-200` (already has file-summary lazy backfill + grounding from the prior feature).
- `lib/openai.ts` — `historyBlock` (`MAX_HISTORY`), `chatSystemPrompt`, `chatReplyStream` (now has the `read_document` tool-loop + injectable client).
- Store helpers (all exist): `getRoomSummary`, `setRoomSummary`, `getChatMessagesAfter`, `getRecentChatMessages`, `getRoomCatchupContext`, `getRecentMessages`; `ROLLING_SUMMARY_RECENCY_WINDOW`, `updateRollingSummary`.

**GOTCHAS (read twice):**
1. **DO NOT lower `MAX_HISTORY` in `lib/openai.ts`.** `historyBlock` is shared by `generateBrief` and `draftPollFromHistory`; shrinking it would silently cut the brief's context. The chat window is controlled by the **route** (fetch exactly `GATE` or `WINDOW`). Leave `MAX_HISTORY = 30` as the defensive cap (it never clips because `GATE=20 < 30`).
2. **Exclude the empty AI stub message.** The route appends an empty `kind:"chat"` AI message (`aiMsg`) *before* this async work, so it appears in `getChatMessagesAfter`/`getRecentChatMessages`. It must be filtered out of the delta, the verbatim window, and the fold input — otherwise the recap summarizes an empty turn and the high-water mark advances past a not-yet-written reply.
3. **Cold start only happens in fold mode.** `> GATE` with no stored summary ⇒ delta = all messages (> WINDOW) ⇒ fold mode. So "nofold" always has a non-null stored recap.

**Conventions:** DRY, YAGNI, TDD, frequent commits. Commit trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: Pure context-decision module (`lib/chat-context.ts`)

Zero runtime imports so `*.test.mjs` loads it cleanly. Mirrors `lib/doc-context.ts`.

**Files:**
- Create: `lib/chat-context.ts`
- Create: `lib/chat-context.test.mjs`

**Step 1: Write the failing tests**

Create `lib/chat-context.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideContextMode, renderRecapBlock, GATE, RECENT_WINDOW } from "./chat-context.ts";

test("constants are 20 / 8", () => {
  assert.equal(GATE, 20);
  assert.equal(RECENT_WINDOW, 8);
});

test("decideContextMode: at/under gate → raw", () => {
  assert.equal(decideContextMode({ chatCount: 1, deltaSize: 0 }), "raw");
  assert.equal(decideContextMode({ chatCount: 20, deltaSize: 99 }), "raw"); // count wins
});

test("decideContextMode: over gate, small delta → recap-nofold", () => {
  assert.equal(decideContextMode({ chatCount: 21, deltaSize: 8 }), "recap-nofold");
  assert.equal(decideContextMode({ chatCount: 60, deltaSize: 1 }), "recap-nofold");
});

test("decideContextMode: over gate, large delta → recap-fold", () => {
  assert.equal(decideContextMode({ chatCount: 21, deltaSize: 9 }), "recap-fold");
  assert.equal(decideContextMode({ chatCount: 60, deltaSize: 40 }), "recap-fold");
});

test("renderRecapBlock: empty bullets → empty string", () => {
  assert.equal(renderRecapBlock([], { names: [], decisions: [], files: [] }), "");
});

test("renderRecapBlock: includes bullets + pinned facts, labeled as summary", () => {
  const out = renderRecapBlock(["Group debated X.", "Chose Y."], {
    names: ["Ana"], decisions: ["Use Y"], files: ["spec.md"],
  });
  assert.match(out, /summary/i);
  assert.match(out, /Group debated X\./);
  assert.match(out, /Chose Y\./);
  assert.match(out, /Ana/);
  assert.match(out, /Use Y/);
  assert.match(out, /spec\.md/);
});
```

**Step 2: Run to verify it fails**

Run: `node --test lib/chat-context.test.mjs`
Expected: FAIL — `Cannot find module './chat-context.ts'`.

**Step 3: Write `lib/chat-context.ts`**

```ts
// Pure, dependency-free helpers that decide the @ai conversation-context mode
// and render the recap block. NO runtime imports so `*.test.mjs` loads it on
// Node 25.

/** At/under this chat-message count, @ai uses today's raw path (all messages). */
export const GATE = 20;
/** In recap mode, how many recent messages to send verbatim alongside the recap. */
export const RECENT_WINDOW = 8;

export type ContextMode = "raw" | "recap-nofold" | "recap-fold";

/**
 * raw           → room fits the window; send all messages verbatim (today).
 * recap-nofold  → over gate, but ≤WINDOW new messages since the recap's
 *                 high-water mark; send stored recap + those raw (no fold call).
 * recap-fold    → over gate and >WINDOW behind; fold the delta into the recap,
 *                 then send fresh recap + last WINDOW verbatim.
 */
export function decideContextMode(args: {
  chatCount: number;
  deltaSize: number;
  gate?: number;
  window?: number;
}): ContextMode {
  const gate = args.gate ?? GATE;
  const window = args.window ?? RECENT_WINDOW;
  if (args.chatCount <= gate) return "raw";
  return args.deltaSize <= window ? "recap-nofold" : "recap-fold";
}

type PinnedFactsLike = { names: string[]; decisions: string[]; files: string[] };

/** Render the recap as a system-prompt block. Empty bullets → "" (no block). */
export function renderRecapBlock(bullets: string[], pinned: PinnedFactsLike): string {
  if (!bullets || bullets.length === 0) return "";
  const lines = bullets.map((b) => `- ${b}`).join("\n");
  const pin = [
    pinned.names.length ? `people: ${pinned.names.join(", ")}` : "",
    pinned.decisions.length ? `decisions: ${pinned.decisions.join("; ")}` : "",
    pinned.files.length ? `files: ${pinned.files.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  const pinBlock = pin ? `\nPinned facts — ${pin}` : "";
  return `\n\nConversation so far (a summary of earlier messages not shown verbatim below; treat the verbatim recent messages as authoritative if they conflict):\n${lines}${pinBlock}`;
}
```

**Step 4: Run to verify it passes**

Run: `node --test lib/chat-context.test.mjs`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add lib/chat-context.ts lib/chat-context.test.mjs
git commit -m "feat(chat-context): pure context-mode decision + recap block (TDD)"
```

---

## Task 2: `chatReplyStream` accepts a recap block

**Files:**
- Modify: `lib/openai.ts` (`chatSystemPrompt`, `ChatReplyOpts`, `chatReplyStream`)
- Modify: `lib/openai.test.mjs` (add two cases)

**Step 1: Add `recapBlock` to `chatSystemPrompt`**

Change the signature + body so the recap is injected after room guidance, before file summaries:
```ts
function chatSystemPrompt(files: DocLike[], systemPrompt: string, recapBlock = ""): string {
  return `You are an AI collaborator in a MindForum room — a shared workspace where a small group brainstorms together in one chat thread. Participants can upload documents that are shared with the group. You only respond when someone addresses you with \`@ai\`; otherwise you stay silent. In the history, each participant's message is prefixed with their name (e.g., "Alice: ..."); your reply is visible to everyone. Keep replies concise. Reference shared files when relevant. Stay grounded in what people have actually said and in the files; don't invent context.${roomGuidanceBlock(systemPrompt)}${recapBlock}${summaryBlock(files)}`;
}
```

**Step 2: Thread `recapBlock` through `ChatReplyOpts` + `chatReplyStream`**

In `ChatReplyOpts` add:
```ts
  /** Pre-rendered recap of earlier messages (recap mode); "" / undefined = none. */
  recapBlock?: string;
```
In `chatReplyStream`, change the system message to pass it:
```ts
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: chatSystemPrompt(docs, systemPrompt, opts.recapBlock ?? "") },
    ...historyBlock(messages),
  ];
```
(Leave `chatReply` and `MAX_HISTORY` untouched — see GOTCHA 1.)

**Step 3: Add tests to `lib/openai.test.mjs`**

Extend the fake so it records the messages it was called with:
```js
function fakeOpenAICapturing(scripts, sink) {
  let call = 0;
  return {
    chat: { completions: { create: async (params) => {
      sink.push(params);
      const chunks = scripts[call++];
      return (async function* () { for (const c of chunks) yield c; })();
    } } },
  };
}
```
Add:
```js
test("recapBlock is injected into the system prompt", async () => {
  const calls = [];
  const gen = chatReplyStream(
    [{ authorId: "u", authorName: "Ana", content: "hi", id: "m1", roomId: "r", createdAt: 0, kind: "chat" }],
    files, "", {
      openai: fakeOpenAICapturing([[content("ok")]], calls),
      recapBlock: "\n\nConversation so far (summary):\n- earlier stuff",
    });
  for await (const _ of gen) { /* drain */ }
  const sys = calls[0].messages[0];
  assert.equal(sys.role, "system");
  assert.match(sys.content, /Conversation so far/);
  assert.match(sys.content, /earlier stuff/);
});

test("only the passed messages become history (no hidden fetch)", async () => {
  const calls = [];
  const msgs = [
    { authorId: "u", authorName: "Ana", content: "one", id: "m1", roomId: "r", createdAt: 0, kind: "chat" },
    { authorId: "u", authorName: "Ana", content: "two", id: "m2", roomId: "r", createdAt: 1, kind: "chat" },
  ];
  const gen = chatReplyStream(msgs, files, "", {
    openai: fakeOpenAICapturing([[content("ok")]], calls),
    recapBlock: "",
  });
  for await (const _ of gen) { /* drain */ }
  // system + 2 history turns
  assert.equal(calls[0].messages.length, 3);
  assert.deepEqual(calls[0].messages.slice(1).map((m) => m.content), ["Ana: one", "Ana: two"]);
});
```

**Step 4: Run tests**

Run: `npm test`
Expected: all PASS (doc-context 6, chat-context 6, openai 5 — the DB-backed poll/store tests need `.env.local`; running `npm test` without it leaves those failing on `POSTGRES_URL` only, which is pre-existing and unrelated).

To run only the touched suites:
Run: `node --import tsx --test lib/openai.test.mjs lib/chat-context.test.mjs`
Expected: PASS.

**Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add lib/openai.ts lib/openai.test.mjs
git commit -m "feat(openai): chatReplyStream accepts an injected recap block (TDD)"
```

---

## Task 3: Fold-on-demand helper (`lib/recap.ts`)

Mirrors the `/catchup` fold but (a) excludes the in-flight AI stub and (b) returns the current recap for the caller to render. No `.mjs` test (imports the store graph); verify via `tsc` + Task 5's acceptance walk.

**Files:**
- Create: `lib/recap.ts`

**Step 1: Write `lib/recap.ts`**

```ts
import {
  getChatMessagesAfter,
  getRecentChatMessages,
  getRoomSummary,
  setRoomSummary,
  type RoomSummary,
} from "./store";
import { ROLLING_SUMMARY_RECENCY_WINDOW, updateRollingSummary } from "./openai";

/**
 * Ensure the room's rolling summary covers everything up to (but excluding) the
 * in-flight AI stub, folding the delta in if needed. Persists with the same
 * optimistic lock as /catchup; on a lost race it re-reads and returns the winner.
 * Throws on generation failure — the caller falls back to the raw path.
 *
 * Returns the recap to render. `excludeMsgId` is the empty AI stub already in the
 * table (see message route); it must not be summarized or advance the high-water
 * mark.
 */
export async function refreshSummaryForReply(args: {
  roomId: string;
  systemPrompt: string;
  selectedFileNames: string[];
  excludeMsgId: string;
}): Promise<RoomSummary> {
  const { roomId, systemPrompt, selectedFileNames, excludeMsgId } = args;
  const stored = await getRoomSummary(roomId);
  const expectedUpToMsgId = stored?.upToMsgId ?? null;

  const deltaRaw = await getChatMessagesAfter(roomId, expectedUpToMsgId);
  const delta = deltaRaw.filter((m) => m.id !== excludeMsgId);
  if (delta.length === 0) {
    // Nothing new (only the stub) — current recap is already fresh.
    return stored ?? { bullets: [], pinnedFacts: { names: [], decisions: [], files: [] }, upToMsgId: expectedUpToMsgId, updatedAt: null };
  }

  const isColdStart = !stored || stored.bullets.length === 0;
  const recentRaw = isColdStart
    ? []
    : await getRecentChatMessages(roomId, ROLLING_SUMMARY_RECENCY_WINDOW + 1);
  const recent = recentRaw.filter((m) => m.id !== excludeMsgId).slice(-ROLLING_SUMMARY_RECENCY_WINDOW);
  const newUpToMsgId = delta[delta.length - 1].id;

  const updated = await updateRollingSummary({
    priorBullets: stored?.bullets ?? [],
    priorPinnedFacts: stored?.pinnedFacts ?? { names: [], decisions: [], files: [] },
    recentMessages: recent,
    deltaMessages: delta,
    fileNames: selectedFileNames,
    systemPrompt,
  });

  const wrote = await setRoomSummary(
    roomId,
    { bullets: updated.bullets, pinnedFacts: updated.pinnedFacts, newUpToMsgId },
    expectedUpToMsgId
  );
  if (!wrote) {
    const fresh = await getRoomSummary(roomId);
    if (fresh && fresh.bullets.length > 0) return fresh;
  }
  return {
    bullets: updated.bullets,
    pinnedFacts: updated.pinnedFacts,
    upToMsgId: newUpToMsgId,
    updatedAt: Date.now(),
  };
}
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

**Step 3: Commit**

```bash
git add lib/recap.ts
git commit -m "feat(recap): fold-on-demand summary helper (excludes the AI stub)"
```

---

## Task 4: Wire context modes into the message route

**Files:**
- Modify: `app/api/room/[id]/message/route.ts` (imports; the `void (async () => { ... })()` block ~113-200)

**Step 1: Add imports**

```ts
import { getRoomCatchupContext, getRoomSummary, getChatMessagesAfter, getRecentChatMessages } from "@/lib/store";
import { decideContextMode, renderRecapBlock, GATE, RECENT_WINDOW } from "@/lib/chat-context";
import { refreshSummaryForReply } from "@/lib/recap";
```
(Keep existing imports; `getSelectedFiles`, `getRecentMessages`, `setFileSummary`, `updateMessageGrounding`, `summarizeDocument`, `needsSummary`, `chatReplyStream` stay.)

**Step 2: Replace the context-assembly preamble**

Inside the async IIFE, replace the current `Promise.all([...])` + `priorHistory` block with mode selection. The lazy file-summary backfill and the `chatReplyStream(...)` call stay, but the *messages* and *recapBlock* passed depend on mode.

```ts
        const [ctx, selectedFiles] = await Promise.all([
          getRoomCatchupContext(id),
          getSelectedFiles(id),
        ]);
        const systemPrompt = ctx?.systemPrompt ?? "";

        // Lazy file-summary backfill (unchanged from the document-summary feature).
        await Promise.all(
          selectedFiles.filter(needsSummary).map(async (f) => {
            try {
              const s = await summarizeDocument(f.name, f.extractedText);
              if (s) { await setFileSummary(id, f.id, s); f.summary = s; }
            } catch (err) {
              console.error("lazy summarize failed (using truncated full text):", err);
            }
          })
        );

        // ---- Decide conversation-context mode ----
        let windowMessages: Message[];
        let recapBlock = "";
        const chatCount = ctx?.chatCount ?? 0;

        if (chatCount <= GATE) {
          // RAW (common case): today's behavior — all messages, verbatim.
          const all = await getRecentMessages(id, GATE);
          windowMessages = all.filter((m) => m.id !== aiMsg.id);
        } else {
          try {
            const stored = await getRoomSummary(id);
            const deltaRaw = await getChatMessagesAfter(id, stored?.upToMsgId ?? null);
            const delta = deltaRaw.filter((m) => m.id !== aiMsg.id);
            const mode = decideContextMode({ chatCount, deltaSize: delta.length });

            if (mode === "recap-nofold") {
              windowMessages = delta; // ≤ WINDOW new msgs; recap covers the rest
              recapBlock = renderRecapBlock(
                stored?.bullets ?? [],
                stored?.pinnedFacts ?? { names: [], decisions: [], files: [] }
              );
            } else {
              const fresh = await refreshSummaryForReply({
                roomId: id,
                systemPrompt,
                selectedFileNames: ctx?.selectedFileNames ?? [],
                excludeMsgId: aiMsg.id,
              });
              const recentRaw = await getRecentChatMessages(id, RECENT_WINDOW + 1);
              windowMessages = recentRaw.filter((m) => m.id !== aiMsg.id).slice(-RECENT_WINDOW);
              recapBlock = renderRecapBlock(fresh.bullets, fresh.pinnedFacts);
            }
          } catch (err) {
            // Recap failed → degrade to today's raw path. Never block a reply.
            console.error("recap context failed (falling back to raw):", err);
            const all = await getRecentMessages(id, GATE);
            windowMessages = all.filter((m) => m.id !== aiMsg.id);
            recapBlock = "";
          }
        }

        for await (const delta of chatReplyStream(windowMessages, selectedFiles, systemPrompt, {
          recapBlock,
          onReadDocument: (name) => grounded.add(name),
        })) {
```

(The streaming loop body, flush logic, grounding persist/broadcast, and `finally` are unchanged.)

**Step 3: Typecheck + build**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run build` → succeeds (route table prints, no errors).

**Step 4: Commit**

```bash
git add "app/api/room/[id]/message/route.ts"
git commit -m "feat(message): threshold-gated recap context for @ai (raw ≤20, recap >20)"
```

---

## Task 5: Full verification + acceptance walk + finish

**Step 1: Full gate**

Run: `npm test` (then `set -a; . ./.env.local; set +a; npm test` to include DB-backed suites)
Run: `npx tsc --noEmit && npm run build`
Expected: pure suites PASS (doc-context, chat-context, openai); DB suites PASS with env; tsc + build clean.

**Step 2: Manual acceptance walk** (dev server + scratch room)

1. **Short room unchanged:** room with <20 messages, ask `@ai` — confirm a normal reply (no recap behavior; nothing in logs about recap).
2. **Recap kicks in:** post >20 messages (mention a specific early decision around msg #3, e.g. "we're dropping the timed exam"). Then ask `@ai` a question that needs that early decision.
   - Confirm a correct answer referencing the early decision (proves the recap carried it past the 20-window).
   - `psql` — confirm `rooms.rolling_summary` / `summary_up_to_msg_id` advanced (fold path).
3. **No-fold path:** immediately ask `@ai` again (only 1-2 new messages since the fold). Confirm it answers and `summary_up_to_msg_id` did NOT need a new fold (delta ≤ 8).
4. **Fallback:** (optional) temporarily force `refreshSummaryForReply` to throw; confirm the reply still streams (raw fallback) and logs the fallback.

**Step 3: Capture learnings**

Append anything discovered to `learnings.md` (e.g., recap latency before first token in fold mode; whether the recap quality is good enough to ground answers vs. just orient).

**Step 4: Finish**

Use superpowers:finishing-a-development-branch. NOTE: the prior document-summary work also lives on this branch and the user chose "leave on branch" — confirm whether this ships together or separately before any push (push goes through `/gitpush`). No schema migration is needed for this feature (it reuses existing columns).

---

## Notes / guardrails

- **No new schema.** Reuses `rooms.rolling_summary` / `pinned_facts` / `summary_up_to_msg_id` and existing store helpers.
- **`/catchup` and the brief are untouched.** Same rolling summary, now also read (and advanced) by `@ai`. Two writers are serialized by the existing optimistic lock.
- **`MAX_HISTORY` stays 30** (GOTCHA 1) — shared by brief/poll.
- **Cost:** ≤20 rooms identical to today; >20 with small delta is cheaper (recap + ≤8); >20 with large delta pays one amortized fold call.
- **Optional follow-up (out of scope):** refactor `/catchup` to call `refreshSummaryForReply` too, removing its inline fold duplication. Skipped to keep this change's blast radius small.
