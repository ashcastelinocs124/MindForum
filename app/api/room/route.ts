import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createRoom } from "@/lib/store";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const MAX_SYSTEM_PROMPT_CHARS = 4000;

/**
 * Create a room.
 *
 * If ADMIN_TOKEN is configured (prod), requires an x-admin-token header
 * matching it via constant-time compare. Unset means unrestricted (dev).
 *
 * Joining an existing room via its link remains open — this gate only
 * controls who can *spawn new rooms*, protecting against homepage-fishing
 * that would otherwise burn OpenAI credits.
 */
export async function POST(req: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) {
    const supplied = req.headers.get("x-admin-token") ?? "";
    const a = Buffer.from(adminToken);
    const b = Buffer.from(supplied);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  try {
    const room = await createRoom(name, createdById, systemPrompt);
    return NextResponse.json({ id: room.id, name: room.name });
  } catch (err) {
    console.error("createRoom failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
