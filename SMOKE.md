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
