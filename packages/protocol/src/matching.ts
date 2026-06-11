import { geohashNear } from './geohash.js';
import type { Intent, ProposedTerms, RidesharePayload, TimeWindow } from './types.js';

/**
 * A standing rule from the agent owner's local config, e.g.
 * "I drive Orchard→Hougang weekdays 15:00–18:00, ±30min".
 *
 * Rules describe what WE can provide or want; the matcher pairs them with
 * OPPOSING intents seen in the market (our offer ↔ their request).
 */
export interface MatchRule {
  schema: string; // e.g. "rideshare/1"
  side: 'offer' | 'request'; // our side
  market: string;
  /** rideshare/1 fields */
  route?: { from_geohash: string; to_geohash: string };
  /** Local-time daily window, "HH:MM". Compared in the agent's timezone. */
  daily_window?: { start: string; end: string };
  days?: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[];
  flex_minutes?: number;
  price?: string;
  /** If true, agent may seal the deal without human confirmation. */
  auto_accept?: boolean;
  contact: string;
  /** Geohash prefix length that counts as "near" (default 5 ≈ 2.4km). */
  proximity?: number;
}

export interface MatchResult {
  matched: boolean;
  /** If terms differ from the intent's ask (e.g. shifted time), the counter to send. */
  counterTerms?: ProposedTerms;
  /** True when intent terms are acceptable as-is. */
  acceptAsIs?: boolean;
  reason?: string;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** Convert a rule's daily window to an absolute window on the intent's day. */
export function ruleWindowOn(date: Date, rule: MatchRule): TimeWindow | null {
  if (!rule.daily_window) return null;
  const day = DAY_KEYS[date.getDay()];
  if (rule.days && !rule.days.includes(day as any)) return null;
  const base = new Date(date);
  base.setHours(0, 0, 0, 0);
  const startMin = parseHHMM(rule.daily_window.start);
  const endMin = parseHHMM(rule.daily_window.end);
  return {
    start: Math.floor(base.getTime() / 1000) + startMin * 60,
    end: Math.floor(base.getTime() / 1000) + endMin * 60,
  };
}

function windowsOverlap(a: TimeWindow, b: TimeWindow, slackSec = 0): boolean {
  return a.start - slackSec <= b.end && b.start - slackSec <= a.end;
}

/** Clamp the intent's window into ours; returns the overlap or nearest feasible slot. */
function reconcileWindows(theirs: TimeWindow, ours: TimeWindow, flexSec: number): TimeWindow | null {
  const start = Math.max(theirs.start, ours.start);
  const end = Math.min(theirs.end, ours.end);
  if (start <= end) {
    // Keep the asked duration if the overlap collapsed to (nearly) a point.
    const duration = theirs.end - theirs.start;
    return { start, end: Math.max(end, Math.min(start + duration, ours.end)) };
  }
  // No overlap — see if shifting within flex makes it work.
  if (theirs.end < ours.start && ours.start - theirs.end <= flexSec) {
    return { start: ours.start, end: Math.min(ours.start + 30 * 60, ours.end) };
  }
  if (ours.end < theirs.start && theirs.start - ours.end <= flexSec) {
    return { start: Math.max(ours.end - 30 * 60, ours.start), end: ours.end };
  }
  return null;
}

/**
 * Match an incoming intent against one of our rules.
 * Generic checks (market, schema, side, expiry) then vertical-specific logic.
 */
export function matchIntent(intent: Intent, rule: MatchRule, nowSec = Math.floor(Date.now() / 1000)): MatchResult {
  const c = intent.content;
  if (c.market !== rule.market) return { matched: false, reason: 'market mismatch' };
  if (c.schema !== rule.schema) return { matched: false, reason: 'schema mismatch' };
  if (c.side === rule.side) return { matched: false, reason: 'same side' };
  if (c.expires_at <= nowSec) return { matched: false, reason: 'expired' };

  if (rule.schema.startsWith('rideshare/')) return matchRideshare(intent, rule);

  // Generic fallback: market+schema+side matched, no vertical logic → surface to human.
  return { matched: true, acceptAsIs: true, reason: 'generic match (no vertical matcher)' };
}

function matchRideshare(intent: Intent, rule: MatchRule): MatchResult {
  const p = intent.content.payload as RidesharePayload;
  if (!p.from?.geohash || !p.to?.geohash) return { matched: false, reason: 'missing route' };
  if (rule.route) {
    const prox = rule.proximity ?? 5;
    if (!geohashNear(p.from.geohash, rule.route.from_geohash, prox))
      return { matched: false, reason: 'origin too far' };
    if (!geohashNear(p.to.geohash, rule.route.to_geohash, prox))
      return { matched: false, reason: 'destination too far' };
  }

  const theirWindow = intent.content.window;
  if (!theirWindow) return { matched: true, acceptAsIs: true };

  const ourWindow = ruleWindowOn(new Date(theirWindow.start * 1000), rule);
  if (!ourWindow) return { matched: false, reason: 'outside our schedule (day)' };

  const flexSec =
    Math.max(rule.flex_minutes ?? 0, intent.content.flex_minutes ?? 0) * 60;
  if (windowsOverlap(theirWindow, ourWindow)) {
    const overlap = reconcileWindows(theirWindow, ourWindow, 0)!;
    // Their ask fits inside our schedule entirely → accept as-is.
    if (overlap.start === theirWindow.start && overlap.end === theirWindow.end) {
      return { matched: true, acceptAsIs: true };
    }
    return {
      matched: true,
      counterTerms: { window: overlap, price: rule.price, note: 'adjusted to my schedule' },
    };
  }

  const shifted = reconcileWindows(theirWindow, ourWindow, flexSec);
  if (shifted) {
    return {
      matched: true,
      counterTerms: { window: shifted, price: rule.price, note: 'time shifted within flexibility' },
    };
  }
  return { matched: false, reason: 'no time overlap within flexibility' };
}
