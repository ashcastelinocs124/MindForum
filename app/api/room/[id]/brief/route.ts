import { NextRequest, NextResponse } from "next/server";
import { getRoom, type Message } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { generateBrief } from "@/lib/openai";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  if (!pid || !room.participants.has(pid)) {
    return NextResponse.json({ error: "not_joined" }, { status: 401 });
  }

  void (async () => {
    try {
      const selectedFiles = Array.from(room.selectedFileIds)
        .map((fid) => room.files.get(fid))
        .filter((f): f is NonNullable<typeof f> => !!f);
      const brief = await generateBrief(room.messages, selectedFiles, room.systemPrompt);
      const msg: Message = {
        id: nanoid(10),
        roomId: id,
        authorId: "ai",
        authorName: "AI",
        content: JSON.stringify(brief),
        createdAt: Date.now(),
        kind: "brief",
      };
      room.messages.push(msg);
      broadcast(id, "message_added", msg);
      broadcast(id, "brief_generated", { id: msg.id });
    } catch (err) {
      console.error("generateBrief failed:", err);
      const errMsg: Message = {
        id: nanoid(10),
        roomId: id,
        authorId: "ai",
        authorName: "AI",
        content: "⚠️ I couldn't generate the brief. Try again.",
        createdAt: Date.now(),
        kind: "chat",
      };
      room.messages.push(errMsg);
      broadcast(id, "message_added", errMsg);
    }
  })();

  return NextResponse.json({ ok: true });
}
