#!/usr/bin/env node
/**
 * Build a fully self-contained `offline-freeport.html` from an `expo export
 * --platform web` output (dist/). Everything is inlined — JS bundles, CSS,
 * icon fonts, favicon/splash images — so the ONE file runs from file:// with
 * no network and no sibling folders. Published as a GitHub Release asset so
 * anyone can keep a working copy of the app ("Save page as…" in a browser
 * can't do this reliably: Chrome skips webfonts, breaking every icon).
 *
 * Font strategy: the Expo bundle registers icon fonts at runtime by injecting
 * <style>@font-face{src:url(/assets/…ttf)}</style>. A tiny shim (injected
 * before the bundle) watches for those styles and swaps the font URL for an
 * embedded data: URI — so expo-font's own registration succeeds offline and
 * font-family names stay exactly what the icon components expect.
 *
 * Usage: node scripts/build-offline.mjs [distDir] [outFile]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
const out = path.resolve(process.argv[3] ?? path.join(root, 'offline-freeport.html'));

// Only the icon sets the app actually imports (keeps the file small; the other
// vector-icon fonts in dist/assets are never registered at runtime).
const FONT_STEMS = ['Ionicons', 'MaterialCommunityIcons'];

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const dataUri = (file) => {
  const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
};
const findFiles = (dir, pred, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, pred, acc);
    else if (pred(p)) acc.push(p);
  }
  return acc;
};

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

// ── Inline local <script src> (the Expo bundles). `</script>` inside the JS
// would terminate the inline tag early — escape it the standard way.
const inlineJs = (file) => fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
const referenced = new Set();
html = html.replace(/<script src="(\/[^"]+)"[^>]*><\/script>/g, (m, src) => {
  const file = path.join(dist, src.replace(/^\//, ''));
  if (!fs.existsSync(file)) { console.warn(`  ! missing script ${src} — kept as-is`); return m; }
  referenced.add(path.resolve(file));
  // Lazy chunks (code-split locale catalogs) are fetched by URL at runtime,
  // which can't work from a single file:// document. Pre-register them all
  // just before the entry bundle: each chunk only defines modules in the
  // metro registry, so the later dynamic import resolves instantly without a
  // network fetch — all 56 languages work offline.
  if (/\/AppEntry-[^/]+\.js$/.test(src)) {
    const webDir = path.dirname(file);
    const extras = fs.readdirSync(webDir)
      .filter((f) => f.endsWith('.js') && !referenced.has(path.resolve(webDir, f)))
      .sort()
      .map((f) => `<script>${inlineJs(path.join(webDir, f))}</script>`);
    console.log(`  pre-registered ${extras.length} lazy chunks (locales)`);
    return extras.join('\n') + `\n<script>${inlineJs(file)}</script>`;
  }
  return `<script>${inlineJs(file)}</script>`;
});

// ── Inline local stylesheets (e.g. leaflet), resolving their url() assets.
html = html.replace(/<link rel="stylesheet" href="(\/[^"]+)"[^>]*>/g, (m, href) => {
  const file = path.join(dist, href.replace(/^\//, ''));
  if (!fs.existsSync(file)) { console.warn(`  ! missing stylesheet ${href} — kept as-is`); return m; }
  let css = fs.readFileSync(file, 'utf8');
  css = css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (mm, q, ref) => {
    if (/^(data:|https?:)/.test(ref)) return mm;
    const refPath = ref.split(/[?#]/)[0];
    if (!refPath) return mm; // pure fragment/query ref (e.g. url(#filter))
    const asset = path.resolve(path.dirname(file), refPath);
    return fs.existsSync(asset) && fs.statSync(asset).isFile() ? `url(${dataUri(asset)})` : mm;
  });
  return `<style>${css}</style>`;
});

// ── Inline images referenced from the static HTML (favicon, splash icon).
html = html.replace(/(href|src)="(\/(?:favicon|icons)[^"]+)"/g, (m, attr, ref) => {
  const file = path.join(dist, ref.replace(/^\//, ''));
  return fs.existsSync(file) ? `${attr}="${dataUri(file)}"` : m;
});

// ── Drop PWA bits that are meaningless (and noisy) on file://.
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<script>if\("serviceWorker" in navigator\)[\s\S]*?<\/script>\n?/, '');

// ── Icon fonts: SUBSET to the glyphs the app can actually render, then embed
// as woff2 data URIs + a runtime shim that rewrites the @font-face styles
// Expo injects, so registration succeeds offline. Full icon fonts are ~1.7 MB;
// the app uses a few dozen glyphs. Used names are collected as every string
// literal in the app source that is a key of the icon set's glyphmap — this
// over-includes (any word that happens to be a glyph name) but each glyph is
// tiny, and it safely covers icons picked via data tables (SORT_ICON,
// categoryIcon()…) since those are string literals somewhere in the source.
const srcFiles = [
  path.join(root, 'App.tsx'),
  ...findFiles(path.join(root, 'src'), (p) => /\.(ts|tsx)$/.test(p)),
];
const literals = new Set();
const litRe = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
for (const f of srcFiles) {
  const txt = fs.readFileSync(f, 'utf8');
  for (const m of txt.matchAll(litRe)) literals.add(m[2]);
}
const glyphmapsDir = path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps');

const fontFiles = findFiles(path.join(dist, 'assets'), (p) =>
  FONT_STEMS.some((s) => path.basename(p).startsWith(s + '.')) && p.endsWith('.ttf'));
const fontMap = {};
for (const f of fontFiles) {
  const stem = path.basename(f).split('.')[0];
  const glyphmap = JSON.parse(fs.readFileSync(path.join(glyphmapsDir, `${stem}.json`), 'utf8'));
  const used = Object.keys(glyphmap).filter((name) => literals.has(name));
  const text = used.map((name) => String.fromCodePoint(glyphmap[name])).join('');
  const woff2 = await subsetFont(fs.readFileSync(f), text, { targetFormat: 'woff2' });
  fontMap[stem] = `data:font/woff2;base64,${woff2.toString('base64')}`;
  console.log(`  embedded font ${stem}: ${used.length} glyphs, ${(woff2.length / 1024).toFixed(0)} kB (was ${(fs.statSync(f).size / 1024).toFixed(0)} kB ttf)`);
}
const missing = FONT_STEMS.filter((s) => !fontMap[s]);
if (missing.length) throw new Error(`icon fonts not found in dist/assets: ${missing.join(', ')}`);

const shim = `<script>
/* offline copy: swap runtime-injected icon-font URLs for embedded data URIs */
(function(){
  var FONTS=${JSON.stringify(fontMap)};
  function fix(node){
    if(!node||node.tagName!=='STYLE'||!node.textContent||node.textContent.indexOf('@font-face')===-1)return;
    var t=node.textContent,changed=false;
    for(var stem in FONTS){
      var re=new RegExp('url\\\\((["\\']?)[^)"\\']*'+stem+'[^)"\\']*\\\\1\\\\)','g');
      if(re.test(t)){t=t.replace(re,'url("'+FONTS[stem]+'")');changed=true;}
    }
    if(changed)node.textContent=t;
  }
  new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var m=muts[i];
      if(m.type==='characterData'){fix(m.target.parentNode);continue;}
      for(var j=0;j<m.addedNodes.length;j++)fix(m.addedNodes[j]);
    }
  }).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
})();
</script>
`;
html = html.replace(/<head[^>]*>/, (m) => m + '\n' + shim);

// ── Self-extracting wrapper: gzip the whole document and ship a small stub
// that inflates it with DecompressionStream and document.write()s it in place
// (same file:// origin). Cuts ~11 MB to ~4 MB. DecompressionStream is in every
// evergreen browser (Chrome 80+, Safari 16.4+, Firefox 113+); older ones get
// a plain-text hint instead of a broken page.
const gz = zlib.gzipSync(Buffer.from(html, 'utf8'), { level: 9 });
const stub = `<!doctype html>
<html><head><meta charset="utf-8"><title>Freeport</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{height:100%;margin:0;background:#06080c;color:#e7ecf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
#u{display:flex;height:100%;flex-direction:column;align-items:center;justify-content:center;gap:12px}</style>
</head><body><div id="u"><div style="font-size:28px;font-weight:800">Freeport</div><div id="m" style="color:#8b97a6;font-size:14px">Unpacking…</div></div>
<script type="text/plain" id="z">${gz.toString('base64')}</script>
<script>
(async function(){
  try{
    var b=atob(document.getElementById("z").textContent.trim());
    var a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
    var html=await new Response(new Blob([a]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    document.open();document.write(html);document.close();
  }catch(e){
    document.getElementById("m").textContent="This browser can't unpack the offline app (needs Chrome 80+/Safari 16.4+/Firefox 113+): "+e;
  }
})();
</script>
</body></html>
`;
fs.writeFileSync(out, stub);
console.log(`  wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB — inner html ${(html.length / 1024 / 1024).toFixed(1)} MB, gzip ${(gz.length / 1024 / 1024).toFixed(1)} MB)`);
