/**
 * Multi-keyword filter: comma-separated terms, AND semantics — the user's
 * example "158, Nẵng" must match a post whose text contains both "158" and
 * "Nẵng" (a Đà Nẵng address at house number 158).
 */
import { describe, it, expect } from 'vitest';
import { matchesKeywords } from '../src/browseFilter';

const POST = '158 đường quang trung, phường hải châu → đường nguyễn văn linh, thành phố đà nẵng';

describe('matchesKeywords', () => {
  it('the example: "158, Nẵng" matches the Đà Nẵng post', () => {
    expect(matchesKeywords(POST, '158, Nẵng')).toBe(true);
  });

  it('AND semantics: every term must appear', () => {
    expect(matchesKeywords(POST, '158, Hà Nội')).toBe(false);
    expect(matchesKeywords(POST, 'quang trung, hải châu, 158')).toBe(true);
  });

  it('single keyword still works (no commas)', () => {
    expect(matchesKeywords(POST, 'nẵng')).toBe(true);
    expect(matchesKeywords(POST, 'saigon')).toBe(false);
  });

  it('case-insensitive on both sides', () => {
    expect(matchesKeywords(POST.toUpperCase(), 'nẵng, QUANG trung')).toBe(true);
  });

  it('whitespace around terms is ignored', () => {
    expect(matchesKeywords(POST, '  158 ,   nẵng  ')).toBe(true);
  });

  it('empty / commas-only queries match everything', () => {
    expect(matchesKeywords(POST, '')).toBe(true);
    expect(matchesKeywords(POST, ' , ,, ')).toBe(true);
  });

  it('a trailing comma does not break the match', () => {
    expect(matchesKeywords(POST, '158,')).toBe(true);
  });
});
