import { nanoid } from "nanoid";

export type Participant = {
  id: string;
  name: string;
  email: string;
  joinedAt: number;
};

export type Message = {
  id: string;
  roomId: string;
  authorId: string;     // participant id, or "ai"
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
};

export type Room = {
  id: string;
  name: string;
  createdAt: number;
  createdById: string;
  systemPrompt: string;
  participants: Map<string, Participant>;
  messages: Message[];
  files: Map<string, RoomFile>;
  selectedFileIds: Set<string>;
};

const g = globalThis as unknown as { __mindforumRooms?: Map<string, Room> };
export const rooms: Map<string, Room> = g.__mindforumRooms ?? new Map();
g.__mindforumRooms = rooms;

export function createRoom(
  name: string,
  createdById: string,
  systemPrompt = ""
): Room {
  const room: Room = {
    id: nanoid(10),
    name,
    createdAt: Date.now(),
    createdById,
    systemPrompt,
    participants: new Map(),
    messages: [],
    files: new Map(),
    selectedFileIds: new Set(),
  };
  rooms.set(room.id, room);
  return room;
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id);
}

export function snapshot(room: Room) {
  return {
    id: room.id,
    name: room.name,
    systemPrompt: room.systemPrompt,
    participants: Array.from(room.participants.values()),
    messages: room.messages,
    files: Array.from(room.files.values()).map(({ extractedText: _drop, ...rest }) => rest),
    selectedFileIds: Array.from(room.selectedFileIds),
  };
}
