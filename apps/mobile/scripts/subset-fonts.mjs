#!/usr/bin/env node
/**
 * Subset the icon fonts in an `expo export --platform web` dist to just the
 * glyphs the app can actually render — the full sets are ~1.7 MB and the app
 * uses a few dozen icons, so every first-time web visitor downloads ~97% dead
 * glyphs. Files are rewritten IN PLACE (same hashed filename the bundle
 * references), still TrueType so nothing else changes.
 *
 * Used glyph names are collected as every string literal in the app source
 * that is a key of the icon set's glyphmap. Over-inclusive by design (any
 * word that happens to be a glyph name is kept — each glyph is tiny) and it
 * covers icons chosen via data tables (SORT_ICON, categoryIcon()…), since
 * those are string literals somewhere in the source. A minimum-count guard
 * fails the build if the scan ever breaks, rather than shipping tofu icons.
 *
 * Usage: node scripts/subset-fonts.mjs [distDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

export const FONT_STEMS = ['Ionicons', 'MaterialCommunityIcons'];
// If the literal scan ever finds fewer than this many glyphs, something broke
// (moved sources, renamed glyphmaps) — fail loudly instead of shipping tofu.
const MIN_GLYPHS = 50;

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function findFiles(dir, pred, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, pred, acc);
    else if (pred(p)) acc.push(p);
  }
  return acc;
}

/** All string literals in the app source (App.tsx + src/**). */
function sourceLiterals(root) {
  const files = [
    path.join(root, 'App.tsx'),
    ...findFiles(path.join(root, 'src'), (p) => /\.(ts|tsx)$/.test(p)),
  ];
  const literals = new Set();
  const litRe = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const m of txt.matchAll(litRe)) literals.add(m[2]);
  }
  return literals;
}

/** The subset text (one char per used glyph) for an icon set. */
export function usedGlyphText(stem, root = appRoot) {
  const glyphmapsDir = path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps');
  const glyphmap = JSON.parse(fs.readFileSync(path.join(glyphmapsDir, `${stem}.json`), 'utf8'));
  const literals = sourceLiterals(root);
  const used = Object.keys(glyphmap).filter((name) => literals.has(name));
  if (used.length < MIN_GLYPHS) {
    throw new Error(`subset-fonts: only ${used.length} ${stem} glyphs found — the source scan looks broken, refusing to subset`);
  }
  return { text: used.map((name) => String.fromCodePoint(glyphmap[name])).join(''), count: used.length };
}

/** Subset every FONT_STEMS ttf under dist/assets in place (TrueType→TrueType). */
export async function subsetDistFonts(dist, root = appRoot) {
  const fontFiles = findFiles(path.join(dist, 'assets'), (p) =>
    FONT_STEMS.some((s) => path.basename(p).startsWith(s + '.')) && p.endsWith('.ttf'));
  if (!fontFiles.length) throw new Error(`subset-fonts: no icon fonts found under ${dist}/assets`);
  for (const f of fontFiles) {
    const stem = path.basename(f).split('.')[0];
    const before = fs.statSync(f).size;
    const { text, count } = usedGlyphText(stem, root);
    const buf = await subsetFont(fs.readFileSync(f), text, { targetFormat: 'truetype' });
    fs.writeFileSync(f, buf);
    console.log(`  ${stem}: ${count} glyphs, ${(before / 1024).toFixed(0)} kB → ${(buf.length / 1024).toFixed(0)} kB`);
  }
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] ?? path.join(appRoot, 'dist'));
  await subsetDistFonts(dist);
}
