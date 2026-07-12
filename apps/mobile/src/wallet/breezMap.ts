/**
 * Pure mapping from Breez SDK Spark `Payment` objects to WalletTx.
 * Kept dependency-free so it can be unit-tested without loading the SDK.
 */
import type { WalletTx } from './types';
import { variantDetails, variantOf } from './breezShapes';

export interface SparkPayment {
  /** string on WASM; numeric PaymentType enum on native (Send=0, Receive=1) */
  paymentType: 'send' | 'receive' | number;
  /** string on WASM; numeric PaymentStatus enum on native (Completed=0, Pending=1, Failed=2) */
  status: 'completed' | 'pending' | 'failed' | number;
  /** sats for BTC rails; token base units for token payments */
  amount: bigint | number;
  /** unix seconds */
  timestamp: number;
  /** WASM: plain {type, …fields}; native: uniffi enum (tag + inner[0]) */
  details?: any;
}

export function mapSparkPayments(payments: SparkPayment[]): WalletTx[] {
  return payments
    .filter((p) => !(p.status === 'failed' || p.status === 2))
    .map((p) => {
      const kind = variantOf(p.details);
      const d = variantDetails(p.details);
      const isToken = kind === 'token' && d?.metadata;
      return {
        direction: p.paymentType === 'receive' || p.paymentType === 1 ? ('in' as const) : ('out' as const),
        sats: isToken ? 0 : Number(p.amount),
        ...(isToken ? { token: {
          ticker: d.metadata.ticker || 'TOKEN',
          amount: Number(p.amount) / 10 ** Number(d.metadata.decimals ?? 0),
        } } : {}),
        description: kind === 'lightning' ? d?.description || undefined : undefined,
        ts: p.timestamp,
        settled: p.status === 'completed' || p.status === 0,
      };
    });
}
