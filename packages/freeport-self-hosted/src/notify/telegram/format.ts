/**
 * HTML message formatting for the group feed. Telegram HTML parse_mode needs
 * only & < > escaped (far simpler than MarkdownV2). Cards stay compact: title,
 * side, time window, payment, distance, and one deep-link button.
 */
import type { Event } from 'nostr-tools';
import { parseIntentEvent, KIND_INTENT_OFFER } from '@freeport/protocol';
import { haversineKm, eventGeohash } from '../match.js';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtWindow(w?: { start: number; end: number }): string | null {
  if (!w) return null;
  const d = new Date(w.start * 1000);
  // Content-blind of timezone; show the poster's UTC-ish local via toLocale on the server.
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const t0 = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const t1 = new Date(w.end * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${t0}–${t1}`;
}

/**
 * Render an intent event as a group card, or null when it isn't a valid intent.
 * `near` (a watch's radius center) adds a distance line when the intent is geotagged.
 */
export function intentCard(
  ev: Event,
  webBase: string,
  near?: { lat: number; lon: number },
): { text: string; button: { text: string; url: string } } | null {
  const intent = parseIntentEvent(ev);
  if (!intent) return null;
  const c = intent.content;
  const payload = c.payload as { from?: { name?: string }; to?: { name?: string }; location?: { name?: string }; service?: string; payment?: string; pax?: number; when?: string; [k: string]: unknown };
  if (!payload || Object.keys(payload).length === 0) return null; // withdrawn tombstone — no card
  const offer = ev.kind === KIND_INTENT_OFFER;

  const lines: string[] = [];
  lines.push(`${offer ? '🟢 <b>Offer</b>' : '🔵 <b>Request</b>'} — ${esc((c.title || '').slice(0, 100))}`);
  const win = fmtWindow(c.window);
  const meta: string[] = [];
  if (win) meta.push(`🕒 ${esc(win)}`);
  if (payload.seats) meta.push(`👤 ${payload.seats}`);
  if (typeof payload.payment === 'string' && payload.payment.trim()) meta.push(`💰 ${esc(payload.payment.trim())}`);
  if (meta.length) lines.push(meta.join(' · '));

  const gh = eventGeohash(ev);
  if (near && gh) {
    const km = haversineKm(near.lat, near.lon, gh);
    if (km !== null) lines.push(`📍 ~${km < 1 ? '<1' : Math.round(km)} km away`);
  }

  return {
    text: lines.join('\n'),
    button: { text: offer ? 'Respond in Freeport' : 'Offer a ride in Freeport', url: `${webBase}/?tab=browse` },
  };
}

/** The strikethrough edit shown when a listing is withdrawn/filled. */
export function withdrawnCard(originalTitle: string): string {
  return `<s>${esc(originalTitle.slice(0, 100))}</s>\n— no longer available`;
}
