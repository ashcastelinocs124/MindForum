import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE_S, adminToken, tokenMatches } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function setCookieAndRedirect(req: NextRequest, token: string): NextResponse {
  const url = new URL("/admin/rooms", req.url);
  const res = NextResponse.redirect(url);
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE_S,
  });
  return res;
}

function unauthorized(req: NextRequest): NextResponse {
  const url = new URL("/admin/rooms", req.url);
  url.searchParams.set("err", "bad_token");
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  if (!adminToken()) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const supplied = req.nextUrl.searchParams.get("token");
  if (typeof supplied !== "string" || !tokenMatches(supplied)) return unauthorized(req);
  return setCookieAndRedirect(req, supplied);
}

export async function POST(req: NextRequest) {
  if (!adminToken()) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const form = await req.formData();
  const supplied = form.get("token");
  if (typeof supplied !== "string" || !tokenMatches(supplied)) return unauthorized(req);
  return setCookieAndRedirect(req, supplied);
}
