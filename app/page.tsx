"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [joinId, setJoinId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name || "Untitled Room",
          systemPrompt: systemPrompt.trim(),
        }),
      });
      if (!res.ok) throw new Error("create_failed");
      const { id } = await res.json();
      router.push(`/room/${id}`);
    } catch {
      setErr("Could not create room.");
    } finally {
      setLoading(false);
    }
  }

  function onJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = joinId.trim();
    if (!trimmed) return;
    router.push(`/room/${trimmed}`);
  }

  return (
    <main style={{ maxWidth: 720, margin: "10vh auto", padding: 24 }}>
      <h1 style={{ fontSize: 40, margin: 0 }}>MindForum</h1>
      <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 17 }}>
        A shared AI workspace for group brainstorming. Create a room, invite collaborators with the link, upload docs, chat together with an AI that joins in when mentioned.
      </p>

      <section style={card()}>
        <h2 style={{ marginTop: 0 }}>Create a room</h2>
        <form onSubmit={onCreate} style={{ display: "grid", gap: 10 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Room name (e.g., Fall 2026 Grant Brainstorm)"
            style={input()}
          />
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                color: "var(--muted)",
                marginBottom: 4,
              }}
            >
              AI guidance (optional) — how should the AI behave in this room?
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="e.g., You are helping four faculty shape a grant proposal. Ask probing questions before suggesting answers. Prefer plain language over jargon."
              rows={4}
              maxLength={4000}
              style={{
                ...input(),
                width: "100%",
                display: "block",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" disabled={loading} style={btnPrimary()}>
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </section>

      <section style={card()}>
        <h2 style={{ marginTop: 0 }}>Join a room</h2>
        <form onSubmit={onJoin} style={{ display: "flex", gap: 8 }}>
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            placeholder="Room ID (from the link)"
            style={input()}
          />
          <button type="submit" style={btnSecondary()}>
            Open
          </button>
        </form>
      </section>

      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <p style={{ color: "var(--muted)", marginTop: 32, fontSize: 13 }}>
        Mention <code>@ai</code> in chat to pull the AI into the conversation. Otherwise it stays silent.
      </p>
    </main>
  );
}

function card(): React.CSSProperties {
  return {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 20,
    marginTop: 24,
  };
}
function input(): React.CSSProperties {
  return {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    fontSize: 16,
  };
}
function btnPrimary(): React.CSSProperties {
  return {
    background: "var(--orange)",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontWeight: 600,
  };
}
function btnSecondary(): React.CSSProperties {
  return {
    background: "var(--navy)",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontWeight: 600,
  };
}
