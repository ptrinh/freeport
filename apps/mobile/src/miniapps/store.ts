/**
 * Mini-app firewall persistence — one firewall instance per app session,
 * serialized into SecureStore under a single key (apps, grants, spend, audit).
 */
import { kvGet, kvSet } from '../kv';
import { MiniAppFirewall } from './firewall';

const STORE_KEY = 'freeport.miniapps';

let instance: MiniAppFirewall | null = null;

export async function loadFirewall(): Promise<MiniAppFirewall> {
  if (!instance) instance = MiniAppFirewall.restore(await kvGet(STORE_KEY));
  return instance;
}

/** Fire-and-forget persist — call after grants, spend, add/remove. */
export function persistFirewall(): void {
  const fw = instance;
  if (fw) void kvSet(STORE_KEY, fw.serialize()).catch(() => {});
}

/** Drop the in-memory instance (logout) — the next load re-reads storage. */
export function resetFirewall(): void {
  instance = null;
}

/** The serialized registry for account export (null when nothing saved yet). */
export async function exportFirewallState(): Promise<string | null> {
  return kvGet(STORE_KEY);
}

/** Restore the registry from an account backup — never trusted verbatim:
 *  round-trip through MiniAppFirewall.restore() so tampered origins, grants on
 *  always-ask kinds, etc. are dropped exactly as they would be at load time. */
export async function importFirewallState(miniapps: unknown): Promise<void> {
  if (typeof miniapps !== 'string' || !miniapps) return;
  await kvSet(STORE_KEY, MiniAppFirewall.restore(miniapps).serialize());
  instance = null; // next load re-reads storage
}
