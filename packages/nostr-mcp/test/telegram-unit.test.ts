import { describe, it, expect, vi } from 'vitest';
import { TelegramApi, GoneError, RetryAfterError } from '../src/notify/telegram/api.js';
import { SendQueue } from '../src/notify/telegram/queue.js';
import { LinkCodes } from '../src/notify/telegram/linkcodes.js';
import { parseHitch, broadcastUrl } from '../src/notify/telegram/listen.js';

function fakeFetch(responses: any[]) {
  const calls: { url: string; body: any }[] = [];
  const fn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { json: async () => responses.shift() } as any;
  });
  return Object.assign(fn, { calls });
}

describe('TelegramApi error classification', () => {
  it('returns the result on ok', async () => {
    const api = new TelegramApi('t', fakeFetch([{ ok: true, result: { id: 1, username: 'FreeportBot' } }]) as any);
    expect(await api.getMe()).toEqual({ id: 1, username: 'FreeportBot' });
  });
  it('throws GoneError on 403 (bot blocked) and 400 chat not found', async () => {
    const api1 = new TelegramApi('t', fakeFetch([{ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }]) as any);
    await expect(api1.sendMessage(1, 'x')).rejects.toBeInstanceOf(GoneError);
    const api2 = new TelegramApi('t', fakeFetch([{ ok: false, error_code: 400, description: 'Bad Request: chat not found' }]) as any);
    await expect(api2.sendMessage(1, 'x')).rejects.toBeInstanceOf(GoneError);
  });
  it('throws RetryAfterError on 429 carrying retry_after', async () => {
    const api = new TelegramApi('t', fakeFetch([{ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } }]) as any);
    await expect(api.sendMessage(1, 'x')).rejects.toMatchObject({ retryAfterSec: 7 });
  });
  it('swallows "message is not modified" on edit', async () => {
    const api = new TelegramApi('t', fakeFetch([{ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }]) as any);
    await expect(api.editMessageText(1, 2, 'x')).resolves.toBeUndefined();
  });
  it('throws a generic error on other failures', async () => {
    const api = new TelegramApi('t', fakeFetch([{ ok: false, error_code: 500, description: 'Internal' }]) as any);
    await expect(api.sendMessage(1, 'x')).rejects.toThrow(/500/);
  });
});

describe('SendQueue', () => {
  function clockQueue() {
    let clock = 0;
    const q = new SendQueue((ms) => { clock += ms; return Promise.resolve(); }, () => clock);
    return { q, at: () => clock };
  }

  it('spaces sends to the same chat by ≥3s', async () => {
    const { q, at } = clockQueue();
    const times: number[] = [];
    await q.enqueue(1, async () => { times.push(at()); });
    await q.enqueue(1, async () => { times.push(at()); });
    expect(times[0]).toBe(0);
    expect(times[1]).toBeGreaterThanOrEqual(3000);
  });

  it('retries once after a RetryAfterError, honoring the delay', async () => {
    const { q } = clockQueue();
    let n = 0;
    const result = await q.enqueue(1, async () => { if (n++ === 0) throw new RetryAfterError(5); return 'done'; });
    expect(result).toBe('done');
    expect(n).toBe(2);
  });

  it('a failed task does not stall the chain', async () => {
    const { q } = clockQueue();
    await expect(q.enqueue(1, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(q.enqueue(1, async () => 'ok')).resolves.toBe('ok');
  });
});

describe('LinkCodes', () => {
  it('is single-use and returns the bound pubkey', () => {
    const codes = new LinkCodes();
    const pk = 'a'.repeat(64);
    const code = codes.create(pk);
    expect(codes.consume(code)).toBe(pk);
    expect(codes.consume(code)).toBeNull(); // already used
  });
  it('expires after 10 minutes', () => {
    let t = 0;
    const codes = new LinkCodes(() => t);
    const code = codes.create('b'.repeat(64));
    t = 11 * 60 * 1000;
    expect(codes.consume(code)).toBeNull();
  });
  it('rejects unknown codes', () => {
    expect(new LinkCodes().consume('nope')).toBeNull();
  });
});

describe('parseHitch — real SGP Hitch template posts', () => {
  it('parses the postal-code pickup sample', () => {
    expect(parseHitch('👋 Hitcher looking for driver 🚗\n\nPick up: 730336\nDrop off: Tanjong Pagar plaza\nDate: today\nTime: now\nPax: 1\n\npls pm me, thank you!'))
      .toEqual({ from: '730336', to: 'Tanjong Pagar plaza', when: 'now', pax: 1 });
  });
  it('parses the place-name sample', () => {
    expect(parseHitch('👋 Hitcher looking for driver\n\nPick up: mcnair\nDrop off: woodlands\nDate: today\nTime: now\nPax: 1\n\npls pm me, thank you!'))
      .toEqual({ from: 'mcnair', to: 'woodlands', when: 'now', pax: 1 });
  });
  it('is case- and label-variant tolerant (Pick Up / Drop Off, Pax 2)', () => {
    expect(parseHitch('🚗 Hitcher Looking for Driver\n\nPick Up: tai Seng\nDrop Off: Hougang\nDate: today\nTime: now\nPax: 2\n\nplease pm me urgent! thank you!'))
      .toEqual({ from: 'tai Seng', to: 'Hougang', when: 'now', pax: 2 });
  });
  it('returns null when both endpoints are not present', () => {
    expect(parseHitch('anyone going to town later? pm me')).toBeNull();
    expect(parseHitch('Pick up: somewhere\n(no drop off)')).toBeNull();
  });
  it('builds a prefilled broadcast URL', () => {
    const url = broadcastUrl('https://freeport.trinh.uk', { from: '730336', to: 'Tanjong Pagar', when: 'now', pax: 1 });
    expect(url).toContain('tab=post');
    expect(url).toContain('from=730336');
    expect(url).toContain('to=Tanjong+Pagar');
    expect(url).toContain('when=now');
    expect(url).toContain('pax=1');
  });
});
