# Seminar Room — Design

**Date:** 2026-04-20
**Status:** Approved, ready for implementation plan
**Target:** Buildathon stage demo (ephemeral, 2–4 users per room, live realtime)

## Purpose

A shared "AI seminar room" where 2–4 Gies faculty can brainstorm a project together with an AI participant. One person creates a room, shares the link, others join with name + email, and the group chats in a single thread while AI can be mentioned, files can be uploaded as shared context, and a hero "Generate project brief" button turns the conversation into a structured proposal outline.

Scope is a Buildathon stage demo, not a persistent pilot. State lives in process memory and is wiped on restart.

## Constraints (locked via brainstorm)

- **Audience / use:** Buildathon demo (not a long-lived pilot).
- **Realtime:** 2–4 people per room, live updates within ~1s — requires SSE.
- **Files:** Text extraction (pdf-parse, mammoth) → stuffed into AI context when a file is selected. No RAG, no vector store.
- **Auth:** Name + email, no verification. Room link is the gate.
- **AI smart action:** One hero "Generate project brief" producing structured output (themes, proposal outline, risks, next steps, suggested collaborators).

## Architecture

New folder `seminar-room/` at repo root, sibling to `champion-chat/`. Same stack as champion-chat:
- Next.js 15, React 19, TypeScript, OpenAI SDK.
- Dev port 3002 (avoids 3001 collision).
- Single long-lived Node process owns all state in module-scope maps.
- SSE for server → client push; POST endpoints for all mutations.

### Folder layout

```
seminar-room/
  app/
    page.tsx                          landing — create or join
    room/[id]/page.tsx                room UI
    api/
      room/route.ts                   POST create room
      room/[id]/join/route.ts         POST join
      room/[id]/message/route.ts      POST send message (AI triggered on @ai)
      room/[id]/upload/route.ts       POST upload + parse file
      room/[id]/files/route.ts        POST toggle selection
      room/[id]/brief/route.ts        POST generate project brief
      room/[id]/stream/route.ts       GET SSE stream
  lib/
    store.ts                          in-memory Map<roomId, Room>
    sse.ts                            subscriber registry + broadcast
    parse.ts                          pdf-parse, mammoth wrappers
    openai.ts                         client + prompt templates
  package.json
  next.config.js
  tsconfig.json
  SMOKE.md                            manual smoke-test checklist
```

## Data model (in-memory)

```ts
type Participant = { id: string; name: string; email: string; joinedAt: number };

type Message = {
  id: string;
  roomId: string;
  authorId: string;              // participant id, or "ai" for AI replies
  authorName: string;            // denormalized for display
  content: string;
  createdAt: number;
  kind?: "chat" | "brief";       // "brief" renders as structured card
};

type RoomFile = {
  id: string;
  roomId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedAt: number;
  extractedText: string;         // parsed once at upload, cached
};

type Room = {
  id: string;                    // nanoid, used in URL
  name: string;
  createdAt: number;
  createdById: string;
  participants: Map<string, Participant>;
  messages: Message[];
  files: Map<string, RoomFile>;
  selectedFileIds: Set<string>;
};
```

Top-level: `export const rooms = new Map<string, Room>()` in `lib/store.ts`.

### SSE events

- `participant_joined`
- `message_added`
- `file_added`
- `file_selection_changed`
- `brief_generated`

First event on a new SSE connection is `snapshot` — the full room state — so clients can rehydrate after reconnect.

## Data flow

### Joining
1. User opens `/room/:id`. If no `seminar_pid_<roomId>` cookie → modal asks name + email.
2. POST `/api/room/:id/join` → creates `Participant`, sets HTTP-only cookie, broadcasts `participant_joined`.
3. Client opens SSE to `/api/room/:id/stream`, receives `snapshot`, then incremental events.

### Sending a message
1. POST `/api/room/:id/message` with `{ content }`; `authorId` resolved from cookie.
2. Server appends to `room.messages`, broadcasts `message_added`.
3. AI trigger: if content starts with `@ai`, server kicks off async OpenAI call using last 30 messages + text of all `selectedFileIds`. Reply posted as a complete message (no token streaming in MVP).

### Uploading a file
1. POST `/api/room/:id/upload` (multipart).
2. Server parses PDF/DOCX/TXT server-side (pdf-parse, mammoth). PPTX deferred.
3. Stores `RoomFile` with cached `extractedText`. Auto-adds to `selectedFileIds`.
4. Broadcasts `file_added` + `file_selection_changed`.

### Generate project brief (hero action)
1. POST `/api/room/:id/brief`.
2. Server builds one prompt: full chat history + all selected file text + JSON-schema instruction requesting `{ themes, outline, risks, nextSteps, suggestedCollaborators }`.
3. OpenAI call uses `response_format: { type: "json_schema", ... }` for reliable structure.
4. Brief is posted as a `Message` with `kind: "brief"`; UI renders it as a sectioned card.
5. Broadcasts `brief_generated`.

## UI

Three-column desktop layout, stacks on mobile.

- **Left:** participant list, live via SSE, green dot on connected.
- **Center:** chat thread; user messages have sender name + color chip; AI messages have an orange left-border accent; brief messages render with section headers in a card.
- **Right:** files with checkboxes (toggle selection), "+ Upload" button, hero "✨ Generate project brief" button at the bottom.
- **Empty state:** "Mention @ai to ask a question, or click Generate project brief when you've gathered enough context."
- **Header:** room name + "Copy link" button.

Palette: Illini Navy `#13294B`, Illini Orange `#E84A27`. Source Sans 3 body, Montserrat headers. No Tailwind — inline CSS modules or a single `globals.css`, matching champion-chat's approach.

## Error handling

- **Unknown room id** → "Room not found. [Create a new room]".
- **Missing participant cookie** → 401 on mutation; client reopens join modal.
- **SSE disconnect** → client auto-reconnects with exponential backoff (1s → 2s → 5s cap). On reconnect, server sends fresh `snapshot` to reconcile.
- **File parse failure** → file rejected with toast; no partial `RoomFile`.
- **OpenAI failure** → AI posts `"⚠️ I couldn't generate a response. Try again."`; room stays healthy.
- **File size** → hard cap 10MB per file; extracted text truncated at 200KB per file with a visible notice.
- **Context overflow** on brief → trim oldest messages first; include a header note in the brief when trimming occurs.
- **Concurrent sends** → single-process store means array append is atomic; no locking needed.

## Testing

No unit suite. Manual smoke checklist committed as `seminar-room/SMOKE.md`:

1. Create room in tab A, join in tab B → B appears in A's participant list within 1s.
2. Send message in A → appears in B within 1s.
3. Upload `grant.pdf` in A → appears in B's file panel within 1s.
4. `@ai summarize the grant` in B → AI reply appears in both within ~5s.
5. Click "Generate project brief" → structured brief posts to thread, visible to all.
6. Kill tab A's network for 10s, restore → missed messages appear on reconnect.
7. Upload corrupt PDF → toast error, no broken file in list.
8. Hard-refresh tab B mid-conversation → full state rehydrates from snapshot.

Fallback: a demo video recorded during dev, in case of live failure on stage.

## Explicit non-goals (YAGNI)

- No persistence across process restart.
- No Supabase / Postgres / vector store.
- No magic-link auth, no email verification.
- No token-level AI streaming (complete-message reply only).
- No PPTX parsing in MVP (deferred).
- No unit or integration test suite.
- No production Vercel deploy (dev mode on a laptop or single-region preview is enough for the demo).

## Upgrade path (post-Buildathon, out of scope)

If this graduates to a faculty pilot, the storage layer is the only thing that changes:
- Swap `lib/store.ts` for Supabase (rooms, messages, files tables; Storage bucket for uploads).
- Swap `lib/sse.ts` for Supabase Realtime channels.
- Swap text-stuffing for OpenAI File Search or a pgvector index if file volume grows.
- Add magic-link auth (Resend is already wired in champion-chat).

API surface seen by the UI stays the same.
