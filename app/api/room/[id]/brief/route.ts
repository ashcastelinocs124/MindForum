import { NextRequest, NextResponse } from "next/server";
import {
  appendMessage,
  getParticipant,
  getRecentMessages,
  getSelectedFiles,
  roomExists,
  type Message,
} from "@/lib/store";
import { query } from "@/lib/db";
import { broadcast } from "@/lib/sse";
import { generateBrief } from "@/lib/openai";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("brief", clientIp(req), 3, 5 * 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  const participant = pid ? await getParticipant(id, pid) : null;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  void (async () => {
    try {
      const [messages, selectedFiles, promptRow] = await Promise.all([
        getRecentMessages(id, 100),
        getSelectedFiles(id),
        query<{ system_prompt: string }>(
          `SELECT system_prompt FROM rooms WHERE id = $1`,
          [id]
        ),
      ]);
      const systemPrompt = promptRow.rows[0]?.system_prompt ?? "";
      const brief = await generateBrief(messages, selectedFiles, systemPrompt);

      const msg: Message = {
        id: nanoid(10),
        roomId: id,
        authorId: "ai",
        authorName: "AI",
        content: JSON.stringify(brief),
        createdAt: Date.now(),
        kind: "brief",
      };
      await appendMessage(msg);
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
      try {
        await appendMessage(errMsg);
        broadcast(id, "message_added", errMsg);
      } catch (err2) {
        console.error("error-message append failed:", err2);
      }
    }
  })();

  return NextResponse.json({ ok: true });
}
