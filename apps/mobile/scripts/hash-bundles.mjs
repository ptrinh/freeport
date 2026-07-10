#!/usr/bin/env node
/**
 * Rename every exported JS bundle to its real content hash and rewrite all
 * references (index.html, inter-chunk imports).
 *
 * Why: metro's `<name>-<hash>.js` filenames are NOT content hashes — we
 * shipped two different AppEntry bytes under the same name in one day, and
 * with Cloudflare's 4h max-age on JS, clients kept running the stale bundle
 * (missing icons, missing env). With true content names, index.html (which
 * is always revalidated) can only ever point at matching code.
 *
 * Runs to a fixpoint: renaming a chunk changes its parents' bytes, which
 * changes their hash, and so on up to the entry.
 *
 * Usage: node scripts/hash-bundles.mjs [distDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(process.argv[2] ?? path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'dist'));
const jsDir = path.join(dist, '_expo/static/js/web');

const textFiles = () => {
  const acc = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html|css|json)$/.test(p)) acc.push(p);
    }
  };
  walk(dist);
  return acc;
};

let total = 0;
for (let round = 0; round < 10; round++) {
  let changed = 0;
  for (const f of fs.readdirSync(jsDir).filter((n) => n.endsWith('.js'))) {
    const m = f.match(/^(.+)-([0-9a-f]{32})\.js$/);
    if (!m) continue;
    const p = path.join(jsDir, f);
    const hash = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
    if (hash === m[2]) continue;
    const nf = `${m[1]}-${hash}.js`;
    fs.renameSync(p, path.join(jsDir, nf));
    let hits = 0;
    for (const tf of textFiles()) {
      const txt = fs.readFileSync(tf, 'utf8');
      if (!txt.includes(f)) continue;
      fs.writeFileSync(tf, txt.split(f).join(nf));
      hits++;
    }
    if (!hits) throw new Error(`hash-bundles: renamed ${f} → ${nf} but nothing references it — deploy would 404`);
    changed++; total++;
  }
  if (!changed) {
    console.log(`  hash-bundles: ${total} bundle(s) renamed to content hashes (${round} round${round === 1 ? '' : 's'})`);
    process.exit(0);
  }
}
throw new Error('hash-bundles: no fixpoint after 10 rounds — circular chunk references?');
