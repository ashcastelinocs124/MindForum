import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
  if (!name || !email) {
    return NextResponse.json({ error: "name_and_email_required" }, { status: 400 });
  }

  const cookieName = `mindforum_pid_${id}`;
  const existing = req.cookies.get(cookieName)?.value;
  if (existing && room.participants.has(existing)) {
    return NextResponse.json({ participantId: existing });
  }

  const participantId = nanoid(10);
  const participant = { id: participantId, name, email, joinedAt: Date.now() };
  room.participants.set(participantId, participant);
  broadcast(id, "participant_joined", participant);

  const res = NextResponse.json({ participantId });
  res.cookies.set(cookieName, participantId, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
