# Seminar Room Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a shared AI seminar room where 2–4 faculty chat, upload files, mention `@ai`, and click one hero button to generate a structured project brief — for a Buildathon stage demo.

**Architecture:** Next.js 15 app at `seminar-room/` sibling to `champion-chat/`. Single long-lived Node process owns all state in module-scope maps. Server-Sent Events (SSE) push updates to clients; POST endpoints for every mutation (join, message, upload, toggle-selection, brief). Files parsed server-side with `pdf-parse` + `mammoth`; extracted text stuffed into OpenAI context when selected. Name + email join (no verification), HTTP-only cookie identifies the participant. Ephemeral — state dies on restart, by design.

**Tech Stack:** Next.js 15, React 19, TypeScript, OpenAI SDK v4, `pdf-parse`, `mammoth`, `nanoid`. No database, no Tailwind. Dev port 3002.

**Design doc:** `docs/plans/2026-04-20-seminar-room-design.md`

---

## Conventions used throughout this plan

- Every task ends with a commit. Commit messages use `feat:` / `chore:` / `fix:` prefixes matching the repo's existing style.
- All paths are relative to repo root `/Users/ash/Desktop/gies-hackathon/` unless otherwise noted.
- "Run: …" means execute in that folder. Where a command must run from `seminar-room/`, the task says so.
- No unit-test framework is installed. Tasks labeled **Manual verify** give you exact browser steps and expected outcomes instead of automated tests. This matches the demo-scoped nature of the build and the smoke-test discipline locked in during brainstorm.
- Final acceptance is the smoke-test checklist in Task 17. Individual tasks verify their own slice.

---

## Task 1: Scaffold the Next.js project

**Files:**
- Create: `seminar-room/package.json`
- Create: `seminar-room/tsconfig.json`
- Create: `seminar-room/next.config.js`
- Create: `seminar-room/next-env.d.ts`
- Create: `seminar-room/.gitignore`
- Create: `seminar-room/app/layout.tsx`
- Create: `seminar-room/app/page.tsx`

**Step 1: Create folder and package.json**

`seminar-room/package.json`:

```json
{
  "name": "seminar-room",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3002",
    "build": "next build",
    "start": "next start --port 3002"
  },
  "dependencies": {
    "next": "^15.3.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "openai": "^4.86.2",
    "nanoid": "^5.0.7",
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.8.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.1.0",
    "@types/pdf-parse": "^1.1.4",
    "typescript": "^5.8.0"
  }
}
```

**Step 2: Create tsconfig.json**

`seminar-room/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 3: Create next.config.js**

`seminar-room/next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};
module.exports = nextConfig;
```

**Step 4: Create next-env.d.ts**

`seminar-room/next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

**Step 5: Create .gitignore**

`seminar-room/.gitignore`:

```
node_modules
.next
.env*.local
*.log
```

**Step 6: Create placeholder layout + home page**

`seminar-room/app/layout.tsx`:

```tsx
import type { ReactNode } from "react";

export const metadata = { title: "Gies Seminar Room" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "'Source Sans 3', system-ui, sans-serif", background: "#F5F5F5" }}>
        {children}
      </body>
    </html>
  );
}
```

`seminar-room/app/page.tsx`:

```tsx
export default function Home() {
  return <main style={{ padding: 24 }}>Seminar Room — coming soon</main>;
}
```

**Step 7: Install and verify dev boots**

Run from `seminar-room/`:
```
npm install
npm run dev
```
Expected: server listening on `http://localhost:3002`, page renders "Seminar Room — coming soon". Kill server with Ctrl-C.

**Step 8: Commit**

```
git add seminar-room/package.json seminar-room/tsconfig.json seminar-room/next.config.js seminar-room/next-env.d.ts seminar-room/.gitignore seminar-room/app/
git commit -m "feat: scaffold seminar-room Next.js app"
```

Do NOT commit `node_modules` or `package-lock.json` yet — next task handles the lockfile with the full deps installed.

---

## Task 2: Commit the lockfile

**Files:**
- Create: `seminar-room/package-lock.json`

**Step 1: Confirm lockfile exists from Task 1's npm install**

Run from `seminar-room/`:
```
ls package-lock.json
```
Expected: file exists.

**Step 2: Commit it**

```
git add seminar-room/package-lock.json
git commit -m "chore: add seminar-room lockfile"
```

---

## Task 3: In-memory store

**Files:**
- Create: `seminar-room/lib/store.ts`

**Step 1: Create store with types and helpers**

`seminar-room/lib/store.ts`:

```ts
import { nanoid } from "nanoid";

export type Participant = {
  id: string;
  name: string;
  email: string;
  joinedAt: number;
};

export type Message = {
  id: string;
  roomId: string;
  authorId: string;     // participant id, or "ai"
  authorName: string;
  content: string;
  createdAt: number;
  kind?: "chat" | "brief";
};

export type RoomFile = {
  id: string;
  roomId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedAt: number;
  extractedText: string;
};

export type Room = {
  id: string;
  name: string;
  createdAt: number;
  createdById: string;
  participants: Map<string, Participant>;
  messages: Message[];
  files: Map<string, RoomFile>;
  selectedFileIds: Set<string>;
};

const g = globalThis as unknown as { __seminarRooms?: Map<string, Room> };
export const rooms: Map<string, Room> = g.__seminarRooms ?? new Map();
g.__seminarRooms = rooms;

export function createRoom(name: string, createdById: string): Room {
  const room: Room = {
    id: nanoid(10),
    name,
    createdAt: Date.now(),
    createdById,
    participants: new Map(),
    messages: [],
    files: new Map(),
    selectedFileIds: new Set(),
  };
  rooms.set(room.id, room);
  return room;
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id);
}

export function snapshot(room: Room) {
  return {
    id: room.id,
    name: room.name,
    participants: Array.from(room.participants.values()),
    messages: room.messages,
    files: Array.from(room.files.values()).map(({ extractedText, ...rest }) => rest),
    selectedFileIds: Array.from(room.selectedFileIds),
  };
}
```

The `globalThis` trick keeps the Map alive across Next.js dev-server hot reloads. `snapshot` strips `extractedText` before sending to clients — they don't need it.

**Step 2: Typecheck**

Run from `seminar-room/`:
```
npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```
git add seminar-room/lib/store.ts
git commit -m "feat: in-memory room store"
```

---

## Task 4: SSE subscriber registry

**Files:**
- Create: `seminar-room/lib/sse.ts`

**Step 1: Create broadcast helper**

`seminar-room/lib/sse.ts`:

```ts
type Writer = WritableStreamDefaultWriter<Uint8Array>;

const g = globalThis as unknown as { __seminarSubs?: Map<string, Set<Writer>> };
const subs: Map<string, Set<Writer>> = g.__seminarSubs ?? new Map();
g.__seminarSubs = subs;

const encoder = new TextEncoder();

export function subscribe(roomId: string, writer: Writer) {
  let set = subs.get(roomId);
  if (!set) {
    set = new Set();
    subs.set(roomId, set);
  }
  set.add(writer);
}

export function unsubscribe(roomId: string, writer: Writer) {
  const set = subs.get(roomId);
  if (!set) return;
  set.delete(writer);
  if (set.size === 0) subs.delete(roomId);
}

export function broadcast(roomId: string, event: string, data: unknown) {
  const set = subs.get(roomId);
  if (!set) return;
  const payload = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const w of set) {
    w.write(payload).catch(() => {
      // writer closed; removed on next heartbeat
      try { set.delete(w); } catch {}
    });
  }
}
```

**Step 2: Typecheck**

Run from `seminar-room/`:
```
npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```
git add seminar-room/lib/sse.ts
git commit -m "feat: SSE subscriber registry + broadcast"
```

---

## Task 5: SSE stream endpoint

**Files:**
- Create: `seminar-room/app/api/room/[id]/stream/route.ts`

**Step 1: Implement GET handler**

`seminar-room/app/api/room/[id]/stream/route.ts`:

```ts
import { NextRequest } from "next/server";
import { getRoom, snapshot } from "@/lib/store";
import { subscribe, unsubscribe } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return new Response("Not found", { status: 404 });

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  // initial snapshot
  writer.write(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot(room))}\n\n`));

  subscribe(id, writer);

  // heartbeat every 15s so proxies don't close the connection
  const hb = setInterval(() => {
    writer.write(encoder.encode(`: hb\n\n`)).catch(() => clearInterval(hb));
  }, 15000);

  // cleanup when the client disconnects
  const onClose = () => {
    clearInterval(hb);
    unsubscribe(id, writer);
    writer.close().catch(() => {});
  };
  // @ts-expect-error - signal is available in Node runtime
  _req.signal?.addEventListener("abort", onClose);

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

**Step 2: Manual verify**

Run dev server, then in another terminal:
```
curl -N http://localhost:3002/api/room/doesnotexist/stream
```
Expected: `Not found` with HTTP 404.

(We can't test a real room yet — no create endpoint.)

**Step 3: Commit**

```
git add seminar-room/app/api/room/
git commit -m "feat: SSE stream endpoint"
```

---

## Task 6: Create-room endpoint

**Files:**
- Create: `seminar-room/app/api/room/route.ts`

**Step 1: Implement POST**

`seminar-room/app/api/room/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "@/lib/store";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "Untitled Room";
  const createdById = nanoid(10);
  const room = createRoom(name, createdById);
  return NextResponse.json({ id: room.id, name: room.name });
}
```

**Step 2: Manual verify**

```
curl -s -X POST http://localhost:3002/api/room -H 'content-type: application/json' -d '{"name":"Test Room"}'
```
Expected: `{"id":"<10-char-id>","name":"Test Room"}`.

Now verify SSE with the real id:
```
curl -N http://localhost:3002/api/room/<id>/stream
```
Expected: first line `event: snapshot`, then `data: {...}` with empty participants/messages/files. Leave it running.

**Step 3: Commit**

```
git add seminar-room/app/api/room/route.ts
git commit -m "feat: create-room endpoint"
```

---

## Task 7: Join endpoint

**Files:**
- Create: `seminar-room/app/api/room/[id]/join/route.ts`

**Step 1: Implement**

`seminar-room/app/api/room/[id]/join/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
  if (!name || !email) return NextResponse.json({ error: "name_and_email_required" }, { status: 400 });

  const cookieName = `seminar_pid_${id}`;
  const existing = req.cookies.get(cookieName)?.value;
  if (existing && room.participants.has(existing)) {
    return NextResponse.json({ participantId: existing });
  }

  const participantId = nanoid(10);
  room.participants.set(participantId, { id: participantId, name, email, joinedAt: Date.now() });
  broadcast(id, "participant_joined", { id: participantId, name, email, joinedAt: Date.now() });

  const res = NextResponse.json({ participantId });
  res.cookies.set(cookieName, participantId, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
```

**Step 2: Manual verify**

With a room id from Task 6 and the SSE curl still running in another terminal:
```
curl -s -X POST http://localhost:3002/api/room/<id>/join \
  -H 'content-type: application/json' -d '{"name":"Ashley","email":"a@illinois.edu"}' \
  -c /tmp/seminar-cookie.txt -v
```
Expected: 200 with `{"participantId":"..."}`, `Set-Cookie: seminar_pid_<id>=...`. The SSE terminal should emit `event: participant_joined` with Ashley's data.

**Step 3: Commit**

```
git add seminar-room/app/api/room/[id]/join/route.ts
git commit -m "feat: join-room endpoint with participant cookie"
```

---

## Task 8: OpenAI client + prompts

**Files:**
- Create: `seminar-room/lib/openai.ts`
- Create: `seminar-room/.env.local.example`

**Step 1: Create env example**

`seminar-room/.env.local.example`:

```
OPENAI_API_KEY=sk-...
```

Copy it locally:
```
cp seminar-room/.env.local.example seminar-room/.env.local
```
Then edit `.env.local` to add your real key. Do NOT commit `.env.local` — the gitignore covers it.

**Step 2: Create client + prompt helpers**

`seminar-room/lib/openai.ts`:

```ts
import OpenAI from "openai";
import type { Message, RoomFile } from "./store";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL_CHAT = "gpt-4o-mini";
const MODEL_BRIEF = "gpt-4o";
const MAX_FILE_CHARS = 200_000;
const MAX_HISTORY = 30;

function fileBlock(files: RoomFile[]): string {
  if (files.length === 0) return "";
  const parts = files.map(f => `--- FILE: ${f.name} ---\n${f.extractedText.slice(0, MAX_FILE_CHARS)}`);
  return `\n\nShared files selected by the room:\n${parts.join("\n\n")}`;
}

function historyBlock(messages: Message[]): { role: "user" | "assistant"; content: string }[] {
  const recent = messages.slice(-MAX_HISTORY);
  return recent.map(m => ({
    role: m.authorId === "ai" ? "assistant" : "user",
    content: m.authorId === "ai" ? m.content : `${m.authorName}: ${m.content}`,
  }));
}

export async function chatReply(messages: Message[], files: RoomFile[]): Promise<string> {
  const system = `You are an AI collaborator in a Gies faculty seminar room. Keep replies concise and useful. Reference the shared files when relevant.${fileBlock(files)}`;
  const res = await openai.chat.completions.create({
    model: MODEL_CHAT,
    messages: [{ role: "system", content: system }, ...historyBlock(messages)],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

export type Brief = {
  themes: string[];
  outline: { section: string; points: string[] }[];
  risks: string[];
  nextSteps: string[];
  suggestedCollaborators: string[];
};

export async function generateBrief(messages: Message[], files: RoomFile[]): Promise<Brief> {
  const system = `You turn a seminar-room conversation and shared files into a structured project brief. Be specific, not generic. Every item should be grounded in the conversation or the files.${fileBlock(files)}`;
  const res = await openai.chat.completions.create({
    model: MODEL_BRIEF,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ProjectBrief",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            themes: { type: "array", items: { type: "string" } },
            outline: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  section: { type: "string" },
                  points: { type: "array", items: { type: "string" } },
                },
                required: ["section", "points"],
              },
            },
            risks: { type: "array", items: { type: "string" } },
            nextSteps: { type: "array", items: { type: "string" } },
            suggestedCollaborators: { type: "array", items: { type: "string" } },
          },
          required: ["themes", "outline", "risks", "nextSteps", "suggestedCollaborators"],
        },
      },
    },
    messages: [{ role: "system", content: system }, ...historyBlock(messages)],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw) as Brief;
}
```

**Step 3: Typecheck**

```
npx tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**

```
git add seminar-room/lib/openai.ts seminar-room/.env.local.example
git commit -m "feat: OpenAI client with chat + structured brief prompts"
```

---

## Task 9: Message endpoint (with AI trigger)

**Files:**
- Create: `seminar-room/app/api/room/[id]/message/route.ts`

**Step 1: Implement**

`seminar-room/app/api/room/[id]/message/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getRoom, Message } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { chatReply } from "@/lib/openai";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const pid = req.cookies.get(`seminar_pid_${id}`)?.value;
  const participant = pid ? room.participants.get(pid) : undefined;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "empty" }, { status: 400 });

  const msg: Message = {
    id: nanoid(10),
    roomId: id,
    authorId: participant.id,
    authorName: participant.name,
    content: content.slice(0, 4000),
    createdAt: Date.now(),
    kind: "chat",
  };
  room.messages.push(msg);
  broadcast(id, "message_added", msg);

  // AI trigger
  if (/^@ai\b/i.test(content)) {
    (async () => {
      try {
        const selectedFiles = Array.from(room.selectedFileIds)
          .map(fid => room.files.get(fid))
          .filter((f): f is NonNullable<typeof f> => !!f);
        const reply = await chatReply(room.messages, selectedFiles);
        const aiMsg: Message = {
          id: nanoid(10),
          roomId: id,
          authorId: "ai",
          authorName: "AI",
          content: reply || "(no reply)",
          createdAt: Date.now(),
          kind: "chat",
        };
        room.messages.push(aiMsg);
        broadcast(id, "message_added", aiMsg);
      } catch (err) {
        const errMsg: Message = {
          id: nanoid(10),
          roomId: id,
          authorId: "ai",
          authorName: "AI",
          content: "⚠️ I couldn't generate a response. Try again.",
          createdAt: Date.now(),
          kind: "chat",
        };
        room.messages.push(errMsg);
        broadcast(id, "message_added", errMsg);
      }
    })();
  }

  return NextResponse.json({ ok: true, id: msg.id });
}
```

**Step 2: Manual verify**

With room id + cookie from Task 7, and SSE running:
```
curl -s -X POST http://localhost:3002/api/room/<id>/message \
  -H 'content-type: application/json' -b /tmp/seminar-cookie.txt \
  -d '{"content":"hello room"}'
```
Expected: `{"ok":true,"id":"..."}`; SSE emits `message_added` with Ashley's message.

Then:
```
curl -s -X POST http://localhost:3002/api/room/<id>/message \
  -H 'content-type: application/json' -b /tmp/seminar-cookie.txt \
  -d '{"content":"@ai say hi in five words"}'
```
Expected: SSE emits the user message immediately, then a second `message_added` ~2–5s later with `authorId:"ai"`.

**Step 3: Commit**

```
git add seminar-room/app/api/room/[id]/message/route.ts
git commit -m "feat: message endpoint with @ai trigger"
```

---

## Task 10: File parser helper

**Files:**
- Create: `seminar-room/lib/parse.ts`

**Step 1: Implement**

`seminar-room/lib/parse.ts`:

```ts
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export type ParseResult = { text: string; mime: string };

export async function parseFile(name: string, mime: string, buf: Buffer): Promise<ParseResult> {
  const lower = name.toLowerCase();

  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const res = await pdfParse(buf);
    return { text: res.text ?? "", mime: "application/pdf" };
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const res = await mammoth.extractRawText({ buffer: buf });
    return {
      text: res.value ?? "",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  if (mime.startsWith("text/") || lower.endsWith(".txt") || lower.endsWith(".md")) {
    return { text: buf.toString("utf8"), mime: mime || "text/plain" };
  }

  throw new Error(`unsupported_file_type:${mime || lower}`);
}
```

**Step 2: Typecheck**

```
npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```
git add seminar-room/lib/parse.ts
git commit -m "feat: file parser for PDF/DOCX/TXT"
```

---

## Task 11: Upload endpoint

**Files:**
- Create: `seminar-room/app/api/room/[id]/upload/route.ts`

**Step 1: Implement**

`seminar-room/app/api/room/[id]/upload/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getRoom, RoomFile } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { parseFile } from "@/lib/parse";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;    // 10MB hard cap
const MAX_TEXT_CHARS = 200_000;        // 200K chars cap per file

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const pid = req.cookies.get(`seminar_pid_${id}`)?.value;
  const participant = pid ? room.participants.get(pid) : undefined;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseFile(file.name, file.type, buf);
  } catch (err) {
    return NextResponse.json({ error: "parse_failed", message: (err as Error).message }, { status: 415 });
  }

  const rf: RoomFile = {
    id: nanoid(10),
    roomId: id,
    name: file.name,
    mime: parsed.mime,
    sizeBytes: file.size,
    uploadedById: participant.id,
    uploadedAt: Date.now(),
    extractedText: parsed.text.slice(0, MAX_TEXT_CHARS),
  };
  room.files.set(rf.id, rf);
  room.selectedFileIds.add(rf.id);

  const { extractedText, ...publicFile } = rf;
  broadcast(id, "file_added", publicFile);
  broadcast(id, "file_selection_changed", { selectedFileIds: Array.from(room.selectedFileIds) });

  return NextResponse.json({ ok: true, file: publicFile });
}
```

**Step 2: Manual verify**

Prepare a small test PDF (any PDF under 10MB) at `/tmp/test.pdf`:
```
curl -s -X POST http://localhost:3002/api/room/<id>/upload \
  -b /tmp/seminar-cookie.txt \
  -F "file=@/tmp/test.pdf"
```
Expected: `{"ok":true,"file":{...}}`; SSE emits `file_added` then `file_selection_changed`.

Then upload a bogus binary to confirm error path:
```
echo "not a pdf" > /tmp/bad.bin
curl -s -X POST http://localhost:3002/api/room/<id>/upload \
  -b /tmp/seminar-cookie.txt -F "file=@/tmp/bad.bin"
```
Expected: HTTP 415 with `parse_failed`.

**Step 3: Commit**

```
git add seminar-room/app/api/room/[id]/upload/route.ts
git commit -m "feat: upload + parse file endpoint"
```

---

## Task 12: Toggle file selection endpoint

**Files:**
- Create: `seminar-room/app/api/room/[id]/files/route.ts`

**Step 1: Implement**

`seminar-room/app/api/room/[id]/files/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/store";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const pid = req.cookies.get(`seminar_pid_${id}`)?.value;
  if (!pid || !room.participants.has(pid)) {
    return NextResponse.json({ error: "not_joined" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  const selected = typeof body.selected === "boolean" ? body.selected : undefined;
  if (!fileId || !room.files.has(fileId) || selected === undefined) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (selected) room.selectedFileIds.add(fileId);
  else room.selectedFileIds.delete(fileId);

  broadcast(id, "file_selection_changed", { selectedFileIds: Array.from(room.selectedFileIds) });
  return NextResponse.json({ ok: true });
}
```

**Step 2: Manual verify**

```
curl -s -X POST http://localhost:3002/api/room/<id>/files \
  -H 'content-type: application/json' -b /tmp/seminar-cookie.txt \
  -d '{"fileId":"<fid>","selected":false}'
```
Expected: `{"ok":true}`; SSE emits `file_selection_changed` with the file removed from the array.

**Step 3: Commit**

```
git add seminar-room/app/api/room/[id]/files/route.ts
git commit -m "feat: toggle file selection endpoint"
```

---

## Task 13: Generate-brief endpoint

**Files:**
- Create: `seminar-room/app/api/room/[id]/brief/route.ts`

**Step 1: Implement**

`seminar-room/app/api/room/[id]/brief/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getRoom, Message } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { generateBrief } from "@/lib/openai";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const pid = req.cookies.get(`seminar_pid_${id}`)?.value;
  if (!pid || !room.participants.has(pid)) {
    return NextResponse.json({ error: "not_joined" }, { status: 401 });
  }

  // fire-and-forget; client reads the result via SSE
  (async () => {
    try {
      const selectedFiles = Array.from(room.selectedFileIds)
        .map(fid => room.files.get(fid))
        .filter((f): f is NonNullable<typeof f> => !!f);
      const brief = await generateBrief(room.messages, selectedFiles);
      const msg: Message = {
        id: nanoid(10),
        roomId: id,
        authorId: "ai",
        authorName: "AI",
        content: JSON.stringify(brief),
        createdAt: Date.now(),
        kind: "brief",
      };
      room.messages.push(msg);
      broadcast(id, "message_added", msg);
      broadcast(id, "brief_generated", { id: msg.id });
    } catch (err) {
      const errMsg: Message = {
        id: nanoid(10),
        roomId: id,
        authorId: "ai",
        authorName: "AI",
        content: "⚠️ I couldn't generate the brief. Try again.",
        createdAt: Date.now(),
        kind: "chat",
      };
      room.messages.push(errMsg);
      broadcast(id, "message_added", errMsg);
    }
  })();

  return NextResponse.json({ ok: true });
}
```

**Step 2: Manual verify**

```
curl -s -X POST http://localhost:3002/api/room/<id>/brief \
  -b /tmp/seminar-cookie.txt
```
Expected: `{"ok":true}` immediately; SSE emits `message_added` with `kind:"brief"` after ~5–20s whose `content` parses as `{themes, outline, risks, nextSteps, suggestedCollaborators}`.

**Step 3: Commit**

```
git add seminar-room/app/api/room/[id]/brief/route.ts
git commit -m "feat: generate-brief endpoint with structured JSON output"
```

---

## Task 14: Landing page (create + join)

**Files:**
- Modify: `seminar-room/app/page.tsx`
- Create: `seminar-room/app/globals.css`
- Modify: `seminar-room/app/layout.tsx` — add `import "./globals.css"`

**Step 1: Create globals.css with Gies palette**

`seminar-room/app/globals.css`:

```css
:root {
  --navy: #13294B;
  --orange: #E84A27;
  --bg: #F5F5F5;
  --card: #FFFFFF;
  --border: #E5E7EB;
  --text: #111827;
  --muted: #6B7280;
}
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Source+Sans+3:wght@400;500;600&display=swap');

*, *::before, *::after { box-sizing: border-box; }
html, body, #__next { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: 'Source Sans 3', system-ui, sans-serif; }
h1, h2, h3 { font-family: Montserrat, system-ui, sans-serif; color: var(--navy); }
button { cursor: pointer; font-family: inherit; }
input, textarea { font-family: inherit; }
```

**Step 2: Update layout.tsx to import globals**

Replace the contents of `seminar-room/app/layout.tsx`:

```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Gies Seminar Room" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en"><body>{children}</body></html>
  );
}
```

**Step 3: Write landing page**

Replace `seminar-room/app/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [joinId, setJoinId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name || "Project Brainstorm Room" }),
      });
      if (!res.ok) throw new Error("create_failed");
      const { id } = await res.json();
      router.push(`/room/${id}`);
    } catch (e) { setErr("Could not create room."); }
    finally { setLoading(false); }
  }

  function onJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = joinId.trim();
    if (!trimmed) return;
    router.push(`/room/${trimmed}`);
  }

  return (
    <main style={{ maxWidth: 720, margin: "10vh auto", padding: 24 }}>
      <h1 style={{ fontSize: 40, margin: 0 }}>Gies Seminar Room</h1>
      <p style={{ color: "var(--muted)", marginTop: 8 }}>
        A shared AI workspace for faculty brainstorming. Create a room, invite collaborators with the link, upload docs, chat with AI.
      </p>

      <section style={card()}>
        <h2 style={{ marginTop: 0 }}>Create a room</h2>
        <form onSubmit={onCreate} style={{ display: "flex", gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="Room name (e.g., Fall 2026 Grant Brainstorm)"
            style={input()} />
          <button type="submit" disabled={loading} style={btnPrimary()}>
            {loading ? "Creating…" : "Create"}
          </button>
        </form>
      </section>

      <section style={card()}>
        <h2 style={{ marginTop: 0 }}>Join a room</h2>
        <form onSubmit={onJoin} style={{ display: "flex", gap: 8 }}>
          <input value={joinId} onChange={e => setJoinId(e.target.value)}
            placeholder="Room ID (from the link)" style={input()} />
          <button type="submit" style={btnSecondary()}>Open</button>
        </form>
      </section>

      {err && <p style={{ color: "crimson" }}>{err}</p>}
    </main>
  );
}

function card(): React.CSSProperties {
  return { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginTop: 24 };
}
function input(): React.CSSProperties {
  return { flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 16 };
}
function btnPrimary(): React.CSSProperties {
  return { background: "var(--orange)", color: "white", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 600 };
}
function btnSecondary(): React.CSSProperties {
  return { background: "var(--navy)", color: "white", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 600 };
}
```

**Step 4: Manual verify**

Reload http://localhost:3002 — page shows two cards, creating a room redirects to `/room/<id>` (which 404s for now; that's fine, next task fixes it).

**Step 5: Commit**

```
git add seminar-room/app/page.tsx seminar-room/app/layout.tsx seminar-room/app/globals.css
git commit -m "feat: landing page with create + join"
```

---

## Task 15: Room page UI

**Files:**
- Create: `seminar-room/app/room/[id]/page.tsx`

This is the biggest task — the single-page room UI. Copy it verbatim.

**Step 1: Create the room page**

`seminar-room/app/room/[id]/page.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { use } from "react";

type Participant = { id: string; name: string; email: string; joinedAt: number };
type PublicFile = { id: string; roomId: string; name: string; mime: string; sizeBytes: number; uploadedById: string; uploadedAt: number };
type Msg = { id: string; roomId: string; authorId: string; authorName: string; content: string; createdAt: number; kind?: "chat" | "brief" };
type Snapshot = { id: string; name: string; participants: Participant[]; messages: Msg[]; files: PublicFile[]; selectedFileIds: string[] };

export default function RoomPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);

  const [joined, setJoined] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [joinError, setJoinError] = useState("");
  const [state, setState] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setJoinError("");
    const res = await fetch(`/api/room/${id}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    if (res.status === 404) { setJoinError("Room not found."); return; }
    if (!res.ok) { setJoinError("Could not join."); return; }
    setJoined(true);
  }

  // SSE subscription
  useEffect(() => {
    if (!joined) return;
    const es = new EventSource(`/api/room/${id}/stream`);
    es.addEventListener("snapshot", (ev) => {
      setState(JSON.parse((ev as MessageEvent).data));
    });
    es.addEventListener("participant_joined", (ev) => {
      const p: Participant = JSON.parse((ev as MessageEvent).data);
      setState(s => s ? { ...s, participants: upsertById(s.participants, p) } : s);
    });
    es.addEventListener("message_added", (ev) => {
      const m: Msg = JSON.parse((ev as MessageEvent).data);
      setState(s => s ? { ...s, messages: [...s.messages, m] } : s);
    });
    es.addEventListener("file_added", (ev) => {
      const f: PublicFile = JSON.parse((ev as MessageEvent).data);
      setState(s => s ? { ...s, files: upsertById(s.files, f) } : s);
    });
    es.addEventListener("file_selection_changed", (ev) => {
      const { selectedFileIds } = JSON.parse((ev as MessageEvent).data);
      setState(s => s ? { ...s, selectedFileIds } : s);
    });
    es.onerror = () => { /* EventSource auto-reconnects */ };
    return () => es.close();
  }, [id, joined]);

  // autoscroll
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [state?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await fetch(`/api/room/${id}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/room/${id}/upload`, { method: "POST", body: fd });
      if (!res.ok) alert(`Upload failed: ${res.status}`);
    } finally { setBusy(false); }
  }

  async function toggleFile(fileId: string, selected: boolean) {
    await fetch(`/api/room/${id}/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileId, selected }),
    });
  }

  async function generateBrief() {
    setBusy(true);
    try { await fetch(`/api/room/${id}/brief`, { method: "POST" }); }
    finally { setBusy(false); }
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
  }

  if (!joined) {
    return (
      <main style={{ maxWidth: 480, margin: "15vh auto", padding: 24 }}>
        <h1>Join room</h1>
        <form onSubmit={join} style={{ display: "grid", gap: 12 }}>
          <input required placeholder="Your name" value={name} onChange={e => setName(e.target.value)} style={inp()} />
          <input required type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={inp()} />
          <button type="submit" style={btnPrimary()}>Join</button>
          {joinError && <p style={{ color: "crimson" }}>{joinError}</p>}
        </form>
      </main>
    );
  }

  if (!state) return <main style={{ padding: 24 }}>Connecting…</main>;

  return (
    <main style={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr", background: "var(--bg)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 20px", background: "var(--navy)", color: "white" }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Gies Seminar Room</div>
          <div style={{ fontFamily: "Montserrat, sans-serif", fontSize: 20 }}>{state.name}</div>
        </div>
        <button onClick={copyLink} style={{ ...btnSecondary(), background: "var(--orange)" }}>Copy link</button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 280px", gap: 16, padding: 16, minHeight: 0 }}>
        {/* Participants */}
        <aside style={col()}>
          <h3 style={colTitle()}>Participants</h3>
          {state.participants.map(p => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: "#22c55e" }} />
              <span>{p.name}</span>
            </div>
          ))}
        </aside>

        {/* Chat */}
        <section style={{ ...col(), minHeight: 0, display: "grid", gridTemplateRows: "1fr auto" }}>
          <div style={{ overflowY: "auto", paddingRight: 8 }}>
            {state.messages.length === 0 && (
              <p style={{ color: "var(--muted)" }}>
                Mention <code>@ai</code> to ask a question, or click <b>Generate project brief</b> when ready.
              </p>
            )}
            {state.messages.map(m => <MsgView key={m.id} m={m} />)}
            <div ref={chatBottomRef} />
          </div>
          <form onSubmit={send} style={{ display: "flex", gap: 8, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <input value={draft} onChange={e => setDraft(e.target.value)}
              placeholder="Type a message. Start with @ai to ask the AI." style={inp()} />
            <button type="submit" style={btnPrimary()}>Send</button>
          </form>
        </section>

        {/* Files */}
        <aside style={{ ...col(), display: "grid", gridTemplateRows: "auto 1fr auto auto", gap: 8 }}>
          <h3 style={colTitle()}>Files</h3>
          <div style={{ overflowY: "auto" }}>
            {state.files.length === 0 && <p style={{ color: "var(--muted)", fontSize: 14 }}>No files yet.</p>}
            {state.files.map(f => {
              const selected = state.selectedFileIds.includes(f.id);
              return (
                <label key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 14 }}>
                  <input type="checkbox" checked={selected} onChange={e => toggleFile(f.id, e.target.checked)} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                </label>
              );
            })}
          </div>
          <label style={{ ...btnSecondary(), textAlign: "center", display: "block" }}>
            + Upload file
            <input type="file" hidden accept=".pdf,.docx,.txt,.md"
              onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <button onClick={generateBrief} disabled={busy} style={heroBtn()}>
            ✨ Generate project brief
          </button>
        </aside>
      </div>
    </main>
  );
}

function MsgView({ m }: { m: Msg }) {
  if (m.kind === "brief") return <BriefView m={m} />;
  const isAi = m.authorId === "ai";
  return (
    <div style={{
      padding: "10px 12px", margin: "8px 0", background: "var(--card)",
      border: "1px solid var(--border)", borderRadius: 8,
      borderLeft: isAi ? "3px solid var(--orange)" : "3px solid var(--navy)",
    }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{m.authorName}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
    </div>
  );
}

function BriefView({ m }: { m: Msg }) {
  let brief: any = null;
  try { brief = JSON.parse(m.content); } catch { return <MsgView m={{ ...m, kind: "chat", content: m.content }} />; }
  return (
    <div style={{ padding: 16, margin: "12px 0", background: "var(--card)",
      border: "1px solid var(--border)", borderRadius: 8, borderLeft: "3px solid var(--orange)" }}>
      <div style={{ fontFamily: "Montserrat, sans-serif", color: "var(--navy)", fontWeight: 700, marginBottom: 8 }}>
        Project Brief
      </div>
      <Section title="Themes" items={brief.themes} />
      <div style={{ margin: "12px 0" }}>
        <div style={sectionTitle()}>Outline</div>
        {(brief.outline ?? []).map((o: any, i: number) => (
          <div key={i} style={{ marginTop: 6 }}>
            <div style={{ fontWeight: 600 }}>{o.section}</div>
            <ul style={{ margin: "4px 0 0 18px" }}>{(o.points ?? []).map((p: string, j: number) => <li key={j}>{p}</li>)}</ul>
          </div>
        ))}
      </div>
      <Section title="Risks" items={brief.risks} />
      <Section title="Next steps" items={brief.nextSteps} />
      <Section title="Suggested collaborators" items={brief.suggestedCollaborators} />
    </div>
  );
}

function Section({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div style={{ margin: "12px 0" }}>
      <div style={sectionTitle()}>{title}</div>
      <ul style={{ margin: "4px 0 0 18px" }}>{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </div>
  );
}

function sectionTitle(): React.CSSProperties {
  return { fontFamily: "Montserrat, sans-serif", color: "var(--navy)", fontWeight: 600 };
}
function col(): React.CSSProperties {
  return { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, overflow: "hidden" };
}
function colTitle(): React.CSSProperties {
  return { margin: "0 0 8px", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" };
}
function inp(): React.CSSProperties {
  return { flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 16 };
}
function btnPrimary(): React.CSSProperties {
  return { background: "var(--orange)", color: "white", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 600 };
}
function btnSecondary(): React.CSSProperties {
  return { background: "var(--navy)", color: "white", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 600 };
}
function heroBtn(): React.CSSProperties {
  return { background: "linear-gradient(135deg, var(--orange), #ff7a3d)", color: "white", border: "none", borderRadius: 8, padding: "12px 16px", fontWeight: 700, fontSize: 15 };
}

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const idx = arr.findIndex(a => a.id === item.id);
  if (idx === -1) return [...arr, item];
  const copy = arr.slice();
  copy[idx] = item;
  return copy;
}
```

**Step 2: Typecheck**

```
npx tsc --noEmit
```
Expected: no errors.

**Step 3: Manual verify**

- Open tab A at `http://localhost:3002`, create a room, join with name "Ashley" / email "a@illinois.edu". You should see the three-column layout.
- Copy link. Open it in tab B (different browser profile or private window), join with "Vishal" / "v@illinois.edu". Tab A's participant list should show Vishal within 1s.
- Send "hello" in tab A → appears in both within 1s.
- In tab B send "@ai say hi in 3 words" → user message appears instantly, AI reply follows within 5s.
- Upload a PDF in tab A → appears in both file panels within 1s.
- Uncheck the file in tab B → checkbox updates in tab A.
- Click "Generate project brief" → structured card appears in both.

**Step 4: Commit**

```
git add seminar-room/app/room/
git commit -m "feat: room page UI with chat, files, brief rendering"
```

---

## Task 16: README for the sub-app

**Files:**
- Create: `seminar-room/README.md`

**Step 1: Write it**

`seminar-room/README.md`:

```markdown
# Seminar Room

Shared AI workspace for Gies faculty brainstorming. Next.js 15 + SSE + in-memory store. Ephemeral by design.

## Dev

    cp .env.local.example .env.local        # add your OPENAI_API_KEY
    npm install
    npm run dev                              # http://localhost:3002

## Flow

1. Landing page → Create room or paste a room ID to join.
2. Room page → join modal (name + email) → three-column UI: participants / chat / files.
3. Mention `@ai` in chat to trigger the AI. Select files on the right to include them as context.
4. Hit **Generate project brief** for a structured output (themes, outline, risks, next steps, suggested collaborators).

## Limitations (intentional)

- State lives in the Node process. Restart = new world.
- No magic-link auth. Anyone with the room link + any name/email can join.
- PDF/DOCX/TXT parsing only. PPTX deferred.
- Single region, dev-server deploy. Not for Vercel serverless (in-memory store wouldn't survive).

See `../docs/plans/2026-04-20-seminar-room-design.md` for full design rationale.
```

**Step 2: Commit**

```
git add seminar-room/README.md
git commit -m "docs: seminar-room README"
```

---

## Task 17: Final smoke test + smoke checklist

**Files:**
- Create: `seminar-room/SMOKE.md`

**Step 1: Write the checklist**

`seminar-room/SMOKE.md`:

```markdown
# Smoke test — seminar-room

Run before any demo. Uses two browser tabs (A and B) with different cookies.

1. [ ] Create room in A → join as Ashley. Copy link, open in B, join as Vishal → B shows up in A's participant list within 1s.
2. [ ] Send "hello" in A → appears in B within 1s.
3. [ ] Upload `test.pdf` in A → appears in B's file panel within 1s; checkbox checked in both.
4. [ ] Send `@ai summarize the file` in B → AI reply appears in both within ~5s.
5. [ ] Click "Generate project brief" → structured card posts to both, with themes / outline / risks / next steps / collaborators.
6. [ ] Kill tab A's network for 10s, restore → A reconnects, messages sent by B during the outage appear.
7. [ ] Upload a corrupt binary (`echo "nope" > /tmp/bad.bin`) → alert fires, no file appears.
8. [ ] Hard-refresh B mid-conversation → full state rehydrates (participants, messages, files, selection).
```

**Step 2: Execute the checklist manually and tick items**

Run `npm run dev`, walk through each item, fix anything that fails.

**Step 3: Commit**

```
git add seminar-room/SMOKE.md
git commit -m "docs: seminar-room smoke-test checklist"
```

---

## Task 18: Update project CLAUDE.md with Completed Work entry

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Append the Completed Work section at the bottom**

Add at the end of `CLAUDE.md`:

```markdown

## Completed Work

### 2026-04-20 — Seminar Room MVP (`seminar-room/`)
- Shared AI seminar room for 2–4 faculty: create room, invite by link, chat + upload files + generate structured project brief.
- Stack: Next.js 15 + SSE + in-memory `Map`-based store, sibling to `champion-chat/`. Runs on port 3002.
- Ephemeral by design (Buildathon demo scope). State dies on restart.
- Files parsed server-side (`pdf-parse`, `mammoth`), extracted text stuffed into OpenAI context when selected.
- Hero "Generate project brief" uses `response_format: json_schema` for structured output.
- Upgrade path to Supabase + Realtime documented in `docs/plans/2026-04-20-seminar-room-design.md`.
```

**Step 2: Commit**

```
git add CLAUDE.md
git commit -m "docs: log seminar-room MVP in Completed Work"
```

---

## Done

Push-blocked per project policy: any push to remote goes through `/gitpush` (secret scan). When you're ready to push the whole series, run `/gitpush` — don't `git push` directly.
