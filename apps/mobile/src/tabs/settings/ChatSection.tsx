import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { t } from '../../i18n';
import { Ionicons } from '@expo/vector-icons';
import { s, palette } from '../../ui/theme';

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
}: {
  showLastSeen: boolean;
  onShowLastSeenChange: (v: boolean) => void;
  receipts: boolean;
  onReceiptsChange: (v: boolean) => void;
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
        </>
      )}
    </>
  );
}

export { ChatSection };
