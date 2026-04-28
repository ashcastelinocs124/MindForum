# Admin Rooms Dashboard — Design

**Date:** 2026-04-27
**Status:** Design approved, ready for implementation plan

## Problem

Rooms are accumulating faster than the operator can track them. There is no single surface that answers "which rooms exist, which are active, and how do I jump into one?" The seed script and filesystem (`MindForum/rooms/<slug>/`) hint at structure, but neither reflects live activity (messages, participants, recency).

## Goal

A single admin-only web page at `/admin/rooms` that lists every room with at-a-glance activity signals, sortable columns, and one-click access to each room and its shareable URL.

## Non-Goals

- Editing rooms, participants, or messages from this page.
- Charts, time-series, or per-room drill-down dashboards.
- Multi-user admin auth, audit logs, or RBAC.
- Archival/soft-delete of stale rooms.
- Real-time updates (page is request-time only; reload to refresh).

## Architecture

New route group under `app/admin/rooms/`. No new dependencies; reuses the existing Postgres pool, `ADMIN_TOKEN` env var, and global styles.

| File | Role |
|---|---|
| `app/admin/rooms/page.tsx` | Server Component. Reads `admin_session` cookie, validates against `ADMIN_TOKEN`. If missing/invalid → renders a minimal token-paste form. If valid → fetches rooms and renders the table. Handles `?sort=` and `?q=` query params. |
| `app/admin/rooms/auth/route.ts` | POST and GET handler. Accepts token (form body or `?token=` query), sets `admin_session` httpOnly cookie (24h TTL, `Secure` in prod, `SameSite=Lax`), redirects to `/admin/rooms`. The GET form supports the bookmarkable token-link flow. |
| `app/admin/rooms/CopyLinkButton.tsx` | Tiny `'use client'` component — single button per row that copies the absolute room URL to the clipboard. |
| `lib/store.ts` | Add `adminListRoomsWithActivity({ sort, q })` returning the typed rows for the table. |
| `middleware.ts` (new if absent) | Belt-and-suspenders 401 on `/admin/*` without the cookie, except `/admin/rooms/auth`. |

### Auth flow

1. Operator visits `/admin/rooms?token=XXX` (link saved in password manager).
2. The page sees the `token` query param, validates it server-side against `ADMIN_TOKEN`, sets the `admin_session` cookie, and redirects to `/admin/rooms` (clean URL, no token in browser history beyond the initial entry).
3. On subsequent visits to `/admin/rooms`, the cookie is checked. Valid → render the table. Missing or invalid → render a minimal token-paste form that POSTs to `/admin/rooms/auth`.
4. Cookie TTL is 24 hours; after expiry the operator re-visits the saved `?token=` link or pastes the token into the form.
5. If `ADMIN_TOKEN` env var is unset, the page returns 503 `admin_disabled` (matches existing seed-route behavior).

The optional `middleware.ts` only enforces the cookie on `/admin/*` *API* routes added later; the dashboard page handles its own auth UI so users get a form rather than a bare 401.

## Data Query

One SQL query per page load, executed against the existing pool:

```sql
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
GROUP BY r.id
ORDER BY {sort_column} {direction} NULLS LAST;
```

`{sort_column}` and `{direction}` are NOT user input — they are looked up from a server-side whitelist keyed by the validated `sort` and `dir` query params. Anything not in the whitelist falls back to the default `last_message_at DESC NULLS LAST`. No concatenation of user-supplied strings into the SQL.

Performance: at the current scale (single-digit rooms) this is trivial. At hundreds of rooms it remains a single aggregate over `messages` indexed on `(room_id, created_at)` — already covered by existing indexes per `db/schema.sql`. No caching needed yet.

## Table UI

Server-rendered HTML table. Columns:

| Column | Format | Sort key |
|---|---|---|
| Room | `name` as link to `/room/[id]` (target=_blank) | `name` |
| Last activity | Relative time ("3m ago", "2d ago", "—") + colored dot | `last_message_at` (default DESC) |
| 24h | `msgs_24h`, right-aligned | `msgs_24h` |
| 7d | `msgs_7d / participants_7d` (e.g. "42 / 5") | `msgs_7d` |
| Files | `file_count` | `file_count` |
| Created | `YYYY-MM-DD` | `created_at` |
| Link | Copy-link button | — |

**Activity dot:**
- Green: `last_message_at` within last hour.
- Yellow: within last 24 hours.
- Gray: older or null.

**Sort:** Column headers are `<a>` tags with `?sort=<key>&dir=desc`. Toggling re-runs the query. Sort keys are whitelisted server-side.

**Filter:** Single GET form with `<input name="q">` at the top. Server filters by `name ILIKE '%' || q || '%'` using a parameterized query. Other params (`sort`, `dir`) are preserved on submit.

**Empty state:** "No rooms yet. Seed one with `scripts/seed-msba-rooms.py`."

**Styling:** Reuse existing global styles. No new CSS framework. Plain table with minimal borders/padding to match the rest of the app.

## Error Handling

- Unset `ADMIN_TOKEN` → 503 with body `admin_disabled`.
- Missing/invalid cookie → render the token-paste form (not a 401), so the operator has a path forward in the browser.
- DB error → 500 page with a short message; full error logged server-side.

## Testing

- Manual smoke: visit with valid token, invalid token, no token, expired cookie. Verify the SQL returns expected counts after seeding a room and posting a few messages.
- Unit-level: a small test for the sort-key whitelist (rejects unknown keys, falls back to default).
- Add a `SMOKE.md` line: "Visit `/admin/rooms?token=$ADMIN_TOKEN` and confirm the seeded rooms appear with non-null counts."

## Open Questions

None blocking. Possible follow-ups (not in scope here):

- Auto-refresh every N seconds via a small client component.
- Per-room "archive" toggle to hide rooms from the default view.
- CSV export of the table.
