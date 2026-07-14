/**
 * Conditional payments — HODL-invoice escrow (trust-minimized, no custodian).
 *
 * The BUYER holds the preimage; the SELLER can only settle when the buyer
 * reveals it on delivery. The Lightning protocol enforces the lock — no
 * operator ever touches the money:
 *
 *   buyer  → escrow.request {hash, amount}   (preimage stays on buyer device)
 *   seller → escrow.invoice {hash, bolt11}   (hold invoice on that hash)
 *   buyer pays the invoice — funds LOCK at the seller side, unsettled
 *   buyer  → escrow.release {preimage}       (on delivery)
 *   seller claims with the preimage → settled
 *   no release → the HTLC expires and auto-refunds the buyer
 *
 * Envelopes ride the encrypted DM channel like the negotiation family, keyed
 * by the negotiation id (escrow is deal-scoped).
 */
import { SCHEMA_VERSION } from './constants.js';

export const ESCROW_REQUEST = 'escrow.request';
export const ESCROW_INVOICE = 'escrow.invoice';
export const ESCROW_RELEASE = 'escrow.release';

export type EscrowMsgType = typeof ESCROW_REQUEST | typeof ESCROW_INVOICE | typeof ESCROW_RELEASE;

export interface EscrowEnvelope {
  v: number;
  type: EscrowMsgType;
  /** Negotiation id this escrow belongs to. */
  nego: string;
  /** Payment hash (hex, 64 chars) — sha256(preimage). Echoed on every message. */
  hash: string;
  /** escrow.request: amount the buyer will lock, in sats. */
  amount_sats?: number;
  /** escrow.invoice: the seller's hold invoice on `hash`. */
  invoice?: string;
  /** escrow.release: the buyer's preimage (hex, 64 chars). */
  preimage?: string;
  ts: number;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const HEX64 = /^[0-9a-f]{64}$/;

export const makeEscrowRequest = (nego: string, hash: string, amountSats: number): EscrowEnvelope =>
  ({ v: SCHEMA_VERSION, type: ESCROW_REQUEST, nego, hash, amount_sats: amountSats, ts: nowSec() });
export const makeEscrowInvoice = (nego: string, hash: string, invoice: string): EscrowEnvelope =>
  ({ v: SCHEMA_VERSION, type: ESCROW_INVOICE, nego, hash, invoice, ts: nowSec() });
export const makeEscrowRelease = (nego: string, hash: string, preimage: string): EscrowEnvelope =>
  ({ v: SCHEMA_VERSION, type: ESCROW_RELEASE, nego, hash, preimage, ts: nowSec() });

export function parseEscrowEnvelope(json: string): EscrowEnvelope | null {
  let msg: EscrowEnvelope;
  try {
    msg = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  if (msg.v !== SCHEMA_VERSION) return null;
  if (msg.type !== ESCROW_REQUEST && msg.type !== ESCROW_INVOICE && msg.type !== ESCROW_RELEASE) return null;
  if (typeof msg.nego !== 'string' || !msg.nego) return null;
  if (typeof msg.hash !== 'string' || !HEX64.test(msg.hash)) return null;
  if (msg.type === ESCROW_REQUEST && (typeof msg.amount_sats !== 'number' || !Number.isFinite(msg.amount_sats) || msg.amount_sats <= 0)) return null;
  if (msg.type === ESCROW_INVOICE && (typeof msg.invoice !== 'string' || !/^ln/i.test(msg.invoice))) return null;
  if (msg.type === ESCROW_RELEASE && (typeof msg.preimage !== 'string' || !HEX64.test(msg.preimage))) return null;
  if (typeof msg.ts !== 'number') return null;
  return msg;
}
