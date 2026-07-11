/**
 * Random lightning-address usernames ("swiftfalcon2204") for the glow-style
 * auto-claim: the wallet registers one silently on first Receive open, and
 * the user can Edit it later. Word pools are short, friendly and ASCII so
 * every result passes the claim regex (^[a-z0-9][a-z0-9._-]{1,30}$).
 */
const ADJECTIVES = [
  'swift', 'brave', 'calm', 'lucky', 'sunny', 'cosmic', 'free', 'wild',
  'noble', 'rapid', 'quiet', 'bright', 'bold', 'keen', 'true', 'happy',
  'golden', 'silver', 'crimson', 'azure', 'emerald', 'amber', 'coral', 'ivory',
];
const NOUNS = [
  'falcon', 'otter', 'tiger', 'eagle', 'whale', 'fox', 'lynx', 'panda',
  'raven', 'wolf', 'heron', 'gecko', 'bison', 'moose', 'crane', 'finch',
  'harbor', 'summit', 'river', 'meadow', 'canyon', 'lagoon', 'breeze', 'ember',
];

export function randomUsername(rng: () => number = Math.random): string {
  const pick = (arr: string[]) => arr[Math.floor(rng() * arr.length) % arr.length];
  const digits = String(Math.floor(rng() * 10_000)).padStart(4, '0');
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${digits}`;
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}$/;
