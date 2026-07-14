import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { t } from '../../i18n';
import { Ionicons } from '@expo/vector-icons';
import { s, palette } from '../../ui/theme';
import { translateSupported } from '../../concierge/translate';

/**
 * Settings → Chat — only rendered while the Chat experiment is on. Both
 * toggles are RECIPROCAL and off by default (privacy-first): turning one off
 * stops you broadcasting AND stops you seeing others'.
 */
function ChatSection({
  showLastSeen,
  onShowLastSeenChange,
  receipts,
  onReceiptsChange,
  callsEnabled,
  onCallsEnabledChange,
  callsTurn,
  onCallsTurnChange,
  callsSupported = true,
  translate,
  onTranslateChange,
  llmEnabled = false,
}: {
  showLastSeen: boolean;
  onShowLastSeenChange: (v: boolean) => void;
  receipts: boolean;
  onReceiptsChange: (v: boolean) => void;
  callsEnabled: boolean;
  onCallsEnabledChange: (v: boolean) => void;
  callsTurn: boolean;
  onCallsTurnChange: (v: boolean) => void;
  /** False on binaries without the WebRTC module (pre-1.6.0) — row disabled. */
  callsSupported?: boolean;
  translate: boolean;
  onTranslateChange: (v: boolean) => void;
  /** Master switch (Settings → Experimental → Local LLM AI). */
  llmEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Toggle = ({ icon, title, desc, value, onChange }: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    title: string; desc: string; value: boolean; onChange: (v: boolean) => void;
  }) => (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={s.toggleRow}
      onPress={() => onChange(!value)}
    >
      <Ionicons name={icon} size={20} color={palette.text2} style={{ marginEnd: 10 }} />
      <View style={{ flex: 1, marginEnd: 12 }}>
        <Text style={s.toggleTitle}>{title}</Text>
        <Text style={s.dim}>{desc}</Text>
      </View>
      <View style={[s.switchTrack, value && s.switchTrackOn]}>
        <View style={[s.switchThumb, value && s.switchThumbOn]} />
      </View>
    </Pressable>
  );

  return (
    <>
      <Pressable style={s.collapseHeader} onPress={() => setOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="chatbubbles-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t('Chat')}</Text>
        </View>
        <Text style={s.collapseChevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <>
          <Toggle
            icon="time-outline"
            title={t('Show last seen')}
            desc={t("Contacts see when you were last online — and you see theirs. Off: neither.")}
            value={showLastSeen}
            onChange={onShowLastSeenChange}
          />
          <Toggle
            icon="checkmark-done-outline"
            title={t('Chat receipts')}
            desc={t("Delivery and read ticks on messages, both ways. Off: you send no receipts and see none.")}
            value={receipts}
            onChange={onReceiptsChange}
          />
          {llmEnabled && translateSupported() && (
            <Toggle
              icon="language-outline"
              title={t('Translate messages')}
              desc={t('Incoming chat messages are translated on this device — nothing is sent anywhere.')}
              value={translate}
              onChange={onTranslateChange}
            />
          )}
          {callsSupported ? (
            <>
              <Toggle
                icon="call-outline"
                title={t('Enable calls')}
                desc={t('Audio & video calls with chat friends, peer-to-peer. Off: incoming calls are declined automatically.')}
                value={callsEnabled}
                onChange={onCallsEnabledChange}
              />
              {callsEnabled && (
                <>
                  <Text style={[s.dim, { marginStart: 30 }]}>
                    {'⚠️ ' + t('Your IP address may be exposed to the person you call.')}
                  </Text>
                  <View style={{ marginStart: 20 }}>
                    <Toggle
                      icon="swap-horizontal-outline"
                      title={t('TURN fallback for calls')}
                      desc={t("When a direct connection fails, relay the call through Cloudflare so it still connects — the other person then can't see your IP. Off: those calls just fail.")}
                      value={callsTurn}
                      onChange={onCallsTurnChange}
                    />
                  </View>
                </>
              )}
            </>
          ) : (
            <View style={[s.toggleRow, { opacity: 0.45 }]}>
              <Ionicons name="call-outline" size={20} color={palette.text2} style={{ marginEnd: 10 }} />
              <View style={{ flex: 1, marginEnd: 12 }}>
                <Text style={s.toggleTitle}>{t('Enable calls')}</Text>
                <Text style={s.dim}>{t('Calls need a newer app version')}</Text>
              </View>
            </View>
          )}
        </>
      )}
    </>
  );
}

export { ChatSection };
