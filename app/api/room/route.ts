import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "@/lib/store";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const MAX_SYSTEM_PROMPT_CHARS = 4000;

export async function POST(req: NextRequest) {
  // 5 room creations per IP per 10 minutes — generous for legit use, tight on abuse.
  const rate = checkRate("create-room", clientIp(req), 5, 10 * 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

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
