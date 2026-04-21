#!/usr/bin/env node
// Apply db/schema.sql against POSTGRES_URL. Idempotent.
// Loads .env.local so local runs pick up credentials the same way Next does.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// Minimal .env.local loader — only if POSTGRES_URL isn't already in env.
if (!process.env.POSTGRES_URL) {
  const envPath = path.join(repoRoot, ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

if (!process.env.POSTGRES_URL) {
  console.error("POSTGRES_URL not set. Add it to .env.local or the environment.");
  process.exit(1);
}

const schema = fs.readFileSync(path.join(repoRoot, "db/schema.sql"), "utf8");
const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
await client.connect();

try {
  await client.query(schema);
  const { rows } = await client.query(
    "SELECT version, applied_at FROM schema_migrations ORDER BY version"
  );
  console.log("applied migrations:");
  for (const r of rows) console.log(`  v${r.version}  ${r.applied_at.toISOString()}`);
  console.log("ok");
} catch (err) {
  console.error("migration failed:", err);
  process.exit(1);
} finally {
  await client.end();
}
