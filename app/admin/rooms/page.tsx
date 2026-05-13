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
        maxWidth: 1100,
        margin: "2rem auto",
        padding: "0 16px",
        fontFamily: "system-ui",
      }}
    >
      <h1>Rooms ({rows.length})</h1>
      <form method="GET" action="/admin/rooms" style={{ marginBottom: 12 }}>
        <input type="hidden" name="sort" value={sort.column} />
        <input type="hidden" name="dir" value={sort.direction.toLowerCase()} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="filter by name…"
          style={{ padding: 6, width: 260 }}
        />
        <button type="submit" style={{ marginLeft: 6 }}>
          Filter
        </button>
        {q && (
          <a href="/admin/rooms" style={{ marginLeft: 8 }}>
            clear
          </a>
        )}
      </form>
      {initialRows.length === 0 ? (
        <p>
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
    </main>
  );
}
