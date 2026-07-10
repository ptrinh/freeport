import { useEffect, useState } from 'react';
import type { MobileClient } from '../client';

/** Live relay connectivity for the header status pill. */
export function useRelayStatus(client: MobileClient | null, resumeTick: number) {
  const [netStatus, setNetStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  useEffect(() => {
    if (!client) { setNetStatus('connecting'); return; }
    let everUp = false;
    let t0 = Date.now();
    // Exponential backoff between reconnect dials while offline: redialing all
    // relays every 2.5s drains the battery on a dead network. Resets the
    // moment a socket comes back (and on resume, since this effect re-runs).
    let nextDialAt = 0;
    let dialDelay = 2500;
    const tick = () => {
      const n = client.connectedRelayCount();
      if (n > 0) { everUp = true; dialDelay = 2500; nextDialAt = 0; setNetStatus('online'); }
      else {
        // No live socket: surface offline and actively try to re-open it,
        // rather than sitting on a stale "No network" forever.
        setNetStatus(everUp || Date.now() - t0 > 5000 ? 'offline' : 'connecting');
        if (Date.now() >= nextDialAt) {
          nextDialAt = Date.now() + dialDelay;
          dialDelay = Math.min(dialDelay * 2, 60_000);
          client.reconnect().catch(() => {});
        }
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    // Re-arm the connecting grace window on resume so a brief reconnect after
    // returning to the foreground doesn't flash "No network".
    t0 = Date.now(); everUp = false;
    return () => clearInterval(id);
  }, [client, resumeTick]);

  // Settle the StatusDot to a static dot once the connection has been 'online'
  // continuously for 5s — keeps the pulse/glow only while connecting/offline or
  // during the first few seconds of being connected (reduces idle UI noise).
  const [netSteady, setNetSteady] = useState(false);
  useEffect(() => {
    if (netStatus !== 'online') { setNetSteady(false); return; }
    const id = setTimeout(() => setNetSteady(true), 5000);
    return () => clearTimeout(id);
  }, [netStatus]);

  return { netStatus, netSteady };
}
