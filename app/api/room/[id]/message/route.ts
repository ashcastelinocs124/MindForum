import { NextRequest, NextResponse } from "next/server";
import { getRoom, type Message } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { chatReplyStream } from "@/lib/openai";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  const participant = pid ? room.participants.get(pid) : undefined;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "empty" }, { status: 400 });

  const msg: Message = {
    id: nanoid(10),
    roomId: id,
    authorId: participant.id,
    authorName: participant.name,
    content: content.slice(0, 4000),
    createdAt: Date.now(),
    kind: "chat",
  };
  room.messages.push(msg);
  broadcast(id, "message_added", msg);

  if (/^@ai\b/i.test(content)) {
    // Snapshot history before we push the empty AI stub so the model
    // doesn't see an empty "AI:" turn.
    const historyForAI = [...room.messages];

    const aiMsg: Message = {
      id: nanoid(10),
      roomId: id,
      authorId: "ai",
      authorName: "AI",
      content: "",
      createdAt: Date.now(),
      kind: "chat",
    };
    room.messages.push(aiMsg);
    broadcast(id, "message_added", aiMsg);

    void (async () => {
      let got = false;
      try {
        const selectedFiles = Array.from(room.selectedFileIds)
          .map((fid) => room.files.get(fid))
          .filter((f): f is NonNullable<typeof f> => !!f);
        for await (const delta of chatReplyStream(historyForAI, selectedFiles, room.systemPrompt)) {
          got = true;
          aiMsg.content += delta;
          broadcast(id, "message_token", { id: aiMsg.id, delta });
        }
        if (!got) {
          aiMsg.content = "(no reply)";
          broadcast(id, "message_updated", { id: aiMsg.id, content: aiMsg.content });
        }
      } catch (err) {
        console.error("chatReplyStream failed:", err);
        aiMsg.content = (aiMsg.content || "") +
          (got ? "\n\n⚠️ (response cut off — try again)" : "⚠️ I couldn't generate a response. Try again.");
        broadcast(id, "message_updated", { id: aiMsg.id, content: aiMsg.content });
      }
    })();
  }

  return NextResponse.json({ ok: true, id: msg.id });
}
