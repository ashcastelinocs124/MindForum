import { NextRequest, NextResponse } from "next/server";
import {
  getChatMessagesAfter,
  getRecentChatMessages,
  getRoomCatchupContext,
  getRoomSummary,
  setRoomSummary,
} from "@/lib/store";
import {
  ROLLING_SUMMARY_RECENCY_WINDOW,
  updateRollingSummary,
} from "@/lib/openai";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("catchup", clientIp(req), 5, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  const room = await getRoomCatchupContext(id);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });

  if (room.chatCount === 0) {
    return NextResponse.json({
      kind: "orientation",
      // Backward-compat shape: the orientation modal lists files by id+name,
      // but with no chat there's nothing to summarize anyway. We pass names
      // as both the id and the name; the client only renders names.
      files: room.selectedFileNames.map((name) => ({ id: name, name })),
    });
  }

  const stored = await getRoomSummary(id);
  const expectedUpToMsgId = stored?.upToMsgId ?? null;
  const delta = await getChatMessagesAfter(id, expectedUpToMsgId);

  // Cache hit: prior summary still covers everything. No model call, no full-room load.
  if (delta.length === 0 && stored && stored.bullets.length > 0) {
    return NextResponse.json({
      kind: "summary",
      bullets: stored.bullets,
      pinnedFacts: stored.pinnedFacts,
    });
  }

  const isColdStart = !stored || stored.bullets.length === 0;
  // On cold start the recency window would entirely overlap with the delta
  // (both contain "all messages"), so we'd be paying for the same content twice.
  const recent = isColdStart
    ? []
    : await getRecentChatMessages(id, ROLLING_SUMMARY_RECENCY_WINDOW);
  const newUpToMsgId = delta[delta.length - 1].id;

  try {
    const updated = await updateRollingSummary({
      priorBullets: stored?.bullets ?? [],
      priorPinnedFacts: stored?.pinnedFacts ?? { names: [], decisions: [], files: [] },
      recentMessages: recent,
      deltaMessages: delta,
      fileNames: room.selectedFileNames,
      systemPrompt: room.systemPrompt,
    });

    const wrote = await setRoomSummary(
      id,
      {
        bullets: updated.bullets,
        pinnedFacts: updated.pinnedFacts,
        newUpToMsgId,
      },
      expectedUpToMsgId
    );

    if (!wrote) {
      // Lost the optimistic-lock race — another /catchup call already
      // persisted a fresher summary. Re-read and serve that.
      const fresh = await getRoomSummary(id);
      if (fresh && fresh.bullets.length > 0) {
        return NextResponse.json({
          kind: "summary",
          bullets: fresh.bullets,
          pinnedFacts: fresh.pinnedFacts,
        });
      }
    }

    return NextResponse.json({
      kind: "summary",
      bullets: updated.bullets,
      pinnedFacts: updated.pinnedFacts,
    });
  } catch (err) {
    console.error("updateRollingSummary failed:", err);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}
