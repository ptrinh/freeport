/* eslint-disable @typescript-eslint/no-explicit-any -- beforeSend/beforeBreadcrumb bridge scrubbers over @sentry/browser generics */
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
  // The single-file offline build (file://) reports nothing: every event from
  // there is environment noise (failed fetches with no stack, no sourcemaps)
  // — e.g. "NetworkError: A network error occurred." (GlitchTip issue 4).
  if (typeof location !== 'undefined' && location.protocol === 'file:') return;
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
      denyUrls: [
        /^iabjs:\/\//i,
        /connect\.facebook\.net/i,
        /^gap:\/\//i,
        // Cloudflare Web Analytics beacon (auto-injected by CF Pages) crashing
        // on old engines without Array.prototype.at (GlitchTip issue 7).
        /static\.cloudflareinsights\.com/i,
      ],
      ignoreErrors: [
        'Java object is gone',                 // FB Android IAB bridge torn down
        /__gCrWeb/i,                           // Chrome-iOS injected script
        'window.webkit.messageHandlers',       // iOS WKWebView bridge noise
        // expo-font's fontfaceobserver rejects unhandled inside the library
        // when the icon font takes >6s (slow first paint / flaky network);
        // the font still applies when it arrives (GlitchTip issue 11).
        /^\d+ms timeout exceeded$/,
        // Transient connectivity loss surfacing as an unhandled DOMException
        // (code 19) from background fetches we don't own — chiefly the Breez
        // SDK's wasm-internal sync polling when the device drops offline. The
        // SDK retries on its own; nothing actionable (GlitchTip issue 4).
        'NetworkError: A network error occurred.',
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

/** The live Sentry module, or null when diagnostics are off. Same contract as
 *  the native variant (see SentryLike there). */
export function getSentry(): { captureMessage: (message: string, context?: { level?: 'info' | 'warning' | 'error'; extra?: Record<string, unknown> }) => void } | null {
  return enabled ? Sentry : null;
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
