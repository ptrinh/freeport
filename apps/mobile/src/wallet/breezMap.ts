/**
 * Pure mapping from Breez SDK Spark `Payment` objects to WalletTx.
 * Kept dependency-free so it can be unit-tested without loading the SDK.
 */
import type { WalletTx } from './types';

export interface SparkPayment {
  paymentType: 'send' | 'receive';
  status: 'completed' | 'pending' | 'failed';
  /** sats for BTC rails; token base units for token payments */
  amount: bigint | number;
  /** unix seconds */
  timestamp: number;
  details?: { type: string; description?: string; metadata?: { ticker?: string; decimals?: number } };
}

export function mapSparkPayments(payments: SparkPayment[]): WalletTx[] {
  return payments
    .filter((p) => p.status !== 'failed')
    .map((p) => {
      const isToken = p.details?.type === 'token' && p.details.metadata;
      return {
        direction: p.paymentType === 'receive' ? ('in' as const) : ('out' as const),
        sats: isToken ? 0 : Number(p.amount),
        ...(isToken ? { token: {
          ticker: p.details!.metadata!.ticker || 'TOKEN',
          amount: Number(p.amount) / 10 ** Number(p.details!.metadata!.decimals ?? 0),
        } } : {}),
        description: p.details?.type === 'lightning' ? p.details.description || undefined : undefined,
        ts: p.timestamp,
        settled: p.status === 'completed',
      };
    });
}
