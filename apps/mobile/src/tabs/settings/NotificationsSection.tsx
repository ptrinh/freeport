import React, { useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { MobileClient } from '../../client';
import { loadPrefs, savePrefs, type UserLocation } from '../../prefs';
import { kvSet } from '../../kv';
import { enablePush, updatePush, disablePush, pushStatus, type PushStatus, type PushFilters } from '../../push';
import { requestTelegramLink, telegramLinkStatus } from '../../telegramLink';
import { browseTopic } from '../../topics';
import { uiAlert } from '../../ui/alerts';
import { s, palette } from '../../ui/theme';
import { Field } from '../../ui/fields';

function NotificationsSection({
  client,
  location,
  servicesEnabled,
  browseAlertNotify,
  browseCat,
  browseEffSub,
}: {
  client: MobileClient | null;
  location: UserLocation;
  servicesEnabled: boolean;
  browseAlertNotify: boolean;
  browseCat: string;
  browseEffSub: string;
}) {
  // Web Push (PWA) — opt-in "new message" notifications via a content-blind sender.
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyHelpOpen, setNotifyHelpOpen] = useState(false);
  const [notifyEndpoint, setNotifyEndpoint] = useState('');
  const [pushState, setPushState] = useState<PushStatus>('off');
  const [pushBusy, setPushBusy] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  React.useEffect(() => {
    loadPrefs().then((p) => { setNotifyEndpoint(p.notifyEndpoint ?? ''); });
    pushStatus().then(setPushState);
  }, []);
  const myPubkeyHex = client?.pubkey ?? '';
  // Reflect whether Telegram is linked (best-effort; only if the server offers it).
  // Debounced so editing the Notification-service-URL field doesn't fire a
  // request per keystroke — it settles, then checks once.
  React.useEffect(() => {
    if (!notifyEndpoint.trim() || !myPubkeyHex) return;
    let cancelled = false;
    const id = setTimeout(() => {
      telegramLinkStatus(notifyEndpoint.trim(), myPubkeyHex).then((v) => { if (!cancelled) setTelegramLinked(v); });
    }, 600);
    return () => { cancelled = true; clearTimeout(id); };
  }, [notifyEndpoint, myPubkeyHex, telegramBusy]);
  // Intent-alert filters for push: only when the user opted into Browse alerts.
  // Topic mirrors what Browse subscribes to (area + default category/subcat), so
  // pushes track new posts in the slice they care about.
  const pushFilters = React.useMemo<PushFilters | undefined>(() => {
    if (!browseAlertNotify) return undefined;
    // Use the EFFECTIVE category/subcategory the Browse UI shows (browseCat/
    // browseEffSub), not the raw pref — otherwise an unset pref ('') fell back to
    // 'All' here while Browse showed Ridesharing, so the push topic was area-only
    // ("sg") and matched every category. This keeps the alert scoped to the slice
    // the user actually sees.
    const topic = browseTopic(location, {
      servicesEnabled,
      filterCat: browseCat,
      filterSub: browseEffSub || null,
    });
    return { topics: [topic] };
  }, [browseAlertNotify, location, servicesEnabled, browseCat, browseEffSub]);
  const togglePush = async () => {
    setPushBusy(true);
    try {
      await savePrefs({ notifyEndpoint: notifyEndpoint.trim() });
      if (pushState === 'on') {
        await disablePush(myPubkeyHex, notifyEndpoint.trim());
        setPushState('off');
        await kvSet('freeport.pushOn', '0').catch(() => {});
      } else {
        const st = await enablePush(myPubkeyHex, notifyEndpoint.trim(), pushFilters);
        setPushState(st);
        // Mark the server as the active notifier so the app skips its local
        // fallback notification (avoids a second alert when you open the app).
        await kvSet('freeport.pushOn', st === 'on' ? '1' : '0').catch(() => {});
      }
    } finally { setPushBusy(false); }
  };
  // Keep the sender's filters in sync when Browse-alert prefs change (cheap —
  // re-registers the existing subscription, no permission prompt / resubscribe).
  React.useEffect(() => {
    if (pushState === 'on' && notifyEndpoint.trim()) {
      void updatePush(myPubkeyHex, notifyEndpoint.trim(), pushFilters);
    }
  }, [pushFilters, pushState]);

  return (
    <>
      {/* Notifications — remote push (when the app is closed) via a content-blind
          sender. Web PWA uses Web Push; native (iOS/Android) uses Expo Push. */}
      <Pressable style={s.collapseHeader} onPress={() => setNotifyOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="notifications-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t("Notifications")}</Text>
        </View>
        <Text style={s.collapseChevron}>{notifyOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {notifyOpen && (
        <>
          <Text style={s.dim}>{Platform.OS === 'web'
            ? t("Get notified about new messages and nearby posts, even when the app is closed. On iOS, add Freeport to your Home Screen first. Delivered by a content-blind sender you set below — it never sees your messages.")
            : t("Get notified about new messages and nearby posts, even when the app is closed. Delivered by a content-blind sender you set below — it never sees your messages.")}</Text>
          <Pressable onPress={() => setNotifyHelpOpen(true)} hitSlop={6} style={{ marginTop: 6 }}>
            <Text style={{ color: palette.link, fontWeight: '600' }}>{'ⓘ ' + t("What's a notification server?")}</Text>
          </Pressable>
          <Field label={t("Notification service URL")} value={notifyEndpoint} onChange={setNotifyEndpoint} placeholder="https://mcp.freeport.network" />
          <Text style={s.dim}>{t("Leave the default to use the public sender, or point to your own self-hosted one.")}</Text>
          <Pressable
            style={[s.btnAccept, { marginTop: 4 }, (pushBusy || !notifyEndpoint.trim() || !myPubkeyHex) && { opacity: 0.6 }]}
            disabled={pushBusy || !notifyEndpoint.trim() || !myPubkeyHex}
            onPress={() => { togglePush(); }}
          >
            {pushBusy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{pushState === 'on' ? t("Disable notifications") : t("Enable notifications")}</Text>}
          </Pressable>
          {pushState === 'on' && <Text style={s.dim}>{t("Notifications enabled.")}</Text>}
          {pushState === 'denied' && <Text style={s.fieldError}>{t("Notifications are blocked — enable them in your device/browser settings.")}</Text>}
          {pushState === 'error' && <Text style={s.fieldError}>{t("Couldn't reach the notification service — check the URL.")}</Text>}

          {/* Telegram: content-blind activity pings via the same server. Useful
              where push is flaky (iOS PWA) or the user just prefers Telegram. */}
          <Text style={[s.toggleTitle, { marginTop: 16 }]}>{t("Telegram alerts")}</Text>
          <Text style={s.dim}>{telegramLinked
            ? t("Telegram is linked. Send /stop to the bot to unlink.")
            : t("Get the same content-blind alerts as a Telegram message. Opens the bot to link your account.")}</Text>
          <Pressable
            style={[s.btnCounter, { marginTop: 6 }, (telegramBusy || !notifyEndpoint.trim() || !myPubkeyHex) && { opacity: 0.6 }]}
            disabled={telegramBusy || !notifyEndpoint.trim() || !myPubkeyHex}
            onPress={async () => {
              setTelegramBusy(true);
              const ok = await requestTelegramLink(notifyEndpoint.trim(), myPubkeyHex);
              if (!ok) uiAlert(t("Telegram alerts unavailable"), t("This notification server doesn't offer Telegram alerts."));
              setTelegramBusy(false);
            }}
          >
            {telegramBusy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{telegramLinked ? t("Re-link Telegram") : t("Link Telegram")}</Text>}
          </Pressable>
        </>
      )}

      {/* "What's a notification server?" explainer + self-host instructions. */}
      <Modal visible={notifyHelpOpen} transparent animationType="fade" onRequestClose={() => setNotifyHelpOpen(false)}>
        <Pressable style={s.sortBackdrop} onPress={() => setNotifyHelpOpen(false)}>
          <Pressable style={s.sortSheet} onPress={() => {}}>
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <Text style={s.sectionTitle}>{t("What's a notification server?")}</Text>
              <Text style={[s.dim, { marginTop: 4 }]}>{t("Freeport has no central server. To alert you when the app is closed, a small notification server watches the public relays for events addressed to you and forwards a push to your device.")}</Text>
              <Text style={[s.dim, { marginTop: 10 }]}>{t("It is content-blind: your messages are end-to-end encrypted, so it only knows that something arrived for you — never what it says.")}</Text>
              <Text style={[s.dim, { marginTop: 10 }]}>{t("Use the public one (the default URL), or run your own in one command and point the URL above at it:")}</Text>
              <View style={s.codeBox}>
                <Text style={s.codeText} selectable>{'git clone https://github.com/ptrinh/freeport.git\ncd freeport/packages/nostr-mcp\ndocker compose up -d'}</Text>
              </View>
              <Text style={[s.dim, { marginTop: 10 }]}>{t("Then set the URL above to your server (for example http://your-host:1988). On Umbrel, install it from the Freeport community app store.")}</Text>
              <Pressable style={[s.mapLink, { marginTop: 12 }]} onPress={() => Linking.openURL('https://github.com/ptrinh/freeport/tree/main/packages/nostr-mcp')}>
                <Text style={s.mapLinkText}>{'🔗 ' + t("Self-hosting guide on GitHub")}</Text>
              </Pressable>
              <Pressable style={[s.btnAccept, { marginTop: 12 }]} onPress={() => setNotifyHelpOpen(false)}>
                <Text style={s.btnText}>{t("Got it")}</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export { NotificationsSection };
