#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { getPublicKey } from 'nostr-tools/pure';
import {
  APP_NAME,
  buildIntentEvent,
  parseIntentEvent,
  DEFAULT_RELAYS,
  type Negotiation,
} from '@freeport/protocol';
import { loadOrCreateKey, npub, encryptedBackup, restoreFromBackup } from './keys.js';
import { loadConfig } from './config.js';
import { Transport } from './transport.js';
import { FreeportAgent } from './agent.js';

const USAGE = `${APP_NAME} agent

usage:
  freeport whoami   [--profile p]                      show (or silently create) identity
  freeport backup   --passphrase <pw> [--profile p]    print NIP-49 encrypted key backup
  freeport restore  --blob <ncryptsec> --passphrase <pw> [--profile p]
  freeport post     --intent <file.json> [--config <agent.json>] [--profile p]
  freeport listen   --market <topic> [--relays url,url] [--profile p]
  freeport run      --config <agent.json> [--post <intent.json>] [--yes]

run = full agent loop: subscribe to configured markets, auto-match, negotiate,
prompt y/n for final deal confirmation (--yes auto-accepts; demo only).`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}
function log(line: string): void {
  console.log(`[${ts()}] ${line}`);
}

function printDeal(nego: Negotiation): void {
  console.log('\n════════ DEAL CONFIRMED ════════');
  console.log(`  intent : ${nego.intent.content.title}`);
  console.log(`  market : ${nego.intent.content.market}`);
  if (nego.terms?.window) {
    console.log(
      `  window : ${new Date(nego.terms.window.start * 1000).toLocaleString()} → ${new Date(nego.terms.window.end * 1000).toLocaleTimeString()}`,
    );
  }
  if (nego.terms?.payment) console.log(`  payment: ${nego.terms.payment}`);
  console.log(`  peer   : ${nego.peer}`);
  console.log(`  contact: ${nego.theirContact ?? '(pending)'}`);
  console.log('════════════════════════════════\n');
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const profile = arg('profile') ?? 'default';

  switch (cmd) {
    case 'whoami': {
      const sk = loadOrCreateKey(profile);
      console.log(npub(sk));
      return;
    }
    case 'backup': {
      const pw = arg('passphrase');
      if (!pw) throw new Error('--passphrase required');
      console.log(encryptedBackup(loadOrCreateKey(profile), pw));
      return;
    }
    case 'restore': {
      const blob = arg('blob');
      const pw = arg('passphrase');
      if (!blob || !pw) throw new Error('--blob and --passphrase required');
      const sk = restoreFromBackup(blob, pw, profile);
      console.log(`restored ${npub(sk)}`);
      return;
    }
    case 'post': {
      const file = arg('intent');
      if (!file) throw new Error('--intent <file.json> required');
      const sk = loadOrCreateKey(profile);
      const spec = JSON.parse(readFileSync(file, 'utf8'));
      const relays = arg('config') ? loadConfig(arg('config')!).relays : DEFAULT_RELAYS;
      const now = Math.floor(Date.now() / 1000);
      const ev = buildIntentEvent(
        {
          side: spec.side,
          market: spec.market,
          schema: spec.schema,
          title: spec.title,
          payload: spec.payload,
          window: spec.window,
          flexMinutes: spec.flex_minutes,
          expiresAt: spec.expires_at ?? now + 6 * 3600,
          geohashes: spec.geohashes,
        },
        sk,
      );
      const t = new Transport(sk, relays);
      const ok = await t.publish(ev);
      log(`published intent ${ev.id.slice(0, 12)}… to ${ok.length}/${relays.length} relays`);
      t.close();
      process.exit(0);
    }
    case 'listen': {
      const market = arg('market');
      if (!market) throw new Error('--market required');
      const relays = arg('relays')?.split(',') ?? DEFAULT_RELAYS;
      const sk = loadOrCreateKey(profile);
      const t = new Transport(sk, relays);
      log(`listening on market "${market}" (${relays.length} relays) — ctrl-c to stop`);
      t.subscribeIntents([market], (intent) => {
        log(
          `${intent.content.side.toUpperCase()} ${intent.id.slice(0, 8)}… "${intent.content.title}" by ${intent.pubkey.slice(0, 8)}…`,
        );
      });
      return; // keep process alive
    }
    case 'run': {
      const configPath = arg('config');
      if (!configPath) throw new Error('--config required');
      const config = loadConfig(configPath);
      if (flag('yes')) config.auto_accept = true;
      const sk = loadOrCreateKey(config.profile ?? profile);
      const t = new Transport(sk, config.relays);
      log(`identity ${npub(sk)} (${getPublicKey(sk).slice(0, 8)}…)`);

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const agent = new FreeportAgent(t, config, {
        onLog: log,
        confirmDeal: async (nego) => {
          console.log('\n──── deal pending your confirmation ────');
          console.log(`  ${nego.intent.content.title}`);
          if (nego.terms?.window)
            console.log(
              `  proposed time: ${new Date(nego.terms.window.start * 1000).toLocaleString()} → ${new Date(nego.terms.window.end * 1000).toLocaleTimeString()}`,
            );
          if (nego.terms?.payment) console.log(`  payment: ${nego.terms.payment}`);
          if (nego.terms?.note) console.log(`  note: ${nego.terms.note}`);
          const a = await rl.question('accept? [y/N] ');
          return a.trim().toLowerCase().startsWith('y');
        },
        onDeal: printDeal,
      });
      agent.start();

      const postFile = arg('post');
      if (postFile) {
        const spec = JSON.parse(readFileSync(postFile, 'utf8'));
        const now = Math.floor(Date.now() / 1000);
        const ev = buildIntentEvent(
          {
            side: spec.side,
            market: spec.market,
            schema: spec.schema,
            title: spec.title,
            payload: spec.payload,
            window: spec.window,
            flexMinutes: spec.flex_minutes,
            expiresAt: spec.expires_at ?? now + 6 * 3600,
            geohashes: spec.geohashes,
          },
          sk,
        );
        const intent = parseIntentEvent(ev);
        if (intent) agent.registerPublishedIntent(intent);
        const ok = await t.publish(ev);
        log(`posted intent "${spec.title}" to ${ok.length}/${config.relays.length} relays`);
      }
      return; // event loop keeps us alive
    }
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
