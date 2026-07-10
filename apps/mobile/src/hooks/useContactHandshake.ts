import { useEffect, useRef, useState } from 'react';
import type { Negotiation } from '@freeport/protocol';
import type { MobileClient } from '../client';
import type { UserProfile } from '../profile';
import { kvGet } from '../kv';
import { needsContactBackflow, shouldPokeForContact } from '../deals';

/**
 * The confirm back-flow / poke healer. When the peer accepts our proposal the
 * deal confirms with only their contact attached; this auto-replies once with
 * OUR contact so both sides have each other's — no second human "Confirm" tap.
 * A 60s tick re-evaluates stuck (idle) deals.
 */
export function useContactHandshake(
  client: MobileClient | null,
  negos: Negotiation[],
  profile: UserProfile,
  buildContactFor: (n: Negotiation) => string,
  resumeTick: number,
) {
  // Auto-send our contact back (the confirm back-flow). The old logic guarded
  // this with a PERSISTED once-ever set and kept the id even when accept()
  // threw (e.g. the signer failing mid-background on iOS) — one bad moment
  // permanently stranded the deal at "waiting for the other party" on the peer
  // (field report). The `!n.ourContact` condition already prevents re-sends
  // after a successful local commit (accept() commits before publishing, and
  // relay failures go to the persisted outbox), so the persisted guard added
  // nothing but that failure mode. Keep only an in-session backoff so a
  // persistently-broken signer can't hot-loop.
  const autoContactSent = useRef<Set<string>>(new Set());
  const autoContactLastTry = useRef<Map<string, number>>(new Map());
  const [autoContactReady, setAutoContactReady] = useState(false);
  useEffect(() => {
    kvGet('freeport.autoContactSent')
      .then((v) => { try { if (v) for (const id of JSON.parse(v) as string[]) autoContactSent.current.add(id); } catch { /* ignore */ } })
      .finally(() => setAutoContactReady(true));
  }, []);
  // Re-evaluate the handshake healer even when nothing else changes: a stuck
  // deal is by definition IDLE (no nego updates to retrigger the effect), and
  // each chat resets updatedAt which defers the poke grace window.
  const [handshakeTick, setHandshakeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHandshakeTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!client || !autoContactReady) return;
    const nowSec = Math.floor(Date.now() / 1000);
    for (const n of negos) {
      if (needsContactBackflow(n)) {
        const last = autoContactLastTry.current.get(n.id) ?? 0;
        if (Date.now() - last < 30_000) continue; // backoff between attempts
        autoContactLastTry.current.set(n.id, Date.now());
        client.accept(n.id, buildContactFor(n)).catch(() => {});
      } else if (shouldPokeForContact(n, nowSec) && !autoContactSent.current.has('poke:' + n.id)) {
        // Waiting side: our contact went out but theirs never arrived — the
        // peer either lost our accept or failed their back-flow. Re-send our
        // accept once per session; their client applies it or, on the
        // duplicate, re-sends their contact (see client.processDM).
        autoContactSent.current.add('poke:' + n.id);
        client.accept(n.id, n.ourContact!).catch(() => {});
      }
    }
  }, [negos, client, profile, autoContactReady, resumeTick, handshakeTick]);
}
