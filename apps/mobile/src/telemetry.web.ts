/**
 * Telemetry — WEB / PWA. Same API as the native variant: Sentry browser SDK
 * (pointed at self-hosted GlitchTip) + self-hosted Aptabase web analytics. PII
 * scrubbing is shared via telemetry-core; a single opt-out flag suppresses all
 * transmission at runtime.
 */
import * as Sentry from '@sentry/browser';
import { init as aptabaseInit, trackEvent as aptabaseTrack } from '@aptabase/web';
import {
  GLITCHTIP_DSN, APTABASE_APP_KEY, APTABASE_HOST, anonInstallId,
  scrubEvent, scrubBreadcrumb, sanitizeProps, isAllowedEvent, type AnalyticsEvent,
} from './telemetry-core';

let enabled = false;
let started = false;

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
      // Third-party noise, not our code: in-app browsers (Facebook/Messenger/
      // Instagram/TikTok) inject their own instrumentation into the WebView
      // (`iabjs://…`, gtm, fb pixels) and its errors land on our global
      // handlers — e.g. "Java object is gone" from FB's Android IAB perf
      // logger (GlitchTip issue 5, a visitor arriving via a Facebook post).
      denyUrls: [/^iabjs:\/\//i, /connect\.facebook\.net/i, /^gap:\/\//i],
      ignoreErrors: [
        'Java object is gone',                 // FB Android IAB bridge torn down
        /__gCrWeb/i,                           // Chrome-iOS injected script
        'window.webkit.messageHandlers',       // iOS WKWebView bridge noise
      ],
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

/** No render-wrapper needed on web; Sentry.init installs the global handlers. */
export const wrapApp = <T,>(c: T): T => c;
