/**
 * Web stub — mini-apps are native-only (a cross-origin iframe can't be
 * injected into; see docs/ROADMAP.md). Metro's platform resolution swaps this
 * in so the web bundle never pulls react-native-webview.
 */
import type { Signer } from '../signer';
import type { MiniAppFirewall, MiniAppRecord } from './firewall';
import type { WalletProvider } from '../wallet';

export function MiniAppShell(_props: {
  app: MiniAppRecord;
  firewall: MiniAppFirewall;
  signer: Signer;
  getWallet: (() => Promise<WalletProvider | null>) | null;
  onClose: () => void;
}): null {
  return null;
}
