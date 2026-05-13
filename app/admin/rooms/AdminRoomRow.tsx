"use client";

import { useEffect, useState } from "react";
import CopyLinkButton from "./CopyLinkButton";

export type AdminRowState = {
  id: string;
  name: string;
  createdAt: string; // ISO
  lastMessageAt: string | null; // ISO
  msgs24h: number;
  msgs7d: number;
  participants7d: number;
  fileCount: number;
  closedAt: number | null;
};

export type AdminParticipant = {
  id: string;
  name: string;
  email: string;
  joinedAt: number;
  lastSeenAt: number | null;
  mutedAt: number | null;
  removedAt: number | null;
};

function relTime(iso: string | null): { label: string; dot: "green" | "yellow" | "gray" } {
  if (!iso) return { label: "—", dot: "gray" };
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const days = Math.floor(h / 24);
  let label: string;
  if (m < 1) label = "just now";
  else if (m < 60) label = `${m}m ago`;
  else if (h < 24) label = `${h}h ago`;
  else label = `${days}d ago`;
  const dot = h < 1 ? "green" : h < 24 ? "yellow" : "gray";
  return { label, dot };
}

export function AdminRoomRow({
  row,
  origin,
  identity,
  onIdentityChange,
  isExpanded,
  onToggle,
  onPatchRow,
}: {
  row: AdminRowState;
  origin: string;
  identity: { name: string; email: string } | null;
  onIdentityChange: (i: { name: string; email: string } | null) => void;
  isExpanded: boolean;
  onToggle: () => void;
  onPatchRow: (patch: Partial<AdminRowState>) => void;
}) {
  const [participants, setParticipants] = useState<AdminParticipant[] | null>(null);

  // On expand: fetch participants + open SSE. On collapse: tear both down.
  useEffect(() => {
    if (!isExpanded) return;
    const ac = new AbortController();
    fetch(`/api/admin/rooms/${row.id}/participants`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setParticipants(d.participants ?? []))
      .catch(() => {
        /* expand stays in loading state — user can collapse + retry */
      });

    const es = new EventSource(`/api/room/${row.id}/stream`);

    es.addEventListener("participant_joined", (ev) => {
      const p = JSON.parse((ev as MessageEvent).data);
      setParticipants((prev) => {
        if (!prev) return prev;
        const without = prev.filter((x) => x.id !== p.id);
        return [
          {
            id: p.id,
            name: p.name,
            email: p.email,
            joinedAt: p.joinedAt,
            lastSeenAt: p.lastSeenAt ?? null,
            mutedAt: p.mutedAt ?? null,
            removedAt: p.removedAt ?? null,
          },
          ...without,
        ];
      });
    });
    es.addEventListener("participant_muted", (ev) => {
      const { participantId, muted } = JSON.parse((ev as MessageEvent).data);
      setParticipants((prev) =>
        prev?.map((p) =>
          p.id === participantId ? { ...p, mutedAt: muted ? Date.now() : null } : p,
        ) ?? prev,
      );
    });
    es.addEventListener("participant_removed", (ev) => {
      const { participantId } = JSON.parse((ev as MessageEvent).data);
      setParticipants((prev) => prev?.filter((p) => p.id !== participantId) ?? prev);
    });
    es.addEventListener("room_closed", () => onPatchRow({ closedAt: Date.now() }));
    es.addEventListener("room_reopened", () => onPatchRow({ closedAt: null }));
    es.addEventListener("room_renamed", (ev) => {
      const { name } = JSON.parse((ev as MessageEvent).data);
      onPatchRow({ name });
    });

    return () => {
      ac.abort();
      es.close();
    };
  }, [isExpanded, row.id, onPatchRow]);

  const closed = row.closedAt != null;
  const t = relTime(row.lastMessageAt);
  const dotColor =
    t.dot === "green" ? "#1a7f37" : t.dot === "yellow" ? "#bf8700" : "#999";
  const url = `${origin}/room/${row.id}`;

  return (
    <>
      <tr
        style={{
          borderBottom: "1px solid #f0f0f0",
          background: closed ? "#fafafa" : undefined,
        }}
      >
        <td style={{ padding: 8 }}>
          <button
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "collapse" : "expand"}
            style={{
              marginRight: 8,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {isExpanded ? "▾" : "▸"}
          </button>
          <a href={`/room/${row.id}`} target="_blank" rel="noreferrer">
            {row.name}
          </a>
          {closed && (
            <span
              style={{
                marginLeft: 8,
                padding: "1px 8px",
                background: "#e5e7eb",
                color: "#374151",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                verticalAlign: "middle",
              }}
            >
              CLOSED
            </span>
          )}
          <div style={{ fontSize: 11, color: "#888", marginLeft: 22 }}>{row.id}</div>
        </td>
        <td style={{ padding: 8 }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 4,
              background: dotColor,
              marginRight: 6,
            }}
          />
          {t.label}
        </td>
        <td style={{ padding: 8, textAlign: "right" }}>{row.msgs24h}</td>
        <td style={{ padding: 8, textAlign: "right" }}>
          {row.msgs7d} / {row.participants7d}
        </td>
        <td style={{ padding: 8, textAlign: "right" }}>{row.fileCount}</td>
        <td style={{ padding: 8 }}>{row.createdAt.slice(0, 10)}</td>
        <td style={{ padding: 8 }}>
          <CopyLinkButton url={url} />
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={7} style={{ padding: "12px 16px 16px 30px", background: "#fcfcfc" }}>
            <div style={{ marginBottom: 10 }}>
              {/* Action buttons land in Task 24/25/26 — wired below. */}
              <ActionButtons row={row} identity={identity} onIdentityChange={onIdentityChange} />
            </div>
            <ParticipantsList roomId={row.id} participants={participants} />
          </td>
        </tr>
      )}
    </>
  );
}

function ActionButtons(_props: {
  row: AdminRowState;
  identity: { name: string; email: string } | null;
  onIdentityChange: (i: { name: string; email: string } | null) => void;
}) {
  // Wired in Task 24/25/26. Render a placeholder so the row layout is stable
  // and the participants list shows up below it during early testing.
  return (
    <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
      (Actions wire up in the next commit — Close / Join / Announce / Rename / Prompt.)
    </div>
  );
}

function ParticipantsList({
  roomId: _roomId,
  participants,
}: {
  roomId: string;
  participants: AdminParticipant[] | null;
}) {
  if (participants === null) {
    return <div style={{ color: "#888", fontSize: 13 }}>Loading participants…</div>;
  }
  if (participants.length === 0) {
    return <div style={{ color: "#888", fontSize: 13 }}>No participants yet.</div>;
  }
  return (
    <div>
      <div style={{ fontSize: 12, color: "#666", margin: "4px 0 6px" }}>
        Participants ({participants.length})
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {participants.map((p) => (
          <li
            key={p.id}
            style={{
              padding: "4px 0",
              display: "flex",
              gap: 12,
              alignItems: "baseline",
              fontSize: 13,
            }}
          >
            <span style={{ minWidth: 200 }}>
              <span style={{ color: p.lastSeenAt && Date.now() - p.lastSeenAt < 60_000 ? "#1a7f37" : "#999" }}>
                ●
              </span>{" "}
              <strong>{p.name}</strong>{" "}
              <span style={{ color: "#888" }}>({p.email})</span>
            </span>
            <span style={{ color: "#888", fontSize: 12, flex: 1 }}>
              last seen {p.lastSeenAt ? relTime(new Date(p.lastSeenAt).toISOString()).label : "never"}
            </span>
            {p.mutedAt && (
              <span
                style={{ background: "#fee2e2", color: "#991b1b", padding: "1px 6px", borderRadius: 4, fontSize: 11 }}
              >
                muted
              </span>
            )}
            {/* Mute/Remove buttons wire up in Task 27. */}
          </li>
        ))}
      </ul>
    </div>
  );
}
