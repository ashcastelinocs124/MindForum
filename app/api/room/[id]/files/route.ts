import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/store";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  if (!pid || !room.participants.has(pid)) {
    return NextResponse.json({ error: "not_joined" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  const selected = typeof body.selected === "boolean" ? body.selected : undefined;
  if (!fileId || !room.files.has(fileId) || selected === undefined) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (selected) room.selectedFileIds.add(fileId);
  else room.selectedFileIds.delete(fileId);

  broadcast(id, "file_selection_changed", { selectedFileIds: Array.from(room.selectedFileIds) });
  return NextResponse.json({ ok: true });
}
