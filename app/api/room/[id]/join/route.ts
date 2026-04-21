import { NextRequest, NextResponse } from "next/server";
import { roomExists, upsertParticipant, getParticipant } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("join", clientIp(req), 10, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
  if (!name || !email) {
    return NextResponse.json({ error: "name_and_email_required" }, { status: 400 });
  }

  const cookieName = `mindforum_pid_${id}`;
  const existingPid = req.cookies.get(cookieName)?.value;
  if (existingPid) {
    const existing = await getParticipant(id, existingPid);
    if (existing) {
      return NextResponse.json({ participantId: existing.id });
    }
  }

  let participant;
  try {
    participant = await upsertParticipant(id, name, email);
  } catch (err) {
    console.error("upsertParticipant failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!participant) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  // DB write is durable — safe to broadcast.
  broadcast(id, "participant_joined", participant);

  const res = NextResponse.json({ participantId: participant.id });
  res.cookies.set(cookieName, participant.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
