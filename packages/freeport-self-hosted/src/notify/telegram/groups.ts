/**
 * Per-chat group-feed configuration, persisted to disk with the same debounced
 * atomic-write pattern as the subscription store. A group has:
 *   - watches[]: which intents to relay into the chat (topic and/or radius),
 *     reusing the notifier's SubFilters shape so match.ts applies verbatim.
 *   - listen: whether the bot parses organic member posts (Hitcher template) and
 *     offers a one-tap "broadcast to Freeport" button.
 *   - posted{}: intent d-tag → the message we posted, so a replaceable-event
 *     edit or a withdrawal updates that message instead of double-posting.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SubFilters } from '../store.js';

export interface GroupWatch { id: string; filters: SubFilters; createdBy?: number; createdAt: number }
export interface PostedMsg { messageId: number; createdAt: number; expiresAt: number }
export interface GroupRecord {
  chatId: number;
  title?: string;
  listen: boolean;
  watches: GroupWatch[];
  posted: Record<string, PostedMsg>;
}

const POSTED_MAX = 200; // cap the per-chat posted-message map

export class GroupStore {
  private map = new Map<number, GroupRecord>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly path: string, private readonly flushDelayMs = 1500) {
    if (existsSync(path)) {
      try {
        for (const r of JSON.parse(readFileSync(path, 'utf8')) as GroupRecord[]) {
          r.watches ??= []; r.posted ??= {}; r.listen ??= false;
          this.map.set(r.chatId, r);
        }
      } catch { /* start empty on corrupt file */ }
    }
    const onExit = () => { if (this.flushTimer) this.flushNow(); };
    process.once('SIGTERM', onExit); process.once('SIGINT', onExit); process.once('beforeExit', onExit);
  }

  private get(chatId: number, title?: string): GroupRecord {
    let r = this.map.get(chatId);
    if (!r) { r = { chatId, title, listen: false, watches: [], posted: {} }; this.map.set(chatId, r); }
    if (title) r.title = title;
    return r;
  }

  all(): GroupRecord[] { return [...this.map.values()]; }
  size(): number { return this.map.size; }
  record(chatId: number): GroupRecord | undefined { return this.map.get(chatId); }

  addWatch(chatId: number, filters: SubFilters, by?: number, title?: string): GroupWatch {
    const r = this.get(chatId, title);
    const id = `${filters.topics?.join(',') ?? ''}|${filters.near ? `${filters.near.lat},${filters.near.lon},${filters.near.radiusKm}` : ''}`;
    const existing = r.watches.find((w) => w.id === id);
    if (existing) { existing.filters = filters; }
    else r.watches.push({ id, filters, createdBy: by, createdAt: Date.now() });
    this.scheduleFlush();
    return r.watches.find((w) => w.id === id)!;
  }

  /** Remove one watch by topic, or all watches when topic === 'all'. Returns count removed. */
  removeWatch(chatId: number, topic: string): number {
    const r = this.map.get(chatId);
    if (!r) return 0;
    const before = r.watches.length;
    r.watches = topic === 'all' ? [] : r.watches.filter((w) => !(w.filters.topics ?? []).includes(topic));
    this.scheduleFlush();
    return before - r.watches.length;
  }

  setListen(chatId: number, on: boolean, title?: string): void {
    this.get(chatId, title).listen = on;
    this.scheduleFlush();
  }

  removeChat(chatId: number): void {
    if (this.map.delete(chatId)) this.scheduleFlush();
  }

  /** Record (or replace) the message we posted for an intent d-tag; prunes the map. */
  setPosted(chatId: number, d: string, msg: PostedMsg): void {
    const r = this.map.get(chatId);
    if (!r) return;
    r.posted[d] = msg;
    const entries = Object.entries(r.posted);
    if (entries.length > POSTED_MAX) {
      entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
      for (const [key] of entries.slice(0, entries.length - POSTED_MAX)) delete r.posted[key];
    }
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
  }
}
