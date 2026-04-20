import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "@/lib/store";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : "Untitled Room";
  const createdById = nanoid(10);
  const room = createRoom(name, createdById);
  return NextResponse.json({ id: room.id, name: room.name });
}
