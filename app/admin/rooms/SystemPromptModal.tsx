"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";

const MAX = 4000;

export function SystemPromptModal({
  roomId,
  onClose,
}: {
  roomId: string;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from server.
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/admin/rooms/${roomId}/system-prompt`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setPrompt(d.systemPrompt ?? ""))
      .catch((e) => {
        if (e?.name !== "AbortError") setError(String(e));
      });
    return () => ac.abort();
  }, [roomId]);

  const tooLong = (prompt?.length ?? 0) > MAX;
  const canSave = prompt !== null && !tooLong && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}/system-prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemPrompt: prompt ?? "" }),
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
    <Modal title="Edit system prompt" onClose={onClose}>
      {prompt === null ? (
        <div style={{ color: "#888" }}>Loading…</div>
      ) : (
        <>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={14}
            style={{
              width: "100%",
              padding: 8,
              fontFamily: "ui-monospace, monospace",
              fontSize: 13,
              boxSizing: "border-box",
              resize: "vertical",
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
              {prompt.length} / {MAX}
            </span>
            {error && <span style={{ color: "#dc2626" }}>Error: {error}</span>}
          </div>
        </>
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
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
