/**
 * Telemetry — NATIVE (iOS/Android). Crash/error reporting via Sentry (pointed at
 * our self-hosted GlitchTip) + anonymous product analytics via self-hosted
 * Aptabase. All PII scrubbing lives in telemetry-core. A single opt-out flag
 * suppresses everything at runtime; see Settings.
 */
import * as Sentry from '@sentry/react-native';
import { init as aptabaseInit, trackEvent as aptabaseTrack } from '@aptabase/react-native';
import {
  GLITCHTIP_DSN, APTABASE_APP_KEY, APTABASE_HOST, anonInstallId,
  scrubEvent, scrubBreadcrumb, sanitizeProps, isAllowedEvent, type AnalyticsEvent,
} from './telemetry-core';

let enabled = false;
let started = false;

/** Initialise the SDKs once. `on` sets the current opt-in state; when off,
 *  nothing is transmitted (events are dropped in beforeSend / trackEvent). */
export async function initTelemetry(on: boolean): Promise<void> {
  enabled = on;
  if (started) return;
  started = true;
  const id = await anonInstallId();
  try {
    Sentry.init({
      dsn: GLITCHTIP_DSN,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      attachStacktrace: true,
      beforeSend: (event) => (enabled ? (scrubEvent(event as any) as any) : null),
      beforeBreadcrumb: (b) => (enabled ? (scrubBreadcrumb(b as any) as any) : null),
    });
    Sentry.setUser({ id });
  } catch { /* never let telemetry break the app */ }
  try { aptabaseInit(APTABASE_APP_KEY, { host: APTABASE_HOST }); } catch { /* ignore */ }
}

export function setTelemetryEnabled(on: boolean): void {
  enabled = on;
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  try { Sentry.captureException(err, context ? { extra: sanitizeProps(context) } : undefined); } catch { /* ignore */ }
}

export function trackEvent(name: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!enabled || !isAllowedEvent(name)) return;
  try { aptabaseTrack(name, sanitizeProps(props)); } catch { /* ignore */ }
}

/** Wrap the root component so unhandled render errors are captured. */
export const wrapApp = Sentry.wrap;
