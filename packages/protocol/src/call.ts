/**
 * 1:1 audio/video call signaling — `call.*` envelopes inside encrypted DMs,
 * a sibling of the chat envelope family (chat.ts). Media never touches a
 * relay: these carry only the WebRTC session descriptions and teardown.
 *
 * Design constraints (docs/ROADMAP.md — calls):
 *  - NON-TRICKLE ICE: exactly one offer and one answer per call, with all
 *    ICE candidates inlined in the SDP. No per-candidate messages.
 *  - Offer freshness: relays replay old DMs on every backfill, so an offer
 *    carries its ts and is only ringable while `now - ts <= CALL_OFFER_TTL`.
 */
import { SCHEMA_VERSION } from './constants.js';

export const CALL_OFFER = 'call.offer';
export const CALL_ANSWER = 'call.answer';
export const CALL_HANGUP = 'call.hangup';

export type CallMsgType = typeof CALL_OFFER | typeof CALL_ANSWER | typeof CALL_HANGUP;

/** How long an offer stays ringable (seconds). Backfilled/late offers are dead. */
export const CALL_OFFER_TTL_SECONDS = 60;

export type CallHangupReason = 'declined' | 'missed' | 'ended' | 'busy' | 'error' | 'disabled';

export interface CallEnvelope {
  v: number;
  type: CallMsgType;
  /** Call session id — random, minted by the caller; every message echoes it. */
  call: string;
  /** SDP (offer/answer), with ICE candidates already gathered inline. */
  sdp?: string;
  /** Offer only: caller wants video (callee may still answer audio-only). */
  video?: boolean;
  /** Hangup only. */
  reason?: CallHangupReason;
  ts: number;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export function mintCallId(): string {
  const rnd = new Uint8Array(8);
  globalThis.crypto.getRandomValues(rnd);
  return [...rnd].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const makeCallOffer = (call: string, sdp: string, video: boolean): CallEnvelope =>
  ({ v: SCHEMA_VERSION, type: CALL_OFFER, call, sdp, video, ts: nowSec() });
export const makeCallAnswer = (call: string, sdp: string): CallEnvelope =>
  ({ v: SCHEMA_VERSION, type: CALL_ANSWER, call, sdp, ts: nowSec() });
export const makeCallHangup = (call: string, reason: CallHangupReason): CallEnvelope =>
  ({ v: SCHEMA_VERSION, type: CALL_HANGUP, call, reason, ts: nowSec() });

/** True while an offer is still fresh enough to ring. */
export function callOfferFresh(env: CallEnvelope, now = nowSec()): boolean {
  return env.type === CALL_OFFER && now - env.ts <= CALL_OFFER_TTL_SECONDS;
}

/** Parse a decrypted DM as a call envelope; null for anything else. */
export function parseCallEnvelope(json: string): CallEnvelope | null {
  let msg: CallEnvelope;
  try {
    msg = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  if (msg.v !== SCHEMA_VERSION) return null;
  if (msg.type !== CALL_OFFER && msg.type !== CALL_ANSWER && msg.type !== CALL_HANGUP) return null;
  if (typeof msg.call !== 'string' || !msg.call) return null;
  if (typeof msg.ts !== 'number') return null;
  if ((msg.type === CALL_OFFER || msg.type === CALL_ANSWER) && (typeof msg.sdp !== 'string' || !msg.sdp)) return null;
  return msg;
}
