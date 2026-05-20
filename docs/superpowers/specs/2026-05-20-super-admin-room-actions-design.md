# Super-admin archive/delete UI on `/admin/rooms`

**Date:** 2026-05-20
**Status:** Design — approved, pending implementation plan

## Problem

`/admin/rooms` is purely observational. A super-admin can see room status
(ACTIVE / ARCHIVED) and filter on it, but cannot change room lifecycle from
the UI:

- Archive / restore is reachable only from a creator's own
  `/dashboard/rooms/[id]/settings` page.
- Hard-delete (`DELETE /api/room/[id]`) exists as an endpoint but has **no UI
  caller anywhere** — the only way to invoke it today is a manual `curl` with
  the admin cookie.

This feature adds per-room archive, restore, and hard-delete controls to the
super-admin rooms table.

## Auth (already in place — no new plumbing)

`requireRoomOwner` → `getActor()` returns the synthetic `cr_super_admin`
creator row whenever the `ADMIN_TOKEN` cookie is present. A super-admin
authenticated on `/admin/rooms` can therefore call all three endpoints with
the same cookie:

| Endpoint | Auth check | Accepts super-admin? |
|---|---|---|
| `POST /api/room/[id]/archive` | `requireRoomOwner` | yes (via `getActor`) |
| `POST /api/room/[id]/restore` | `requireRoomOwner` (`assertActiveOrOwnerOnArchive`) | yes |
| `DELETE /api/room/[id]` | `isAdmin()` | yes |

## Decisions

- **Delete confirmation:** type-to-confirm the exact room id. Highest safety —
  prevents a misclick on the wrong row, matching the weight of an irreversible
  cascade.
- **Delete gating:** hard-delete is allowed **only on already-archived rooms**.
  Archive acts as a recoverable staging step before permanent deletion. An
  active room cannot be destroyed in one action.

## Approach

Chosen: **"Actions" column + per-row client component, fetch to existing API
routes.** Mirrors the established `CopyLinkButton` / `ArchiveControl` pattern
(client component → `fetch` → API route → `window.location.reload()`). No new
endpoints; one small server-side guard.

Rejected alternatives:

- **Next 15 server actions** — diverges from the codebase's universal "client
  fetch → API route" mutation convention.
- **Dedicated `/admin/rooms/[id]` detail page** — extra navigation for what is
  two buttons; over-built.

## Components

### 1. New `app/admin/rooms/RoomActions.tsx` (`"use client"`)

One instance per table row.

Props:

```ts
{ roomId: string; roomName: string; archived: boolean }
```

State: `busy: boolean`, `err: string | null`, `confirming: boolean`,
`typed: string`.

Behavior:

- **Active room** (`archived === false`): renders an **Archive** button.
  On click → `window.confirm` ("Archive this room? Participants will no longer
  be able to post or join. You can restore it later.") → on OK,
  `POST /api/room/{roomId}/archive` → on 2xx, `window.location.reload()`.

- **Archived room** (`archived === true`): renders **Restore** + **Delete**
  buttons.
  - Restore → `POST /api/room/{roomId}/restore` → reload.
  - Delete → sets `confirming = true`, swapping the cell to the inline
    type-to-confirm state:
    - a text input with placeholder `type the room id to confirm`
    - a red **Delete permanently** button, `disabled` unless
      `typed === roomId` (exact match)
    - a **Cancel** button that resets `confirming` and `typed`
    - On confirm click → `DELETE /api/room/{roomId}` → on 2xx, reload.

- On any non-2xx response: read `body.error`, show inline red error text
  (same style as `ArchiveControl`: `color: "#c00", fontSize: 13`). The row
  stays interactive; `busy` clears in a `finally`.

Button styling follows existing inline-style conventions on the page
(`CopyLinkButton`: `fontSize: 12, padding: "2px 8px"`; destructive actions use
the `ArchiveControl` red palette — `#991b1b` text, `#fecaca` border).

### 2. `app/admin/rooms/page.tsx`

- Add `<th style={{ padding: 8 }}>Actions</th>` to the table header row,
  after the existing `Link` column.
- Add a matching `<td style={{ padding: 8 }}>` per row rendering
  `<RoomActions roomId={r.id} roomName={r.name} archived={r.archivedAt !== null} />`.
- Import `RoomActions` alongside the existing `CopyLinkButton` import.

No change to `adminListRoomsWithActivity` — `r.id`, `r.name`, and
`r.archivedAt` are already in the row shape.

### 3. Server guard — `DELETE /api/room/[id]` (`app/api/room/[id]/route.ts`)

The "delete only archived rooms" rule must be enforced server-side, not just
hidden in the UI. The current `DELETE` handler deletes any room.

Add a guard before `hardDeleteRoom`: look up the room's `archived_at`; if it
is `null` (room is active), return `409 { error: "not_archived" }` and do not
delete. If the room does not exist, the existing `404 not_found` path (from
`hardDeleteRoom` returning no snapshot) still applies — order the new check so
a missing room is not misreported as `not_archived`.

Implementation note: a single `SELECT archived_at FROM rooms WHERE id = $1`
distinguishes all three cases — no row → `404 not_found`; `archived_at IS NULL`
→ `409 not_archived`; otherwise proceed to `hardDeleteRoom`.

No changes to the archive or restore endpoints.

## Data flow

```
super-admin on /admin/rooms  (ADMIN_TOKEN cookie)
  → RoomActions button click
  → fetch  POST /api/room/[id]/archive
         | POST /api/room/[id]/restore
         | DELETE /api/room/[id]
  → getActor() resolves cr_super_admin → requireRoomOwner / isAdmin passes
  → store mutation + logAudit (room.archive | room.restore | room.hard_delete)
  → SSE broadcast (archive/restore only — hard-delete has no live room to notify)
  → window.location.reload() → table re-renders with updated status
```

## Error handling

| Case | Behavior |
|---|---|
| Failed fetch / network error | Inline red error in the cell; row stays interactive. |
| `409 not_archived` (stale tab where room was un-archived elsewhere) | Error surfaces inline; a reload clears stale state. |
| Wrong room id typed into the confirm input | Delete button stays `disabled`; no request fires. |
| `404 not_found` (room deleted in another tab) | Error surfaces inline; reload removes the row. |

## Out of scope (YAGNI)

- Bulk select / bulk archive / bulk delete.
- Optimistic UI — full page reload is acceptable for a low-traffic admin tool.
- Audit-log viewer.
- Soft-delete-to-trash / undo for hard-delete.
- Any change to the creator-side `/dashboard` archive control.

## Testing

Manual walk on the VPS, consistent with how creator-rooms v1 was verified
(`curl` + browser):

1. Archive an active room from `/admin/rooms` → row flips to `ARCHIVED`,
   Restore + Delete buttons appear.
2. Restore it → row flips back to `ACTIVE`, only Archive shows.
3. On an archived room, click Delete, type the wrong id → Delete permanently
   button stays disabled.
4. Type the correct id → confirm → room disappears from the table; verify the
   `room.hard_delete` audit row exists (`psql`).
5. `curl -X DELETE` on an **active** room with the admin cookie → `409
   not_archived`; room still present.
6. `curl -X DELETE` on a non-existent id → `404 not_found`.
