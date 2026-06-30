/**
 * Pure deal/negotiation helpers shared by the Messages UI. Kept out of App.tsx
 * so they are unit-testable without the React Native runtime.
 */
import type { Intent, Negotiation } from '@freeport/protocol';
import type { MobileClient } from './client';

/**
 * A negotiation is "done" (shown under Messages > Completed) when it was
 * cancelled/expired, or confirmed and the deal has completed.
 */
export function negoIsDone(n: Negotiation): boolean {
  if (n.state === 'cancelled' || n.state === 'expired') return true;
  if (n.state === 'confirmed') return n.stage === 'completed';
  return false;
}

/**
 * Which Messages sub-tab to open given new activity since `sinceTs`: the sub-tab
 * of the most recent UNREAD inbound chat message (or just-confirmed deal), or
 * null when nothing is newer than `sinceTs` — so a manual sub-tab choice stands.
 */
export function messagesViewForNewActivity(
  negos: Negotiation[],
  sinceTs: number,
): 'active' | 'completed' | null {
  let bestTs = sinceTs;
  let bestView: 'active' | 'completed' | null = null;
  for (const n of negos) {
    for (const m of n.messages ?? []) {
      if (m.dir === 'in' && m.ts > bestTs) { bestTs = m.ts; bestView = negoIsDone(n) ? 'completed' : 'active'; }
    }
    if (n.state === 'confirmed' && n.updatedAt > bestTs) { bestTs = n.updatedAt; bestView = negoIsDone(n) ? 'completed' : 'active'; }
  }
  return bestView;
}

/**
 * Lowercased haystack for keyword search over a post: title, author name, route
 * (from/to), service, location, notes, payment, category, subcategory.
 */
export function searchableText(i: Intent, client: MobileClient | null): string {
  const p = i.content.payload as Record<string, any>;
  const author = client?.profiles.get(i.pubkey)?.name ?? '';
  return [
    i.content.title, author, p.from?.name, p.to?.name, p.service,
    p.location?.name, p.notes, p.payment, p.category, p.subcategory,
  ].filter(Boolean).join(' ').toLowerCase();
}
