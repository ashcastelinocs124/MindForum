// Client-side @-mention awareness helpers for the room page.
// Pure browser APIs — safe to import only into client components.

export type NotifyPrefs = {
  toast: boolean;
  sound: boolean;
  mentionAll: boolean;
  aiReplies: boolean;
  reactions: boolean;
};

export const DEFAULT_PREFS: NotifyPrefs = {
  toast: true,
  sound: false,
  mentionAll: true,
  aiReplies: false,
  reactions: false,
};

const PREFS_KEY = (roomId: string) => `mindforum_notify_prefs_${roomId}`;

export function loadPrefs(roomId: string): NotifyPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY(roomId));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(roomId: string, prefs: NotifyPrefs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREFS_KEY(roomId), JSON.stringify(prefs));
  } catch {}
}

export type MentionMatch =
  | { kind: "direct"; matched: string }
  | { kind: "all" }
  | { kind: "ai-reply" }
  | null;

// Build a list of name tokens to match: full name + first name (sans trailing punctuation).
function nameTokens(fullName: string): string[] {
  const trimmed = fullName.trim();
  if (!trimmed) return [];
  const tokens = new Set<string>();
  tokens.add(trimmed);
  const firstRaw = trimmed.split(/\s+/)[0] ?? "";
  const first = firstRaw.replace(/[.,;:!?]+$/, "");
  if (first && first !== trimmed && first.length >= 2) tokens.add(first);
  return [...tokens];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesMention(
  text: string,
  userName: string,
  opts: { mentionAll: boolean }
): MentionMatch {
  if (!text) return null;

  if (opts.mentionAll && /@(all|everyone)\b/i.test(text)) {
    return { kind: "all" };
  }

  for (const token of nameTokens(userName)) {
    const re = new RegExp(`@${escapeRegex(token)}\\b`, "i");
    if (re.test(text)) return { kind: "direct", matched: token };
  }

  return null;
}

// --- Title flash ---

let originalTitle: string | null = null;

function captureBaseTitle() {
  if (originalTitle === null) {
    originalTitle = document.title.replace(/^\(\d+\)\s*/, "");
  }
}

export function flashTitle(count: number) {
  if (typeof document === "undefined") return;
  captureBaseTitle();
  if (count <= 0) {
    document.title = originalTitle ?? document.title;
    return;
  }
  document.title = `(${count}) ${originalTitle}`;
}

export function resetTitle() {
  if (typeof document === "undefined") return;
  if (originalTitle !== null) document.title = originalTitle;
}

// --- Browser toast (Notification API) ---

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

let lastToastAt = 0;
const TOAST_DEBOUNCE_MS = 3000;

export function showToast(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const now = Date.now();
  if (now - lastToastAt < TOAST_DEBOUNCE_MS) return;
  lastToastAt = now;
  try {
    const n = new Notification(title, { body, tag: "mindforum-mention" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {}
}

// --- Sound ping (Web Audio synthesized) ---

let lastPingAt = 0;
const PING_DEBOUNCE_MS = 1500;

export function playPing() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastPingAt < PING_DEBOUNCE_MS) return;
  lastPingAt = now;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.start();
    o.stop(ctx.currentTime + 0.3);
    o.onended = () => ctx.close().catch(() => {});
  } catch {}
}
