# Smoke test — MindForum

Run through this after any significant change and before sharing a room link with collaborators. Uses two browser profiles or tabs (A and B) so they carry different cookies.

1. [ ] Create room in A → join as "Ashleyn". Copy link, open in B, join as "Vishal" → B appears in A's participant list within 1s.
2. [ ] Send "hello" in A → appears in B within 1s.
3. [ ] Upload a small PDF in A → appears in B's file panel within 1s; checkbox checked in both.
4. [ ] Send `@ai summarize the file` in B → AI reply appears in both within ~5s.
5. [ ] Click "Generate project brief" in A → structured card posts to both, with themes / outline / risks / next steps / suggested collaborators.
6. [ ] Kill tab A's network for 10s, restore → A reconnects, any messages B sent during the outage appear.
7. [ ] Upload a corrupt binary (`echo "nope" > /tmp/bad.bin`) → alert fires, no bad file appears in the list.
8. [ ] Hard-refresh B mid-conversation → full state rehydrates from snapshot (participants, messages, files, selection).
9. [ ] Send a plain message without `@ai` → no AI reply. Bot stays silent.
10. [ ] Restart the Node process → visiting an old room shows "Room not found". (Expected — ephemeral by design.)

## Admin Rooms Dashboard (`/admin/rooms`)

Prereq: `ADMIN_TOKEN` set in env, dev server running.

1. Visit `/admin/rooms` with no cookie → token form appears (no table, no error banner).
2. Submit wrong token → form re-renders with "Invalid token." banner.
3. Submit correct token → redirected to `/admin/rooms`, table renders, URL has no `token=`.
4. Visit `/admin/rooms/auth?token=$ADMIN_TOKEN` (link form) → cookie set, redirected to `/admin/rooms`.
5. Confirm at least one row exists per seeded room. Counts for an idle room should be 0/0; for an active room, non-zero.
6. Click a column header twice → sort flips between ↓ and ↑. URL reflects `?sort=…&dir=…`.
7. Type a filter and submit → only matching rooms appear; the active sort persists.
8. Click "Copy" on a row → clipboard contains the absolute URL `https://<host>/room/<id>`. Button shows "Copied" briefly.
9. Click the room name → opens `/room/<id>` in a new tab.
10. Wait 24h (or manually delete the cookie) → revisiting `/admin/rooms` shows the form again.
