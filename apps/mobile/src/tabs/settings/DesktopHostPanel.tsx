import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { hostStart, hostStop, hostStatus, type HostStatus } from '../../desktopHost';
import { s, palette } from '../../ui/theme';
import { Field } from '../../ui/fields';

/** Desktop-only: run a built-in HTTP server that serves the Freeport web app
 *  (this same bundle) on a chosen port, so anyone on the LAN can open it in a
 *  browser — a zero-infra way to share/self-host Freeport. Rendered only when
 *  isTauri(). The Rust side lives in apps/desktop/src-tauri. */
function DesktopHostPanel() {
  const [portText, setPortText] = useState('1988');
  const [withNotify, setWithNotify] = useState(false);
  const [tgToken, setTgToken] = useState('');
  const [tgPass, setTgPass] = useState('');
  const [tgOpen, setTgOpen] = useState(false);
  const [status, setStatus] = useState<HostStatus>({ running: false, port: 0, notify: false, telegram: false, notify_available: false, urls: [], relay_urls: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { hostStatus().then(setStatus).catch(() => {}); }, []);

  const toggle = async () => {
    setError(null);
    setBusy(true);
    try {
      if (status.running) {
        setStatus(await hostStop());
      } else {
        const port = parseInt(portText.trim(), 10);
        if (!Number.isFinite(port) || port < 1024 || port > 65535) {
          setError(t('Enter a port between 1024 and 65535.'));
          return;
        }
        const useNotify = withNotify && status.notify_available;
        setStatus(await hostStart(port, useNotify, useNotify ? tgToken : '', useNotify ? tgPass : ''));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 22 }}>
      <Text style={s.sectionTitle}>{t('Host Freeport for others')}</Text>
      <Text style={[s.dim, { marginTop: 4 }]}>{t('Serve this app on your network so anyone nearby can open it in a browser — no install, no store. The shared app still connects directly to the public relays.')}</Text>

      {!status.running ? (
        <>
          <View style={{ marginTop: 12 }}>
            <Field label={t('Port')} value={portText} onChange={setPortText} placeholder="1988" keyboardType="number-pad" />
          </View>
          {status.notify_available && (
            <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }} onPress={() => setWithNotify((v) => !v)}>
              <Ionicons name={withNotify ? 'checkbox' : 'square-outline'} size={22} color={withNotify ? palette.accent : palette.text3} />
              <View style={{ flex: 1 }}>
                <Text style={s.toggleTitle}>{t('Also host notifications, MCP + a relay')}</Text>
                <Text style={[s.dim, { fontSize: 12 }]}>{t('Runs the push notifier, MCP endpoint and a Nostr relay too — a full node. Best on an always-on machine.')}</Text>
              </View>
            </Pressable>
          )}
          {status.notify_available && withNotify && (
            <View style={{ marginTop: 10, marginStart: 32 }}>
              <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => setTgOpen((v) => !v)}>
                <Ionicons name={tgOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={palette.text3} />
                <Text style={s.dim}>{t('Telegram bridge (optional)')}</Text>
              </Pressable>
              {tgOpen && (
                <View style={{ marginTop: 8 }}>
                  <Field label={t('Telegram bot token')} value={tgToken} onChange={setTgToken} placeholder="123456:AA…" secure />
                  <Text style={[s.dim, { fontSize: 12, marginTop: 4 }]}>{t('From @BotFather. Relays a market feed into groups and sends content-blind pings.')}</Text>
                  <View style={{ marginTop: 10 }}>
                    <Field label={t('Guest-mode passphrase (advanced)')} value={tgPass} onChange={setTgPass} placeholder={t('leave empty to keep guest mode off')} secure />
                  </View>
                  <Text style={[s.fieldError, { fontSize: 12, marginTop: 4 }]}>{t('Guest mode is custodial: your node holds an encrypted key for each Telegram user who posts. Only enable if you accept that responsibility.')}</Text>
                </View>
              )}
            </View>
          )}
          <Pressable style={[s.btnAccept, { marginTop: 8 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={toggle}>
            {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Start hosting')}</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[s.dim, { marginTop: 12 }]}>{t('Hosting on port {port}. Share one of these links (same Wi-Fi/network):', { port: String(status.port) })}</Text>
          <View style={s.codeBox}>
            <Text style={s.codeText} selectable>{(status.urls.length ? status.urls : [t('No network address found — are you online?')]).join('\n')}</Text>
          </View>
          {status.notify && status.urls[0] && (
            <Text style={[s.dim, { marginTop: 6, fontSize: 12 }]}>{t('Notification + MCP server on too — set the Notification service URL to {url}', { url: status.urls[0] })}</Text>
          )}
          {status.notify && status.relay_urls.length > 0 && (
            <>
              <Text style={[s.dim, { marginTop: 8 }]}>{t('Relay running — add to the app’s relay list:')}</Text>
              <View style={s.codeBox}>
                <Text style={s.codeText} selectable>{status.relay_urls.join('\n')}</Text>
              </View>
            </>
          )}
          {status.telegram && <Text style={[s.dim, { marginTop: 6, fontSize: 12 }]}>{'🤖 ' + t('Telegram bridge active.')}</Text>}
          <Text style={[s.dim, { marginTop: 6, fontSize: 12 }]}>{t('Your OS firewall may ask to allow incoming connections the first time.')}</Text>
          <Pressable style={[s.btnCounter, { marginTop: 8 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={toggle}>
            {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Stop hosting')}</Text>}
          </Pressable>
        </>
      )}
      {error && <Text style={[s.fieldError, { marginTop: 8 }]}>{error}</Text>}
    </View>
  );
}

export { DesktopHostPanel };
