import { cookies } from "next/headers";

export const ADMIN_COOKIE = "mf_admin_session";
export const ADMIN_COOKIE_MAX_AGE_S = 60 * 60 * 24; // 24h

/** Returns the configured ADMIN_TOKEN, or null if unset (admin disabled). */
export function adminToken(): string | null {
  const t = process.env.ADMIN_TOKEN;
  return t && t.length > 0 ? t : null;
}

/** True iff the request carries a cookie matching ADMIN_TOKEN. */
export async function isAdmin(): Promise<boolean> {
  if (!adminToken()) return false;
  const c = await cookies();
  return tokenMatches(c.get(ADMIN_COOKIE)?.value);
}

/** Constant-time compare to defeat trivial timing leaks on token check. */
export function tokenMatches(supplied: string | null | undefined): boolean {
  const t = adminToken();
  if (!t || !supplied) return false;
  if (supplied.length !== t.length) return false;
  let diff = 0;
  for (let i = 0; i < t.length; i++) diff |= t.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}
