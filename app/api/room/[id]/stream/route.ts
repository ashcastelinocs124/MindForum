import { NextRequest } from "next/server";
import {
  getReactionsForRoom,
  getRoom,
  setParticipantLastSeen,
  snapshot,
} from "@/lib/store";
import { subscribe, unsubscribe } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [room, reactions] = await Promise.all([getRoom(id), getReactionsForRoom(id)]);
  if (!room) return new Response("Not found", { status: 404 });

  const cookieName = `mindforum_pid_${id}`;
  const participantId = req.cookies.get(cookieName)?.value ?? null;

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  writer.write(
    encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot(room, reactions))}\n\n`)
  );

  subscribe(id, writer);

  const hb = setInterval(() => {
    writer.write(encoder.encode(`: hb\n\n`)).catch(() => clearInterval(hb));
  }, 15000);

  const onClose = () => {
    clearInterval(hb);
    if (participantId) {
      setParticipantLastSeen(id, participantId, Date.now()).catch((err) => {
        console.error("setParticipantLastSeen failed:", err);
      });
    }
    unsubscribe(id, writer);
    writer.close().catch(() => {});
  };
  req.signal?.addEventListener("abort", onClose);

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
