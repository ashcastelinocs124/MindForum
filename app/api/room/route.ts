import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "@/lib/store";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const MAX_SYSTEM_PROMPT_CHARS = 4000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : "Untitled Room";
  const systemPrompt =
    typeof body.systemPrompt === "string"
      ? body.systemPrompt.trim().slice(0, MAX_SYSTEM_PROMPT_CHARS)
      : "";
  const createdById = nanoid(10);
  const room = createRoom(name, createdById, systemPrompt);
  return NextResponse.json({ id: room.id, name: room.name });
}
