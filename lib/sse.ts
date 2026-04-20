type Writer = WritableStreamDefaultWriter<Uint8Array>;

const g = globalThis as unknown as { __mindforumSubs?: Map<string, Set<Writer>> };
const subs: Map<string, Set<Writer>> = g.__mindforumSubs ?? new Map();
g.__mindforumSubs = subs;

const encoder = new TextEncoder();

export function subscribe(roomId: string, writer: Writer) {
  let set = subs.get(roomId);
  if (!set) {
    set = new Set();
    subs.set(roomId, set);
  }
  set.add(writer);
}

export function unsubscribe(roomId: string, writer: Writer) {
  const set = subs.get(roomId);
  if (!set) return;
  set.delete(writer);
  if (set.size === 0) subs.delete(roomId);
}

export function broadcast(roomId: string, event: string, data: unknown) {
  const set = subs.get(roomId);
  if (!set) return;
  const payload = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const w of set) {
    w.write(payload).catch(() => {
      try { set.delete(w); } catch {}
    });
  }
}
