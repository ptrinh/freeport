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
import { perfSpans, perfCounters } from './perfSpans';

const TICK_MS = 100;
const RUN_MS = 8_000;
/** Drift below this is normal scheduler jitter, not a stall. */
const STALL_MIN_MS = 120;

let running = false;

export function startPerfProbe(tag: 'launch' | 'resume'): void {
  if (running) return; // one probe at a time; overlapping AppState flips are noise
  running = true;
  const stalls: Array<{ ms: number; at: number }> = [];
  let blocked = 0;
  let last = Date.now();
  const started = last;
  const verify0 = { ...perfCounters };
  const tick = () => {
    const now = Date.now();
    const drift = now - last - TICK_MS;
    // `at` = offset of the stall's START within the window — lines up with the
    // span/mark timeline so the blocking phase is identifiable by position.
    if (drift >= STALL_MIN_MS) { stalls.push({ ms: drift, at: last - started }); blocked += drift; }
    last = now;
    if (now - started < RUN_MS) { setTimeout(tick, TICK_MS); return; }
    running = false;
    report(tag, blocked, stalls, now - started, started, {
      verifyCount: perfCounters.verifyCount - verify0.verifyCount,
      verifyMs: perfCounters.verifyMs - verify0.verifyMs,
    });
  };
  setTimeout(tick, TICK_MS);
}

function report(tag: string, blockedMs: number, stalls: Array<{ ms: number; at: number }>, windowMs: number, startedAt: number, verify: { verifyCount: number; verifyMs: number }): void {
  try {
    const S = getSentry();
    if (!S) return;
    stalls.sort((a, b) => b.ms - a.ms);
    // Named spans that overlapped the probe window (small lead-in included —
    // launch work often starts just before the probe does): the "who".
    const spans = perfSpans
      .filter((sp) => sp.at + sp.ms >= startedAt - 2000)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 15)
      .map((sp) => `${sp.l}:${sp.ms}ms@+${Math.max(0, sp.at - startedAt)}`);
    S.captureMessage(`[fp-perf] ${tag}: js blocked ${Math.round(blockedMs)}ms / ${Math.round(windowMs)}ms`, {
      level: 'info',
      extra: {
        tag,
        blockedMs: Math.round(blockedMs),
        windowMs: Math.round(windowMs),
        stallCount: stalls.length,
        topStallsMs: stalls.slice(0, 10).map((st) => `${st.ms}ms@+${st.at}`),
        verifyCount: verify.verifyCount,
        verifyMs: verify.verifyMs,
        spans,
      },
    });
  } catch { /* telemetry is best-effort */ }
}
