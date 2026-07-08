/**
 * Onboarding "keep the app open" gate: the welcome screen shows the line
 * "Keep the app open during a deal — there's no server to hold missed
 * messages." exactly when auto-subscribe can't work — client can't push,
 * permission denied, or the default notification server isn't responding.
 * pushUnavailableForOnboarding() is that decision.
 */
import { describe, it, expect } from 'vitest';
import { pushUnavailableForOnboarding, type PushAvailabilityDeps } from '../src/pushAvailability';

const ENDPOINT = 'https://nostr-mcp.trinh.uk';

function deps(over: Partial<PushAvailabilityDeps> = {}): PushAvailabilityDeps {
  return {
    status: async () => 'off',                 // supported, not yet enabled
    endpoint: async () => ENDPOINT,
    fetchFn: async () => ({ ok: true }),       // healthy server
    ...over,
  };
}

describe('onboarding push availability (shows the keep-the-app-open line when true)', () => {
  it('client does not support push → line shows', async () => {
    expect(await pushUnavailableForOnboarding(deps({ status: async () => 'unsupported' }))).toBe(true);
  });

  it('notification permission already denied → line shows', async () => {
    expect(await pushUnavailableForOnboarding(deps({ status: async () => 'denied' }))).toBe(true);
  });

  it('default notification server not responding (network error) → line shows', async () => {
    expect(await pushUnavailableForOnboarding(deps({
      fetchFn: async () => { throw new Error('ECONNREFUSED'); },
    }))).toBe(true);
  });

  it('default notification server responding with an error status → line shows', async () => {
    expect(await pushUnavailableForOnboarding(deps({ fetchFn: async () => ({ ok: false }) }))).toBe(true);
  });

  it('server hangs past the timeout → aborted → line shows', async () => {
    const hang: PushAvailabilityDeps['fetchFn'] = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    expect(await pushUnavailableForOnboarding(deps({ fetchFn: hang, timeoutMs: 20 }))).toBe(true);
  });

  it('no default endpoint configured → line shows', async () => {
    expect(await pushUnavailableForOnboarding(deps({ endpoint: async () => '' }))).toBe(true);
    expect(await pushUnavailableForOnboarding(deps({ endpoint: async () => undefined }))).toBe(true);
    expect(await pushUnavailableForOnboarding(deps({ endpoint: async () => '   ' }))).toBe(true);
  });

  it('status check itself failing → line shows (fail safe)', async () => {
    expect(await pushUnavailableForOnboarding(deps({
      status: async () => { throw new Error('boom'); },
    }))).toBe(true);
  });

  it('push supported + permission open + server healthy → line hidden', async () => {
    expect(await pushUnavailableForOnboarding(deps())).toBe(false);
  });

  it('permission previously granted (status on) + healthy server → line hidden', async () => {
    expect(await pushUnavailableForOnboarding(deps({ status: async () => 'on' }))).toBe(false);
  });

  it('probes GET <endpoint>/health, tolerating a trailing slash', async () => {
    const urls: string[] = [];
    await pushUnavailableForOnboarding(deps({
      endpoint: async () => ENDPOINT + '/',
      fetchFn: async (url) => { urls.push(url); return { ok: true }; },
    }));
    expect(urls).toEqual([ENDPOINT + '/health']);
  });
});
