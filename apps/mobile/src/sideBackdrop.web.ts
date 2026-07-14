/**
 * On wide web screens the app is a centered ~480px column, leaving the
 * `appBg` margins blank. We fill them with a faint, tiled pattern of the app's
 * own iconography (rideshare car, location pin, chat bubble, karma star,
 * service tag).
 *
 * The arrangement is seeded by the account (its npub), so every account gets a
 * different — but stable and regenerable — scatter: each new account created on
 * the device reshuffles which icon sits in which slot and how each is rotated.
 *
 * Performance: this is a SINGLE static CSS rule with an inline-SVG data-URI
 * background — the browser tiles and GPU-composites it once. No DOM nodes per
 * tile, no JS on scroll/render, no images to fetch. Cost is effectively zero
 * while the app runs; we only re-emit the rule when the theme colour or the
 * account seed changes.
 */

// FNV-1a → uint32, then mulberry32 PRNG. Deterministic per seed string, so the
// same account always renders the same pattern.
function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  const s = seed || 'freeport';
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One 160×160 tile of line-art app icons placed in fixed slots. Each account's
// seed both PICKS which icons appear (a random subset of the full app icon set,
// not a fixed five) and permutes their slots + rotations. Stroke-only (no fill);
// kept geometric and tiny so the encoded URI stays small.
const ICON_PATHS = [
  // car
  'M2 22 l4-11 a4 4 0 0 1 4-3 h20 a4 4 0 0 1 4 3 l4 11 v7 h-5 a5 5 0 0 0-10 0 h-11 a5 5 0 0 0-10 0 h-5 z',
  // pin
  'M14 2 a10 10 0 0 1 10 10 c0 8-10 19-10 19 S4 20 4 12 A10 10 0 0 1 14 2 z',
  // chat
  'M2 6 h30 a4 4 0 0 1 4 4 v13 a4 4 0 0 1-4 4 H16 l-9 7 v-7 a4 4 0 0 1-4-4 V10 a4 4 0 0 1 4-4 z',
  // tag
  'M2 2 h15 l16 16-15 15-16-16 z',
  // star
  'M16 2 l4 9 10 1-7.5 6.5 2.5 10-9-5-9 5 2.5-10L2 12 l10-1 z',
  // banknote (payment)
  'M2 8 h28 v16 H2 z M16 12 a4 4 0 1 0 0.01 0 z',
  // clock (time)
  'M16 4 a12 12 0 1 0 0.01 0 z M16 8 v8 l6 4',
  // mic (voice memo)
  'M16 3 a4 4 0 0 1 4 4 v6 a4 4 0 0 1-8 0 V7 a4 4 0 0 1 4-4 z M8 13 a8 8 0 0 0 16 0 M16 21 v7 M11 28 h10',
  // search (filter)
  'M14 4 a9 9 0 1 0 0.01 0 z M21 21 l8 8',
  // key (identity)
  'M11 10 a6 6 0 1 0 0.01 0 z M15 14 l13 13 M24 23 l3 3 M28 27 l3-3',
  // bolt (crypto)
  'M18 2 L6 18 h8 l-2 12 L26 14 h-8 z',
  // wrench (services)
  'M28 5 a6 6 0 0 1-8 8 L5 28 l-1-1 L19 12 a6 6 0 0 1 9-7 z',
  // heart (karma/like)
  'M16 28 C4 18 2 10 8 6 c4-3 8 1 8 4 c0-3 4-7 8-4 c6 4 4 12-8 22 z',
];

function tileSvg(stroke: string, seed: string): string {
  // Fixed slots (so spacing stays even when tiled); the icon→slot mapping and
  // which icons get drawn are what the seed varies.
  const slots = [[8, 18], [108, 12], [10, 104], [110, 108], [64, 62], [60, 8]];

  const rnd = seededRandom(seed);
  // Seeded Fisher–Yates over the WHOLE icon set, then take the first N for the
  // slots — so each account shows a different random subset of all app icons.
  const order = ICON_PATHS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const paths = slots
    .map(([x, y], slot) => {
      const d = ICON_PATHS[order[slot % order.length]];
      const rot = Math.floor(rnd() * 4) * 90; // 0/90/180/270 around the icon's ~centre
      return `<g transform="translate(${x} ${y}) rotate(${rot} 16 16)"><path d="${d}"/></g>`;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" ` +
    `fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">` +
    `${paths}</svg>`
  );
}

const STYLE_ID = 'freeport-side-backdrop';

/**
 * Apply (or re-theme/re-seed) the tiled side background. `stroke` is a faint
 * colour; `seed` (the account npub) varies the icon arrangement per account.
 */
export function applySideBackdrop(stroke: string, seed = ''): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  const uri = `data:image/svg+xml,${encodeURIComponent(tileSvg(stroke, seed))}`;
  // Targets the appShell (nativeID="freeport-shell" → DOM id). The centred
  // column has its own opaque bg on top, so the pattern only shows in the
  // blank side margins.
  // Both the main shell AND full-screen modals (chat window) — RN-web Modals
  // portal OUTSIDE #freeport-shell, which lost the pattern (user report).
  el.textContent = `#freeport-shell,#freeport-shell-modal{background-image:url("${uri}");background-repeat:repeat;background-position:center top;}`;
}
