import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { rooms, type Room, type RoomFile } from "@/lib/store";
import { parseFile } from "@/lib/parse";

export const runtime = "nodejs";

type SeedFile = {
  path: string;    // relative to process.cwd()
  name?: string;
  selected?: boolean;
};

type SeedBody = {
  id: string;
  name: string;
  systemPrompt?: string;
  files?: SeedFile[];
  replace?: boolean;       // if true, overwrite an existing room with this id
};

const MAX_TEXT_CHARS = 200_000;

/**
 * Admin-only idempotent room seeder. Used to re-create a room at a specific
 * (previously-used) id after a process restart, so old invite links survive.
 *
 * Auth: requires x-admin-token header matching ADMIN_TOKEN env var.
 */
export async function POST(req: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  }
  const supplied = req.headers.get("x-admin-token");
  if (supplied !== adminToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: SeedBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  if (!body.id || !body.name) {
    return NextResponse.json({ error: "id_and_name_required" }, { status: 400 });
  }

  if (rooms.has(body.id) && !body.replace) {
    return NextResponse.json({ error: "already_exists", id: body.id }, { status: 409 });
  }

  const room: Room = {
    id: body.id,
    name: body.name.slice(0, 100),
    createdAt: Date.now(),
    createdById: "seed",
    systemPrompt: (body.systemPrompt ?? "").slice(0, 4000),
    participants: new Map(),
    messages: [],
    files: new Map(),
    selectedFileIds: new Set(),
  };

  const loaded: { name: string; path: string; bytes: number }[] = [];
  const failed: { path: string; error: string }[] = [];

  for (const sf of body.files ?? []) {
    try {
      const abs = path.resolve(process.cwd(), sf.path);
      // Stay inside the app directory — no escaping via ../
      if (!abs.startsWith(process.cwd() + path.sep) && abs !== process.cwd()) {
        failed.push({ path: sf.path, error: "path_escape" });
        continue;
      }
      const buf = fs.readFileSync(abs);
      const fileName = sf.name ?? path.basename(sf.path);
      const parsed = await parseFile(fileName, "", buf);
      const rf: RoomFile = {
        id: `seed-${Buffer.from(sf.path).toString("base64url").slice(0, 12)}`,
        roomId: room.id,
        name: fileName,
        mime: parsed.mime,
        sizeBytes: buf.length,
        uploadedById: "seed",
        uploadedAt: Date.now(),
        extractedText: parsed.text.slice(0, MAX_TEXT_CHARS),
      };
      room.files.set(rf.id, rf);
      if (sf.selected !== false) room.selectedFileIds.add(rf.id);
      loaded.push({ name: fileName, path: sf.path, bytes: buf.length });
    } catch (err) {
      failed.push({ path: sf.path, error: (err as Error).message });
    }
  }

  rooms.set(room.id, room);

  return NextResponse.json({
    ok: true,
    id: room.id,
    name: room.name,
    files: loaded,
    failed,
  });
}
