import { NextRequest, NextResponse } from "next/server";
import { getParticipant, roomExists } from "@/lib/store";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// Returns the full extracted text for a single file, scoped to one room.
// This is the *only* place clients should pull `extractedText` from — the
// room snapshot deliberately strips it (see lib/store.ts snapshot()) so the
// initial SSE payload stays small. Loading content on demand here keeps the
// snapshot lean even when a room has many large KB files.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  const participant = pid ? await getParticipant(id, pid) : null;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  const { rows } = await query<{
    id: string;
    name: string;
    mime: string;
    size_bytes: number;
    uploaded_by_id: string;
    uploaded_at: Date;
    extracted_text: string;
    uploader_name: string | null;
    uploader_email: string | null;
  }>(
    `SELECT rf.id, rf.name, rf.mime, rf.size_bytes, rf.uploaded_by_id, rf.uploaded_at,
            rf.extracted_text,
            p.name AS uploader_name, p.email AS uploader_email
     FROM room_files rf
     LEFT JOIN participants p
       ON p.id = rf.uploaded_by_id AND p.room_id = rf.room_id
     WHERE rf.room_id = $1 AND rf.id = $2`,
    [id, fileId]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "file_not_found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    name: row.name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at.getTime(),
    uploadedById: row.uploaded_by_id,
    uploaderName: row.uploader_name,
    uploaderEmail: row.uploader_email,
    extractedText: row.extracted_text,
  });
}
