#!/usr/bin/env node
/**
 * Pin the single-file offline app to IPFS via Pinata, so the download stays
 * available from any public gateway even if the git hosting disappears.
 * Content-addressed: an unchanged build re-pins to the same CID (no-op).
 *
 *   node scripts/pin-ipfs.mjs <file> [pin-name]
 *
 * Auth: PINATA_JWT env var (deploy-web.sh sources .env; CI passes a secret).
 * Missing token → warn and exit 0, deploys must not fail on the mirror step.
 * Keeps the newest KEEP pins with the same name, unpinning older ones so the
 * free-tier quota never fills up.
 */
import fs from 'node:fs';
import path from 'node:path';

const KEEP = 5;
const API = 'https://api.pinata.cloud';

const [file, pinName = 'Freeport-offline.html'] = process.argv.slice(2);
const jwt = (process.env.PINATA_JWT ?? '').trim();
if (!file) { console.error('usage: pin-ipfs.mjs <file> [pin-name]'); process.exit(2); }
if (!jwt) { console.warn('▸ Skipping IPFS pin (no PINATA_JWT)'); process.exit(0); }
if (!fs.existsSync(file)) { console.error(`pin-ipfs: ${file} not found`); process.exit(2); }

const auth = { Authorization: `Bearer ${jwt}` };

async function pinFile() {
  const form = new FormData();
  // Wrap in a directory so the CID resolves to /<pinName> — gateways then
  // pick the content type from the file extension. A bare-file pin has no
  // name at all, and our UTF-16LE BOM (FF FE) matches the MP3 frame-sync
  // bits, so content sniffers served the app as audio/mpeg.
  form.append('file', new Blob([fs.readFileSync(file)]), pinName);
  form.append('pinataMetadata', JSON.stringify({ name: pinName }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }));
  const res = await fetch(`${API}/pinning/pinFileToIPFS`, { method: 'POST', headers: auth, body: form });
  if (!res.ok) throw new Error(`pinFileToIPFS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function pruneOld(currentCid) {
  // Best-effort hygiene — never fail the deploy over cleanup.
  try {
    const q = new URLSearchParams({ status: 'pinned', 'metadata[name]': pinName, pageLimit: '100' });
    const res = await fetch(`${API}/data/pinList?${q}`, { headers: auth });
    if (!res.ok) return;
    const { rows = [] } = await res.json();
    const stale = rows
      .filter((r) => r.ipfs_pin_hash !== currentCid)
      .sort((a, b) => new Date(b.date_pinned) - new Date(a.date_pinned))
      .slice(KEEP - 1); // current pin + (KEEP-1) previous ones survive
    for (const r of stale) {
      await fetch(`${API}/pinning/unpin/${r.ipfs_pin_hash}`, { method: 'DELETE', headers: auth });
      console.log(`  unpinned old ${r.ipfs_pin_hash} (${r.date_pinned})`);
    }
  } catch { /* ignore */ }
}

const out = await pinFile();
const cid = out.IpfsHash;
const size = (fs.statSync(file).size / 1e6).toFixed(1);
console.log(`▸ Pinned ${path.basename(file)} (${size} MB) to IPFS${out.isDuplicate ? ' (unchanged — same CID)' : ''}`);
console.log(`  CID:     ${cid}`);
console.log(`  Gateway: https://ipfs.io/ipfs/${cid}/${pinName}`);
console.log(`           https://gateway.pinata.cloud/ipfs/${cid}/${pinName}`);
await pruneOld(cid);
