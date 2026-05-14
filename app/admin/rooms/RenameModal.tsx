"use client";

import { useState } from "react";
import { Modal } from "./Modal";

const MAX = 100;

export function RenameModal({
  roomId,
  initialName,
  onClose,
}: {
  roomId: string;
  initialName: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const tooLong = trimmed.length > MAX;
  const canSave = trimmed.length > 0 && !tooLong && !saving && trimmed !== initialName;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
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
      setSaving(false);
    }
  }

  return (
    <Modal title="Rename room" onClose={onClose}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={MAX + 20}
        style={{
          width: "100%",
          padding: 8,
          fontSize: 14,
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
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
        <button onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={!canSave}
          style={{
            background: canSave ? "var(--orange)" : "#cbd5e1",
            color: "white",
            border: "none",
            padding: "8px 18px",
            borderRadius: 6,
            fontWeight: 600,
            cursor: canSave ? "pointer" : "default",
            boxShadow: canSave ? "0 1px 2px rgba(232,74,39,0.25)" : "none",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
