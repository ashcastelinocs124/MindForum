"use client";

import { useEffect, useState } from "react";
import CopyLinkButton from "./CopyLinkButton";
import { AnnounceModal } from "./AnnounceModal";
import { RenameModal } from "./RenameModal";
import { SystemPromptModal } from "./SystemPromptModal";
import { JoinIdentityModal } from "./JoinIdentityModal";

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
  // Brand-aligned activity dots: green = live, orange = recent, gray = idle.
  const dotColor =
    t.dot === "green" ? "#16a34a" : t.dot === "yellow" ? "var(--orange)" : "#94a3b8";
  const url = `${origin}/room/${row.id}`;
  const cellStyle: React.CSSProperties = {
    padding: "12px",
    borderBottom: "1px solid #f1f5f9",
    background: closed ? "#fff7ed" : isExpanded ? "rgba(19,41,75,0.03)" : "white",
    transition: "background 120ms",
  };

  return (
    <>
      <tr>
        <td style={cellStyle}>
          <button
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "collapse" : "expand"}
            style={{
              marginRight: 8,
              border: "none",
              background: isExpanded ? "var(--navy)" : "transparent",
              color: isExpanded ? "white" : "var(--navy)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              width: 22,
              height: 22,
              borderRadius: 4,
              lineHeight: 1,
              verticalAlign: "middle",
            }}
          >
            {isExpanded ? "▾" : "▸"}
          </button>
          <a
            href={`/room/${row.id}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--navy)", fontWeight: 600, textDecoration: "none" }}
          >
            {row.name}
          </a>
          <span style={{ marginLeft: 8 }}>
            {closed ? (
              <span
                style={{
                  padding: "2px 8px",
                  background: "var(--orange)",
                  color: "white",
                  borderRadius: 10,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  verticalAlign: "middle",
                }}
              >
                CLOSED
              </span>
            ) : (
              <span
                style={{
                  padding: "2px 8px",
                  background: "rgba(22,163,74,0.12)",
                  color: "#15803d",
                  borderRadius: 10,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  verticalAlign: "middle",
                }}
              >
                OPEN
              </span>
            )}
          </span>
          <div
            style={{
              fontSize: 11,
              color: "#94a3b8",
              marginLeft: 30,
              marginTop: 2,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {row.id}
          </div>
        </td>
        <td style={cellStyle}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 4,
              background: dotColor,
              marginRight: 8,
              boxShadow: t.dot === "green" ? "0 0 0 3px rgba(22,163,74,0.15)" : "none",
            }}
          />
          <span style={{ fontSize: 13, color: "#475569" }}>{t.label}</span>
        </td>
        <td style={{ ...cellStyle, textAlign: "right", fontWeight: row.msgs24h > 0 ? 600 : 400, color: row.msgs24h > 0 ? "var(--navy)" : "#94a3b8" }}>
          {row.msgs24h}
        </td>
        <td style={{ ...cellStyle, textAlign: "right", color: "#475569" }}>
          {row.msgs7d} <span style={{ color: "#94a3b8" }}>/ {row.participants7d}</span>
        </td>
        <td style={{ ...cellStyle, textAlign: "right", color: row.fileCount > 0 ? "#475569" : "#94a3b8" }}>
          {row.fileCount}
        </td>
        <td style={{ ...cellStyle, color: "#64748b", fontSize: 12 }}>
          {row.createdAt.slice(0, 10)}
        </td>
        <td style={cellStyle}>
          <CopyLinkButton url={url} />
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td
            colSpan={7}
            style={{
              padding: "16px 18px 18px 40px",
              background: "rgba(19,41,75,0.04)",
              borderBottom: "1px solid #e2e8f0",
              borderLeft: "3px solid var(--orange)",
            }}
          >
            <div style={{ marginBottom: 14 }}>
              <ActionButtons row={row} identity={identity} onIdentityChange={onIdentityChange} />
            </div>
            <ParticipantsList roomId={row.id} participants={participants} />
          </td>
        </tr>
      )}
    </>
  );
}

function ActionButtons({
  row,
  identity,
  onIdentityChange,
}: {
  row: AdminRowState;
  identity: { name: string; email: string } | null;
  onIdentityChange: (i: { name: string; email: string } | null) => void;
}) {
  const closed = row.closedAt != null;
  const [busy, setBusy] = useState<"toggle" | null>(null);
  const [showAnnounce, setShowAnnounce] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showIdentity, setShowIdentity] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleClose() {
    setBusy("toggle");
    setActionError(null);
    try {
      const path = closed ? "reopen" : "close";
      const res = await fetch(`/api/admin/rooms/${row.id}/${path}`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `HTTP ${res.status}`);
      }
      // SSE will patch the row's closedAt — no optimistic update needed.
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(null);
    }
  }

  function doJoin() {
    if (!identity) {
      setShowIdentity(true);
      return;
    }
    // Use a real form POST so the 303 redirect + Set-Cookie sticks.
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `/api/admin/rooms/${row.id}/join`;
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => void toggleClose()}
          disabled={busy === "toggle"}
          style={closed ? primaryAdmin() : dangerAdmin()}
        >
          {busy === "toggle" ? "…" : closed ? "Reopen" : "Close"}
        </button>
        <button onClick={doJoin} style={primaryAdmin()}>
          Join
        </button>
        <button onClick={() => setShowAnnounce(true)} style={secondaryAdmin()}>
          Announce
        </button>
        <button onClick={() => setShowRename(true)} style={secondaryAdmin()}>
          Rename
        </button>
        <button onClick={() => setShowPrompt(true)} style={secondaryAdmin()}>
          Prompt
        </button>
        {actionError && (
          <span style={{ color: "#dc2626", fontSize: 12 }}>Error: {actionError}</span>
        )}
      </div>

      {showAnnounce && (
        <AnnounceModal roomId={row.id} onClose={() => setShowAnnounce(false)} />
      )}
      {showRename && (
        <RenameModal
          roomId={row.id}
          initialName={row.name}
          onClose={() => setShowRename(false)}
        />
      )}
      {showPrompt && (
        <SystemPromptModal roomId={row.id} onClose={() => setShowPrompt(false)} />
      )}
      {showIdentity && (
        <JoinIdentityModal
          onSaved={(i) => {
            onIdentityChange(i);
            setShowIdentity(false);
            // Re-trigger Join now that identity is set.
            const form = document.createElement("form");
            form.method = "POST";
            form.action = `/api/admin/rooms/${row.id}/join`;
            document.body.appendChild(form);
            form.submit();
          }}
          onClose={() => setShowIdentity(false)}
        />
      )}
    </>
  );
}

function primaryAdmin(): React.CSSProperties {
  // Orange CTA — high-signal "do this now" action (Join, primary save).
  return {
    background: "var(--orange)",
    color: "white",
    border: "none",
    padding: "6px 14px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(232,74,39,0.25)",
  };
}

function secondaryAdmin(): React.CSSProperties {
  // Navy-outlined — neutral utility action.
  return {
    background: "white",
    color: "var(--navy)",
    border: "1px solid #cbd5e1",
    padding: "6px 14px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}

function dangerAdmin(): React.CSSProperties {
  // Orange danger — closes/locks the room.
  return {
    background: "white",
    color: "var(--orange)",
    border: "1px solid var(--orange)",
    padding: "6px 14px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}

function ParticipantsList({
  roomId,
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

  async function toggleMute(p: AdminParticipant) {
    await fetch(`/api/admin/rooms/${roomId}/participants/${p.id}/mute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ muted: p.mutedAt == null }),
    });
  }
  async function removeParticipant(p: AdminParticipant) {
    if (
      !confirm(
        `Remove ${p.name} (${p.email}) from this room?\n\nThey can rejoin via email — this just kicks them from the current session.`,
      )
    )
      return;
    await fetch(`/api/admin/rooms/${roomId}/participants/${p.id}/remove`, {
      method: "POST",
    });
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
              padding: "5px 0",
              display: "flex",
              gap: 10,
              alignItems: "center",
              fontSize: 13,
              flexWrap: "wrap",
            }}
          >
            <span style={{ minWidth: 240 }}>
              <span
                style={{
                  color:
                    p.lastSeenAt && Date.now() - p.lastSeenAt < 60_000
                      ? "#1a7f37"
                      : "#999",
                }}
              >
                ●
              </span>{" "}
              <strong>{p.name}</strong>{" "}
              <span style={{ color: "#888" }}>({p.email})</span>
            </span>
            <span style={{ color: "#888", fontSize: 12, flex: 1 }}>
              last seen{" "}
              {p.lastSeenAt
                ? relTime(new Date(p.lastSeenAt).toISOString()).label
                : "never"}
            </span>
            {p.mutedAt && (
              <span
                style={{
                  background: "#fee2e2",
                  color: "#991b1b",
                  padding: "1px 6px",
                  borderRadius: 4,
                  fontSize: 11,
                }}
              >
                muted
              </span>
            )}
            <button onClick={() => void toggleMute(p)} style={tinyBtn()}>
              {p.mutedAt ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={() => void removeParticipant(p)}
              style={{ ...tinyBtn(), color: "#b91c1c", borderColor: "#fca5a5" }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function tinyBtn(): React.CSSProperties {
  return {
    background: "white",
    color: "#13294B",
    border: "1px solid #d1d5db",
    padding: "2px 8px",
    borderRadius: 3,
    fontSize: 11,
    cursor: "pointer",
  };
}
