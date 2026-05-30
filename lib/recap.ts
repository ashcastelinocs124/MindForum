import {
  getChatMessagesAfter,
  getRecentChatMessages,
  getRoomSummary,
  setRoomSummary,
  type RoomSummary,
} from "./store";
import { ROLLING_SUMMARY_RECENCY_WINDOW, updateRollingSummary } from "./openai";

/**
 * Ensure the room's rolling summary covers everything up to (but excluding) the
 * in-flight AI stub, folding the delta in if needed. Persists with the same
 * optimistic lock as /catchup; on a lost race it re-reads and returns the winner.
 * Throws on generation failure — the caller falls back to the raw path.
 *
 * Returns the recap to render. `excludeMsgId` is the empty AI stub already in the
 * table (see message route); it must not be summarized or advance the high-water
 * mark.
 */
export async function refreshSummaryForReply(args: {
  roomId: string;
  systemPrompt: string;
  selectedFileNames: string[];
  excludeMsgId: string;
}): Promise<RoomSummary> {
  const { roomId, systemPrompt, selectedFileNames, excludeMsgId } = args;
  const stored = await getRoomSummary(roomId);
  const expectedUpToMsgId = stored?.upToMsgId ?? null;

  const deltaRaw = await getChatMessagesAfter(roomId, expectedUpToMsgId);
  const delta = deltaRaw.filter((m) => m.id !== excludeMsgId);
  if (delta.length === 0) {
    // Nothing new (only the stub) — current recap is already fresh.
    return (
      stored ?? {
        bullets: [],
        pinnedFacts: { names: [], decisions: [], files: [] },
        upToMsgId: expectedUpToMsgId,
        updatedAt: null,
      }
    );
  }

  const isColdStart = !stored || stored.bullets.length === 0;
  const recentRaw = isColdStart
    ? []
    : await getRecentChatMessages(roomId, ROLLING_SUMMARY_RECENCY_WINDOW + 1);
  const recent = recentRaw
    .filter((m) => m.id !== excludeMsgId)
    .slice(-ROLLING_SUMMARY_RECENCY_WINDOW);
  const newUpToMsgId = delta[delta.length - 1].id;

  const updated = await updateRollingSummary({
    priorBullets: stored?.bullets ?? [],
    priorPinnedFacts: stored?.pinnedFacts ?? { names: [], decisions: [], files: [] },
    recentMessages: recent,
    deltaMessages: delta,
    fileNames: selectedFileNames,
    systemPrompt,
  });

  const wrote = await setRoomSummary(
    roomId,
    { bullets: updated.bullets, pinnedFacts: updated.pinnedFacts, newUpToMsgId },
    expectedUpToMsgId
  );
  if (!wrote) {
    const fresh = await getRoomSummary(roomId);
    if (fresh && fresh.bullets.length > 0) return fresh;
  }
  return {
    bullets: updated.bullets,
    pinnedFacts: updated.pinnedFacts,
    upToMsgId: newUpToMsgId,
    updatedAt: Date.now(),
  };
}
