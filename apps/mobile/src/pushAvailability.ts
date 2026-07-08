/**
 * Can the post-onboarding auto-subscribe to the notification server possibly
 * work? Decides whether onboarding should show the old "Keep the app open
 * during a deal — there's no server to hold missed messages." point — true
 * (unavailable) when any of:
 *   - the platform can't push at all (e.g. web outside an installed PWA),
 *   - notification permission is already denied,
 *   - no default notification endpoint is configured,
 *   - the endpoint's /health doesn't respond OK within the timeout.
 *
 * Dependencies are injected (no imports of push.ts/prefs.ts here) so the
 * decision is unit-testable in Node without the Expo native modules.
 */
export type PushStatusLite = 'on' | 'off' | 'denied' | 'unsupported' | 'error';

export interface PushAvailabilityDeps {
  /** Current push capability/permission (pushStatus from src/push). */
  status: () => Promise<PushStatusLite>;
  /** The default notification endpoint (prefs.notifyEndpoint). */
  endpoint: () => Promise<string | undefined>;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchFn?: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean }>;
  /** Health-check cap in ms (default 5000). */
  timeoutMs?: number;
}

export async function pushUnavailableForOnboarding(deps: PushAvailabilityDeps): Promise<boolean> {
  try {
    const st = await deps.status();
    if (st === 'unsupported' || st === 'denied') return true;
    const endpoint = ((await deps.endpoint()) || '').trim();
    if (!endpoint) return true;
    const f = deps.fetchFn ?? (fetch as NonNullable<PushAvailabilityDeps['fetchFn']>);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 5000);
    try {
      const res = await f(endpoint.replace(/\/$/, '') + '/health', { signal: ctrl.signal });
      return !res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return true; // offline/unreachable/aborted → treat as unavailable, warn like before
  }
}
