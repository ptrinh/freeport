import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Linking } from 'react-native';
import { t } from '../i18n';
import { httpsLinkOrNull, linkHost } from '../profile';
import { confirmAsync } from './alerts';
import { palette } from './theme';

/**
 * Open a peer-supplied profile link. The link is attacker-controlled, so we:
 *   1. RE-validate https at open time (never trust the stored/received value), and
 *   2. show the destination host in a confirm dialog before leaving the app.
 * A non-https or unparseable value silently does nothing.
 */
export async function openPeerLink(link: string): Promise<void> {
  const safe = httpsLinkOrNull(link);
  if (!safe) return;
  const host = linkHost(safe) ?? safe;
  const ok = await confirmAsync(t('Open link?'), t('This opens {host} in your browser.', { host }), t('Open'));
  if (!ok) return;
  Linking.openURL(safe).catch(() => {});
}

/**
 * Small tappable link icon shown next to a peer's display name in trust-relevant
 * contexts (feed cards, deal cards, chat headers). Renders nothing unless the
 * link is a valid https URL. Tapping opens it via `openPeerLink` (host confirm +
 * https re-check). `stopPropagation` keeps a tap from also triggering an
 * enclosing card/row press.
 */
export function PeerLinkIcon({ link, size = 14, color = palette.link }: { link?: string | null; size?: number; color?: string }): React.ReactElement | null {
  if (!httpsLinkOrNull(link ?? '')) return null;
  const safe = link as string;
  return (
    <Pressable
      hitSlop={8}
      onPress={(e) => { e.stopPropagation?.(); void openPeerLink(safe); }}
      accessibilityRole="link"
      accessibilityLabel={t('Open profile link')}
      style={{ marginLeft: 4 }}
    >
      <Ionicons name="link-outline" size={size} color={color} />
    </Pressable>
  );
}
