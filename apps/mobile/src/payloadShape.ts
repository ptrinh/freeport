/**
 * Typed view over an intent's free-form `payload` (protocol-side it is
 * `Record<string, unknown>` on purpose — schemas evolve without protocol
 * bumps). UI code that pokes known fields casts through this instead of
 * `as any`, so typos in field names still fail to compile while unknown
 * extra fields stay legal.
 */
/** A place reference inside a payload: pinned point and/or label. */
export interface PlaceRef { geohash?: string; name?: string }

export interface KnownPayload {
  withdrawn?: boolean;
  geohash?: string;
  to_geohash?: string;
  payment?: string;
  name?: string;
  category?: string;
  subcategory?: string;
  duration_minutes?: number;
  from?: PlaceRef;
  to?: PlaceRef;
  location?: PlaceRef;
  service?: string;
  notes?: string;
  vehicle?: string;
  when?: string;
  pax?: number;
  phone?: string;
  note?: string;
  [k: string]: unknown;
}

/** The payload, viewed through the known-field lens. */
export function payloadOf(x: { content: { payload: Record<string, unknown> } }): KnownPayload {
  return x.content.payload as KnownPayload;
}
