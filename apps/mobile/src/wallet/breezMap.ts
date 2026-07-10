/**
 * Pure mapping from Breez SDK Spark `Payment` objects to WalletTx.
 * Kept dependency-free so it can be unit-tested without loading the SDK.
 */
import type { WalletTx } from './types';

export interface SparkPayment {
  paymentType: 'send' | 'receive';
  status: 'completed' | 'pending' | 'failed';
  /** sats (the SDK returns bigint; number accepted for tests) */
  amount: bigint | number;
  /** unix seconds */
  timestamp: number;
  details?: { type: string; description?: string };
}

export function mapSparkPayments(payments: SparkPayment[]): WalletTx[] {
  return payments
    .filter((p) => p.status !== 'failed')
    .map((p) => ({
      direction: p.paymentType === 'receive' ? ('in' as const) : ('out' as const),
      sats: Number(p.amount),
      description: p.details?.type === 'lightning' ? p.details.description || undefined : undefined,
      ts: p.timestamp,
      settled: p.status === 'completed',
    }));
}
