/**
 * Guest accounts for Telegram-native users who post without the app. The bridge
 * custodies one keypair per user, encrypted at rest with NIP-49 (passphrase from
 * TELEGRAM_GUEST_KEY_PASSPHRASE). This is deliberately a CUSTODIAL trade-off —
 * zero-install in exchange for the operator holding low-value, freshly-minted
 * keys. Guests can /exportkey to graduate to the sovereign app, or /forgetme.
 *
 * Persisted with the same debounced atomic-write pattern as the subscription
 * store; only the ncryptsec (never the plaintext key) touches disk.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip49 from 'nostr-tools/nip49';
import * as nip19 from 'nostr-tools/nip19';

export interface GuestPost {
  d: string;
  eventId: string;
  market: string;
  schema: string;
  title: string;
  createdAt: number;
  expiresAt: number;
  status: 'live' | 'dealt' | 'expired' | 'withdrawn';
  intentJson: string; // serialized Intent — re-registered on the agent at boot
}

export interface GuestRecord {
  telegramUserId: number;
  chatId: number;
  ncryptsec: string;
  pubkey: string;
  contact?: string;
  contactConsentAt?: number;
  status: 'active' | 'graduated' | 'deleted';
  createdAt: number;
  lastActivityAt: number;
  posts: GuestPost[];
  postsToday: { day: string; count: number };
  exportedAt?: number;
}

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export class GuestStore {
  private map = new Map<number, GuestRecord>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly path: string, private readonly passphrase: string, private readonly flushDelayMs = 1500) {
    if (existsSync(path)) {
      try {
        for (const r of JSON.parse(readFileSync(path, 'utf8')) as GuestRecord[]) { r.posts ??= []; this.map.set(r.telegramUserId, r); }
      } catch { /* start empty on corrupt file */ }
    }
    const onExit = () => { if (this.flushTimer) this.flushNow(); };
    process.once('SIGTERM', onExit); process.once('SIGINT', onExit); process.once('beforeExit', onExit);
  }

  get(userId: number): GuestRecord | undefined { return this.map.get(userId); }
  all(): GuestRecord[] { return [...this.map.values()]; }
  size(): number { return this.map.size; }
  byPubkey(pubkey: string): GuestRecord | undefined { return [...this.map.values()].find((r) => r.pubkey === pubkey); }

  /** Create a guest with a fresh keypair (generated on their first post). */
  create(userId: number, chatId: number): GuestRecord {
    const sk = generateSecretKey();
    const rec: GuestRecord = {
      telegramUserId: userId, chatId,
      ncryptsec: nip49.encrypt(sk, this.passphrase),
      pubkey: getPublicKey(sk),
      status: 'active', createdAt: Date.now(), lastActivityAt: Date.now(),
      posts: [], postsToday: { day: today(), count: 0 },
    };
    sk.fill(0);
    this.map.set(userId, rec);
    this.scheduleFlush();
    return rec;
  }

  /** Decrypt a guest's secret key for use by a live agent. Caller zeroes it. */
  decryptKey(rec: GuestRecord): Uint8Array {
    return nip49.decrypt(rec.ncryptsec, this.passphrase);
  }

  /** The bare nsec for /exportkey (graduation to the app). */
  exportNsec(rec: GuestRecord): string {
    const sk = this.decryptKey(rec);
    const nsec = nip19.nsecEncode(sk);
    sk.fill(0);
    return nsec;
  }

  setContact(userId: number, contact: string): void {
    const r = this.map.get(userId); if (!r) return;
    r.contact = contact; r.contactConsentAt = Date.now(); this.touch(userId);
  }

  /** Daily + active-post quota gate. Returns null when ok, else a reason. */
  quotaReason(userId: number, maxPerDay: number, maxActive: number): string | null {
    const r = this.map.get(userId);
    if (!r) return null; // first post — created after this check
    if (r.postsToday.day !== today()) r.postsToday = { day: today(), count: 0 };
    if (r.postsToday.count >= maxPerDay) return `Daily limit reached (${maxPerDay} posts/day).`;
    if (this.activePosts(r).length >= maxActive) return `You already have ${maxActive} active posts. Cancel one first (/myposts).`;
    return null;
  }

  addPost(userId: number, post: GuestPost): void {
    const r = this.map.get(userId); if (!r) return;
    if (r.postsToday.day !== today()) r.postsToday = { day: today(), count: 0 };
    r.postsToday.count++;
    r.posts.push(post);
    this.touch(userId);
  }

  activePosts(rec: GuestRecord, now = Math.floor(Date.now() / 1000)): GuestPost[] {
    return rec.posts.filter((p) => p.status === 'live' && p.expiresAt > now);
  }

  setPostStatus(userId: number, d: string, status: GuestPost['status']): void {
    const r = this.map.get(userId); if (!r) return;
    const p = r.posts.find((x) => x.d === d); if (p) { p.status = status; this.touch(userId); }
  }

  touch(userId: number): void {
    const r = this.map.get(userId); if (!r) return;
    r.lastActivityAt = Date.now(); this.scheduleFlush();
  }

  markExported(userId: number): void {
    const r = this.map.get(userId); if (!r) return;
    r.exportedAt = Date.now(); this.touch(userId);
  }

  /** Stop acting as this guest's agent; the app now holds the key. */
  markGraduated(userId: number): void {
    const r = this.map.get(userId); if (!r) return;
    r.status = 'graduated'; this.touch(userId);
  }

  /** GDPR: forget the guest. Keeps a minimal tombstone so a delete/recreate
   *  cycle can't reset the daily quota within the day. */
  forget(userId: number): void {
    const r = this.map.get(userId);
    this.map.set(userId, {
      telegramUserId: userId, chatId: r?.chatId ?? 0, ncryptsec: '', pubkey: '',
      status: 'deleted', createdAt: r?.createdAt ?? Date.now(), lastActivityAt: Date.now(),
      posts: [], postsToday: r?.postsToday ?? { day: today(), count: 0 },
    });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flushNow(), this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  private flushNow(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.map.values()], null, 2));
    renameSync(tmp, this.path);
    try { chmodSync(this.path, 0o600); } catch { /* best-effort on non-POSIX */ }
  }
}
