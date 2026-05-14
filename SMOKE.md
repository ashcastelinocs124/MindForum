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

## Admin Facilitator Console (expanded row actions)

Prereq: `ADMIN_TOKEN` set; seed a test room via `/tmp/seed-poll-test-room.sh` and have two tabs open — the admin dashboard and the room as a regular participant.

1. **Expand a row** → click the ▸ caret. Participants list streams in; if a new tab joins the room, the new participant appears live without refreshing.
2. **Close** → click Close on the expanded row. The CLOSED pill appears; the room tab sees the orange banner immediately; the composer dims and Send is disabled. POST to `/api/room/<id>/message` from the room tab returns 410.
3. **Reopen** → click Reopen. Banner disappears, composer re-enables.
4. **Announce** → click Announce, send "Wrap up in 5 minutes." A 📢 Facilitator bubble appears in every room tab with italic styling and a navy left bar.
5. **Rename** → click Rename, change the title. Modal closes; the new name lands in the admin row, the open room tab's header updates, and a refresh shows the same name.
6. **Prompt** → click Prompt. Modal loads with the current system prompt pre-filled, char counter visible. Edit + save → next `@ai` reply uses the new prompt.
7. **Join (first time)** → click Join on any row. JoinIdentityModal appears asking for name + email. Submit → tab redirects to `/room/<id>` with your facilitator name in the Participants sidebar.
8. **Join (subsequent)** → click Join on another room. No modal — straight redirect; the identity cookie was reused.
9. **Mute** → click Mute on a participant. Open the room as that participant; send a message. Their tab shows the message succeed. Other tabs do not see it. `messages` row count in the DB does NOT increase.
10. **Unmute** → click Unmute. Next message from that participant lands normally.
11. **Remove** → click Remove on a participant. Their next POST to `/message` returns 401 (`not_joined`); they're kicked. Joining again via the join form re-binds (email upsert).
12. **Announce on closed room** → close the room first, then Announce. Bubble still appears (admin bypass). Participant messages still return 410.
