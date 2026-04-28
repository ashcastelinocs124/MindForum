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

export type Participant = {
  id: string;
  name: string;
  email: string;
  joinedAt: number;
  lastSeenAt: number | null;
};

export type Message = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
  kind?: "chat" | "brief";
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
  participants: Participant[];
  messages: Message[];
  files: RoomFile[];
};

// -------- Row → domain mappers

function toParticipant(r: {
  id: string;
  name: string;
  email: string;
  joined_at: Date;
  last_seen_at: Date | null;
}): Participant {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    joinedAt: r.joined_at.getTime(),
    lastSeenAt: r.last_seen_at ? r.last_seen_at.getTime() : null,
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
}): Message {
  return {
    id: r.id,
    roomId: r.room_id,
    authorId: r.author_id,
    authorName: r.author_name,
    content: r.content,
    createdAt: r.created_at.getTime(),
    kind: (r.kind as Message["kind"]) ?? "chat",
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
    }>(
      `SELECT id, name, system_prompt, created_by_id, created_at
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
      }>(
        `SELECT id, name, email, joined_at, last_seen_at FROM participants
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
      }>(
        `SELECT id, room_id, author_id, author_name, content, kind, created_at
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
    }>(
      `SELECT id, name, email, joined_at, last_seen_at FROM participants
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
    }>(
      `INSERT INTO participants (id, room_id, name, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, joined_at, last_seen_at`,
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
  }>(
    `SELECT id, name, email, joined_at, last_seen_at FROM participants
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
  }>(
    `SELECT * FROM (
       SELECT id, room_id, author_id, author_name, content, kind, created_at
       FROM messages WHERE room_id = $1
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
 */
export function snapshot(room: Room) {
  return {
    id: room.id,
    name: room.name,
    systemPrompt: room.systemPrompt,
    participants: room.participants,
    messages: room.messages,
    files: room.files.map(({ extractedText: _drop, selected: _sel, ...rest }) => rest),
    selectedFileIds: room.files.filter((f) => f.selected).map((f) => f.id),
  };
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
    msgs24h: Number(r.msgs_24h),
    msgs7d: Number(r.msgs_7d),
    participants7d: Number(r.participants_7d),
    lastMessageAt: r.last_message_at,
    totalParticipants: Number(r.total_participants),
    fileCount: Number(r.file_count),
  }));
}
