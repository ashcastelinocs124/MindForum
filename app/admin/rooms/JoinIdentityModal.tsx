"use client";

import { useState } from "react";
import { Modal } from "./Modal";

export function JoinIdentityModal({
  onSaved,
  onClose,
}: {
  onSaved: (i: { name: string; email: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const canSave = trimmedName.length > 0 && trimmedEmail.length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      onSaved({ name: trimmedName, email: trimmedEmail });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Join rooms as facilitator" onClose={onClose}>
      <p style={{ margin: "0 0 12px", color: "#555", fontSize: 13 }}>
        You haven&rsquo;t set a facilitator identity yet. It&rsquo;ll be saved (for 30
        days) and reused every time you click Join.
      </p>
      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Display name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ash"
          style={inp()}
        />
      </label>
      <label style={{ display: "block", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ash@example.com"
          style={inp()}
        />
      </label>
      {error && (
        <div style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}>Error: {error}</div>
      )}
      <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={!canSave}
          style={{
            background: "#13294B",
            color: "white",
            border: "none",
            padding: "6px 14px",
            borderRadius: 4,
            fontWeight: 600,
            cursor: canSave ? "pointer" : "default",
          }}
        >
          {saving ? "Saving…" : "Save & continue"}
        </button>
      </div>
    </Modal>
  );
}

function inp(): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: 8,
    fontSize: 14,
    boxSizing: "border-box",
    marginTop: 2,
  };
}
