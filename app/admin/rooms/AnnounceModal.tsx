"use client";

import { useState } from "react";
import { Modal } from "./Modal";

const MAX = 4000;

export function AnnounceModal({
  roomId,
  onClose,
}: {
  roomId: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = content.trim();
  const tooLong = trimmed.length > MAX;
  const canSend = trimmed.length > 0 && !tooLong && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}/announce`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="Post facilitator announcement" onClose={onClose}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Wrap up in 5 minutes…"
        rows={4}
        style={{
          width: "100%",
          padding: 8,
          fontFamily: "inherit",
          fontSize: 14,
          boxSizing: "border-box",
          resize: "vertical",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
          fontSize: 12,
          color: tooLong ? "#dc2626" : "#888",
        }}
      >
        <span>
          {trimmed.length} / {MAX}
        </span>
        {error && <span style={{ color: "#dc2626" }}>Error: {error}</span>}
      </div>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} disabled={sending}>
          Cancel
        </button>
        <button onClick={() => void send()} disabled={!canSend} style={primaryBtn()}>
          {sending ? "Sending…" : "Send announcement"}
        </button>
      </div>
    </Modal>
  );
}

function primaryBtn(): React.CSSProperties {
  return {
    background: "var(--orange)",
    color: "white",
    border: "none",
    padding: "8px 18px",
    borderRadius: 6,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(232,74,39,0.25)",
  };
}
