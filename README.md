# MindForum

Shared AI workspace for small-group brainstorming. Create a room, share the link, upload documents, and chat together with an AI collaborator that only speaks when mentioned with `@ai`.

Stack: Next.js 15, React 19, TypeScript, Server-Sent Events, OpenAI API, in-memory store.

## Features

- **Rooms** — create a room and share the link. Anyone with the link can join with a name + email (no verification; the link is the gate).
- **Group chat** — live via SSE. 2–6 participants is the comfortable range.
- **File upload** — PDF, DOCX, TXT, MD. Parsed server-side; extracted text is cached and fed to the AI as context when a file is selected.
- **AI collaborator** — silent by default. Mention `@ai` to bring it into the conversation. Has access to the recent chat history and any files currently checked.
- **Project brief** — one button turns the conversation into a structured brief (themes, outline, risks, next steps, collaborators). Posts back to the thread for everyone.

## Local development

```bash
cp .env.local.example .env.local     # add your OPENAI_API_KEY
npm install
npm run dev                          # http://localhost:3000
```

Environment variables:

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `OPENAI_API_KEY` | yes | — | Your OpenAI key |
| `OPENAI_MODEL` | no | `gpt-5.4` | Chat + brief model |
| `OPENAI_MODEL_BRIEF` | no | same as `OPENAI_MODEL` | Override for the brief endpoint only |
| `PORT` | no | 3000 | |

## VPS deployment

Single long-lived Node process — state lives in memory, so running multiple instances behind a load balancer won't work without sticky sessions (and even then, restarts reset everything). One process per app is fine for this scale.

### 1. Server prep

```bash
# On the VPS:
sudo apt update && sudo apt install -y nodejs npm nginx
# or use nvm for a newer Node
```

### 2. Deploy the app

```bash
git clone https://github.com/gies-ai-experiments/MindForum.git /opt/mindforum
cd /opt/mindforum
npm install
npm run build
```

Create `/opt/mindforum/.env.local`:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4
PORT=3000
```

### 3. systemd unit

`/etc/systemd/system/mindforum.service`:

```ini
[Unit]
Description=MindForum
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/mindforum
EnvironmentFile=/opt/mindforum/.env.local
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mindforum
sudo systemctl status mindforum
```

### 4. Nginx reverse proxy (with SSE-friendly config)

```nginx
server {
    listen 80;
    server_name mindforum.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: keep connections open, don't buffer
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }
}
```

Then provision TLS:

```bash
sudo certbot --nginx -d mindforum.example.com
```

### Restart = lost state

This is intentional for an MVP. Participants, messages, and uploaded files all live in one Node process. If you restart the service, active rooms are gone. Upgrade path to SQLite/Postgres is sketched in `docs/plans/2026-04-20-seminar-room-design.md`.

## Abuse notes

The app has no built-in rate limiting. Anyone with a room link can post messages and trigger `@ai` calls against your OpenAI key. Before exposing it broadly, consider adding:

- Per-IP rate limit at the nginx or app layer (e.g., `limit_req_zone`).
- A simple shared-secret env var gating room creation.
- Per-room message cap.

For a private link shared with a handful of trusted collaborators, those aren't strictly necessary.

## How the pieces fit

```
app/
  page.tsx                        landing: create or join
  room/[id]/page.tsx              room UI (single client component)
  api/
    room/route.ts                 POST create room
    room/[id]/join/route.ts       POST join (sets cookie)
    room/[id]/message/route.ts    POST send message (triggers AI on @ai)
    room/[id]/upload/route.ts     POST multipart upload + parse
    room/[id]/files/route.ts      POST toggle selection
    room/[id]/brief/route.ts      POST generate structured brief
    room/[id]/stream/route.ts     GET SSE stream
lib/
  store.ts                        in-memory rooms Map
  sse.ts                          broadcast registry
  parse.ts                        pdf-parse + mammoth wrappers
  openai.ts                       client + prompt templates + Brief schema
```

See `docs/plans/` for the full design and task-by-task implementation plan.
