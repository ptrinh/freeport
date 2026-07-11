import { describe, it, expect } from 'vitest';
import { randomUsername, USERNAME_RE } from '../src/wallet/username';

describe('randomUsername (auto-claim)', () => {
  it('always satisfies the claim regex', () => {
    for (let i = 0; i < 200; i++) expect(randomUsername()).toMatch(USERNAME_RE);
  });

  it('is deterministic under a seeded rng and shaped adjective+noun+4digits', () => {
    let n = 0;
    const rng = () => ((n += 0.37) % 1);
    const u = randomUsername(rng);
    expect(u).toBe(randomUsername((() => { let m = 0; return () => ((m += 0.37) % 1); })()));
    expect(u).toMatch(/^[a-z]+\d{4}$/);
  });

  it('varies across calls', () => {
    expect(new Set(Array.from({ length: 50 }, () => randomUsername())).size).toBeGreaterThan(10);
  });
});
