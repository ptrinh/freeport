import { describe, it, expect } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import {
  buildIntentEvent,
  buildWithdrawEvent,
  parseIntentEvent,
  intentExpired,
  DEMO_MARKET,
  DEMO_SCHEMA,
  type Intent,
} from '../src/index.js';

const sk = generateSecretKey();

/**
 * Build a parsed intent we can later withdraw. Mirrors a live, in-window
 * addressable intent with a future expiration.
 */
function liveIntent(): Intent {
  const now = Math.floor(Date.now() / 1000);
  const ev = buildIntentEvent(
    {
      side: 'request',
      market: DEMO_MARKET,
      schema: DEMO_SCHEMA,
      title: 'Ride somewhere',
      payload: { seats: 1 },
      expiresAt: now + 86400,
    },
    sk,
  );
  const intent = parseIntentEvent(ev);
  expect(intent).not.toBeNull();
  return intent!;
}

/**
 * Build a tombstone (withdrawal republish under the same d-tag) with an
 * explicit expiration offset. Positive = future, zero/negative = born-expired.
 */
function tombstone(intent: Intent, expiresAtOffset: number): Intent {
  const now = Math.floor(Date.now() / 1000);
  const ev = buildIntentEvent(
    {
      side: intent.content.side,
      market: intent.content.market,
      schema: intent.content.schema,
      title: '(withdrawn)',
      payload: {},
      expiresAt: now + expiresAtOffset,
      d: intent.d,
      createdAt: now,
    },
    sk,
  );
  const parsed = parseIntentEvent(ev);
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe('born-expired withdrawal', () => {
  it('intentExpired() is true for an expiration at/in the past, false for the future', () => {
    const now = 1_000_000;
    const live = liveIntent();

    // Future expiration -> not expired.
    expect(intentExpired({ ...live, content: { ...live.content, expires_at: now + 3600 } }, now)).toBe(
      false,
    );
    // Exactly now -> expired (NIP-40 relays drop expiration <= now).
    expect(intentExpired({ ...live, content: { ...live.content, expires_at: now } }, now)).toBe(true);
    // In the past -> expired.
    expect(intentExpired({ ...live, content: { ...live.content, expires_at: now - 1 } }, now)).toBe(true);
  });

  it('a tombstone with a FUTURE expiration is parseable and NOT born-expired', () => {
    const intent = liveIntent();
    const t = tombstone(intent, 86400); // expires 1 day out
    // Same addressable identity -> replaces the original.
    expect(t.d).toBe(intent.d);
    // The fix: a future expiration means a NIP-40 relay will accept and keep
    // the tombstone, so it propagates and other users stop seeing the intent.
    expect(intentExpired(t)).toBe(false);
  });

  it('a tombstone built with expiresAt = now is born-expired (the bug)', () => {
    const intent = liveIntent();
    const t = tombstone(intent, 0); // expiration == now
    expect(t.d).toBe(intent.d);
    // A NIP-40-honoring relay rejects/instantly drops expiration <= now, so
    // this tombstone never propagates -- the filled intent stays visible.
    expect(intentExpired(t)).toBe(true);
  });

  it('a tombstone built with a past expiresAt is also born-expired', () => {
    const intent = liveIntent();
    const t = tombstone(intent, -60); // expiration 60s in the past
    expect(t.d).toBe(intent.d);
    expect(intentExpired(t)).toBe(true);
  });

  it('buildWithdrawEvent republishes under the same d-tag and is parseable', () => {
    const intent = liveIntent();
    const w = buildWithdrawEvent(intent, sk);
    // Withdrawal must target the same addressable coordinate to replace it.
    expect(w.tags.find((t) => t[0] === 'd')?.[1]).toBe(intent.d);
    const parsed = parseIntentEvent(w);
    expect(parsed).not.toBeNull();
    expect(parsed!.d).toBe(intent.d);
  });
});
