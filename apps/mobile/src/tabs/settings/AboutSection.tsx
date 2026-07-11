import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { versionLabel, checkForUpdate, applyUpdate, getTrack, setTrack, trackSupported, type UpdateTrack } from '../../updates';
import { confirmAsync } from '../../ui/alerts';
import { s, palette } from '../../ui/theme';

const DONATION_BTC = 'bc1ps44wjx3wpu4s0xj746gz2lu45nspsm9059d3ym8xz0nrhu4psyasdgwwhx';

function AboutSection({
  onReplayTour,
}: {
  onReplayTour: () => void;
}) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [donationCopied, setDonationCopied] = useState(false);
  // On a mobile-browser web session (not the installed PWA / native app),
  // suggest the native app — shown as a passive notice in About.
  const nativeOS = useMemo<'ios' | 'android' | null>(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null;
    const w: any = typeof window !== 'undefined' ? window : undefined;
    const standalone = !!(w?.matchMedia?.('(display-mode: standalone)')?.matches) || (navigator as any).standalone === true;
    if (standalone) return null;
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua) || ((navigator as any).platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return null;
  }, []);
  const [updBusy, setUpdBusy] = useState(false);
  const [updMsg, setUpdMsg] = useState('');
  const [updTrack, setUpdTrack] = useState<UpdateTrack>('latest');
  const changeTrack = async (track: UpdateTrack) => {
    if (track === updTrack || updBusy) return;
    const ok = await confirmAsync(
      t('Switch update track?'),
      t('This downloads the selected release and restarts the app.'),
      t('Switch'),
    );
    if (!ok) return;
    setUpdBusy(true); setUpdMsg('');
    setUpdTrack(track);
    const r = await setTrack(track);
    if (r.outcome === 'updated') { setUpdMsg(t('Update found — restarting…')); await applyUpdate(); return; }
    setUpdMsg(r.outcome === 'up-to-date' ? t("You're on the latest version.") : t('Could not check for updates.'));
    setUpdBusy(false);
  };
  const checkUpdates = async () => {
    setUpdBusy(true); setUpdMsg('');
    const r = await checkForUpdate();
    if (r.outcome === 'updated') { setUpdMsg(t('Update found — restarting…')); await applyUpdate(); return; }
    setUpdMsg(
      r.outcome === 'up-to-date' ? t("You're on the latest version.")
        : r.outcome === 'unsupported' ? t('Updates aren\'t available in this build.')
        : t('Could not check for updates.')
    );
    setUpdBusy(false);
  };
  React.useEffect(() => {
    getTrack().then(setUpdTrack).catch(() => {});
  }, []);

  return (
    <>
      {/* About — version, low-key update check, credits & feedback. Collapsed
          by default like the other Settings sections. The OTA update flow lives
          here as a small "Check now" link (native gets a real OTA swap; web just
          hard-reloads to the newest deploy). */}
      <Pressable style={s.collapseHeader} onPress={() => setAboutOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="information-circle-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t("About")}</Text>
        </View>
        <Text style={s.collapseChevron}>{aboutOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {aboutOpen && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            <Text style={s.mono}>{versionLabel()}</Text>
            <Pressable hitSlop={8} disabled={updBusy} onPress={() => { checkUpdates(); }}>
              {updBusy
                ? <ActivityIndicator size="small" color={palette.accent} />
                : <Text style={[s.link, { fontSize: 13 }]}>{t('Check now')}</Text>}
            </Pressable>
          </View>
          {!!updMsg && <Text style={s.dim}>{updMsg}</Text>}
          {trackSupported() && (
            <View style={{ marginTop: 12 }}>
              <Text style={s.label}>{t('Update track')}</Text>
              <View style={s.segRow}>
                {(['latest', 'stable'] as UpdateTrack[]).map((tk) => (
                  <Pressable key={tk} disabled={updBusy} onPress={() => { changeTrack(tk); }} style={[s.seg, updTrack === tk && s.segActive]}>
                    <Ionicons
                      name={tk === 'latest' ? 'rocket-outline' : 'shield-checkmark-outline'}
                      size={15}
                      color={updTrack === tk ? palette.chipBlueText : palette.dim}
                      style={{ marginEnd: 6 }}
                    />
                    <Text style={[s.segText, updTrack === tk && s.segTextActive]}>{t(tk === 'latest' ? 'Latest' : 'Stable')}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.dim}>{t('Latest receives updates first. Stable stays one release behind for extra safety.')}</Text>
            </View>
          )}
          {nativeOS && (
            <Text style={[s.dim, { marginTop: 8 }]}>
              📱 {nativeOS === 'ios' ? t('Use the iOS app for the best experience.') : t('Use the Android app for the best experience.')}
            </Text>
          )}
          <Pressable style={[s.btnDecline, { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }]} onPress={() => onReplayTour()}>
            <Ionicons name="help-circle-outline" size={16} color="white" />
            <Text style={s.btnText}>{t('Replay guided tour')}</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 10, gap: 6 }}>
            <Text style={s.dim}>{t('Donation')}: </Text>
            <Pressable
              hitSlop={6}
              onPress={async () => {
                try {
                  // expo-clipboard isn't in the binary — Share is the native copy path.
                  if (Platform.OS === 'web' && (navigator as any)?.clipboard) {
                    await (navigator as any).clipboard.writeText(DONATION_BTC);
                    setDonationCopied(true);
                  } else await Share.share({ message: DONATION_BTC });
                } catch { /* ignore */ }
              }}
            >
              <Text style={s.link}>{donationCopied ? t('Copied') : t('Copy BTC address')}</Text>
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}

export { AboutSection };
