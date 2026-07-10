import { describe, it, expect } from 'vitest';
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';
import { buildIntentEvent, DEMO_MARKET, DEMO_SCHEMA } from '@freeport/protocol';
import { validatePreSigned } from '../src/write.js';

const sk = generateSecretKey();
const now = () => Math.floor(Date.now() / 1000);

function signedIntent(overrides: Partial<{ expiresAt: number; createdAt: number; content: string; tags: string[][] }> = {}) {
  const tmpl = buildIntentEvent(
    {
      side: 'offer',
      market: DEMO_MARKET,
      schema: DEMO_SCHEMA,
      title: 'Ride offer',
      payload: { seats: 2 },
      expiresAt: overrides.expiresAt ?? now() + 3600,
      createdAt: overrides.createdAt,
    },
    sk,
  );
  if (overrides.content !== undefined) tmpl.content = overrides.content;
  if (overrides.tags !== undefined) tmpl.tags = overrides.tags;
  return finalizeEvent({ kind: tmpl.kind, created_at: tmpl.created_at, tags: tmpl.tags, content: tmpl.content }, sk);
}

describe('validatePreSigned', () => {
  it('accepts a well-formed intent with a bounded expiry', () => {
    expect(validatePreSigned(signedIntent())).toBeNull();
  });

  it('rejects an expiry beyond the configured maximum', () => {
    const ev = signedIntent({ expiresAt: now() + 10 * 365 * 24 * 3600 }); // 10 years
    expect(validatePreSigned(ev)).toMatch(/exceeds/);
  });

  it('rejects an already-expired event', () => {
    const ev = signedIntent({ expiresAt: now() - 60 });
    expect(validatePreSigned(ev)).toMatch(/expired/);
  });

  it('rejects a missing expiration tag', () => {
    const base = signedIntent();
    const ev = finalizeEvent(
      { kind: base.kind, created_at: base.created_at, tags: base.tags.filter((t) => t[0] !== 'expiration'), content: base.content },
      sk,
    );
    expect(validatePreSigned(ev)).toMatch(/expiration/);
  });

  it('rejects arbitrary non-intent content', () => {
    const ev = signedIntent({ content: 'spam spam spam' });
    expect(validatePreSigned(ev)).toMatch(/not a valid Freeport intent/);
  });

  it('rejects a far-future created_at', () => {
    const ev = signedIntent({ createdAt: now() + 24 * 3600 });
    expect(validatePreSigned(ev)).toMatch(/future/);
  });

  it('rejects an oversized event', () => {
    const ev = signedIntent({ content: JSON.stringify({ v: 1, side: 'offer', market: DEMO_MARKET, schema: DEMO_SCHEMA, title: 'x', payload: { blob: 'x'.repeat(70 * 1024) }, expires_at: now() + 3600 }) });
    expect(validatePreSigned(ev)).toMatch(/too large/);
  });
});
