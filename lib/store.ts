// Postgres-backed store for MindForum.
//
// Function signatures return the same in-memory Room shape the app has always
// worked with, so snapshot() and the rest of the code don't have to think about
// SQL. The backing store is fully durable across restarts.
//
// Selection lives on room_files.selected (boolean). The Room type still
// exposes a selectedFileIds array so client code (and the SSE snapshot payload)
// stays unchanged.

import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import { pool, query, tx } from "./db";
import type { SortKey, Direction } from "./admin-sort";
import { computeTallies, type OptionRow, type VoteRow } from "./poll-logic";

export type Participant = {
  id: string;
  name: string;
  email: string;
  joinedAt: number;
  lastSeenAt: number | null;
  mutedAt: number | null;
  removedAt: number | null;
};

export type ReactionSummary = {
  emoji: string;
  count: number;
  reacterIds: string[];
};

export type Message = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
  kind?: "chat" | "brief" | "system";
  reactions?: ReactionSummary[];
  editedAt?: number | null;
};

export type RoomFile = {
  id: string;
  roomId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedAt: number;
  extractedText: string;
  selected: boolean;
};

export type Room = {
  id: string;
  name: string;
  createdAt: number;
  createdById: string;
  systemPrompt: string;
  closedAt: number | null;
  participants: Participant[];
  messages: Message[];
  files: RoomFile[];
};

export type Poll = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  question: string;
  status: "open" | "closed";
  createdAt: number;
  closesAt: number | null;
  closedAt: number | null;
  closedBy: string | null;
  options: PollOption[];
};

export type PollOption = {
  id: string;
  pollId: string;
  position: number;
  text: string;
};

export type PollVote = {
  pollId: string;
  participantId: string;
  optionId: string;
  castAt: number;
};

export type OpenPollView = Omit<Poll, "status"> & {
  status: "open";
  totalVotes: number;
  myVoteOptionId: string | null;
};

export type ClosedPollView = Omit<Poll, "status"> & {
  status: "closed";
  totalVotes: number;
  tallies: { optionId: string; text: string; votes: number }[];
  winnerOptionId: string | null;
  inconclusive: boolean;
};

// -------- Row → domain mappers

function toParticipant(r: {
  id: string;
  name: string;
  email: string;
  joined_at: Date;
  last_seen_at: Date | null;
  muted_at: Date | null;
  removed_at: Date | null;
}): Participant {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    joinedAt: r.joined_at.getTime(),
    lastSeenAt: r.last_seen_at ? r.last_seen_at.getTime() : null,
    mutedAt: r.muted_at ? r.muted_at.getTime() : null,
    removedAt: r.removed_at ? r.removed_at.getTime() : null,
  };
}

function toMessage(r: {
  id: string;
  room_id: string;
  author_id: string;
  author_name: string;
  content: string;
  kind: string;
  created_at: Date;
  edited_at?: Date | null;
}): Message {
  return {
    id: r.id,
    roomId: r.room_id,
    authorId: r.author_id,
    authorName: r.author_name,
    content: r.content,
    createdAt: r.created_at.getTime(),
    kind: (r.kind as Message["kind"]) ?? "chat",
    editedAt: r.edited_at ? r.edited_at.getTime() : null,
  };
}

function toRoomFile(r: {
  id: string;
  room_id: string;
  name: string;
  mime: string;
  size_bytes: number;
  uploaded_by_id: string;
  extracted_text: string;
  selected: boolean;
  uploaded_at: Date;
}): RoomFile {
  return {
    id: r.id,
    roomId: r.room_id,
    name: r.name,
    mime: r.mime,
    sizeBytes: r.size_bytes,
    uploadedById: r.uploaded_by_id,
    uploadedAt: r.uploaded_at.getTime(),
    extractedText: r.extracted_text,
    selected: r.selected,
  };
}

// -------- Room lifecycle

export async function createRoom(
  name: string,
  createdById: string,
  systemPrompt = ""
): Promise<Room> {
  const id = nanoid(10);
  const { rows } = await query<{
    id: string;
    name: string;
    system_prompt: string;
    created_by_id: string;
    created_at: Date;
  }>(
    `INSERT INTO rooms (id, name, system_prompt, created_by_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, system_prompt, created_by_id, created_at`,
    [id, name, systemPrompt, createdById]
  );
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    systemPrompt: r.system_prompt,
    createdById: r.created_by_id,
    createdAt: r.created_at.getTime(),
    closedAt: null,
    participants: [],
    messages: [],
    files: [],
  };
}

/** Fetch a room with all its participants, messages, and files. */
export async function getRoom(id: string): Promise<Room | null> {
  const client = await pool().connect();
  try {
    const roomQ = await client.query<{
      id: string;
      name: string;
      system_prompt: string;
      created_by_id: string;
      created_at: Date;
      closed_at: Date | null;
    }>(
      `SELECT id, name, system_prompt, created_by_id, created_at, closed_at
       FROM rooms WHERE id = $1`,
      [id]
    );
    if (roomQ.rowCount === 0) return null;
    const r = roomQ.rows[0];

    const [participantsQ, messagesQ, filesQ] = await Promise.all([
      client.query<{
        id: string;
        name: string;
        email: string;
        joined_at: Date;
        last_seen_at: Date | null;
        muted_at: Date | null;
        removed_at: Date | null;
      }>(
        `SELECT id, name, email, joined_at, last_seen_at, muted_at, removed_at FROM participants
         WHERE room_id = $1 ORDER BY joined_at ASC`,
        [id]
      ),
      client.query<{
        id: string;
        room_id: string;
        author_id: string;
        author_name: string;
        content: string;
        kind: string;
        created_at: Date;
        edited_at: Date | null;
      }>(
        `SELECT id, room_id, author_id, author_name, content, kind, created_at, edited_at
         FROM messages WHERE room_id = $1
         ORDER BY created_at ASC, id ASC`,
        [id]
      ),
      client.query<{
        id: string;
        room_id: string;
        name: string;
        mime: string;
        size_bytes: number;
        uploaded_by_id: string;
        extracted_text: string;
        selected: boolean;
        uploaded_at: Date;
      }>(
        `SELECT id, room_id, name, mime, size_bytes, uploaded_by_id,
                extracted_text, selected, uploaded_at
         FROM room_files WHERE room_id = $1
         ORDER BY uploaded_at ASC`,
        [id]
      ),
    ]);

    return {
      id: r.id,
      name: r.name,
      systemPrompt: r.system_prompt,
      createdById: r.created_by_id,
      createdAt: r.created_at.getTime(),
      closedAt: r.closed_at ? r.closed_at.getTime() : null,
      participants: participantsQ.rows.map(toParticipant),
      messages: messagesQ.rows.map(toMessage),
      files: filesQ.rows.map(toRoomFile),
    };
  } finally {
    client.release();
  }
}

/** Cheap existence check without pulling all children. */
export async function roomExists(id: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM rooms WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

// -------- Participants

/**
 * Upsert by (room_id, lower(email)) so racing join requests don't create
 * duplicate participants. Returns the canonical participant (existing or new).
 */
export async function upsertParticipant(
  roomId: string,
  name: string,
  email: string
): Promise<Participant | null> {
  return tx(async (client) => {
    const roomCheck = await client.query("SELECT 1 FROM rooms WHERE id = $1", [roomId]);
    if (roomCheck.rowCount === 0) return null;

    const existing = await client.query<{
      id: string;
      name: string;
      email: string;
      joined_at: Date;
      last_seen_at: Date | null;
      muted_at: Date | null;
      removed_at: Date | null;
    }>(
      `SELECT id, name, email, joined_at, last_seen_at, muted_at, removed_at FROM participants
       WHERE room_id = $1 AND lower(email) = lower($2)`,
      [roomId, email]
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return toParticipant(existing.rows[0]);
    }

    const id = nanoid(10);
    const { rows } = await client.query<{
      id: string;
      name: string;
      email: string;
      joined_at: Date;
      last_seen_at: Date | null;
      muted_at: Date | null;
      removed_at: Date | null;
    }>(
      `INSERT INTO participants (id, room_id, name, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, joined_at, last_seen_at, muted_at, removed_at`,
      [id, roomId, name, email]
    );
    return toParticipant(rows[0]);
  });
}

export async function getParticipant(
  roomId: string,
  participantId: string
): Promise<Participant | null> {
  const { rows } = await query<{
    id: string;
    name: string;
    email: string;
    joined_at: Date;
    last_seen_at: Date | null;
    muted_at: Date | null;
    removed_at: Date | null;
  }>(
    `SELECT id, name, email, joined_at, last_seen_at, muted_at, removed_at FROM participants
     WHERE room_id = $1 AND id = $2`,
    [roomId, participantId]
  );
  if (rows.length === 0) return null;
  return toParticipant(rows[0]);
}

export async function setParticipantLastSeen(
  roomId: string,
  participantId: string,
  at: number
): Promise<void> {
  await query(
    `UPDATE participants SET last_seen_at = to_timestamp($3 / 1000.0)
     WHERE room_id = $1 AND id = $2`,
    [roomId, participantId, at]
  );
}

export async function countMessagesAfter(
  roomId: string,
  afterMillis: number
): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM messages
     WHERE room_id = $1 AND created_at > to_timestamp($2 / 1000.0) AND kind = 'chat'`,
    [roomId, afterMillis]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

// -------- Messages

export async function appendMessage(msg: Message): Promise<void> {
  await query(
    `INSERT INTO messages (id, room_id, author_id, author_name, content, kind, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
    [
      msg.id,
      msg.roomId,
      msg.authorId,
      msg.authorName,
      msg.content,
      msg.kind ?? "chat",
      msg.createdAt,
    ]
  );
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  await query(`UPDATE messages SET content = $2 WHERE id = $1`, [id, content]);
}

/**
 * Author-only edit. Returns the new edited_at on success, or null if the
 * message doesn't exist or the participant doesn't own it. Stamps edited_at
 * (used by the UI to render "(edited)") — distinct from the AI-streaming
 * path which calls updateMessageContent without setting edited_at.
 */
export async function editMessage(
  messageId: string,
  authorId: string,
  newContent: string
): Promise<{ editedAt: number; content: string } | null> {
  const { rows } = await query<{ content: string; edited_at: Date }>(
    `UPDATE messages
       SET content = $3, edited_at = NOW()
     WHERE id = $1 AND author_id = $2 AND kind = 'chat'
     RETURNING content, edited_at`,
    [messageId, authorId, newContent]
  );
  if (rows.length === 0) return null;
  return { content: rows[0].content, editedAt: rows[0].edited_at.getTime() };
}

// -------- Files

export async function addFile(file: RoomFile): Promise<void> {
  await query(
    `INSERT INTO room_files
       (id, room_id, name, mime, size_bytes, uploaded_by_id, extracted_text, selected, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0))`,
    [
      file.id,
      file.roomId,
      file.name,
      file.mime,
      file.sizeBytes,
      file.uploadedById,
      file.extractedText,
      file.selected,
      file.uploadedAt,
    ]
  );
}

export async function setFileSelected(
  roomId: string,
  fileId: string,
  selected: boolean
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE room_files SET selected = $3
     WHERE room_id = $1 AND id = $2`,
    [roomId, fileId, selected]
  );
  return (rowCount ?? 0) > 0;
}

/** Fetch only the selected files' extracted text — for AI prompt assembly. */
export async function getSelectedFiles(roomId: string): Promise<RoomFile[]> {
  const { rows } = await query<{
    id: string;
    room_id: string;
    name: string;
    mime: string;
    size_bytes: number;
    uploaded_by_id: string;
    extracted_text: string;
    selected: boolean;
    uploaded_at: Date;
  }>(
    `SELECT id, room_id, name, mime, size_bytes, uploaded_by_id,
            extracted_text, selected, uploaded_at
     FROM room_files
     WHERE room_id = $1 AND selected = TRUE
     ORDER BY uploaded_at ASC`,
    [roomId]
  );
  return rows.map(toRoomFile);
}

/**
 * For the AI prompt: fetch the last N messages for a room, chronological.
 * Avoids round-tripping a full room for a single AI call.
 */
export async function getRecentMessages(roomId: string, limit: number): Promise<Message[]> {
  const { rows } = await query<{
    id: string;
    room_id: string;
    author_id: string;
    author_name: string;
    content: string;
    kind: string;
    created_at: Date;
    edited_at: Date | null;
  }>(
    `SELECT * FROM (
       SELECT id, room_id, author_id, author_name, content, kind, created_at, edited_at
       FROM messages WHERE room_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2
     ) t ORDER BY created_at ASC, id ASC`,
    [roomId, limit]
  );
  return rows.map(toMessage);
}

// -------- Reactions

/** Aggregate reactions for every message in a room. */
export async function getReactionsForRoom(
  roomId: string
): Promise<Map<string, ReactionSummary[]>> {
  const { rows } = await query<{
    message_id: string;
    emoji: string;
    reacter_ids: string[];
  }>(
    `SELECT mr.message_id,
            mr.emoji,
            array_agg(mr.participant_id ORDER BY mr.reacted_at) AS reacter_ids
     FROM message_reactions mr
     JOIN messages m ON m.id = mr.message_id
     WHERE m.room_id = $1
     GROUP BY mr.message_id, mr.emoji
     ORDER BY mr.message_id, mr.emoji`,
    [roomId]
  );
  const out = new Map<string, ReactionSummary[]>();
  for (const r of rows) {
    const arr = out.get(r.message_id) ?? [];
    arr.push({ emoji: r.emoji, count: r.reacter_ids.length, reacterIds: r.reacter_ids });
    out.set(r.message_id, arr);
  }
  return out;
}

/** Aggregate reactions for one message — used to broadcast after a toggle. */
export async function getReactionsForMessage(
  messageId: string
): Promise<ReactionSummary[]> {
  const { rows } = await query<{ emoji: string; reacter_ids: string[] }>(
    `SELECT emoji,
            array_agg(participant_id ORDER BY reacted_at) AS reacter_ids
     FROM message_reactions
     WHERE message_id = $1
     GROUP BY emoji
     ORDER BY emoji`,
    [messageId]
  );
  return rows.map((r) => ({
    emoji: r.emoji,
    count: r.reacter_ids.length,
    reacterIds: r.reacter_ids,
  }));
}

/**
 * Toggle a (message, participant, emoji) reaction. Returns whether the row
 * now exists (true = added, false = removed). Wrapped in a tx so the
 * delete-then-maybe-insert can't race with itself for the same triple.
 */
export async function toggleReaction(
  messageId: string,
  participantId: string,
  emoji: string
): Promise<{ added: boolean }> {
  return tx(async (client) => {
    const del = await client.query(
      `DELETE FROM message_reactions
       WHERE message_id = $1 AND participant_id = $2 AND emoji = $3`,
      [messageId, participantId, emoji]
    );
    if ((del.rowCount ?? 0) > 0) return { added: false };
    await client.query(
      `INSERT INTO message_reactions (message_id, participant_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [messageId, participantId, emoji]
    );
    return { added: true };
  });
}

/** Cheap message ownership / room-scope check used by the react route. */
export async function getMessageRoomId(messageId: string): Promise<string | null> {
  const { rows } = await query<{ room_id: string }>(
    `SELECT room_id FROM messages WHERE id = $1`,
    [messageId]
  );
  return rows[0]?.room_id ?? null;
}

// -------- Rolling catch-up summary
//
// One global summary per room (kind: "summary"). Updates on /catchup are lazy
// and incremental: we feed the prior summary + pinned facts + the last K raw
// messages + only the *delta* messages (those after summary_up_to_msg_id)
// back to the model and persist the new summary.

export type PinnedFacts = {
  names: string[];
  decisions: string[];
  files: string[];
};

export type RoomSummary = {
  bullets: string[];
  pinnedFacts: PinnedFacts;
  upToMsgId: string | null;
  updatedAt: number | null;
};

const EMPTY_FACTS: PinnedFacts = { names: [], decisions: [], files: [] };

export async function getRoomSummary(roomId: string): Promise<RoomSummary | null> {
  const { rows, rowCount } = await query<{
    rolling_summary: { bullets?: string[] } | null;
    pinned_facts: PinnedFacts | null;
    summary_up_to_msg_id: string | null;
    summary_updated_at: Date | null;
  }>(
    `SELECT rolling_summary, pinned_facts, summary_up_to_msg_id, summary_updated_at
     FROM rooms WHERE id = $1`,
    [roomId]
  );
  if (!rowCount) return null;
  const r = rows[0];
  return {
    bullets: r.rolling_summary?.bullets ?? [],
    pinnedFacts: r.pinned_facts ?? EMPTY_FACTS,
    upToMsgId: r.summary_up_to_msg_id,
    updatedAt: r.summary_updated_at ? r.summary_updated_at.getTime() : null,
  };
}

/**
 * Persist a freshly-computed rolling summary. Optimistic lock: only writes if
 * `summary_up_to_msg_id` still matches `expectedUpToMsgId` (the value we read
 * before computing). A racing writer that already advanced the column wins;
 * we return false so the caller can re-read and serve the latest summary.
 *
 * Note on contention cost: under a race, both writers will have already paid
 * for one OpenAI call — only one persists. The wasted call is bounded
 * (one per loser) and self-limiting: subsequent /catchup hits will be cache
 * reads. Acceptable given /catchup's per-IP rate limit (5/min).
 */
export async function setRoomSummary(
  roomId: string,
  payload: { bullets: string[]; pinnedFacts: PinnedFacts; newUpToMsgId: string },
  expectedUpToMsgId: string | null
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE rooms
       SET rolling_summary      = $2,
           pinned_facts         = $3,
           summary_up_to_msg_id = $4,
           summary_updated_at   = NOW()
     WHERE id = $1
       AND summary_up_to_msg_id IS NOT DISTINCT FROM $5`,
    [
      roomId,
      JSON.stringify({ bullets: payload.bullets }),
      JSON.stringify(payload.pinnedFacts),
      payload.newUpToMsgId,
      expectedUpToMsgId,
    ]
  );
  return (rowCount ?? 0) > 0;
}

/** Chat messages strictly after the given message id, chronological. */
export async function getChatMessagesAfter(
  roomId: string,
  afterMsgId: string | null
): Promise<Message[]> {
  if (afterMsgId == null) {
    const { rows } = await query<{
      id: string;
      room_id: string;
      author_id: string;
      author_name: string;
      content: string;
      kind: string;
      created_at: Date;
    }>(
      `SELECT id, room_id, author_id, author_name, content, kind, created_at
       FROM messages
       WHERE room_id = $1 AND kind = 'chat'
       ORDER BY created_at ASC, id ASC`,
      [roomId]
    );
    return rows.map(toMessage);
  }
  const { rows } = await query<{
    id: string;
    room_id: string;
    author_id: string;
    author_name: string;
    content: string;
    kind: string;
    created_at: Date;
  }>(
    `WITH anchor AS (
       SELECT created_at, id FROM messages
       WHERE id = $2 AND room_id = $1 AND kind = 'chat'
     )
     SELECT m.id, m.room_id, m.author_id, m.author_name, m.content, m.kind, m.created_at
     FROM messages m, anchor a
     WHERE m.room_id = $1
       AND m.kind = 'chat'
       AND (m.created_at, m.id) > (a.created_at, a.id)
     ORDER BY m.created_at ASC, m.id ASC`,
    [roomId, afterMsgId]
  );
  if (rows.length === 0) {
    const anchorCheck = await query<{ id: string }>(
      `SELECT id FROM messages WHERE id = $1 AND room_id = $2 AND kind = 'chat'`,
      [afterMsgId, roomId]
    );
    if (anchorCheck.rows.length === 0) {
      return getChatMessagesAfter(roomId, null);
    }
  }
  return rows.map(toMessage);
}

/**
 * Targeted lookup for the catchup route — returns just the columns the route
 * needs without pulling all messages/files like getRoom() does. Cache-hit
 * /catchup calls should never load the full conversation.
 */
export async function getRoomCatchupContext(id: string): Promise<{
  name: string;
  systemPrompt: string;
  chatCount: number;
  selectedFileNames: string[];
} | null> {
  const client = await pool().connect();
  try {
    const roomQ = await client.query<{
      name: string;
      system_prompt: string;
      chat_count: string;
    }>(
      `SELECT r.name, r.system_prompt,
              (SELECT COUNT(*)::text FROM messages m
                 WHERE m.room_id = r.id AND m.kind = 'chat') AS chat_count
       FROM rooms r WHERE r.id = $1`,
      [id]
    );
    if (roomQ.rowCount === 0) return null;
    const r = roomQ.rows[0];

    const filesQ = await client.query<{ name: string }>(
      `SELECT name FROM room_files
       WHERE room_id = $1 AND selected = TRUE
       ORDER BY uploaded_at ASC`,
      [id]
    );

    return {
      name: r.name,
      systemPrompt: r.system_prompt,
      chatCount: parseInt(r.chat_count, 10),
      selectedFileNames: filesQ.rows.map((f) => f.name),
    };
  } finally {
    client.release();
  }
}

/** Last N chat messages, chronological. Used as a "recency window" we always
 * include verbatim alongside the rolling summary. */
export async function getRecentChatMessages(
  roomId: string,
  limit: number
): Promise<Message[]> {
  const { rows } = await query<{
    id: string;
    room_id: string;
    author_id: string;
    author_name: string;
    content: string;
    kind: string;
    created_at: Date;
  }>(
    `SELECT * FROM (
       SELECT id, room_id, author_id, author_name, content, kind, created_at
       FROM messages
       WHERE room_id = $1 AND kind = 'chat'
       ORDER BY created_at DESC, id DESC
       LIMIT $2
     ) t ORDER BY created_at ASC, id ASC`,
    [roomId, limit]
  );
  return rows.map(toMessage);
}

// -------- Snapshot for SSE clients

/**
 * Serialize a Room for the SSE `snapshot` event.
 * Computes `selectedFileIds` from files.selected so the client type stays the same.
 * Strips `extractedText` from files before sending — clients don't need it.
 * If `reactionsByMsg` is provided, attaches the reaction summary to each message.
 */
export function snapshot(
  room: Room,
  reactionsByMsg?: Map<string, ReactionSummary[]>,
  openPolls: OpenPollView[] = [],
  recentClosedPolls: ClosedPollView[] = [],
) {
  return {
    id: room.id,
    name: room.name,
    systemPrompt: room.systemPrompt,
    participants: room.participants,
    messages: reactionsByMsg
      ? room.messages.map((m) => ({ ...m, reactions: reactionsByMsg.get(m.id) ?? [] }))
      : room.messages,
    files: room.files.map(({ extractedText: _drop, selected: _sel, ...rest }) => rest),
    selectedFileIds: room.files.filter((f) => f.selected).map((f) => f.id),
    openPolls,
    recentClosedPolls,
  };
}

// -------- Admin facilitator mutators (close/reopen room, mute/remove participant)

/** Lock a room: no more writes (messages, polls, uploads, briefs) until reopened.
 *  Idempotent — re-closing keeps the original timestamp via COALESCE. */
export async function closeRoom(roomId: string): Promise<void> {
  await query(
    `UPDATE rooms SET closed_at = COALESCE(closed_at, NOW()) WHERE id = $1`,
    [roomId],
  );
}

/** Unlock a previously closed room. No-op if already open. */
export async function reopenRoom(roomId: string): Promise<void> {
  await query(`UPDATE rooms SET closed_at = NULL WHERE id = $1`, [roomId]);
}

/** Shadow-mute (true) or unmute (false) a participant. Idempotent via COALESCE. */
export async function setParticipantMuted(
  roomId: string,
  participantId: string,
  muted: boolean,
): Promise<void> {
  await query(
    muted
      ? `UPDATE participants SET muted_at = COALESCE(muted_at, NOW())
           WHERE room_id = $1 AND id = $2`
      : `UPDATE participants SET muted_at = NULL
           WHERE room_id = $1 AND id = $2`,
    [roomId, participantId],
  );
}

/** Mark a participant as removed (per-session kick).
 *  They can rejoin via email upsert; this just invalidates the current cookie path.
 *  Idempotent via COALESCE — second remove keeps the original timestamp. */
export async function setParticipantRemoved(
  roomId: string,
  participantId: string,
): Promise<void> {
  await query(
    `UPDATE participants
        SET removed_at = COALESCE(removed_at, NOW())
      WHERE room_id = $1 AND id = $2`,
    [roomId, participantId],
  );
}

/** Rename a room. Caller validates length. */
export async function renameRoom(roomId: string, name: string): Promise<void> {
  await query(`UPDATE rooms SET name = $2 WHERE id = $1`, [roomId, name]);
}

/** Replace the room's system prompt wholesale. Caller validates length. */
export async function setSystemPrompt(
  roomId: string,
  systemPrompt: string,
): Promise<void> {
  await query(`UPDATE rooms SET system_prompt = $2 WHERE id = $1`, [
    roomId,
    systemPrompt,
  ]);
}

/** Post a facilitator announcement as a kind:"system" message.
 *  Admin bypass: this does NOT check closed_at, so admins can announce on
 *  closed rooms (e.g. "Session ended, thanks for joining"). */
export async function postSystemAnnouncement(
  roomId: string,
  content: string,
): Promise<Message> {
  const msg: Message = {
    id: nanoid(10),
    roomId,
    authorId: "facilitator",
    authorName: "Facilitator",
    content: content.slice(0, 4000),
    createdAt: Date.now(),
    kind: "system",
  };
  await appendMessage(msg);
  return msg;
}

/** Per-room participant listing for the admin dashboard.
 *  Ordered by recency (last_seen_at DESC NULLS LAST, then name ASC).
 *  Excludes removed participants by default; pass includeRemoved to see them. */
export async function listParticipantsForAdmin(
  roomId: string,
  opts: { includeRemoved?: boolean } = {},
): Promise<Participant[]> {
  const filter = opts.includeRemoved ? "" : "AND removed_at IS NULL";
  const { rows } = await query<{
    id: string;
    name: string;
    email: string;
    joined_at: Date;
    last_seen_at: Date | null;
    muted_at: Date | null;
    removed_at: Date | null;
  }>(
    `SELECT id, name, email, joined_at, last_seen_at, muted_at, removed_at
       FROM participants
      WHERE room_id = $1 ${filter}
      ORDER BY last_seen_at DESC NULLS LAST, name ASC`,
    [roomId],
  );
  return rows.map(toParticipant);
}

// -------- Admin helpers (used by /api/admin/seed)

export async function adminUpsertRoom(input: {
  id: string;
  name: string;
  systemPrompt: string;
  replaceMode: "metadata" | "full";
}): Promise<void> {
  await tx(async (client: PoolClient) => {
    if (input.replaceMode === "full") {
      // ON DELETE CASCADE handles participants/messages/files
      await client.query("DELETE FROM rooms WHERE id = $1", [input.id]);
    }
    await client.query(
      `INSERT INTO rooms (id, name, system_prompt, created_by_id)
       VALUES ($1, $2, $3, 'seed')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, system_prompt = EXCLUDED.system_prompt`,
      [input.id, input.name, input.systemPrompt]
    );
    // Replace files regardless of mode — the caller typically passes a fresh set.
    if (input.replaceMode !== "full") {
      await client.query("DELETE FROM room_files WHERE room_id = $1", [input.id]);
    }
  });
}

export async function adminAddFile(file: RoomFile): Promise<void> {
  // Admin seeds use deterministic ids; use ON CONFLICT to re-seed safely.
  await query(
    `INSERT INTO room_files
       (id, room_id, name, mime, size_bytes, uploaded_by_id, extracted_text, selected)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       mime = EXCLUDED.mime,
       size_bytes = EXCLUDED.size_bytes,
       extracted_text = EXCLUDED.extracted_text,
       selected = EXCLUDED.selected`,
    [
      file.id,
      file.roomId,
      file.name,
      file.mime,
      file.sizeBytes,
      file.uploadedById,
      file.extractedText,
      file.selected,
    ]
  );
}

export type RoomActivityRow = {
  id: string;
  name: string;
  createdAt: Date;
  msgs24h: number;
  msgs7d: number;
  participants7d: number;
  lastMessageAt: Date | null;
  totalParticipants: number;
  fileCount: number;
  closedAt: Date | null;
};

export async function adminListRoomsWithActivity(opts: {
  column: SortKey;
  direction: Direction;
  q?: string;
}): Promise<RoomActivityRow[]> {
  const { column, direction, q } = opts;
  // column/direction come from the whitelist resolver in lib/admin-sort.ts —
  // safe to interpolate. q is parameterized.
  const sql = `
    SELECT
      r.id,
      r.name,
      r.created_at,
      r.closed_at,
      COUNT(m.id) FILTER (WHERE m.created_at > NOW() - INTERVAL '24 hours') AS msgs_24h,
      COUNT(m.id) FILTER (WHERE m.created_at > NOW() - INTERVAL '7 days')   AS msgs_7d,
      COUNT(DISTINCT m.author_id) FILTER (WHERE m.created_at > NOW() - INTERVAL '7 days' AND m.author_id != 'ai') AS participants_7d,
      MAX(m.created_at) AS last_message_at,
      (SELECT COUNT(*) FROM participants p WHERE p.room_id = r.id) AS total_participants,
      (SELECT COUNT(*) FROM room_files f WHERE f.room_id = r.id)  AS file_count
    FROM rooms r
    LEFT JOIN messages m ON m.room_id = r.id
    WHERE ($1::text IS NULL OR r.name ILIKE '%' || $1 || '%')
    GROUP BY r.id
    ORDER BY ${column} ${direction} NULLS LAST
  `;
  const result = await query<{
    id: string;
    name: string;
    created_at: Date;
    closed_at: Date | null;
    msgs_24h: string;
    msgs_7d: string;
    participants_7d: string;
    last_message_at: Date | null;
    total_participants: string;
    file_count: string;
  }>(sql, [q && q.trim() ? q.trim() : null]);
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    closedAt: r.closed_at,
    msgs24h: Number(r.msgs_24h),
    msgs7d: Number(r.msgs_7d),
    participants7d: Number(r.participants_7d),
    lastMessageAt: r.last_message_at,
    totalParticipants: Number(r.total_participants),
    fileCount: Number(r.file_count),
  }));
}

// -------- Polls

function newPollId(): string { return `pl_${nanoid(10)}`; }
function newOptionId(): string { return `po_${nanoid(10)}`; }

type PollRow = {
  id: string;
  room_id: string;
  author_id: string;
  question: string;
  status: string;
  created_at: Date;
  closes_at: Date | null;
  closed_at: Date | null;
  closed_by: string | null;
};

type OptionDbRow = {
  id: string;
  poll_id: string;
  position: number;
  text: string;
};

function toPollOption(r: OptionDbRow): PollOption {
  return { id: r.id, pollId: r.poll_id, position: r.position, text: r.text };
}

function toPoll(row: PollRow, authorName: string, options: PollOption[]): Poll {
  return {
    id: row.id,
    roomId: row.room_id,
    authorId: row.author_id,
    authorName,
    question: row.question,
    status: row.status as "open" | "closed",
    createdAt: row.created_at.getTime(),
    closesAt: row.closes_at ? row.closes_at.getTime() : null,
    closedAt: row.closed_at ? row.closed_at.getTime() : null,
    closedBy: row.closed_by,
    options,
  };
}

export async function createPoll(input: {
  roomId: string;
  authorId: string;
  question: string;
  options: string[]; // pre-validated
  closesAt: Date | null;
}): Promise<Poll> {
  const id = newPollId();
  return tx(async (client) => {
    const pollRes = await client.query<PollRow>(
      `INSERT INTO polls (id, room_id, author_id, question, status, closes_at)
       VALUES ($1, $2, $3, $4, 'open', $5)
       RETURNING id, room_id, author_id, question, status, created_at,
                 closes_at, closed_at, closed_by`,
      [id, input.roomId, input.authorId, input.question, input.closesAt],
    );
    const pollRow = pollRes.rows[0];
    const optionRows: OptionDbRow[] = [];
    for (let i = 0; i < input.options.length; i++) {
      const oRes = await client.query<OptionDbRow>(
        `INSERT INTO poll_options (id, poll_id, position, text)
         VALUES ($1, $2, $3, $4)
         RETURNING id, poll_id, position, text`,
        [newOptionId(), id, i, input.options[i]],
      );
      optionRows.push(oRes.rows[0]);
    }
    const authorRes = await client.query<{ name: string }>(
      `SELECT name FROM participants WHERE id = $1 AND room_id = $2`,
      [input.authorId, input.roomId],
    );
    const authorName = authorRes.rows[0]?.name ?? "(unknown)";
    return toPoll(pollRow, authorName, optionRows.map(toPollOption));
  });
}

export async function getPoll(id: string): Promise<Poll | null> {
  const { rows } = await query<PollRow & { author_name: string | null }>(
    `SELECT p.id, p.room_id, p.author_id, p.question, p.status, p.created_at,
            p.closes_at, p.closed_at, p.closed_by,
            pt.name AS author_name
     FROM polls p
     LEFT JOIN participants pt ON pt.id = p.author_id AND pt.room_id = p.room_id
     WHERE p.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const optsRes = await query<OptionDbRow>(
    `SELECT id, poll_id, position, text FROM poll_options
     WHERE poll_id = $1 ORDER BY position`,
    [id],
  );
  return toPoll(r, r.author_name ?? "(unknown)", optsRes.rows.map(toPollOption));
}

export async function getOpenPollsForRoom(
  roomId: string,
  requesterId: string,
): Promise<OpenPollView[]> {
  const { rows: polls } = await query<PollRow & { author_name: string | null }>(
    `SELECT p.id, p.room_id, p.author_id, p.question, p.status, p.created_at,
            p.closes_at, p.closed_at, p.closed_by,
            pt.name AS author_name
     FROM polls p
     LEFT JOIN participants pt ON pt.id = p.author_id AND pt.room_id = p.room_id
     WHERE p.room_id = $1 AND p.status = 'open'
     ORDER BY p.created_at ASC`,
    [roomId],
  );
  const views: OpenPollView[] = [];
  for (const p of polls) {
    const optsRes = await query<OptionDbRow>(
      `SELECT id, poll_id, position, text FROM poll_options
       WHERE poll_id = $1 ORDER BY position`,
      [p.id],
    );
    const countRes = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM poll_votes WHERE poll_id = $1`,
      [p.id],
    );
    const totalVotes = parseInt(countRes.rows[0]?.n ?? "0", 10);
    const myRes = await query<{ option_id: string }>(
      `SELECT option_id FROM poll_votes
       WHERE poll_id = $1 AND participant_id = $2`,
      [p.id, requesterId],
    );
    const base = toPoll(p, p.author_name ?? "(unknown)", optsRes.rows.map(toPollOption));
    views.push({
      ...base,
      status: "open",
      totalVotes,
      myVoteOptionId: myRes.rows[0]?.option_id ?? null,
    });
  }
  return views;
}

export async function getClosedPollsForRoom(
  roomId: string,
  limit = 50,
): Promise<ClosedPollView[]> {
  const { rows: polls } = await query<PollRow & { author_name: string | null }>(
    `SELECT p.id, p.room_id, p.author_id, p.question, p.status, p.created_at,
            p.closes_at, p.closed_at, p.closed_by,
            pt.name AS author_name
     FROM polls p
     LEFT JOIN participants pt ON pt.id = p.author_id AND pt.room_id = p.room_id
     WHERE p.room_id = $1 AND p.status = 'closed'
     ORDER BY p.closed_at DESC
     LIMIT $2`,
    [roomId, limit],
  );
  const views: ClosedPollView[] = [];
  for (const p of polls) {
    const optsRes = await query<OptionDbRow>(
      `SELECT id, poll_id, position, text FROM poll_options
       WHERE poll_id = $1 ORDER BY position`,
      [p.id],
    );
    const votesRes = await query<{ option_id: string }>(
      `SELECT option_id FROM poll_votes WHERE poll_id = $1`,
      [p.id],
    );
    const tally = computeTallies(
      optsRes.rows.map((o): OptionRow => ({ id: o.id, position: o.position, text: o.text })),
      votesRes.rows.map((v): VoteRow => ({ optionId: v.option_id })),
    );
    const base = toPoll(p, p.author_name ?? "(unknown)", optsRes.rows.map(toPollOption));
    views.push({
      ...base,
      status: "closed",
      totalVotes: tally.totalVotes,
      tallies: tally.tallies,
      winnerOptionId: tally.winnerOptionId,
      inconclusive: tally.inconclusive,
    });
  }
  return views.reverse();
}

export async function castVote(input: {
  pollId: string;
  participantId: string;
  optionId: string;
}): Promise<{ totalVotes: number }> {
  return tx(async (client) => {
    const openCheck = await client.query<{ ok: number }>(
      `SELECT 1 AS ok FROM polls
       WHERE id = $1 AND status = 'open'
         AND (closes_at IS NULL OR closes_at > NOW())`,
      [input.pollId],
    );
    if (openCheck.rowCount === 0) throw new Error("poll_not_open");
    const optCheck = await client.query<{ ok: number }>(
      `SELECT 1 AS ok FROM poll_options WHERE id = $1 AND poll_id = $2`,
      [input.optionId, input.pollId],
    );
    if (optCheck.rowCount === 0) throw new Error("invalid_option");
    await client.query(
      `INSERT INTO poll_votes (poll_id, participant_id, option_id, cast_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (poll_id, participant_id)
       DO UPDATE SET option_id = EXCLUDED.option_id, cast_at = NOW()`,
      [input.pollId, input.participantId, input.optionId],
    );
    const countRes = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM poll_votes WHERE poll_id = $1`,
      [input.pollId],
    );
    return { totalVotes: parseInt(countRes.rows[0]?.n ?? "0", 10) };
  });
}

export async function closePoll(input: {
  pollId: string;
  closedBy: string;
}): Promise<ClosedPollView | null> {
  const { rows } = await query<{ room_id: string }>(
    `UPDATE polls
     SET status='closed', closed_at=NOW(), closed_by=$2
     WHERE id=$1 AND status='open'
     RETURNING room_id`,
    [input.pollId, input.closedBy],
  );
  if (rows.length === 0) return null;
  const closed = await getClosedPollsForRoom(rows[0].room_id, 100);
  return closed.find(p => p.id === input.pollId) ?? null;
}

/**
 * Lazy expiry: closes all polls in a room whose closes_at has passed.
 * Returns ClosedPollView for each newly-closed poll. Idempotent —
 * the WHERE status='open' guard prevents double-close.
 */
export async function closeExpiredPolls(roomId: string): Promise<ClosedPollView[]> {
  const { rows } = await query<{ id: string }>(
    `UPDATE polls
     SET status='closed', closed_at=NOW(), closed_by='auto'
     WHERE room_id=$1
       AND status='open'
       AND closes_at IS NOT NULL
       AND closes_at <= NOW()
     RETURNING id`,
    [roomId],
  );
  if (rows.length === 0) return [];
  const closed = await getClosedPollsForRoom(roomId, 100);
  const closedIds = new Set(rows.map(r => r.id));
  return closed.filter(p => closedIds.has(p.id));
}
