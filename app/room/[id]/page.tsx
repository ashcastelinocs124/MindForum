"use client";
import { useEffect, useRef, useState, use } from "react";

type Participant = { id: string; name: string; email: string; joinedAt: number };
type PublicFile = {
  id: string;
  roomId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedAt: number;
};
type Msg = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
  kind?: "chat" | "brief";
};
type Snapshot = {
  id: string;
  name: string;
  participants: Participant[];
  messages: Msg[];
  files: PublicFile[];
  selectedFileIds: string[];
};

export default function RoomPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);

  const [joined, setJoined] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [joinError, setJoinError] = useState("");
  const [state, setState] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [briefPending, setBriefPending] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setJoinError("");
    const res = await fetch(`/api/room/${id}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    if (res.status === 404) {
      setJoinError("Room not found.");
      return;
    }
    if (!res.ok) {
      setJoinError("Could not join.");
      return;
    }
    setJoined(true);
  }

  useEffect(() => {
    if (!joined) return;
    const es = new EventSource(`/api/room/${id}/stream`);
    es.addEventListener("snapshot", (ev) => {
      setState(JSON.parse((ev as MessageEvent).data));
    });
    es.addEventListener("participant_joined", (ev) => {
      const p: Participant = JSON.parse((ev as MessageEvent).data);
      setState((s) => (s ? { ...s, participants: upsertById(s.participants, p) } : s));
    });
    es.addEventListener("message_added", (ev) => {
      const m: Msg = JSON.parse((ev as MessageEvent).data);
      setState((s) => (s ? { ...s, messages: [...s.messages, m] } : s));
      if (m.kind === "brief") setBriefPending(false);
    });
    es.addEventListener("file_added", (ev) => {
      const f: PublicFile = JSON.parse((ev as MessageEvent).data);
      setState((s) => (s ? { ...s, files: upsertById(s.files, f) } : s));
    });
    es.addEventListener("file_selection_changed", (ev) => {
      const { selectedFileIds } = JSON.parse((ev as MessageEvent).data);
      setState((s) => (s ? { ...s, selectedFileIds } : s));
    });
    es.onerror = () => {
      /* EventSource auto-reconnects */
    };
    return () => es.close();
  }, [id, joined]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await fetch(`/api/room/${id}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/room/${id}/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Upload failed: ${body.error ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleFile(fileId: string, selected: boolean) {
    await fetch(`/api/room/${id}/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileId, selected }),
    });
  }

  async function generateBrief() {
    setBriefPending(true);
    try {
      await fetch(`/api/room/${id}/brief`, { method: "POST" });
    } catch {
      setBriefPending(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
  }

  if (!joined) {
    return (
      <main style={{ maxWidth: 480, margin: "15vh auto", padding: 24 }}>
        <h1>Join room</h1>
        <p style={{ color: "var(--muted)" }}>Anyone with the link can join. Name and email are for attribution only.</p>
        <form onSubmit={join} style={{ display: "grid", gap: 12 }}>
          <input
            required
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inp()}
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inp()}
          />
          <button type="submit" style={btnPrimary()}>
            Join
          </button>
          {joinError && <p style={{ color: "crimson" }}>{joinError}</p>}
        </form>
      </main>
    );
  }

  if (!state) return <main style={{ padding: 24 }}>Connecting…</main>;

  return (
    <main
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr",
        background: "var(--bg)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 20px",
          background: "var(--navy)",
          color: "white",
        }}
      >
        <div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>MindForum</div>
          <div style={{ fontFamily: "Montserrat, sans-serif", fontSize: 20 }}>{state.name}</div>
        </div>
        <button onClick={copyLink} style={{ ...btnSecondary(), background: "var(--orange)" }}>
          Copy link
        </button>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr 280px",
          gap: 16,
          padding: 16,
          minHeight: 0,
        }}
      >
        <aside style={col()}>
          <h3 style={colTitle()}>Participants</h3>
          {state.participants.map((p) => (
            <div
              key={p.id}
              style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}
            >
              <span
                style={{ width: 8, height: 8, borderRadius: 8, background: "#22c55e" }}
              />
              <span>{p.name}</span>
            </div>
          ))}
        </aside>

        <section
          style={{ ...col(), minHeight: 0, display: "grid", gridTemplateRows: "1fr auto" }}
        >
          <div style={{ overflowY: "auto", paddingRight: 8 }}>
            {state.messages.length === 0 && (
              <p style={{ color: "var(--muted)" }}>
                Mention <code>@ai</code> to ask a question, or click <b>Generate project brief</b> when the room has enough context.
              </p>
            )}
            {state.messages.map((m) => (
              <MsgView key={m.id} m={m} />
            ))}
            {briefPending && (
              <div style={{ color: "var(--muted)", fontStyle: "italic", padding: "8px 0" }}>
                Generating brief…
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
          {(() => {
            const aiMention = /^\s*@ai\b/i.test(draft);
            return (
              <form
                onSubmit={send}
                style={{
                  display: "grid",
                  gap: 6,
                  paddingTop: 12,
                  borderTop: "1px solid var(--border)",
                }}
              >
                {aiMention && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignSelf: "flex-start",
                      alignItems: "center",
                      gap: 6,
                      background: "var(--orange)",
                      color: "white",
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "3px 8px",
                      borderRadius: 999,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: 6, background: "white" }} />
                    AI will respond
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a message. Start with @ai to ask the AI."
                    style={{
                      ...inp(),
                      borderColor: aiMention ? "var(--orange)" : "var(--border)",
                      boxShadow: aiMention ? "0 0 0 3px rgba(232,74,39,0.15)" : "none",
                      outline: "none",
                      transition: "border-color 120ms, box-shadow 120ms",
                    }}
                  />
                  <button type="submit" style={btnPrimary()}>
                    Send
                  </button>
                </div>
              </form>
            );
          })()}
        </section>

        <aside
          style={{
            ...col(),
            display: "grid",
            gridTemplateRows: "auto 1fr auto auto",
            gap: 8,
          }}
        >
          <h3 style={colTitle()}>Files</h3>
          <div style={{ overflowY: "auto" }}>
            {state.files.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>No files yet.</p>
            )}
            {state.files.map((f) => {
              const selected = state.selectedFileIds.includes(f.id);
              return (
                <label
                  key={f.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "4px 0",
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => toggleFile(f.id, e.target.checked)}
                  />
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={f.name}
                  >
                    {f.name}
                  </span>
                </label>
              );
            })}
          </div>
          <label
            style={{
              ...btnSecondary(),
              textAlign: "center",
              display: "block",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Uploading…" : "+ Upload file"}
            <input
              type="file"
              hidden
              accept=".pdf,.docx,.txt,.md"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </label>
          <button onClick={generateBrief} disabled={briefPending} style={heroBtn()}>
            {briefPending ? "Generating…" : "✨ Generate project brief"}
          </button>
        </aside>
      </div>
    </main>
  );
}

function MsgView({ m }: { m: Msg }) {
  if (m.kind === "brief") return <BriefView m={m} />;
  const isAi = m.authorId === "ai";
  return (
    <div
      style={{
        padding: "10px 12px",
        margin: "8px 0",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        borderLeft: isAi ? "3px solid var(--orange)" : "3px solid var(--navy)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{m.authorName}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{renderWithAiMentions(m.content)}</div>
    </div>
  );
}

function renderWithAiMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /@ai\b/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <span
        key={`ai-${i++}`}
        style={{
          background: "var(--orange)",
          color: "white",
          padding: "1px 6px",
          borderRadius: 4,
          fontWeight: 600,
          fontSize: "0.92em",
        }}
      >
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type BriefData = {
  themes?: string[];
  outline?: { section: string; points: string[] }[];
  risks?: string[];
  nextSteps?: string[];
  suggestedCollaborators?: string[];
};

function BriefView({ m }: { m: Msg }) {
  let brief: BriefData | null = null;
  try {
    brief = JSON.parse(m.content);
  } catch {
    return <MsgView m={{ ...m, kind: "chat", content: m.content }} />;
  }
  return (
    <div
      style={{
        padding: 16,
        margin: "12px 0",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        borderLeft: "3px solid var(--orange)",
      }}
    >
      <div
        style={{
          fontFamily: "Montserrat, sans-serif",
          color: "var(--navy)",
          fontWeight: 700,
          marginBottom: 8,
          fontSize: 18,
        }}
      >
        Project Brief
      </div>
      <Section title="Themes" items={brief?.themes} />
      {brief?.outline && brief.outline.length > 0 && (
        <div style={{ margin: "12px 0" }}>
          <div style={sectionTitle()}>Outline</div>
          {brief.outline.map((o, i) => (
            <div key={i} style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600 }}>{o.section}</div>
              <ul style={{ margin: "4px 0 0 18px" }}>
                {(o.points ?? []).map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <Section title="Risks" items={brief?.risks} />
      <Section title="Next steps" items={brief?.nextSteps} />
      <Section title="Suggested collaborators" items={brief?.suggestedCollaborators} />
    </div>
  );
}

function Section({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div style={{ margin: "12px 0" }}>
      <div style={sectionTitle()}>{title}</div>
      <ul style={{ margin: "4px 0 0 18px" }}>
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function sectionTitle(): React.CSSProperties {
  return { fontFamily: "Montserrat, sans-serif", color: "var(--navy)", fontWeight: 600 };
}
function col(): React.CSSProperties {
  return {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 16,
    overflow: "hidden",
  };
}
function colTitle(): React.CSSProperties {
  return {
    margin: "0 0 8px",
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--muted)",
  };
}
function inp(): React.CSSProperties {
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
function heroBtn(): React.CSSProperties {
  return {
    background: "linear-gradient(135deg, var(--orange), #ff7a3d)",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "12px 16px",
    fontWeight: 700,
    fontSize: 15,
  };
}

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const idx = arr.findIndex((a) => a.id === item.id);
  if (idx === -1) return [...arr, item];
  const copy = arr.slice();
  copy[idx] = item;
  return copy;
}
