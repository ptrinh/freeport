/**
 * Quick replies for deal chats: two fixed one-tap messages plus the user's
 * own Custom Message (Settings → Features). The custom-message placeholder
 * suggests the country's most common instant P2P payment rail so drivers
 * can paste their handle once and reuse it on every deal.
 */
import type { Negotiation } from '@freeport/protocol';
import { t } from './i18n';

/** Best-known instant P2P payment method per country (ISO 3166-1 alpha-2).
 *  Anything not listed falls back to cash. */
const P2P_METHODS: Record<string, string> = {
  US: 'Zelle',
  SG: 'PayNow',
  MY: 'DuitNow',
  TH: 'PromptPay',
  VN: 'VietQR',
  PH: 'GCash',
  ID: 'QRIS',
  IN: 'UPI',
  BR: 'Pix',
};

export function p2pMethodForCountry(country: string): string | null {
  return P2P_METHODS[country.toUpperCase()] ?? null;
}

/** Example custom message shown as the Settings placeholder — localized to
 *  the user's country's payment rail (cash when none is known). */
export function defaultCustomMessage(country: string): string {
  const method = p2pMethodForCountry(country);
  const payLine = method
    ? `💵 ${t('Payment method')}:\n${method}: ...`
    : `💵 ${t('Payment method')}: ${t('Cash')}`;
  return `${payLine}\n\n${t('Please rate me after the deal')} 🙏`;
}

/** The two fixed quick replies + the custom message (when set). */
export function quickReplies(customMessage: string): { label: string; text: string }[] {
  const out = [
    { label: t('I am here') + ' ✅', text: t('I am here') + ' ✅' },
    { label: t('Please wait') + ' ⏳', text: t('Please wait') + ' ⏳' },
  ];
  const custom = customMessage.trim();
  if (custom) out.push({ label: t('Custom message'), text: custom });
  return out;
}

/**
 * Deals that should receive the auto-sent custom message: confirmed, not yet
 * completed, and not already handled. Callers mark every returned id as
 * handled (even with auto-send off) so toggling the feature on later never
 * blasts the message into old chats.
 */
export function newlyConfirmed(negos: Negotiation[], handled: Set<string>): Negotiation[] {
  return negos.filter((n) => n.state === 'confirmed' && n.stage !== 'completed' && !handled.has(n.id));
}
