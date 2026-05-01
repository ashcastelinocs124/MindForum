#!/usr/bin/env bash
# Deploy MindForum to the VPS. Run from /root/repos/mindforum on the host.
# Idempotent. Safe to re-run.

set -euo pipefail

cd /root/repos/mindforum

echo "==> Cleaning local package-lock.json (npm install dirties it)"
git checkout -- package-lock.json || true

echo "==> Pulling latest from origin/main"
git pull --ff-only

echo "==> Installing dependencies"
npm install

echo "==> Running schema migrations (idempotent)"
npm run migrate

echo "==> Building"
npm run build

echo "==> Restarting PM2 process"
pm2 restart mindforum --update-env

echo "==> Health check"
sleep 3
if curl -fsS http://localhost:3006/ > /dev/null; then
  echo "OK: app responded on :3006"
else
  echo "WARN: app did not respond on :3006 within 3s — check 'pm2 logs mindforum'"
  exit 1
fi
