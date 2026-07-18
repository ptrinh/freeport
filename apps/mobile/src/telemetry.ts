/* eslint-disable @typescript-eslint/no-explicit-any -- Sentry SDK is lazy-required so old binaries without the native module survive; the module object is untyped by design */
/**
 * Telemetry — NATIVE (iOS/Android). Crash/error reporting via Sentry (pointed at
 * our self-hosted GlitchTip) + anonymous product analytics via self-hosted
 * Aptabase. All PII scrubbing lives in telemetry-core. A single opt-out flag
 * suppresses everything at runtime; see Settings.
 *
 * Crash-safe on OLDER builds: this JS can be delivered over-the-air to a build
 * whose native binary predates the Sentry/Aptabase native modules. To survive
 * that, we NEVER import the native SDKs at module load — we lazy-`require` them
 * inside initTelemetry, gate Sentry on the RNSentry native module actually being
 * present, and wrap everything in try/catch. If the modules aren't there,
 * telemetry silently no-ops instead of crashing the app.
 */
import { NativeModules } from 'react-native';
import {
  GLITCHTIP_DSN, APTABASE_APP_KEY, APTABASE_HOST, anonInstallId,
  scrubEvent, scrubBreadcrumb, sanitizeProps, isAllowedEvent, type AnalyticsEvent,
} from './telemetry-core';

let enabled = false;
let started = false;
let sentry: any = null;                 // set only when the native module exists
let aptabaseTrackFn: ((name: string, props?: Record<string, unknown>) => void) | null = null;

/** True only if this build's binary actually includes the Sentry native module. */
function sentryNativeAvailable(): boolean {
  try { return !!NativeModules.RNSentry; } catch { return false; }
}

/** Initialise the SDKs once. `on` sets the current opt-in state; when off,
 *  nothing is transmitted (events are dropped in beforeSend / trackEvent). */
export async function initTelemetry(on: boolean): Promise<void> {
  enabled = on;
  if (started) return;
  started = true;
  const id = await anonInstallId().catch(() => '');
  // Sentry — only touch it when the native module is present in THIS binary.
  if (sentryNativeAvailable()) {
    try {
      const S = require('@sentry/react-native');
      S.init({
        dsn: GLITCHTIP_DSN,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        attachStacktrace: true,
        beforeSend: (event: any) => (enabled ? (scrubEvent(event) as any) : null),
        beforeBreadcrumb: (b: any) => (enabled ? (scrubBreadcrumb(b) as any) : null),
      });
      if (id) S.setUser({ id });
      sentry = S;
    } catch { sentry = null; }
  }
  // Aptabase — pure-JS-ish; require + init guarded so a missing dependency (e.g.
  // expo-application on an old build) can't crash. It just won't collect.
  try {
    const { init, trackEvent } = require('@aptabase/react-native');
    init(APTABASE_APP_KEY, { host: APTABASE_HOST });
    aptabaseTrackFn = trackEvent;
  } catch { aptabaseTrackFn = null; }
}

export function setTelemetryEnabled(on: boolean): void {
  enabled = on;
}

/** The slice of the Sentry API low-level callers (perfProbe, the About
 *  self-test) actually use. */
export interface SentryLike {
  captureMessage: (message: string, context?: { level?: 'info' | 'warning' | 'error'; extra?: Record<string, unknown> }) => void;
}

/** The live Sentry module, or null when diagnostics are off / module absent.
 *  For low-level callers (perfProbe) that need more than captureException. */
export function getSentry(): SentryLike | null {
  return enabled ? (sentry as SentryLike | null) : null;
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled || !sentry) return;
  try { sentry.captureException(err, context ? { extra: sanitizeProps(context) } : undefined); } catch { /* ignore */ }
}

export function trackEvent(name: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!enabled || !aptabaseTrackFn || !isAllowedEvent(name)) return;
  try { aptabaseTrackFn(name, sanitizeProps(props)); } catch { /* ignore */ }
}

/** No render-wrapper (avoid touching the native SDK at import); Sentry.init
 *  installs the global JS + native error handlers when available. */
export const wrapApp = <T,>(c: T): T => c;
