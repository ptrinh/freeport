/**
 * Native no-op counterpart of debug.web.ts. The `window.freeport` debug API and
 * `?profile=N` isolation are browser-only testing aids; on native these do
 * nothing. Metro resolves debug.web.ts for the web build automatically.
 */
interface DebugClient {
  pubkey?: string;
  connectedRelayCount?: () => number;
  negotiations?: Map<string, unknown>;
  relays?: string[];
}

export function installDebugApi(): void {}

export function registerDebugClient(_client: DebugClient, _npub: string, _intentsGetter?: () => unknown[]): void {}
