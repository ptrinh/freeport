/**
 * Desktop-only bridge to the Tauri host server (see apps/desktop). Uses the
 * `window.__TAURI__` global (Tauri's `withGlobalTauri`) so there is NO static
 * @tauri-apps import — the web and native React Native bundles never see this
 * dependency, and isTauri() is simply false there (the UI hides itself).
 */
export interface HostStatus {
  running: boolean;
  port: number;
  urls: string[];
}

type TauriGlobal = { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };

function tauri(): TauriGlobal | null {
  const g = (globalThis as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  return g && g.core && typeof g.core.invoke === 'function' ? g : null;
}

/** True only inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return tauri() != null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const g = tauri();
  if (!g || !g.core?.invoke) throw new Error('not running in the desktop app');
  return (await g.core.invoke(cmd, args)) as T;
}

export const hostStart = (port: number) => invoke<HostStatus>('host_start', { port });
export const hostStop = () => invoke<HostStatus>('host_stop');
export const hostStatus = () => invoke<HostStatus>('host_status');
