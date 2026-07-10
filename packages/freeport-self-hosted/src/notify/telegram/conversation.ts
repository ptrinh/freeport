/**
 * Per-chat conversation state for guest posting + inline-button follow-ups.
 * In-memory (a lost prompt just means the user re-taps). Parsing is pure and
 * unit-tested; side effects (geocode, publish) happen in the command handler.
 */
export interface RideDraft {
  from: string;
  to: string;
  when?: string;   // raw text: "now", "18:30", "in 30m"
  payment?: string;
}

export type ConvState =
  | { kind: 'idle' }
  | { kind: 'awaiting_contact'; draft: RideDraft }   // first post needs a reachable contact
  | { kind: 'counter_amount'; sid: string }          // awaiting the counter price after tapping ↩️
  | { kind: 'confirm_export' }
  | { kind: 'confirm_forget' };

/**
 * Parse a `/ride` command body: `<from> -> <to> [at <time>] [for <price>]`.
 * Also accepts ` to ` as the separator. Returns null when from/to are missing.
 */
export function parseRide(body: string): RideDraft | null {
  let text = body.trim();
  if (!text) return null;
  let payment: string | undefined;
  const forMatch = text.match(/\s+for\s+(.+)$/i);
  if (forMatch) { payment = forMatch[1].trim(); text = text.slice(0, forMatch.index).trim(); }

  let when: string | undefined;
  const atMatch = text.match(/\s+(?:at|@)\s+(.+)$/i);
  if (atMatch) { when = atMatch[1].trim(); text = text.slice(0, atMatch.index).trim(); }

  const sep = text.match(/\s*(?:->|→|\bto\b)\s*/i);
  if (!sep) return null;
  const from = text.slice(0, sep.index).trim();
  const to = text.slice((sep.index ?? 0) + sep[0].length).trim();
  if (!from || !to) return null;
  return { from, to, when, payment };
}

/**
 * Turn a "when" phrase into an absolute [start, end] window (30-min slot).
 * Understands "now", "in Nm"/"in Nh", and "HH:MM" (today, or tomorrow if past).
 * Falls back to now → +30m. Server-local time; good enough for a ride ask.
 */
export function parseWhen(when: string | undefined, now = Date.now()): { start: number; end: number } {
  const base = Math.floor(now / 1000);
  const slot = (start: number) => ({ start, end: start + 30 * 60 });
  if (!when) return slot(base);
  const w = when.trim().toLowerCase();
  if (w === 'now' || w === 'asap') return slot(base);
  const rel = w.match(/^in\s+(\d+)\s*(m|min|mins|h|hr|hrs|hour|hours)$/);
  if (rel) { const n = Number(rel[1]); const mins = /^h/.test(rel[2]) ? n * 60 : n; return slot(base + mins * 60); }
  const hhmm = w.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const d = new Date(now); d.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0);
    let t = Math.floor(d.getTime() / 1000);
    if (t < base) t += 24 * 3600; // already past today → tomorrow
    return slot(t);
  }
  return slot(base);
}

/** Parse a counter reply ("60k", "SGD 25", "18:45") into terms fields. */
export function parseCounterReply(text: string, now = Date.now()): { payment?: string; window?: { start: number; end: number } } {
  const t = text.trim();
  const hhmm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) return { window: parseWhen(t, now) };
  return { payment: t };
}
