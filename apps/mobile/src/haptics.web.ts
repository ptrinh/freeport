/* eslint-disable @typescript-eslint/no-explicit-any -- navigator vibration/gamepad haptics are untyped vendor APIs */
/**
 * Tactile + audible feedback (web).
 *
 * - `wheelTick()` — a short quiet Web-Audio click + a tiny vibration (where the
 *   browser/PWA supports it), so the amount wheel feels like a physical detent.
 * - `eventAlert()` — a new request/message: a two-tone "di-ding" + a longer
 *   vibration pattern. Throttled to collapse bursts.
 *
 * Dependency-free; no-ops gracefully where APIs are missing.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const AC: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

function blip(freq: number, startOffset: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
  const c = ctx!;
  const t = c.currentTime + startOffset;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let lastTick = 0;
export function wheelTick(): void {
  const now = Date.now();
  if (now - lastTick < 35) return;
  lastTick = now;
  try { (navigator as any).vibrate?.(4); } catch { /* ignore */ }
  try { if (audio()) blip(1050, 0, 0.022, 0.007, 'sine'); } catch { /* ignore */ }
}

/** Celebration "tada" — an upward arpeggio + success vibration. */
export function playCelebrate(): void {
  try { (navigator as any).vibrate?.([0, 30, 50, 30, 50, 60]); } catch { /* ignore */ }
  try {
    if (audio()) {
      blip(523, 0, 0.16, 0.10);    // C5
      blip(659, 0.12, 0.16, 0.10); // E5
      blip(784, 0.24, 0.18, 0.10); // G5
      blip(1046, 0.38, 0.9, 0.10); // C6 chord
      blip(1318, 0.38, 0.9, 0.06);
      blip(1568, 0.38, 0.9, 0.05);
    }
  } catch { /* ignore */ }
}

let lastAlert = 0;
export function eventAlert(): void {
  const now = Date.now();
  if (now - lastAlert < 800) return;
  lastAlert = now;
  try { (navigator as any).vibrate?.([0, 40, 70, 40]); } catch { /* ignore */ }
  try {
    if (audio()) {
      blip(880, 0, 0.16, 0.10);    // A5
      blip(1318, 0.12, 0.26, 0.10); // E6 — rising "di-ding"
    }
  } catch { /* ignore */ }
}
