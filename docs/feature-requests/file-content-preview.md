# Feature: file-content preview modal in room Files panel

## Why

Seeded rooms (e.g. `msbai-pilot-faculty`, `msbai-corporate-partners`) load a curated knowledge base that participants didn't upload themselves. Today, they can see filenames in the Files panel but can't read the contents — the only way to learn what's in the KB is to mention `@ai` and hope the bot quotes the right thing. This is a transparency gap. Stakeholders should be able to read the source.

## What it should do (user-visible behavior)

1. In the right-side Files panel, each file row currently shows a checkbox + filename. Make the filename clickable.
2. Clicking the filename opens a modal overlay showing the file's content.
3. Modal contains:
   - **Header**: filename, size in KB, "uploaded by [name] on [date]"
   - **Body** (scrollable):
     - `.md` → rendered as markdown (use already-installed `react-markdown` + `remark-gfm`)
     - `.txt` → monospace `<pre>` block
     - `.pdf` / `.docx` → render the extracted text with a banner: *"This is the text the AI extracted from the original file. Formatting may differ from the source."*
   - **Close**: X button in top-right, Esc key, backdrop click
4. The KB-inclusion checkbox stays exactly where it is and continues to work — modal is purely for viewing.
5. On mobile (<600px), the modal goes full-screen.

## How (implementation outline)

### New API endpoint

Create `app/api/room/[id]/files/[fileId]/route.ts` with a `GET` handler.

- Auth: copy the cookie + `getParticipant` check from `app/api/room/[id]/files/route.ts:14-17`. Return 401 if not joined.
- Look up the file from `room_files`, scoped by **both** `room_id` and `file_id` (don't let cross-room file lookups work — return 404 if the file doesn't belong to the room).
- Return JSON: `{ id, name, mime, sizeBytes, uploadedAt, uploadedById, extractedText }`.
- **Important**: do NOT add `extractedText` to the room snapshot response. It was deliberately stripped at `lib/store.ts:412` to keep snapshots small. This new endpoint is the *only* place clients should fetch content. Add a code comment explaining why.

### Frontend changes — `app/room/[id]/page.tsx`

1. Add a `FilePreviewModal` component (can live in the same file initially — match the existing pattern).
2. State: `const [previewFileId, setPreviewFileId] = useState<string | null>(null)`. Modal renders when non-null.
3. When the modal opens, fetch `/api/room/${id}/files/${fileId}` and store the response in component state. Show "Loading…" while in flight.
4. Modify the Files panel row (around `app/room/[id]/page.tsx:378-409`): wrap the filename span in a `<button>` with `onClick={() => setPreviewFileId(f.id)}`. Add a hover state. **Don't change the checkbox behavior.**
5. Reuse the existing `mdComponents` (defined in `page.tsx` around line 518+) for markdown rendering — it already handles bold/code/lists/tables/links consistently with chat messages.
6. Esc handler: `useEffect` with a `keydown` listener that calls `setPreviewFileId(null)` on Escape; clean up on unmount.

### File-type rendering switch

In the modal body, branch on the file extension:

- ends with `.md` → `<ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{extractedText}</ReactMarkdown>`
- ends with `.txt` → `<pre style={{whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, ...'}}>{extractedText}</pre>`
- otherwise → banner div + the same `<pre>` block

## Acceptance criteria

- [ ] Click a filename in the Files panel → modal opens with content
- [ ] Markdown files show rendered (bold, headings, lists, tables, code spans, links)
- [ ] `.pdf` / `.docx` show the extracted-text banner
- [ ] Esc closes modal
- [ ] Backdrop click closes modal
- [ ] X button closes modal
- [ ] Mobile (375px viewport in browser dev tools) → modal goes full-screen
- [ ] Checkbox still toggles KB inclusion exactly as before
- [ ] Logged-out user cannot fetch the file endpoint → returns 401 (verify with curl)
- [ ] Cross-room access blocked: a user joined to room A cannot fetch a fileId belonging to room B → returns 404
- [ ] Snapshot endpoint (`GET /api/room/[id]`) still does NOT contain `extractedText` — verify by curling the snapshot of a seeded room and grepping for any file's text

## Out of scope (do NOT do)

- Don't add `extractedText` to the room snapshot to "save a request" — it'll bloat initial page load (the MSBA faculty room has 22 files at ~50KB each).
- Don't add a markdown parser as a dependency — `react-markdown` and `remark-gfm` are already in `package.json`.
- Don't add original-file download (we don't store the original blob — only the extracted text survives).
- Don't add file-content search (planned as a separate Phase 2 feature).
- Don't add a "Quote in chat" button (Phase 2).
- Don't change the checkbox logic in any way.

## Test plan

1. Smoke-test in the live `msbai-pilot-faculty` room (22 files = realistic stress test).
2. Open `curriculum.md` → confirm tables and headings render correctly.
3. Open `target_profile.md` → confirm bold + bullet lists render.
4. Test mobile via browser dev tools at 375px viewport.
5. Test Esc / backdrop / X close behaviors.
6. Test auth bypass attempts:
   - `curl https://mindforum.illinihunt.org/api/room/msbai-pilot-faculty/files/SOME_FILE_ID` (no cookie) → 401
   - Join one room, try to fetch a fileId from a different room → 404

## Effort

Half a day. Roughly: 25 lines of API, 120 lines of modal + rendering logic, 20 lines of panel wiring. No new dependencies.

## Files to touch

- `app/api/room/[id]/files/[fileId]/route.ts` (new file)
- `app/room/[id]/page.tsx` (Files panel row + modal component + state + Esc handler)
- Optional: extract `mdComponents` from `page.tsx` into a shared module so it's importable from any future surface — keep it inline if that feels heavier than the gain.

## Background reading in the codebase

- `app/room/[id]/page.tsx:373-410` — current Files panel row (this is what you're modifying)
- `app/room/[id]/page.tsx` `mdComponents` (around line 518) — reuse for markdown rendering
- `app/api/room/[id]/files/route.ts` — auth pattern to copy in the new GET endpoint
- `lib/store.ts:32-50` — `RoomFile` type and `extractedText` field shape
- `lib/store.ts:402-413` — where `extractedText` is stripped from snapshots (don't reverse this)

## Build & deploy notes

- Run `npm run build` locally before pushing — TypeScript errors will be caught here.
- After merge, deploy follows the standard recipe in `CLAUDE.md` (git pull on VPS, `npm install`, `npm run build`, `pm2 restart mindforum`). No DB migration required.
