import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE_S, adminToken, tokenMatches } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Behind nginx, req.url uses the internal listening address (e.g. localhost:3006),
// so building redirects with `new URL(path, req.url)` sends the browser to the wrong host.
// Use the forwarded headers nginx supplies to reconstruct the public origin.
function publicUrl(req: NextRequest, path: string): URL {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    new URL(req.url).host;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  return new URL(path, `${proto}://${host}`);
}

function setCookieAndRedirect(req: NextRequest, token: string): NextResponse {
  const res = NextResponse.redirect(publicUrl(req, "/admin/rooms"));
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
  const url = publicUrl(req, "/admin/rooms");
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
