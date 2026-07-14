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
