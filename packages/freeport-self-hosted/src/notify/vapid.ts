/**
 * VAPID keys — each host generates its OWN pair. The private key is a secret
 * (never logged); the public key is handed to clients so their browser/PWA can
 * create a push subscription bound to this sender.
 *
 * Source order: env (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) → keys file → generate
 * and persist. So a fresh `npx` run just works, and a container can pin keys
 * via env so subscriptions survive redeploys.
 */
import webpush from 'web-push';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Vapid { publicKey: string; privateKey: string; subject: string; }

export function loadVapid(keysPath: string): Vapid {
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject };
  }
  if (existsSync(keysPath)) {
    const f = JSON.parse(readFileSync(keysPath, 'utf8'));
    if (f.publicKey && f.privateKey) return { publicKey: f.publicKey, privateKey: f.privateKey, subject };
  }
  const gen = webpush.generateVAPIDKeys();
  mkdirSync(dirname(keysPath), { recursive: true });
  // The file holds the VAPID PRIVATE key — create it 0600 (owner-only) so a
  // co-tenant / other local user can't read it and forge pushes as this server.
  // tmp-with-mode then rename so the restrictive mode exists before any content
  // and the write is atomic.
  const tmp = `${keysPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(gen, null, 2), { mode: 0o600 });
  renameSync(tmp, keysPath);
  return { publicKey: gen.publicKey, privateKey: gen.privateKey, subject };
}

/** Configure the web-push client. Returns the public key (safe to expose). */
export function configureWebPush(v: Vapid): string {
  webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);
  return v.publicKey;
}
