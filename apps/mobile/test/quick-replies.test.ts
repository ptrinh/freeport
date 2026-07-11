import { describe, it, expect } from 'vitest';
import { p2pMethodForCountry, defaultCustomMessage, quickReplies, newlyConfirmed } from '../src/quickReplies';
import type { Negotiation } from '@freeport/protocol';

describe('REQUIREMENT: gợi ý phương thức P2P tức thời theo quốc gia', () => {
  it('US → Zelle, SG → PayNow', () => {
    expect(p2pMethodForCountry('US')).toBe('Zelle');
    expect(p2pMethodForCountry('SG')).toBe('PayNow');
    expect(p2pMethodForCountry('sg')).toBe('PayNow'); // case-insensitive
  });

  it('không có rail nào biết đến → cash (null)', () => {
    expect(p2pMethodForCountry('FR')).toBeNull();
    expect(p2pMethodForCountry('')).toBeNull();
  });

  it('template mẫu: có dòng payment method + xin rate sau deal', () => {
    const us = defaultCustomMessage('US');
    expect(us).toContain('Zelle: ...');
    expect(us).toContain('💵');
    expect(us).toContain('🙏');
    expect(us).toMatch(/rate me after the deal/i);
    // unknown country falls back to cash on the same line
    const fr = defaultCustomMessage('FR');
    expect(fr).toContain('Cash');
    expect(fr).not.toContain(': ...');
  });
});

describe('REQUIREMENT: 3 quick replies trong chat box', () => {
  it('luôn có "I am here ✅" và "Please wait ⏳"; custom chỉ khi đã set', () => {
    const bare = quickReplies('');
    expect(bare.map((q) => q.label)).toEqual(['I am here ✅', 'Please wait ⏳']);
    const withCustom = quickReplies('Zelle: me@x.com');
    expect(withCustom).toHaveLength(3);
    expect(withCustom[2].label).toBe('Custom message');
    expect(withCustom[2].text).toBe('Zelle: me@x.com');
  });

  it('custom toàn khoảng trắng coi như chưa set', () => {
    expect(quickReplies('   \n ')).toHaveLength(2);
  });

  it('chip gửi đúng nội dung text (label = text cho 2 chip cố định)', () => {
    const [here, wait] = quickReplies('');
    expect(here.text).toBe(here.label);
    expect(wait.text).toBe(wait.label);
  });
});

const nego = (id: string, state: string, stage?: string): Negotiation =>
  ({ id, state, stage } as unknown as Negotiation);

describe('REQUIREMENT: auto-send đúng deal vừa confirmed, mỗi deal một lần', () => {
  it('chỉ chọn deal confirmed chưa xử lý', () => {
    const negos = [nego('a', 'confirmed'), nego('b', 'negotiating'), nego('c', 'confirmed')];
    const out = newlyConfirmed(negos, new Set(['a']));
    expect(out.map((n) => n.id)).toEqual(['c']);
  });

  it('bỏ qua deal đã completed (replay cũ không được nhắn)', () => {
    const negos = [nego('a', 'confirmed', 'completed'), nego('b', 'confirmed', 'picked_up')];
    expect(newlyConfirmed(negos, new Set()).map((n) => n.id)).toEqual(['b']);
  });

  it('không chọn cancelled/expired', () => {
    const negos = [nego('a', 'cancelled'), nego('b', 'expired'), nego('c', 'cancel_requested')];
    expect(newlyConfirmed(negos, new Set())).toEqual([]);
  });
});
