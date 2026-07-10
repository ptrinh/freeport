/**
 * Parser for organic "hitcher" posts that groups like SGP Hitch (69k members)
 * already use, e.g.:
 *
 *   👋 Hitcher looking for driver 🚗
 *   Pick up: 730336
 *   Drop off: Tanjong Pagar plaza
 *   Date: today
 *   Time: now
 *   Pax: 1
 *   pls pm me, thank you!
 *
 * A parse hit lets the bot offer a one-tap "broadcast to Freeport" button that
 * deep-links to the web post form, prefilled — turning a group-only shout into
 * a Freeport intent that reaches drivers beyond the group. Deliberately lenient:
 * emoji, casing and label variants ("Pickup", "From:", "Destination:") all pass.
 */
export interface ParsedHitch {
  from: string;
  to: string;
  when?: string;   // free text: "now", "today 6pm", …
  pax?: number;
}

const FIELD = (labels: string[]) =>
  new RegExp(`^\\s*(?:${labels.join('|')})\\s*[:\\-]\\s*(.+?)\\s*$`, 'im');

const FROM = FIELD(['pick\\s*up', 'pickup', 'from', 'pick up point', 'pu']);
const TO = FIELD(['drop\\s*off', 'dropoff', 'to', 'destination', 'dest', 'do']);
const WHEN = FIELD(['time', 'when', 'timing']);
const PAX = FIELD(['pax', 'passengers?', 'seats?']);

/** Extract a ride request from free text, or null when it isn't one. */
export function parseHitch(text: string): ParsedHitch | null {
  if (!text) return null;
  const from = FROM.exec(text)?.[1]?.trim();
  const to = TO.exec(text)?.[1]?.trim();
  if (!from || !to) return null; // both endpoints are required to be useful
  const when = WHEN.exec(text)?.[1]?.trim();
  const paxRaw = PAX.exec(text)?.[1]?.trim();
  const pax = paxRaw ? parseInt(paxRaw.replace(/\D.*$/, ''), 10) || undefined : undefined;
  return { from, to, when: when || undefined, pax };
}

/** Build the prefilled web post-form URL for a parsed hitch. */
export function broadcastUrl(webBase: string, p: ParsedHitch): string {
  const q = new URLSearchParams({ tab: 'post', from: p.from, to: p.to });
  if (p.when) q.set('when', p.when);
  if (p.pax) q.set('pax', String(p.pax));
  return `${webBase}/?${q.toString()}`;
}
