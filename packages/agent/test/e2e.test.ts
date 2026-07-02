/**
 * End-to-end: two independent agents, one relay between them.
 * Rider posts a 15:45 ride request; driver's schedule starts 16:00 →
 * driver counters 16:00, rider's human confirms, both sides reach
 * `confirmed` with contact details exchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import {
  buildIntentEvent,
  parseIntentEvent,
  geohashEncode,
  DEMO_MARKET,
  DEMO_SCHEMA,
  type Negotiation,
} from '@freeport/protocol';
import { Transport } from '../src/transport.js';
import { FreeportAgent } from '../src/agent.js';
import type { AgentConfig } from '../src/config.js';
import { startMiniRelay } from './mini-relay.js';

const PORT = 18801;
const RELAY = `ws://127.0.0.1:${PORT}`;
const ORCHARD = geohashEncode(1.3048, 103.8318, 6);
const HOUGANG = geohashEncode(1.3712, 103.8863, 6);

let relay: { close: () => void };
beforeAll(() => {
  relay = startMiniRelay(PORT);
});
afterAll(() => relay.close());

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('two agents over a relay', () => {
  it('completes match → counter → human accept → confirmed deal', async () => {
    const skRider = generateSecretKey();
    const skDriver = generateSecretKey();
    const tRider = new Transport(skRider, [RELAY]);
    const tDriver = new Transport(skDriver, [RELAY]);

    // Rider wants 15:45 today; driver only drives from 16:00.
    const day = new Date();
    day.setHours(15, 45, 0, 0);
    const askStart = Math.floor(day.getTime() / 1000);

    const driverConfig: AgentConfig = {
      name: 'driver',
      relays: [RELAY],
      markets: [DEMO_MARKET],
      rules: [
        {
          schema: DEMO_SCHEMA,
          side: 'offer',
          market: DEMO_MARKET,
          route: { from_geohash: ORCHARD, to_geohash: HOUGANG },
          daily_window: { start: '16:00', end: '18:00' },
          flex_minutes: 30,
          contact: 'tg:@driver_bob',
          auto_accept: true, // driver pre-authorized this standing route
        },
      ],
    };
    const riderConfig: AgentConfig = {
      name: 'rider',
      relays: [RELAY],
      markets: [DEMO_MARKET],
      rules: [
        {
          schema: DEMO_SCHEMA,
          side: 'request',
          market: DEMO_MARKET,
          contact: 'tg:@rider_alice',
        },
      ],
    };

    const riderDeal = deferred<Negotiation>();
    const driverDeal = deferred<Negotiation>();
    const riderAsked = deferred<Negotiation>();

    // Collected agent logs — dumped into the timeout error so a CI failure
    // shows how far the flow got instead of just "timeout".
    const logs: string[] = [];

    const riderAgent = new FreeportAgent(tRider, riderConfig, {
      onLog: (m) => logs.push(`rider: ${m}`),
      confirmDeal: async (nego) => {
        riderAsked.resolve(nego); // the human was consulted
        return true;
      },
      onDeal: (n) => riderDeal.resolve(n),
    });
    const driverAgent = new FreeportAgent(tDriver, driverConfig, {
      onLog: (m) => logs.push(`driver: ${m}`),
      confirmDeal: async () => true,
      onDeal: (n) => driverDeal.resolve(n),
    });

    riderAgent.start();
    driverAgent.start();
    await new Promise((r) => setTimeout(r, 300)); // let subscriptions settle

    // Rider posts the public intent.
    const ev = buildIntentEvent(
      {
        side: 'request',
        market: DEMO_MARKET,
        schema: DEMO_SCHEMA,
        title: 'Ride Orchard → Hougang at 15:45',
        payload: {
          from: { name: 'Orchard', geohash: ORCHARD },
          to: { name: 'Hougang', geohash: HOUGANG },
          seats: 1,
        },
        window: { start: askStart, end: askStart + 15 * 60 },
        flexMinutes: 30,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        geohashes: [ORCHARD.slice(0, 5)],
      },
      skRider,
    );
    riderAgent.registerPublishedIntent(parseIntentEvent(ev)!);
    await tRider.publish(ev);

    // Generous budget: CI runners pay cold-start costs (websocket setup,
    // nip04 crypto) that a warm dev machine doesn't.
    const [riderResult, driverResult, consulted] = await Promise.all([
      withTimeout(riderDeal.promise, 30_000, 'rider deal', logs),
      withTimeout(driverDeal.promise, 30_000, 'driver deal', logs),
      withTimeout(riderAsked.promise, 30_000, 'rider human confirm', logs),
    ]);

    // Both sides confirmed, contacts crossed, time landed at driver's 16:00.
    expect(riderResult.state).toBe('confirmed');
    expect(driverResult.state).toBe('confirmed');
    expect(riderResult.theirContact).toBe('tg:@driver_bob');
    expect(driverResult.theirContact).toBe('tg:@rider_alice');
    expect(consulted.terms?.window?.start).toBeGreaterThan(askStart);
    const counterTime = new Date(riderResult.terms!.window!.start * 1000);
    expect(counterTime.getHours()).toBe(16);

    riderAgent.stop();
    driverAgent.stop();
    tRider.close();
    tDriver.close();
  }, 60_000);
});

function withTimeout<T>(p: Promise<T>, ms: number, label: string, logs?: string[]): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`timeout: ${label}\nagent log:\n${logs?.join('\n') || '(empty)'}`)), ms),
    ),
  ]);
}
