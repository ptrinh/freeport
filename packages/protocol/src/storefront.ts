/**
 * Persistent storefronts — NIP-15 products (kind 30018) so listings are
 * durable (no expiry, unlike intents) and interoperate with other Nostr
 * Market clients. A Freeport twist: products also carry our market `t` tag
 * so the existing relay subscriptions discover them.
 *
 * Removal follows the intent-withdraw pattern: republish the same d-tag with
 * empty content — relays replace the addressable event, parsers reject it.
 */
import type { EventTemplate } from 'nostr-tools/pure';

/** NIP-15 product (Nostr Market). Addressable: latest (pubkey, kind, d) wins. */
export const KIND_PRODUCT = 30018;

export interface ProductContent {
  /** NIP-15 requires id == the d tag. */
  id: string;
  name: string;
  description?: string;
  images?: string[];
  currency: string; // ISO-ish, e.g. "SGD", "USD", "sats"
  price: number;
  /** null/undefined = unlimited (services). 0 = sold out. */
  quantity?: number | null;
}

export interface Product {
  id: string; // event id
  pubkey: string;
  d: string;
  createdAt: number;
  content: ProductContent;
}

export interface BuildProductInput {
  d: string; // stable product id (mint once, keep across edits)
  market: string; // Freeport discovery tag
  name: string;
  description?: string;
  images?: string[];
  currency: string;
  price: number;
  quantity?: number | null;
  createdAt?: number;
}

export function mintProductId(): string {
  const rnd = new Uint8Array(8);
  globalThis.crypto.getRandomValues(rnd);
  return [...rnd].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildProductTemplate(input: BuildProductInput): EventTemplate {
  const content: ProductContent = {
    id: input.d,
    name: input.name.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.images?.length ? { images: input.images } : {}),
    currency: input.currency,
    price: input.price,
    ...(input.quantity != null ? { quantity: input.quantity } : {}),
  };
  return {
    kind: KIND_PRODUCT,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    tags: [['d', input.d], ['t', input.market]],
    content: JSON.stringify(content),
  };
}

/** Tombstone template — same d, empty content (see module doc). */
export function buildProductRemovalTemplate(d: string, market: string): EventTemplate {
  return {
    kind: KIND_PRODUCT,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', d], ['t', market]],
    content: '',
  };
}

export function parseProductEvent(ev: { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }): Product | null {
  if (ev.kind !== KIND_PRODUCT) return null;
  const d = ev.tags.find((t) => t[0] === 'd')?.[1];
  if (!d || !ev.content) return null; // no d / tombstoned
  let content: ProductContent;
  try {
    content = JSON.parse(ev.content);
  } catch {
    return null;
  }
  if (typeof content !== 'object' || content === null) return null;
  if (typeof content.name !== 'string' || !content.name.trim()) return null;
  if (typeof content.price !== 'number' || !Number.isFinite(content.price) || content.price < 0) return null;
  if (typeof content.currency !== 'string' || !content.currency) return null;
  return { id: ev.id, pubkey: ev.pubkey, d, createdAt: ev.created_at, content };
}
