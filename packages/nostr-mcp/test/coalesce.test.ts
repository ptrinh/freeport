import { describe, it, expect } from 'vitest';
import { dmCoalesceDue } from '../src/notify/coalesce.js';

describe('dmCoalesceDue()', () => {
  const COOLDOWN = 30_000; // default DM_NOTIFY_COOLDOWN_SEC=30

  it('first push (no prior timestamp) is due', () => {
    expect(dmCoalesceDue(undefined, 1_000_000, COOLDOWN)).toBe(true);
  });

  it('a push within the cooldown window is suppressed', () => {
    const last = 1_000_000;
    expect(dmCoalesceDue(last, last + 1, COOLDOWN)).toBe(false);
    expect(dmCoalesceDue(last, last + COOLDOWN - 1, COOLDOWN)).toBe(false);
  });

  it('a push exactly at the cooldown boundary is due', () => {
    const last = 1_000_000;
    expect(dmCoalesceDue(last, last + COOLDOWN, COOLDOWN)).toBe(true);
  });

  it('a push after the cooldown window is due', () => {
    const last = 1_000_000;
    expect(dmCoalesceDue(last, last + COOLDOWN + 1, COOLDOWN)).toBe(true);
  });

  it('cooldownMs = 0 is always due', () => {
    expect(dmCoalesceDue(undefined, 1_000_000, 0)).toBe(true);
    expect(dmCoalesceDue(1_000_000, 1_000_000, 0)).toBe(true);
    expect(dmCoalesceDue(1_000_000, 1_000_001, 0)).toBe(true);
  });
});
