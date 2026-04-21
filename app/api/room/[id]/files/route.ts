import { NextRequest, NextResponse } from "next/server";
import { getParticipant, roomExists, setFileSelected } from "@/lib/store";
import { query } from "@/lib/db";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  const participant = pid ? await getParticipant(id, pid) : null;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  const selected = typeof body.selected === "boolean" ? body.selected : undefined;
  if (!fileId || selected === undefined) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const updated = await setFileSelected(id, fileId, selected);
  if (!updated) return NextResponse.json({ error: "file_not_found" }, { status: 404 });

  const { rows } = await query<{ id: string }>(
    `SELECT id FROM room_files WHERE room_id = $1 AND selected = TRUE ORDER BY uploaded_at ASC`,
    [id]
  );
  broadcast(id, "file_selection_changed", { selectedFileIds: rows.map((r) => r.id) });
  return NextResponse.json({ ok: true });
}
