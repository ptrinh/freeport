/**
 * Lightweight named timing spans, consumed by perfProbe's [fp-perf] report.
 * The probe told us the JS thread stalls (one 3.7s block at launch) but not
 * WHERE — these spans name the culprit. Import-free on purpose: client.ts
 * stays react-native-free (node tests), and anything may record a span.
 *
 * Only spans ≥ SPAN_MIN_MS are kept — the hot paths stay allocation-free.
 */
export interface PerfSpan { l: string; ms: number; at: number }

const SPAN_MIN_MS = 50;
const CAP = 100;

export const perfSpans: PerfSpan[] = [];

function record(label: string, t0: number): void {
  const ms = Date.now() - t0;
  if (ms < SPAN_MIN_MS) return;
  perfSpans.push({ l: label, ms, at: t0 });
  if (perfSpans.length > CAP) perfSpans.shift();
}

/** Time a synchronous block. */
export function timeSync<T>(label: string, fn: () => T): T {
  const t0 = Date.now();
  try { return fn(); } finally { record(label, t0); }
}

/** Time an async block (includes awaited I/O — read alongside sync spans). */
export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try { return await fn(); } finally { record(label, t0); }
}

/** Zero-duration milestone (always kept) — anchors the report's timeline. */
export function mark(label: string): void {
  perfSpans.push({ l: label, ms: 0, at: Date.now() });
  if (perfSpans.length > CAP) perfSpans.shift();
}
