/**
 * Launch/resume performance probe. Measures how long the JS thread is blocked
 * during the first seconds after a launch or foreground resume by sampling
 * event-loop drift: a 100ms setTimeout chain whose callbacks arrive late
 * exactly when something hogged the thread. Reports one `[fp-perf]` info
 * event to GlitchTip (gated on the same diagnostics opt-in as crash reports)
 * with total blocked time and the largest stalls — so "the app feels laggy
 * for 4s" turns into "the JS thread was blocked N ms by ...(or wasn't, so
 * look at the native/UI thread instead)".
 *
 * Deliberately dumb and allocation-free in the hot path; ~80 ticks per run.
 */
import { getSentry } from './telemetry';

const TICK_MS = 100;
const RUN_MS = 8_000;
/** Drift below this is normal scheduler jitter, not a stall. */
const STALL_MIN_MS = 120;

let running = false;

export function startPerfProbe(tag: 'launch' | 'resume'): void {
  if (running) return; // one probe at a time; overlapping AppState flips are noise
  running = true;
  const stalls: number[] = [];
  let blocked = 0;
  let last = Date.now();
  const started = last;
  const tick = () => {
    const now = Date.now();
    const drift = now - last - TICK_MS;
    if (drift >= STALL_MIN_MS) { stalls.push(drift); blocked += drift; }
    last = now;
    if (now - started < RUN_MS) { setTimeout(tick, TICK_MS); return; }
    running = false;
    report(tag, blocked, stalls, now - started);
  };
  setTimeout(tick, TICK_MS);
}

function report(tag: string, blockedMs: number, stalls: number[], windowMs: number): void {
  try {
    const S = getSentry();
    if (!S) return;
    stalls.sort((a, b) => b - a);
    S.captureMessage(`[fp-perf] ${tag}: js blocked ${Math.round(blockedMs)}ms / ${Math.round(windowMs)}ms`, {
      level: 'info',
      extra: {
        tag,
        blockedMs: Math.round(blockedMs),
        windowMs: Math.round(windowMs),
        stallCount: stalls.length,
        topStallsMs: stalls.slice(0, 10),
      },
    });
  } catch { /* telemetry is best-effort */ }
}
