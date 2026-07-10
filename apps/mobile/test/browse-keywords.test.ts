/**
 * Multi-keyword filter: comma-separated terms, AND semantics — e.g.
 * "158, élysées" must match a post whose text contains both "158" and
 * "élysées" (an address at house number 158; diacritics must match too).
 */
import { describe, it, expect } from 'vitest';
import { matchesKeywords } from '../src/browseFilter';

const POST = '158 rue de la convention, vaugirard → avenue des champs-élysées, paris';

describe('matchesKeywords', () => {
  it('the example: "158, élysées" matches the Paris post', () => {
    expect(matchesKeywords(POST, '158, élysées')).toBe(true);
  });

  it('AND semantics: every term must appear', () => {
    expect(matchesKeywords(POST, '158, marseille')).toBe(false);
    expect(matchesKeywords(POST, 'convention, vaugirard, 158')).toBe(true);
  });

  it('single keyword still works (no commas)', () => {
    expect(matchesKeywords(POST, 'élysées')).toBe(true);
    expect(matchesKeywords(POST, 'berlin')).toBe(false);
  });

  it('case-insensitive on both sides', () => {
    expect(matchesKeywords(POST.toUpperCase(), 'élysées, RUE de')).toBe(true);
  });

  it('whitespace around terms is ignored', () => {
    expect(matchesKeywords(POST, '  158 ,   élysées  ')).toBe(true);
  });

  it('empty / commas-only queries match everything', () => {
    expect(matchesKeywords(POST, '')).toBe(true);
    expect(matchesKeywords(POST, ' , ,, ')).toBe(true);
  });

  it('a trailing comma does not break the match', () => {
    expect(matchesKeywords(POST, '158,')).toBe(true);
  });
});
