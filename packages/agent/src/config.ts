import { readFileSync } from 'node:fs';
import { DEFAULT_RELAYS, type MatchRule } from '@freeport/protocol';

export interface AgentConfig {
  name: string;
  profile?: string; // key/data directory under ~/.freeport/
  relays: string[];
  markets: string[];
  rules: MatchRule[];
  /** Seal deals without a human y/n. Off by default. */
  auto_accept?: boolean;
}

export function loadConfig(path: string): AgentConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw.markets) || raw.markets.length === 0) {
    throw new Error('config needs at least one market');
  }
  return {
    name: raw.name ?? 'agent',
    profile: raw.profile,
    relays: raw.relays?.length ? raw.relays : DEFAULT_RELAYS,
    markets: raw.markets,
    rules: raw.rules ?? [],
    auto_accept: raw.auto_accept ?? false,
  };
}
