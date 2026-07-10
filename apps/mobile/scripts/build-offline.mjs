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
import { usedGlyphText, FONT_STEMS } from './subset-fonts.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
const out = path.resolve(process.argv[3] ?? path.join(root, 'offline-freeport.html'));


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

// Preload hints for local assets 404 from file:// (the real tags are inlined).
html = html.replace(/<link rel="preload" href="\/[^"]+"[^>]*>\n?/g, '');

// ── Drop PWA bits that are meaningless (and noisy) on file://.
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<script>if\("serviceWorker" in navigator\)[\s\S]*?<\/script>\n?/, '');

// ── Icon fonts: SUBSET to the glyphs the app can actually render (see
// scripts/subset-fonts.mjs for the shared literal-scan), embedded as woff2
// data URIs + a runtime shim that rewrites the @font-face styles Expo
// injects, so registration succeeds offline. Idempotent when the dist fonts
// were already subset by deploy: subsetting to the same glyph set again is a
// no-op size-wise.
const fontFiles = findFiles(path.join(dist, 'assets'), (p) =>
  FONT_STEMS.some((s) => path.basename(p).startsWith(s + '.')) && p.endsWith('.ttf'));
const fontMap = {};
for (const f of fontFiles) {
  const stem = path.basename(f).split('.')[0];
  const { text, count } = usedGlyphText(stem, root);
  const woff2 = await subsetFont(fs.readFileSync(f), text, { targetFormat: 'woff2' });
  fontMap[stem] = `data:font/woff2;base64,${woff2.toString('base64')}`;
  console.log(`  embedded font ${stem}: ${count} glyphs, ${(woff2.length / 1024).toFixed(0)} kB (dist ttf ${(fs.statSync(f).size / 1024).toFixed(0)} kB)`);
}
const missing = FONT_STEMS.filter((s) => !fontMap[s]);
if (missing.length) throw new Error(`icon fonts not found in dist/assets: ${missing.join(', ')}`);

// ── Runtime image assets (the in-app logo, etc.): the bundle sets
// <img src="/assets/…png"> at runtime, which can't resolve from file://.
// Embed every non-font asset (currently just the logo, ~195 kB) and let the
// shim rewrite img srcs as React inserts them.
// Built-in wallet wasm → gzip + base64 for zero-network wallet in the offline
// file. Pre-gzipping beats letting the outer pass compress raw-wasm base64:
// the runtime shim inflates it with DecompressionStream (already required by
// the self-extractor).
const wasmPath = path.join(dist, 'breez_sdk_spark_wasm_bg.wasm');
const wasmB64 = fs.existsSync(wasmPath)
  ? zlib.gzipSync(fs.readFileSync(wasmPath), { level: 9 }).toString('base64')
  : '';
if (wasmB64) console.log(`  embedded wallet wasm (${(fs.statSync(wasmPath).size / 1048576).toFixed(1)} MB raw → ${(wasmB64.length / 1048576).toFixed(1)} MB gz+b64)`);
else console.warn('  ! no wallet wasm in dist — offline wallet will need network once');

const assetMap = {};
for (const f of findFiles(path.join(dist, 'assets'), (p) => !p.endsWith('.ttf'))) {
  const rel = '/' + path.relative(dist, f).split(path.sep).join('/');
  assetMap[rel] = dataUri(f);
  console.log(`  embedded asset ${rel} (${(fs.statSync(f).size / 1024).toFixed(0)} kB)`);
}

// ── Runtime-injected CSS chunks (leaflet). The bundle appends
// <link href="/_expo/static/css/…css"> at runtime — dead on file://, and
// without leaflet.css the map renders no tiles. Embed every exported CSS file
// (url() refs resolved) and let the shim rewrite the hrefs.
const cssMap = {};
const cssDir = path.join(dist, '_expo/static/css');
if (fs.existsSync(cssDir)) {
  for (const f of findFiles(cssDir, (p) => p.endsWith('.css'))) {
    let css = fs.readFileSync(f, 'utf8');
    css = css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (mm, q, ref) => {
      if (/^(data:|https?:)/.test(ref)) return mm;
      const refPath = ref.split(/[?#]/)[0];
      if (!refPath) return mm;
      const asset = path.resolve(path.dirname(f), refPath);
      return fs.existsSync(asset) && fs.statSync(asset).isFile() ? `url(${dataUri(asset)})` : mm;
    });
    const rel = '/' + path.relative(dist, f).split(path.sep).join('/');
    cssMap[rel] = `data:text/css;base64,${Buffer.from(css, 'utf8').toString('base64')}`;
    console.log(`  embedded css ${rel} (${(css.length / 1024).toFixed(0)} kB)`);
  }
}

const shim = `<script>
/* offline copy: swap runtime-injected icon-font URLs and /assets/ image srcs
   for embedded data URIs */
(function(){
  var FONTS=${JSON.stringify(fontMap)};
  var ASSETS=${JSON.stringify(assetMap)};
  /* Built-in wallet wasm, embedded so the wallet works with zero network.
     src/wallet/breez.ts fetches /breez_sdk_spark_wasm_bg.wasm — the fetch
     shim below answers from these bytes. */
  var WASM_B64=${JSON.stringify(wasmB64)};
  var CSS=${JSON.stringify(cssMap)};
  function fixStyle(node){
    if(!node.textContent||node.textContent.indexOf('@font-face')===-1)return;
    var t=node.textContent,changed=false;
    for(var stem in FONTS){
      var re=new RegExp('url\\\\((["\\']?)[^)"\\']*'+stem+'[^)"\\']*\\\\1\\\\)','g');
      if(re.test(t)){t=t.replace(re,'url("'+FONTS[stem]+'")');changed=true;}
    }
    if(changed)node.textContent=t;
  }
  function fixImg(el){
    var src=el.getAttribute('src');
    if(src&&ASSETS[src.split('?')[0]])el.setAttribute('src',ASSETS[src.split('?')[0]]);
  }
  /* Code-split chunks (locale catalogs) are pre-registered inline above, but
     metro's asyncRequire still fetches the chunk URL via an injected <script>
     before require()ing it — which fails on file:// and fell back to English.
     Point those scripts at an empty data: URI: onload fires instantly and the
     pre-registered module resolves. */
  function cssFor(v){
    var m=(''+v).match(/\\/_expo\\/static\\/css\\/[^?#]+\\.css/);
    return m&&CSS[m[0]]?CSS[m[0]]:null;
  }
  try{
    var origCreate=document.createElement.bind(document);
    var srcDesc=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');
    var hrefDesc=Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype,'href');
    var isChunk=function(v){return /\\/_expo\\/static\\/js\\/web\\/[^?#]+\\.js/.test(''+v);};
    document.createElement=function(tag){
      var el=origCreate.apply(document,arguments);
      var t=(''+tag).toLowerCase();
      if(t==='script'){
        Object.defineProperty(el,'src',{
          configurable:true,
          get:srcDesc.get,
          set:function(v){srcDesc.set.call(this,isChunk(v)?'data:text/javascript,':v);}
        });
        var osa=el.setAttribute.bind(el);
        el.setAttribute=function(n,v){osa(n,n==='src'&&isChunk(v)?'data:text/javascript,':v);};
      } else if(t==='link'){
        /* runtime CSS chunks (leaflet) — rewrite to embedded data URIs */
        Object.defineProperty(el,'href',{
          configurable:true,
          get:hrefDesc.get,
          set:function(v){var c=cssFor(v);hrefDesc.set.call(this,c||v);}
        });
        var ola=el.setAttribute.bind(el);
        el.setAttribute=function(n,v){var c=n==='href'?cssFor(v):null;ola(n,c||v);};
      }
      return el;
    };
    var origFetch=window.fetch&&window.fetch.bind(window);
    if(origFetch)window.fetch=function(input,init){
      var u=typeof input==='string'?input:(input&&input.url)||'';
      if(isChunk(u))return Promise.resolve(new Response('',{status:200,headers:{'Content-Type':'text/javascript'}}));
      if(WASM_B64&&u.indexOf('breez_sdk_spark_wasm_bg.wasm')!==-1){
        var bin=atob(WASM_B64),bytes=new Uint8Array(bin.length);
        for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
        var inflated=new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
        return inflated.arrayBuffer().then(function(buf){
          return new Response(buf,{status:200,headers:{'Content-Type':'application/wasm'}});
        });
      }
      return origFetch(input,init);
    };
  }catch(_){}
  /* react-native-web preloads images on a DETACHED new Image() before ever
     inserting a node — a MutationObserver never sees it, and a failed preload
     renders nothing (the missing-logo bug). Rewrite at the property setter. */
  try{
    var desc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    Object.defineProperty(HTMLImageElement.prototype,'src',{
      configurable:true,
      get:desc.get,
      set:function(v){var k=(''+v).split('?')[0];desc.set.call(this,ASSETS[k]||v);}
    });
  }catch(_){}
  /* react-native-web renders Image as a div with an inline background-image */
  function fixBg(el){
    var bg=el.style&&el.style.backgroundImage;
    if(!bg||bg.indexOf('/assets/')===-1)return;
    var m=bg.match(/url\\(["']?([^"')]+)["']?\\)/);
    if(m){var k=m[1].split('?')[0];if(ASSETS[k])el.style.backgroundImage='url("'+ASSETS[k]+'")';}
  }
  function fix(node){
    if(!node||!node.tagName)return;
    if(node.tagName==='STYLE'){fixStyle(node);return;}
    if(node.tagName==='IMG')fixImg(node);
    fixBg(node);
    if(node.querySelectorAll){
      node.querySelectorAll('img').forEach(fixImg);
      node.querySelectorAll('[style*="background-image"]').forEach(fixBg);
    }
  }
  new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var m=muts[i];
      if(m.type==='characterData'){if(m.target.parentNode&&m.target.parentNode.tagName==='STYLE')fixStyle(m.target.parentNode);continue;}
      if(m.type==='attributes'){if(m.attributeName==='style')fixBg(m.target);else fixImg(m.target);continue;}
      for(var j=0;j<m.addedNodes.length;j++)fix(m.addedNodes[j]);
    }
  }).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src','style']});
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

// Pack the gzip bytes into UTF-16 code units, 15 bits per character mapped
// into 0x3000..0xB7FF — a contiguous BMP range with no surrogates, no JS
// string specials and no '<'. Written as a UTF-16LE file (BOM up front) each
// character costs exactly 2 bytes, so the payload carries 15 data bits per
// 16 stored bits: ~6.7% overhead instead of base64's 33% (9.6 MB → 7.7 MB).
function pack15(buf) {
  const codes = [];
  let acc = 0, nb = 0;
  for (const byte of buf) {
    acc = ((acc << 8) | byte) & 0x7fffff; nb += 8;
    while (nb >= 15) { nb -= 15; codes.push(0x3000 + ((acc >>> nb) & 0x7fff)); }
  }
  if (nb > 0) codes.push(0x3000 + ((acc << (15 - nb)) & 0x7fff));
  let s = '';
  for (let i = 0; i < codes.length; i += 65536) s += String.fromCharCode.apply(null, codes.slice(i, i + 65536));
  return s;
}
const packed = pack15(gz);
const stub =
  '<!doctype html>\n' +
  '<html><head><title>Freeport</title>\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  "<style>html,body{height:100%;margin:0;background:#06080c;color:#e7ecf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}\n" +
  '#u{display:flex;height:100%;flex-direction:column;align-items:center;justify-content:center;gap:12px}</style>\n' +
  '</head><body><div id="u"><div style="font-size:28px;font-weight:800">Freeport</div><div id="m" style="color:#8b97a6;font-size:14px">Unpacking…</div></div>\n' +
  '<script>\n' +
  '(async function(){\n' +
  '  try{\n' +
  '    var s=P,n=' + gz.length + ';\n' +
  '    var a=new Uint8Array(n),acc=0,nb=0,j=0;\n' +
  '    for(var i=0;i<s.length;i++){\n' +
  '      acc=((acc<<15)|(s.charCodeAt(i)-0x3000))&0x7fffff;nb+=15;\n' +
  '      while(nb>=8&&j<n){nb-=8;a[j++]=(acc>>>nb)&255;}\n' +
  '    }\n' +
  '    var html=await new Response(new Blob([a]).stream().pipeThrough(new DecompressionStream("gzip"))).text();\n' +
  '    document.open();document.write(html);document.close();\n' +
  '  }catch(e){\n' +
  '    document.getElementById("m").textContent="This browser can\'t unpack the offline app (needs Chrome 80+/Safari 16.4+/Firefox 113+): "+e;\n' +
  '  }\n' +
  '})();\n' +
  '<\/script>\n' +
  '</body></html>\n';
// The payload rides in its own script as a global — kept out of the main stub
// string so neither side needs escaping.
const payloadScript = '<script>var P="' + packed + '";<\/script>\n';
const full = stub.replace('<script>\n(async', payloadScript + '<script>\n(async');
fs.writeFileSync(out, Buffer.concat([Buffer.from('\ufeff', 'utf16le'), Buffer.from(full, 'utf16le')]));
console.log(`  wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB — inner html ${(html.length / 1024 / 1024).toFixed(1)} MB, gzip ${(gz.length / 1024 / 1024).toFixed(1)} MB, utf16-packed)`);
