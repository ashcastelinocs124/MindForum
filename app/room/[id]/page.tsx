"use client";
import { useEffect, useRef, useState, use } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DEFAULT_PREFS,
  type NotifyPrefs,
  flashTitle,
  loadPrefs,
  matchesMention,
  notificationPermission,
  playPing,
  requestNotificationPermission,
  resetTitle,
  savePrefs,
  showToast,
} from "@/lib/notify";

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
  systemPrompt?: string;
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
  const [joining, setJoining] = useState(false);
  const [state, setState] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [briefPending, setBriefPending] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  type PinnedFacts = { names: string[]; decisions: string[]; files: string[] };
  type CatchupData =
    | { kind: "orientation"; files: { id: string; name: string }[] }
    | { kind: "summary"; bullets: string[]; pinnedFacts: PinnedFacts }
    | { kind: "error" };
  const [catchupOpen, setCatchupOpen] = useState(false);
  const [catchupData, setCatchupData] = useState<CatchupData | null>(null);
  const [catchupLoading, setCatchupLoading] = useState(false);

  const [participantId, setParticipantId] = useState<string>("");
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [unread, setUnread] = useState(0);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const nameRef = useRef(name);
  const prefsRef = useRef(prefs);
  const participantIdRef = useRef(participantId);
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  useEffect(() => {
    participantIdRef.current = participantId;
  }, [participantId]);

  // Prefill name + email from previous session so returning users don't retype.
  useEffect(() => {
    try {
      const savedName = localStorage.getItem("mindforum_name");
      const savedEmail = localStorage.getItem("mindforum_email");
      if (savedName) setName(savedName);
      if (savedEmail) setEmail(savedEmail);
    } catch {}
  }, []);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) {
      setJoinError("Name and email are both required.");
      return;
    }
    setJoinError("");
    setJoining(true);
    try {
      const res = await fetch(`/api/room/${id}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail }),
      });
      if (res.status === 404) {
        setJoinError("Room not found.");
        return;
      }
      if (!res.ok) {
        setJoinError("Could not join.");
        return;
      }
      const joinJson: {
        participantId: string;
        catchupHint?: { should: false } | { should: true; since: number | null };
      } = await res.json().catch(() => ({ participantId: "" }));
      try {
        localStorage.setItem("mindforum_name", trimmedName);
        localStorage.setItem("mindforum_email", trimmedEmail);
      } catch {}
      setParticipantId(joinJson.participantId ?? "");
      setJoined(true);

      if (joinJson.catchupHint?.should) {
        setCatchupOpen(true);
        setCatchupLoading(true);
        // The catchup endpoint now serves a single rolling summary for the room;
        // the `since` hint still controls whether we show the modal but no longer
        // shapes the response.
        fetch(`/api/room/${id}/catchup`)
          .then((r) => (r.ok ? r.json() : Promise.reject(r)))
          .then((data: CatchupData) => setCatchupData(data))
          .catch(() => setCatchupData({ kind: "error" }))
          .finally(() => setCatchupLoading(false));
      }
    } finally {
      setJoining(false);
    }
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

      const prevLast = messagesRef.current[messagesRef.current.length - 1];
      const myId = participantIdRef.current;
      const myName = nameRef.current;
      const p = prefsRef.current;
      const isOwn = myId !== "" && m.authorId === myId;
      const isAi = m.authorId === "ai";
      const focused =
        typeof document !== "undefined" && !document.hidden && document.hasFocus();

      let trigger: { title: string; body: string } | null = null;
      if (!isOwn && !focused) {
        if (isAi) {
          if (
            p.aiReplies &&
            prevLast &&
            myId !== "" &&
            prevLast.authorId === myId &&
            m.content.trim().length > 0
          ) {
            trigger = { title: "AI replied", body: snippet(m.content) };
          }
        } else {
          const match = matchesMention(m.content, myName, { mentionAll: p.mentionAll });
          if (match?.kind === "direct") {
            trigger = {
              title: `${m.authorName} mentioned you`,
              body: snippet(m.content),
            };
          } else if (match?.kind === "all") {
            trigger = {
              title: `${m.authorName} pinged the room`,
              body: snippet(m.content),
            };
          }
        }
      }

      if (trigger) {
        setUnread((n) => n + 1);
        if (p.toast) showToast(trigger.title, trigger.body);
        if (p.sound) playPing();
      }

      setState((s) => (s ? { ...s, messages: [...s.messages, m] } : s));
      if (m.kind === "brief") setBriefPending(false);
    });
    es.addEventListener("message_token", (ev) => {
      const { id: mid, delta } = JSON.parse((ev as MessageEvent).data) as {
        id: string;
        delta: string;
      };
      setState((s) =>
        s
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === mid ? { ...m, content: m.content + delta } : m
              ),
            }
          : s
      );
    });
    es.addEventListener("message_updated", (ev) => {
      const { id: mid, content } = JSON.parse((ev as MessageEvent).data) as {
        id: string;
        content: string;
      };
      setState((s) =>
        s
          ? {
              ...s,
              messages: s.messages.map((m) => (m.id === mid ? { ...m, content } : m)),
            }
          : s
      );
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

  // Autoscroll on new messages and while the last message is streaming.
  const lastMsgLen = state?.messages[state.messages.length - 1]?.content?.length ?? 0;
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [state?.messages.length, lastMsgLen]);

  // Keep messagesRef in sync so the SSE handler can inspect the previous message
  // without re-subscribing the EventSource.
  useEffect(() => {
    messagesRef.current = state?.messages ?? [];
  }, [state?.messages]);

  // Load notification prefs + current permission state once per room.
  useEffect(() => {
    setPrefs(loadPrefs(id));
    setPerm(notificationPermission());
    setPrefsLoaded(true);
  }, [id]);

  // Persist prefs whenever they change — only after the initial load,
  // so we don't clobber saved prefs with defaults on first render.
  useEffect(() => {
    if (!prefsLoaded) return;
    savePrefs(id, prefs);
  }, [id, prefs, prefsLoaded]);

  // Reset unread + title when the user looks at the tab again.
  useEffect(() => {
    function onVisible() {
      if (!document.hidden && document.hasFocus()) {
        setUnread(0);
        resetTitle();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // Flash the document title with the unread mention count.
  useEffect(() => {
    flashTitle(unread);
  }, [unread]);

  // Restore original title when leaving the room.
  useEffect(() => {
    return () => {
      resetTitle();
    };
  }, []);

  async function enableBrowserNotifications() {
    const result = await requestNotificationPermission();
    setPerm(result);
    if (result === "granted") setPrefs((p) => ({ ...p, toast: true }));
  }

  function updatePref<K extends keyof NotifyPrefs>(key: K, value: NotifyPrefs[K]) {
    setPrefs((p) => ({ ...p, [key]: value }));
    if (key === "toast" && value === true && perm === "default") {
      void enableBrowserNotifications();
    }
  }

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
          <button
            type="submit"
            disabled={joining || !name.trim() || !email.trim()}
            style={btnPrimary()}
          >
            {joining ? "Joining…" : "Join"}
          </button>
          {joinError && <p style={{ color: "crimson", margin: 0 }}>{joinError}</p>}
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
      {catchupOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 24,
              maxWidth: 520,
              width: "90%",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
              fontFamily: "system-ui, sans-serif",
              color: "var(--navy)",
            }}
          >
            <h2 style={{ margin: 0, marginBottom: 12, fontFamily: "Montserrat, sans-serif" }}>
              {catchupData?.kind === "orientation"
                ? `Welcome to ${state.name}`
                : "Catch up"}
            </h2>

            {catchupLoading && (
              <p style={{ marginTop: 0 }}>
                Generating summary — please wait a few seconds. The
                <strong> Got it</strong> button will activate once it's ready.
              </p>
            )}

            {!catchupLoading && catchupData?.kind === "orientation" && (
              <>
                <p style={{ marginTop: 0 }}>
                  You're the first one here — no discussion yet.
                </p>
                {catchupData.files.length > 0 && (
                  <>
                    <strong>Files already shared:</strong>
                    <ul>
                      {catchupData.files.map((f) => (
                        <li key={f.id}>{f.name}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p>Go ahead and say hi to kick it off.</p>
              </>
            )}

            {!catchupLoading && catchupData?.kind === "summary" && (
              <>
                <ul style={{ paddingLeft: 20 }}>
                  {catchupData.bullets.map((b, i) => (
                    <li key={i} style={{ marginBottom: 8 }}>
                      {b}
                    </li>
                  ))}
                  {catchupData.bullets.length === 0 && (
                    <li>Nothing notable yet — scroll up to read along.</li>
                  )}
                </ul>
                <PinnedFactsBlock facts={catchupData.pinnedFacts} />
              </>
            )}

            {!catchupLoading && catchupData?.kind === "error" && (
              <p>Couldn't generate a summary — scroll up to see the conversation.</p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                onClick={() => setCatchupOpen(false)}
                disabled={catchupLoading}
                style={{
                  ...btnSecondary(),
                  opacity: catchupLoading ? 0.5 : 1,
                  cursor: catchupLoading ? "not-allowed" : "pointer",
                }}
              >
                {catchupLoading ? "Waiting for summary…" : "Got it"}
              </button>
            </div>
          </div>
        </div>
      )}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 20px",
          background: "var(--navy)",
          color: "white",
          position: "relative",
        }}
      >
        <div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>MindForum</div>
          <div style={{ fontFamily: "Montserrat, sans-serif", fontSize: 20 }}>{state.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Notification settings"
            aria-expanded={settingsOpen}
            title="Notification settings"
            style={{
              ...btnSecondary(),
              background: "rgba(255,255,255,0.12)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>Alerts</span>
            {unread > 0 && (
              <span
                style={{
                  background: "var(--orange)",
                  color: "white",
                  borderRadius: 999,
                  padding: "1px 7px",
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 1.4,
                }}
              >
                {unread}
              </span>
            )}
          </button>
          <button onClick={copyLink} style={{ ...btnSecondary(), background: "var(--orange)" }}>
            Copy link
          </button>
          {settingsOpen && (
            <NotifySettingsPopover
              prefs={prefs}
              perm={perm}
              onChange={updatePref}
              onEnable={enableBrowserNotifications}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
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
            {state.systemPrompt && <GuidanceCard text={state.systemPrompt} />}
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
                  <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
                    <div
                      aria-hidden="true"
                      style={{
                        ...inp(),
                        flex: undefined,
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        whiteSpace: "pre",
                        overflow: "hidden",
                        borderColor: "transparent",
                        background: "transparent",
                        color: "var(--text)",
                      }}
                    >
                      {renderInputMentions(draft)}
                    </div>
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Type a message. Start with @ai to ask the AI."
                      style={{
                        ...inp(),
                        width: "100%",
                        borderColor: aiMention ? "var(--orange)" : "var(--border)",
                        boxShadow: aiMention ? "0 0 0 3px rgba(232,74,39,0.15)" : "none",
                        outline: "none",
                        transition: "border-color 120ms, box-shadow 120ms",
                        background: "transparent",
                        color: draft ? "transparent" : undefined,
                        caretColor: "var(--text)",
                        position: "relative",
                      }}
                    />
                  </div>
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
          <div>
            <button onClick={generateBrief} disabled={briefPending} style={{ ...heroBtn(), width: "100%" }}>
              {briefPending ? "Generating…" : "✨ Generate project brief"}
            </button>
            <p
              style={{
                fontSize: 12,
                color: "var(--muted)",
                lineHeight: 1.4,
                margin: "8px 0 0",
              }}
            >
              Turns the conversation and any selected files into a structured brief — themes, outline, risks, next steps, suggested collaborators. Posts to the thread for everyone. Takes ~10–20s.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function GuidanceCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.length > 140 ? text.slice(0, 140) + "…" : text;
  return (
    <div
      style={{
        padding: "10px 12px",
        margin: "0 0 12px",
        background: "rgba(19,41,75,0.04)",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      <div style={{ color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>
        AI guidance for this room
      </div>
      <div style={{ whiteSpace: "pre-wrap" }}>{open ? text : preview}</div>
      {text.length > 140 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            marginTop: 4,
            background: "transparent",
            border: "none",
            color: "var(--navy)",
            fontWeight: 600,
            padding: 0,
            fontSize: 12,
          }}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
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
      <div
        style={
          isAi
            ? { /* markdown handles whitespace */ }
            : { whiteSpace: "pre-wrap" }
        }
        className={isAi ? "msg-md" : undefined}
      >
        {m.content ? (
          isAi ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents}
            >
              {m.content}
            </ReactMarkdown>
          ) : (
            renderWithMentions(m.content)
          )
        ) : isAi ? (
          <span style={{ color: "var(--muted)", fontStyle: "italic" }}>thinking…</span>
        ) : null}
      </div>
    </div>
  );
}

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p style={{ margin: "0 0 8px" }}>{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul style={{ margin: "0 0 8px", paddingLeft: 22 }}>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol style={{ margin: "0 0 8px", paddingLeft: 22 }}>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li style={{ margin: "2px 0" }}>{children}</li>
  ),
  code: ({
    inline,
    children,
  }: {
    inline?: boolean;
    children?: React.ReactNode;
  }) =>
    inline === false ? (
      <code>{children}</code>
    ) : (
      <code
        style={{
          background: "var(--border)",
          padding: "1px 5px",
          borderRadius: 3,
          fontSize: "0.92em",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {children}
      </code>
    ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre
      style={{
        background: "var(--border)",
        padding: 10,
        borderRadius: 6,
        overflowX: "auto",
        margin: "0 0 8px",
        fontSize: "0.9em",
      }}
    >
      {children}
    </pre>
  ),
  a: ({
    href,
    children,
  }: {
    href?: string;
    children?: React.ReactNode;
  }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "var(--orange)", textDecoration: "underline" }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote
      style={{
        borderLeft: "3px solid var(--border)",
        paddingLeft: 10,
        margin: "0 0 8px",
        color: "var(--muted)",
      }}
    >
      {children}
    </blockquote>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 style={{ margin: "10px 0 6px", fontSize: "1.05em" }}>{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h3 style={{ margin: "10px 0 6px", fontSize: "1.05em" }}>{children}</h3>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h4 style={{ margin: "8px 0 4px", fontSize: "1em" }}>{children}</h4>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <table
      style={{
        borderCollapse: "collapse",
        margin: "0 0 8px",
        fontSize: "0.95em",
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th
      style={{
        border: "1px solid var(--border)",
        padding: "4px 8px",
        textAlign: "left",
        background: "var(--card)",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td style={{ border: "1px solid var(--border)", padding: "4px 8px" }}>
      {children}
    </td>
  ),
};

// Color-only mention rendering for the live input mirror — no padding/background
// so glyph widths stay aligned with the underlying transparent <input>.
function renderInputMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /@[\w-]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const isAi = /^@ai$/i.test(match[0]);
    parts.push(
      <span
        key={`im-${i++}`}
        style={{ color: isAi ? "var(--orange)" : "var(--navy)", fontWeight: 600 }}
      >
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderWithMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /@[\w-]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const isAi = /^@ai$/i.test(match[0]);
    parts.push(
      <span
        key={`m-${i++}`}
        style={{
          background: isAi ? "var(--orange)" : "var(--navy)",
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

function briefToMarkdown(brief: BriefData, createdAt: number): string {
  const iso = new Date(createdAt).toISOString().slice(0, 19).replace("T", " ");
  const lines: string[] = [`# Project Brief`, ``, `_Generated ${iso} UTC_`, ``];
  if (brief.themes?.length) {
    lines.push(`## Themes`, ``);
    for (const t of brief.themes) lines.push(`- ${t}`);
    lines.push(``);
  }
  if (brief.outline?.length) {
    lines.push(`## Outline`, ``);
    for (const o of brief.outline) {
      lines.push(`### ${o.section}`, ``);
      for (const p of o.points ?? []) lines.push(`- ${p}`);
      lines.push(``);
    }
  }
  if (brief.risks?.length) {
    lines.push(`## Risks`, ``);
    for (const r of brief.risks) lines.push(`- ${r}`);
    lines.push(``);
  }
  if (brief.nextSteps?.length) {
    lines.push(`## Next steps`, ``);
    for (const n of brief.nextSteps) lines.push(`- ${n}`);
    lines.push(``);
  }
  if (brief.suggestedCollaborators?.length) {
    lines.push(`## Suggested collaborators`, ``);
    for (const c of brief.suggestedCollaborators) lines.push(`- ${c}`);
    lines.push(``);
  }
  return lines.join("\n");
}

function BriefView({ m }: { m: Msg }) {
  let brief: BriefData | null = null;
  try {
    brief = JSON.parse(m.content);
  } catch {
    return <MsgView m={{ ...m, kind: "chat", content: m.content }} />;
  }
  const download = () => {
    if (!brief) return;
    const md = briefToMarkdown(brief, m.createdAt);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date(m.createdAt).toISOString().slice(0, 10);
    a.href = url;
    a.download = `mindforum-brief-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
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
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontFamily: "Montserrat, sans-serif",
            color: "var(--navy)",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          Project Brief
        </div>
        <button
          type="button"
          onClick={download}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            color: "var(--navy)",
            fontWeight: 600,
          }}
        >
          ↓ Download .md
        </button>
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

function PinnedFactsBlock({
  facts,
}: {
  facts: { names: string[]; decisions: string[]; files: string[] };
}) {
  const hasAny =
    facts.names.length > 0 || facts.decisions.length > 0 || facts.files.length > 0;
  if (!hasAny) return null;
  const row = (label: string, items: string[]) =>
    items.length === 0 ? null : (
      <div style={{ marginTop: 6, fontSize: 13 }}>
        <span style={{ color: "var(--muted)", fontWeight: 600 }}>{label}: </span>
        {items.join(", ")}
      </div>
    );
  return (
    <div
      style={{
        marginTop: 14,
        padding: "10px 12px",
        background: "rgba(19,41,75,0.04)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--muted)",
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        Key references
      </div>
      {row("People", facts.names)}
      {row("Decisions", facts.decisions)}
      {row("Files", facts.files)}
    </div>
  );
}

function snippet(s: string, max = 140): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

function NotifySettingsPopover({
  prefs,
  perm,
  onChange,
  onEnable,
  onClose,
}: {
  prefs: NotifyPrefs;
  perm: NotificationPermission | "unsupported";
  onChange: <K extends keyof NotifyPrefs>(key: K, value: NotifyPrefs[K]) => void;
  onEnable: () => void;
  onClose: () => void;
}) {
  // Close on outside click.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    fontSize: 14,
    color: "var(--navy)",
    cursor: "pointer",
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        zIndex: 40,
        minWidth: 280,
        background: "white",
        color: "var(--navy)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        padding: 14,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Notifications</div>

      {perm === "unsupported" && (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          Browser notifications aren&apos;t supported here. Sound and tab-title alerts still work.
        </p>
      )}
      {perm === "default" && (
        <button
          type="button"
          onClick={onEnable}
          style={{
            ...btnSecondary(),
            background: "var(--orange)",
            width: "100%",
            marginBottom: 8,
            padding: "8px 12px",
            fontSize: 13,
          }}
        >
          Enable browser notifications
        </button>
      )}
      {perm === "denied" && (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          Browser notifications are blocked for this site. Update your browser&apos;s site
          settings to allow them.
        </p>
      )}

      <label style={row}>
        <input
          type="checkbox"
          checked={prefs.toast}
          disabled={perm === "unsupported" || perm === "denied"}
          onChange={(e) => onChange("toast", e.target.checked)}
        />
        <span>Browser notification on @mention</span>
      </label>
      <label style={row}>
        <input
          type="checkbox"
          checked={prefs.sound}
          onChange={(e) => onChange("sound", e.target.checked)}
        />
        <span>Sound on @mention</span>
      </label>
      <label style={row}>
        <input
          type="checkbox"
          checked={prefs.mentionAll}
          onChange={(e) => onChange("mentionAll", e.target.checked)}
        />
        <span>Notify on @all / @everyone</span>
      </label>
      <label style={row}>
        <input
          type="checkbox"
          checked={prefs.aiReplies}
          onChange={(e) => onChange("aiReplies", e.target.checked)}
        />
        <span>Notify when AI replies to me</span>
      </label>

      <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0", lineHeight: 1.4 }}>
        Alerts only fire when this tab is unfocused. The tab title shows an unread count
        until you come back.
      </p>
    </div>
  );
}
