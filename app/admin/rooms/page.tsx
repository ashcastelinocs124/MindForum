import { headers } from "next/headers";
import { adminToken, isAdmin } from "@/lib/admin-auth";
import { getAdminIdentity } from "@/lib/admin-identity";
import { adminListRoomsWithActivity } from "@/lib/store";
import { resolveSort } from "@/lib/admin-sort";
import TokenForm from "./TokenForm";
import AdminRoomsTable from "./AdminRoomsTable";
import type { AdminRowState } from "./AdminRoomRow";

export const dynamic = "force-dynamic";

type SearchParams = { sort?: string; dir?: string; q?: string; err?: string };

export default async function AdminRoomsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!adminToken()) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Admin disabled</h1>
        <p>Set ADMIN_TOKEN to enable.</p>
      </main>
    );
  }
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return <TokenForm error={sp.err} />;
  }
  const sort = resolveSort(sp.sort, sp.dir);
  const q = (sp.q ?? "").trim();
  const rows = await adminListRoomsWithActivity({ ...sort, q });
  const identity = await getAdminIdentity();

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;

  // Serialize Dates to ISO so the client island doesn't have to know about
  // Postgres Date objects vs numbers.
  const initialRows: AdminRowState[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
    msgs24h: r.msgs24h,
    msgs7d: r.msgs7d,
    participants7d: r.participants7d,
    fileCount: r.fileCount,
    closedAt: r.closedAt ? r.closedAt.getTime() : null,
  }));

  return (
    <main
      style={{
        fontFamily: "system-ui",
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 200px)",
      }}
    >
      <header
        style={{
          background:
            "linear-gradient(135deg, var(--navy) 0%, #1f3a68 100%)",
          color: "white",
          padding: "32px 0 34px",
          borderBottom: "3px solid var(--orange)",
          boxShadow: "0 2px 8px rgba(19,41,75,0.08)",
        }}
      >
        <div style={{ padding: "0 40px" }}>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            MindForum
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 44,
              fontWeight: 800,
              letterSpacing: -0.5,
              lineHeight: 1.05,
              textTransform: "uppercase",
              color: "var(--orange)",
            }}
          >
            Facilitator Console
          </h1>
          <div style={{ marginTop: 10, fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
            {rows.length} {rows.length === 1 ? "room" : "rooms"}
            {identity && (
              <>
                {" · joined as "}
                <span style={{ color: "var(--orange)", fontWeight: 700 }}>
                  {identity.name}
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "1.5rem auto", padding: "0 24px" }}>
        <form
          method="GET"
          action="/admin/rooms"
          style={{
            marginBottom: 16,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <input type="hidden" name="sort" value={sort.column} />
          <input type="hidden" name="dir" value={sort.direction.toLowerCase()} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="🔍 Filter rooms by name…"
            style={{
              padding: "8px 12px",
              width: 320,
              fontSize: 14,
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              outline: "none",
              background: "white",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "8px 16px",
              background: "var(--navy)",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Filter
          </button>
          {q && (
            <a
              href="/admin/rooms"
              style={{
                marginLeft: 4,
                fontSize: 13,
                color: "var(--orange)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              clear
            </a>
          )}
        </form>
        {initialRows.length === 0 ? (
          <p style={{ color: "#64748b" }}>
            No rooms match. Seed one with <code>scripts/seed-msba-rooms.py</code>.
          </p>
        ) : (
          <AdminRoomsTable
            initialRows={initialRows}
            origin={origin}
            sort={sort}
            q={q}
            initialIdentity={identity}
          />
        )}
      </div>
    </main>
  );
}
