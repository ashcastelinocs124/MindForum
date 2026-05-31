/**
 * Max characters for a room system prompt.
 *
 * Enforced on every write path (create `/api/room`, edit `PATCH /api/room/[id]`,
 * `/api/admin/seed`, `/api/admin/rooms/[id]/system-prompt`) and surfaced as a
 * live counter in the create/edit UIs. Over-cap writes are REJECTED with HTTP
 * 400 `system_prompt_too_long` — never silently truncated (that previously cut
 * the GUARDRAILS off seeded rooms; see issue #20).
 *
 * Deliberately lean (~2K tokens): a facilitator prompt should be *behavior*,
 * not reference material. Facts belong in uploaded room files, which the model
 * already reads as context. Best-practice guidance (OpenAI GPT-5.x) is "the
 * smallest prompt that passes your evals"; reasoning quality degrades well
 * before any context-window limit.
 */
export const MAX_SYSTEM_PROMPT_CHARS = 8000;
