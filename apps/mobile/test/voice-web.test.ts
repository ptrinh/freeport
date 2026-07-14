/**
 * Web voice playback (voice.web.ts): play/pause toggling, tap-to-seek and
 * hold-for-2x — the behaviors behind three user bug reports ("bấm Play mà
 * cứ dừng ở 0:00", tua nhanh, x2 speed). HTMLAudio is stubbed; the module
 * state is reset per test via vi.resetModules().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 120; // seconds; tests override for the unknown-duration case
  playbackRate = 1;
  readyState = 2;
  listeners = new Map<string, Array<() => void>>();
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  addEventListener(ev: string, fn: () => void, _opts?: unknown) {
    const arr = this.listeners.get(ev) ?? [];
    arr.push(fn);
    this.listeners.set(ev, arr);
  }
  fire(ev: string) { for (const fn of this.listeners.get(ev) ?? []) fn(); }
  async play() { this.paused = false; this.fire('play'); }
  pause() { this.paused = true; this.fire('pause'); }
}

async function loadVoice() {
  vi.resetModules();
  FakeAudio.instances = [];
  (globalThis as any).Audio = FakeAudio;
  return await import('../src/voice.web');
}

beforeEach(() => { delete (globalThis as any).Audio; });

describe('voice.web playback', () => {
  it('toggleVoice actually starts the clip and reports progress (the 0:00 bug)', async () => {
    const v = await loadVoice();
    const seen: any[] = [];
    await v.toggleVoice('https://x/clip.m4a', (st) => seen.push(st));
    const el = FakeAudio.instances[0];
    expect(el.paused).toBe(false);              // playback really started
    el.currentTime = 3;
    el.fire('timeupdate');
    const last = seen[seen.length - 1];
    expect(last.playing).toBe(true);
    expect(last.positionMillis).toBe(3000);
    expect(last.durationMillis).toBe(120000);
  });

  it('same URL toggles pause/resume; a different URL stops the old clip', async () => {
    const v = await loadVoice();
    await v.toggleVoice('https://x/a.m4a', () => {});
    const a = FakeAudio.instances[0];
    await v.toggleVoice('https://x/a.m4a', () => {});
    expect(a.paused).toBe(true);                // second tap paused
    let aDone: any = null;
    await v.toggleVoice('https://x/a.m4a', (st) => { aDone = st; });
    expect(a.paused).toBe(false);               // third tap resumed
    await v.toggleVoice('https://x/b.m4a', () => {});
    expect(a.paused).toBe(true);                // switching clips stops A…
    expect(aDone?.done).toBe(true);             // …and tells A's bubble to reset
    expect(FakeAudio.instances[1].paused).toBe(false);
  });

  it('seekVoice jumps to the tapped fraction and starts playback if idle', async () => {
    const v = await loadVoice();
    await v.seekVoice('https://x/clip.m4a', 0.5, () => {});
    const el = FakeAudio.instances[0];
    expect(el.currentTime).toBe(60);            // 0.5 × 120s
    expect(el.paused).toBe(false);
  });

  it('seekVoice on an unknown-duration stream skips the jump but still plays', async () => {
    const v = await loadVoice();
    await v.toggleVoice('https://x/stream.webm', () => {});
    const el = FakeAudio.instances[0];
    el.duration = Infinity;                     // Chrome MediaRecorder streams
    await v.seekVoice('https://x/stream.webm', 0.5, () => {});
    expect(el.currentTime).toBe(0);             // no bogus seek
    expect(el.paused).toBe(false);
  });

  it('setVoiceRate applies immediately, sticks for the NEXT clip, and is reported', async () => {
    const v = await loadVoice();
    const seen: any[] = [];
    await v.toggleVoice('https://x/a.m4a', (st) => seen.push(st));
    await v.setVoiceRate(2);
    expect(FakeAudio.instances[0].playbackRate).toBe(2);
    expect(seen[seen.length - 1].rate).toBe(2); // badge state comes from the status
    expect(v.voiceRate()).toBe(2);
    await v.toggleVoice('https://x/b.m4a', () => {});
    expect(FakeAudio.instances[1].playbackRate).toBe(2); // remembered across clips
  });
});
