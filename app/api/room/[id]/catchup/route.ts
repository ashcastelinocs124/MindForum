import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/store";
import { generateCatchupBullets } from "@/lib/openai";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("catchup", clientIp(req), 5, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  const room = await getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) : null;

  const chatMessages = room.messages.filter((m) => (m.kind ?? "chat") === "chat");
  const selectedFiles = room.files.filter((f) => f.selected);

  if (chatMessages.length === 0) {
    return NextResponse.json({
      kind: "orientation",
      systemPrompt: room.systemPrompt,
      files: selectedFiles.map((f) => ({ id: f.id, name: f.name })),
    });
  }

  const scoped =
    since != null ? chatMessages.filter((m) => m.createdAt > since) : chatMessages;
  if (scoped.length === 0) {
    return NextResponse.json({
      kind: since != null ? "catchup" : "debrief",
      bullets: [],
    });
  }

  try {
    const bullets = await generateCatchupBullets(
      scoped,
      selectedFiles,
      room.systemPrompt,
      since != null ? "catchup" : "debrief"
    );
    return NextResponse.json({
      kind: since != null ? "catchup" : "debrief",
      bullets,
    });
  } catch (err) {
    console.error("generateCatchupBullets failed:", err);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}
