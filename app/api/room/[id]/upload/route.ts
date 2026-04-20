import { NextRequest, NextResponse } from "next/server";
import { getRoom, type RoomFile } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { parseFile } from "@/lib/parse";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;    // 10MB
const MAX_TEXT_CHARS = 200_000;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  const participant = pid ? room.participants.get(pid) : undefined;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseFile(file.name, file.type, buf);
  } catch (err) {
    return NextResponse.json(
      { error: "parse_failed", message: (err as Error).message },
      { status: 415 }
    );
  }

  const rf: RoomFile = {
    id: nanoid(10),
    roomId: id,
    name: file.name,
    mime: parsed.mime,
    sizeBytes: file.size,
    uploadedById: participant.id,
    uploadedAt: Date.now(),
    extractedText: parsed.text.slice(0, MAX_TEXT_CHARS),
  };
  room.files.set(rf.id, rf);
  room.selectedFileIds.add(rf.id);

  const { extractedText: _drop, ...publicFile } = rf;
  broadcast(id, "file_added", publicFile);
  broadcast(id, "file_selection_changed", { selectedFileIds: Array.from(room.selectedFileIds) });

  return NextResponse.json({ ok: true, file: publicFile });
}
