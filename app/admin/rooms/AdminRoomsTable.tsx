"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { SortKey, Direction } from "@/lib/admin-sort";
import { AdminRoomRow, type AdminRowState } from "./AdminRoomRow";

type Sort = { column: SortKey; direction: Direction };

function sortLink(
  current: Sort,
  key: SortKey,
  q: string,
  label: string,
): ReactNode {
  const flip =
    current.column === key && current.direction === "DESC" ? "asc" : "desc";
  const params = new URLSearchParams();
  params.set("sort", key);
  params.set("dir", flip);
  if (q) params.set("q", q);
  const isActive = current.column === key;
  const arrow = isActive ? (current.direction === "DESC" ? " ↓" : " ↑") : "";
  return (
    <a
      href={`/admin/rooms?${params.toString()}`}
      style={{
        color: "white",
        textDecoration: "none",
        fontWeight: 600,
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {label}
      {isActive && (
        <span style={{ color: "var(--orange)", marginLeft: 4 }}>{arrow}</span>
      )}
    </a>
  );
}

export default function AdminRoomsTable({
  initialRows,
  origin,
  sort,
  q,
  initialIdentity,
}: {
  initialRows: AdminRowState[];
  origin: string;
  sort: Sort;
  q: string;
  initialIdentity: { name: string; email: string } | null;
}) {
  const [rows, setRows] = useState<AdminRowState[]>(initialRows);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [identity, setIdentity] = useState(initialIdentity);

  function patchRow(id: string, patch: Partial<AdminRowState>): void {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function toggle(id: string): void {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const headStyle: React.CSSProperties = {
    padding: "10px 12px",
    color: "white",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "separate",
        borderSpacing: 0,
        background: "white",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
        border: "1px solid #e2e8f0",
      }}
    >
      <thead>
        <tr style={{ textAlign: "left", background: "var(--navy)" }}>
          <th style={headStyle}>{sortLink(sort, "name", q, "Room")}</th>
          <th style={headStyle}>{sortLink(sort, "last_message_at", q, "Last activity")}</th>
          <th style={{ ...headStyle, textAlign: "right" }}>
            {sortLink(sort, "msgs_24h", q, "24h")}
          </th>
          <th style={{ ...headStyle, textAlign: "right" }}>
            {sortLink(sort, "msgs_7d", q, "7d / users")}
          </th>
          <th style={{ ...headStyle, textAlign: "right" }}>
            {sortLink(sort, "file_count", q, "Files")}
          </th>
          <th style={headStyle}>{sortLink(sort, "created_at", q, "Created")}</th>
          <th style={headStyle}>Link</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <AdminRoomRow
            key={row.id}
            row={row}
            origin={origin}
            identity={identity}
            onIdentityChange={setIdentity}
            isExpanded={expanded.has(row.id)}
            onToggle={() => toggle(row.id)}
            onPatchRow={(patch) => patchRow(row.id, patch)}
          />
        ))}
      </tbody>
    </table>
  );
}
