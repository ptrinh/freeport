import { describe, it, expect } from 'vitest';
import { repostDraft } from '../src/deals';
import type { Intent } from '@freeport/protocol';

const make = (schema: string, payload: any) => ({
  id: 'x', pubkey: 'p'.repeat(64), createdAt: 1, expiresAt: 2,
  content: { schema, market: 'sg-rideshare', payload },
}) as unknown as Intent;

describe('repostDraft (Repost copies everything except the time)', () => {
  it('maps a rideshare post: route + pin, category, price, note, images', () => {
    const d = repostDraft(make('rideshare.request.v1', {
      from: { name: '237 Xóm Chùa', geohash: 'w3gvd3xk' },
      to: { name: 'Landmark 81', geohash: 'w3gvk9qp' },
      category: 'compact', payment: 'S$5', note: '2 vali',
      images: ['https://x/img.jpg'],
      window: { start: 1, end: 2 }, // time-ish fields must NOT carry over
    }));
    expect(d).toMatchObject({
      schema: 'rideshare.request.v1',
      from: '237 Xóm Chùa', fromGeohash: 'w3gvd3xk',
      to: 'Landmark 81',
      category: 'compact', payment: 'S$5', note: '2 vali',
      images: ['https://x/img.jpg'],
    });
    expect(JSON.stringify(d)).not.toContain('window');
  });

  it('maps a service post incl. duration and subcategory', () => {
    const d = repostDraft(make('service.offer.v1', {
      location: { name: 'Quận 1', geohash: 'w3gv' },
      service: 'Sửa điều hòa', category: 'repair', subcategory: 'hvac',
      payment: '₫200.000', duration_minutes: 90, notes: 'mang thang',
    }));
    expect(d).toMatchObject({
      location: 'Quận 1', locationGeohash: 'w3gv',
      service: 'Sửa điều hòa', category: 'repair', subcategory: 'hvac',
      payment: '₫200.000', durationMinutes: 90, note: 'mang thang',
    });
  });

  it('tolerates sparse payloads', () => {
    const d = repostDraft(make('rideshare.request.v1', {}));
    expect(d.schema).toBe('rideshare.request.v1');
    expect(d.from).toBeUndefined();
    expect(d.images).toBeUndefined();
  });
});
