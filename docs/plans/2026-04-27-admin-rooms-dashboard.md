# Admin Rooms Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a server-rendered `/admin/rooms` page that lists every room with activity-sorted columns (last activity, msgs 24h, msgs 7d / participants 7d, files, created), name filter, sortable headers, and copy-link buttons — gated by the existing `ADMIN_TOKEN` env var via an httpOnly cookie.

**Architecture:** One Next.js App Router route group at `app/admin/rooms/`. Server Component fetches rooms via a new `adminListRoomsWithActivity()` helper in `lib/store.ts`. Auth is handled by a session cookie set by a paired auth route; missing/invalid cookie renders a token-paste form rather than a bare 401. One small `'use client'` component handles the copy-link button.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, `pg` (existing connection pool in `lib/db.ts`), no new dependencies.

**Spec:** `docs/plans/2026-04-27-admin-rooms-dashboard-design.md`

**Testing note:** This repo has no test framework and uses `SMOKE.md` for manual smoke tests. We will not introduce jest/vitest. Pure logic (sort-key whitelist) gets a tiny `node --test` (built-in to Node 22+, no deps) script. UI/auth flows are verified via SMOKE.md additions.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `lib/store.ts` | modify | Add `adminListRoomsWithActivity()` + `RoomActivityRow` type |
| `lib/admin-sort.ts` | create | Pure sort/dir whitelist mapper used by store + page |
| `lib/admin-sort.test.mjs` | create | `node --test` for the whitelist |
| `lib/admin-auth.ts` | create | Cookie name, TTL, `setAdminCookie()`, `isAdmin()` helpers |
| `app/admin/rooms/page.tsx` | create | Server Component: auth check → table or form |
| `app/admin/rooms/auth/route.ts` | create | POST + GET handlers that validate token and set cookie |
| `app/admin/rooms/CopyLinkButton.tsx` | create | Client component, single-button copy-to-clipboard |
| `app/admin/rooms/TokenForm.tsx` | create | Server-rendered form shown when no/bad cookie |
| `SMOKE.md` | modify | Add admin dashboard smoke checklist |

---

## Task 1: Sort/dir whitelist helper

**Files:**
- Create: `lib/admin-sort.ts`
- Create: `lib/admin-sort.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// lib/admin-sort.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSort } from "./admin-sort.js";

test("default when no input", () => {
  assert.deepEqual(resolveSort(undefined, undefined), {
    column: "last_message_at",
    direction: "DESC",
  });
});

test("valid sort key passes through", () => {
  assert.deepEqual(resolveSort("msgs_7d", "asc"), {
    column: "msgs_7d",
    direction: "ASC",
  });
});

test("invalid sort key falls back to default", () => {
  assert.deepEqual(resolveSort("'; DROP TABLE rooms;--", "desc"), {
    column: "last_message_at",
    direction: "DESC",
  });
});

test("invalid direction falls back to DESC", () => {
  const r = resolveSort("name", "sideways");
  assert.equal(r.direction, "DESC");
});

test("name accepts both asc and desc", () => {
  assert.equal(resolveSort("name", "asc").direction, "ASC");
  assert.equal(resolveSort("name", "desc").direction, "DESC");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/admin-sort.test.mjs`
Expected: FAIL — `Cannot find module './admin-sort.js'`

- [ ] **Step 3: Implement the helper**

```ts
// lib/admin-sort.ts
export const SORT_KEYS = [
  "name",
  "last_message_at",
  "msgs_24h",
  "msgs_7d",
  "file_count",
  "created_at",
] as const;

export type SortKey = (typeof SORT_KEYS)[number];
export type Direction = "ASC" | "DESC";

export const DEFAULT_SORT: { column: SortKey; direction: Direction } = {
  column: "last_message_at",
  direction: "DESC",
};

export function resolveSort(
  sort: string | undefined,
  dir: string | undefined
): { column: SortKey; direction: Direction } {
  const column = (SORT_KEYS as readonly string[]).includes(sort ?? "")
    ? (sort as SortKey)
    : DEFAULT_SORT.column;
  const direction: Direction = dir?.toLowerCase() === "asc" ? "ASC" : "DESC";
  return { column, direction };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/admin-sort.test.mjs`
Expected: PASS — all 5 tests.

Note: Node resolves `.js` to `.ts` only via the TS toolchain. To keep the test runnable with bare `node --test`, compile or alias. Simplest: change the import in the test to `./admin-sort.ts` and run with `node --test --experimental-strip-types lib/admin-sort.test.mjs` (Node 22.6+). If that flag is unavailable on the dev machine, the test file can be skipped from CI and run only when types-stripping is available; the helper itself is still exercised by the page.

- [ ] **Step 5: Commit**

```bash
git add lib/admin-sort.ts lib/admin-sort.test.mjs
git commit -m "feat(admin): add sort/dir whitelist helper for rooms dashboard"
```

---

## Task 2: `adminListRoomsWithActivity` store function

**Files:**
- Modify: `lib/store.ts` (append after the existing admin section near line 495)

- [ ] **Step 1: Add the row type and function**

```ts
// Append at end of lib/store.ts

export type RoomActivityRow = {
  id: string;
  name: string;
  createdAt: Date;
  msgs24h: number;
  msgs7d: number;
  participants7d: number;
  lastMessageAt: Date | null;
  totalParticipants: number;
  fileCount: number;
};

import type { SortKey, Direction } from "./admin-sort";

export async function adminListRoomsWithActivity(opts: {
  column: SortKey;
  direction: Direction;
  q?: string;
}): Promise<RoomActivityRow[]> {
  const { column, direction, q } = opts;
  // column/direction come from the whitelist resolver — safe to interpolate.
  const sql = `
    SELECT
      r.id,
      r.name,
      r.created_at,
      COUNT(m.id) FILTER (WHERE m.created_at > NOW() - INTERVAL '24 hours') AS msgs_24h,
      COUNT(m.id) FILTER (WHERE m.created_at > NOW() - INTERVAL '7 days')   AS msgs_7d,
      COUNT(DISTINCT m.author_id) FILTER (WHERE m.created_at > NOW() - INTERVAL '7 days') AS participants_7d,
      MAX(m.created_at) AS last_message_at,
      (SELECT COUNT(*) FROM participants p WHERE p.room_id = r.id) AS total_participants,
      (SELECT COUNT(*) FROM room_files f WHERE f.room_id = r.id)  AS file_count
    FROM rooms r
    LEFT JOIN messages m ON m.room_id = r.id
    WHERE ($1::text IS NULL OR r.name ILIKE '%' || $1 || '%')
    GROUP BY r.id
    ORDER BY ${column} ${direction} NULLS LAST
  `;
  const result = await query<{
    id: string;
    name: string;
    created_at: Date;
    msgs_24h: string;
    msgs_7d: string;
    participants_7d: string;
    last_message_at: Date | null;
    total_participants: string;
    file_count: string;
  }>(sql, [q && q.trim() ? q.trim() : null]);
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    msgs24h: Number(r.msgs_24h),
    msgs7d: Number(r.msgs_7d),
    participants7d: Number(r.participants_7d),
    lastMessageAt: r.last_message_at,
    totalParticipants: Number(r.total_participants),
    fileCount: Number(r.file_count),
  }));
}
```

Note: `pg` returns `bigint`/`COUNT()` results as strings — that's why we coerce with `Number()`.

- [ ] **Step 2: Move the import to the top of the file**

The `import type { SortKey, Direction }` line above must go in the import block at the top of `lib/store.ts` (alongside the existing `import { pool, query, tx } from "./db"`), not at the bottom. Move it.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/store.ts
git commit -m "feat(admin): add adminListRoomsWithActivity for rooms dashboard"
```

---

## Task 3: Admin auth helpers

**Files:**
- Create: `lib/admin-auth.ts`

- [ ] **Step 1: Implement**

```ts
// lib/admin-auth.ts
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "mf_admin_session";
export const ADMIN_COOKIE_MAX_AGE_S = 60 * 60 * 24; // 24h

/** Returns the configured ADMIN_TOKEN, or null if unset (admin disabled). */
export function adminToken(): string | null {
  const t = process.env.ADMIN_TOKEN;
  return t && t.length > 0 ? t : null;
}

/** True iff the request carries a cookie matching ADMIN_TOKEN. */
export async function isAdmin(): Promise<boolean> {
  const t = adminToken();
  if (!t) return false;
  const c = await cookies();
  return c.get(ADMIN_COOKIE)?.value === t;
}

/** Constant-time compare to defeat trivial timing leaks on token check. */
export function tokenMatches(supplied: string | null | undefined): boolean {
  const t = adminToken();
  if (!t || !supplied) return false;
  if (supplied.length !== t.length) return false;
  let diff = 0;
  for (let i = 0; i < t.length; i++) diff |= t.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}
```

Note: Next 15 made `cookies()` async. Confirm by running `grep -n 'cookies()' app/**/*.ts` after writing — if existing code awaits it, this matches.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/admin-auth.ts
git commit -m "feat(admin): add admin cookie auth helpers"
```

---

## Task 4: Auth route + token form

**Files:**
- Create: `app/admin/rooms/auth/route.ts`
- Create: `app/admin/rooms/TokenForm.tsx`

- [ ] **Step 1: Implement the auth route**

```ts
// app/admin/rooms/auth/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE_S, adminToken, tokenMatches } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function setCookieAndRedirect(req: NextRequest, token: string): NextResponse {
  const url = new URL("/admin/rooms", req.url);
  const res = NextResponse.redirect(url);
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE_S,
  });
  return res;
}

function unauthorized(req: NextRequest): NextResponse {
  const url = new URL("/admin/rooms", req.url);
  url.searchParams.set("err", "bad_token");
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  if (!adminToken()) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const supplied = req.nextUrl.searchParams.get("token");
  if (!tokenMatches(supplied)) return unauthorized(req);
  return setCookieAndRedirect(req, supplied!);
}

export async function POST(req: NextRequest) {
  if (!adminToken()) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const form = await req.formData();
  const supplied = form.get("token");
  if (typeof supplied !== "string" || !tokenMatches(supplied)) return unauthorized(req);
  return setCookieAndRedirect(req, supplied);
}
```

- [ ] **Step 2: Implement the token form**

```tsx
// app/admin/rooms/TokenForm.tsx
export default function TokenForm({ error }: { error?: string }) {
  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Admin access</h1>
      <p style={{ color: "#666" }}>Paste the admin token to continue.</p>
      {error === "bad_token" && (
        <p role="alert" style={{ color: "#c00" }}>
          Invalid token.
        </p>
      )}
      <form method="POST" action="/admin/rooms/auth">
        <input
          type="password"
          name="token"
          autoComplete="off"
          autoFocus
          required
          style={{ width: "100%", padding: 8, fontSize: 16 }}
        />
        <button type="submit" style={{ marginTop: 8, padding: "8px 16px" }}>
          Continue
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/admin/rooms/auth/route.ts app/admin/rooms/TokenForm.tsx
git commit -m "feat(admin): add cookie auth route and token form for rooms dashboard"
```

---

## Task 5: Copy-link client component

**Files:**
- Create: `app/admin/rooms/CopyLinkButton.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/admin/rooms/CopyLinkButton.tsx
"use client";
import { useState } from "react";

export default function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard API unavailable — fall back to a prompt
          window.prompt("Copy this URL:", url);
        }
      }}
      style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer" }}
      aria-label={`Copy link to ${url}`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/rooms/CopyLinkButton.tsx
git commit -m "feat(admin): add copy-link button for rooms dashboard"
```

---

## Task 6: The dashboard page

**Files:**
- Create: `app/admin/rooms/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/admin/rooms/page.tsx
import { headers } from "next/headers";
import { adminToken, isAdmin } from "@/lib/admin-auth";
import { adminListRoomsWithActivity } from "@/lib/store";
import { resolveSort, SORT_KEYS, type SortKey } from "@/lib/admin-sort";
import TokenForm from "./TokenForm";
import CopyLinkButton from "./CopyLinkButton";

export const dynamic = "force-dynamic";

type SearchParams = { sort?: string; dir?: string; q?: string; err?: string };

function relTime(d: Date | null): { label: string; dot: "green" | "yellow" | "gray" } {
  if (!d) return { label: "—", dot: "gray" };
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const days = Math.floor(h / 24);
  let label: string;
  if (m < 1) label = "just now";
  else if (m < 60) label = `${m}m ago`;
  else if (h < 24) label = `${h}h ago`;
  else label = `${days}d ago`;
  const dot = h < 1 ? "green" : h < 24 ? "yellow" : "gray";
  return { label, dot };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sortLink(
  current: { column: SortKey; direction: "ASC" | "DESC" },
  key: SortKey,
  q: string,
  label: string
): JSX.Element {
  const flip = current.column === key && current.direction === "DESC" ? "asc" : "desc";
  const params = new URLSearchParams();
  params.set("sort", key);
  params.set("dir", flip);
  if (q) params.set("q", q);
  const arrow = current.column === key ? (current.direction === "DESC" ? " ↓" : " ↑") : "";
  return <a href={`/admin/rooms?${params.toString()}`}>{label}{arrow}</a>;
}

export default async function AdminRoomsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!adminToken()) {
    return <main style={{ padding: 24 }}><h1>Admin disabled</h1><p>Set ADMIN_TOKEN to enable.</p></main>;
  }
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return <TokenForm error={sp.err} />;
  }
  const sort = resolveSort(sp.sort, sp.dir);
  const q = (sp.q ?? "").trim();
  const rows = await adminListRoomsWithActivity({ ...sort, q });

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;

  return (
    <main style={{ maxWidth: 1100, margin: "2rem auto", padding: "0 16px", fontFamily: "system-ui" }}>
      <h1>Rooms ({rows.length})</h1>
      <form method="GET" action="/admin/rooms" style={{ marginBottom: 12 }}>
        <input type="hidden" name="sort" value={sort.column} />
        <input type="hidden" name="dir" value={sort.direction.toLowerCase()} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="filter by name…"
          style={{ padding: 6, width: 260 }}
        />
        <button type="submit" style={{ marginLeft: 6 }}>Filter</button>
        {q && <a href="/admin/rooms" style={{ marginLeft: 8 }}>clear</a>}
      </form>
      {rows.length === 0 ? (
        <p>No rooms match. Seed one with <code>scripts/seed-msba-rooms.py</code>.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: 8 }}>{sortLink(sort, "name", q, "Room")}</th>
              <th style={{ padding: 8 }}>{sortLink(sort, "last_message_at", q, "Last activity")}</th>
              <th style={{ padding: 8, textAlign: "right" }}>{sortLink(sort, "msgs_24h", q, "24h")}</th>
              <th style={{ padding: 8, textAlign: "right" }}>{sortLink(sort, "msgs_7d", q, "7d / users")}</th>
              <th style={{ padding: 8, textAlign: "right" }}>{sortLink(sort, "file_count", q, "Files")}</th>
              <th style={{ padding: 8 }}>{sortLink(sort, "created_at", q, "Created")}</th>
              <th style={{ padding: 8 }}>Link</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = relTime(r.lastMessageAt);
              const dotColor = t.dot === "green" ? "#1a7f37" : t.dot === "yellow" ? "#bf8700" : "#999";
              const url = `${origin}/room/${r.id}`;
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 8 }}>
                    <a href={`/room/${r.id}`} target="_blank" rel="noreferrer">{r.name}</a>
                    <div style={{ fontSize: 11, color: "#888" }}>{r.id}</div>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: dotColor, marginRight: 6 }} />
                    {t.label}
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.msgs24h}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.msgs7d} / {r.participants7d}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.fileCount}</td>
                  <td style={{ padding: 8 }}>{ymd(r.createdAt)}</td>
                  <td style={{ padding: 8 }}><CopyLinkButton url={url} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

Note: `searchParams` is a Promise in Next 15 — we await it. `headers()` is also async.

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build completes; `/admin/rooms` and `/admin/rooms/auth` show as routes in the output.

- [ ] **Step 3: Commit**

```bash
git add app/admin/rooms/page.tsx
git commit -m "feat(admin): add /admin/rooms dashboard page"
```

---

## Task 7: SMOKE.md update + manual verification

**Files:**
- Modify: `SMOKE.md`

- [ ] **Step 1: Append a smoke section**

Add to the end of `SMOKE.md`:

```markdown
## Admin Rooms Dashboard (`/admin/rooms`)

Prereq: `ADMIN_TOKEN` set in env, dev server running.

1. Visit `/admin/rooms` with no cookie → token form appears (no table, no error banner).
2. Submit wrong token → form re-renders with "Invalid token." banner.
3. Submit correct token → redirected to `/admin/rooms`, table renders, URL has no `token=`.
4. Visit `/admin/rooms?token=$ADMIN_TOKEN` (link form) → cookie set, redirected to clean URL.
5. Confirm at least one row exists per seeded room. Counts for an idle room should be 0/0; for an active room, non-zero.
6. Click a column header twice → sort flips between ↓ and ↑. URL reflects `?sort=…&dir=…`.
7. Type a filter and submit → only matching rooms appear; the active sort persists.
8. Click "Copy" on a row → clipboard contains the absolute URL `https://<host>/room/<id>`. Button shows "Copied" briefly.
9. Click the room name → opens `/room/<id>` in a new tab.
10. Wait 24h (or manually delete the cookie) → revisiting `/admin/rooms` shows the form again.
```

- [ ] **Step 2: Run through the checklist locally**

```bash
ADMIN_TOKEN=test123 npm run dev
```

Then walk through items 1–9 in a browser. Item 10 can be verified by deleting the `mf_admin_session` cookie in devtools.

If any step fails, fix the underlying issue before committing.

- [ ] **Step 3: Commit**

```bash
git add SMOKE.md
git commit -m "docs: add admin rooms dashboard to smoke checklist"
```

---

## Self-Review Notes

**Spec coverage check:**
- Architecture (4 files + middleware) → covered by Tasks 1–6. Middleware was marked optional in the spec; not implemented here. The page handles its own auth.
- Auth flow (cookie-based, ?token= GET, paste form) → Task 4.
- SQL query → Task 2 with the exact query from the spec.
- Table columns + dot + sort + filter + empty state → Task 6.
- Error handling (admin_disabled 503, invalid cookie → form, DB error → 500) → admin_disabled in Task 4 and Task 6; DB errors propagate as 500 by Next default (acceptable per spec).
- Testing (sort whitelist unit test + SMOKE.md) → Task 1 + Task 7.

**Type consistency check:**
- `RoomActivityRow` field names (camelCase) consistent in store + page.
- `resolveSort` return shape `{column, direction}` consistent across store call site and page.
- Cookie name `mf_admin_session` defined once in `lib/admin-auth.ts`, imported everywhere it's used.

**Placeholder scan:** No TBDs, no "implement later", no vague error-handling steps. Every code step contains complete code.
