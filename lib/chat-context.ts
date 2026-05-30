// Pure, dependency-free helpers that decide the @ai conversation-context mode
// and render the recap block. NO runtime imports so `*.test.mjs` loads it on
// Node 25.

/** At/under this chat-message count, @ai uses today's raw path (all messages). */
export const GATE = 20;
/** In recap mode, how many recent messages to send verbatim alongside the recap. */
export const RECENT_WINDOW = 8;

export type ContextMode = "raw" | "recap-nofold" | "recap-fold";

/**
 * raw           → room fits the window; send all messages verbatim (today).
 * recap-nofold  → over gate, but ≤WINDOW new messages since the recap's
 *                 high-water mark; send stored recap + those raw (no fold call).
 * recap-fold    → over gate and >WINDOW behind; fold the delta into the recap,
 *                 then send fresh recap + last WINDOW verbatim.
 */
export function decideContextMode(args: {
  chatCount: number;
  deltaSize: number;
  gate?: number;
  window?: number;
}): ContextMode {
  const gate = args.gate ?? GATE;
  const window = args.window ?? RECENT_WINDOW;
  if (args.chatCount <= gate) return "raw";
  return args.deltaSize <= window ? "recap-nofold" : "recap-fold";
}

type PinnedFactsLike = { names: string[]; decisions: string[]; files: string[] };

/** Render the recap as a system-prompt block. Empty bullets → "" (no block). */
export function renderRecapBlock(bullets: string[], pinned: PinnedFactsLike): string {
  if (!bullets || bullets.length === 0) return "";
  const lines = bullets.map((b) => `- ${b}`).join("\n");
  const pin = [
    pinned.names.length ? `people: ${pinned.names.join(", ")}` : "",
    pinned.decisions.length ? `decisions: ${pinned.decisions.join("; ")}` : "",
    pinned.files.length ? `files: ${pinned.files.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  const pinBlock = pin ? `\nPinned facts — ${pin}` : "";
  return `\n\nConversation so far (a summary of earlier messages not shown verbatim below; treat the verbatim recent messages as authoritative if they conflict):\n${lines}${pinBlock}`;
}
