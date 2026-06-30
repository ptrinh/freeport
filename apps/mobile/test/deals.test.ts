import { describe, it, expect } from 'vitest';
import { negoIsDone, messagesViewForNewActivity, searchableText } from '../src/deals';

const nego = (o: Record<string, unknown> = {}): any => ({ state: 'open', stage: undefined, messages: [], updatedAt: 0, ...o });

describe('negoIsDone', () => {
  it('cancelled/expired are done', () => {
    expect(negoIsDone(nego({ state: 'cancelled' }))).toBe(true);
    expect(negoIsDone(nego({ state: 'expired' }))).toBe(true);
  });
  it('confirmed is done only once the deal stage is completed', () => {
    expect(negoIsDone(nego({ state: 'confirmed', stage: 'completed' }))).toBe(true);
    expect(negoIsDone(nego({ state: 'confirmed', stage: 'picked_up' }))).toBe(false);
    expect(negoIsDone(nego({ state: 'confirmed' }))).toBe(false);
  });
  it('open negotiations are active', () => {
    expect(negoIsDone(nego({ state: 'open' }))).toBe(false);
  });
});

describe('messagesViewForNewActivity (Messages sub-tab auto-select)', () => {
  it('returns null when nothing is newer than sinceTs (keeps a manual choice)', () => {
    const n = nego({ state: 'open', messages: [{ dir: 'in', ts: 100 }] });
    expect(messagesViewForNewActivity([n], 100)).toBeNull(); // ts not strictly newer
    expect(messagesViewForNewActivity([n], 200)).toBeNull();
  });
  it('opens Active for a new message on an active deal', () => {
    const n = nego({ state: 'confirmed', stage: 'picked_up', messages: [{ dir: 'in', ts: 150 }] });
    expect(messagesViewForNewActivity([n], 100)).toBe('active');
  });
  it('opens Completed for a new message on a completed deal', () => {
    const n = nego({ state: 'confirmed', stage: 'completed', messages: [{ dir: 'in', ts: 150 }] });
    expect(messagesViewForNewActivity([n], 100)).toBe('completed');
  });
  it('follows the most recent unread message across deals', () => {
    const active = nego({ state: 'open', messages: [{ dir: 'in', ts: 120 }] });
    const completed = nego({ state: 'cancelled', messages: [{ dir: 'in', ts: 180 }] });
    expect(messagesViewForNewActivity([active, completed], 100)).toBe('completed');
  });
  it('ignores outbound messages', () => {
    const n = nego({ state: 'open', messages: [{ dir: 'out', ts: 200 }] });
    expect(messagesViewForNewActivity([n], 100)).toBeNull();
  });
  it('treats a freshly confirmed deal (no chat) as active activity', () => {
    const n = nego({ state: 'confirmed', updatedAt: 150, messages: [] });
    expect(messagesViewForNewActivity([n], 100)).toBe('active');
  });
});

describe('searchableText (Completed-tab keyword filter)', () => {
  const intent = (payload: Record<string, unknown>, title = 'Ride'): any => ({ pubkey: 'p', content: { title, payload } });
  it('indexes category, subcategory, route, payment, and notes (lowercased)', () => {
    const t = searchableText(intent({
      from: { name: 'Orchard' }, to: { name: 'Hougang' }, payment: 'S$5.50',
      category: 'Ridesharing', subcategory: 'Compact Car', notes: 'two bags',
    }), null);
    for (const term of ['orchard', 'hougang', 's$5.50', 'ridesharing', 'compact car', 'two bags']) {
      expect(t).toContain(term);
    }
  });
  it('is case-insensitive (matches a Plumbing service via "plumbing")', () => {
    expect(searchableText(intent({ service: 'Plumbing' }), null)).toContain('plumbing');
  });
});
