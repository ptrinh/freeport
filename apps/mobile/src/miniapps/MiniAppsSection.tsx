/**
 * Settings → Mini-apps: the launcher/registry UI. Add an app by URL or QR,
 * see what it can do (grants + today's spend), open it in the shell, revoke.
 * Native-only — the section is hidden on web (see docs/ROADMAP.md).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import { evaluateAdd, type MiniAppFirewall, type MiniAppRecord } from './firewall';
import { persistFirewall } from './store';
import { ScanSheet } from '../tabs/wallet/ScanSheet';

function appLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** Convenience: the example apps' GitHub source links resolve to their
 *  published homes, so pasting either the repo URL or the web URL works. */
function resolveDemoAlias(input: string): string {
  const m = /^https:\/\/github\.com\/ptrinh\/freeport(?:\/tree\/[^/]+)?\/examples\/([a-z0-9-]+)\/?$/i.exec(input);
  if (m) return `https://freeport.network/${m[1]}/`;
  // Bare repo root → the original eSIM demo shop.
  if (/^https:\/\/github\.com\/ptrinh\/freeport\/?$/i.test(input)) return 'https://freeport.network/demo-app/';
  return input;
}

export function MiniAppsSection({
  firewall,
  onOpenApp,
  defaultOpen = false,
}: {
  firewall: MiniAppFirewall;
  onOpenApp: (app: MiniAppRecord) => void;
  /** Start expanded (used when the section is the whole Apps tab). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [, bump] = useState(0);
  const refresh = () => bump((v) => v + 1);

  const add = (input: string) => {
    setErr('');
    input = resolveDemoAlias(input.trim());
    const { origin, warnings } = evaluateAdd(input);
    if (!origin) { setErr(t('Enter a valid https:// URL.')); return; }
    if (warnings.includes('punycode')) {
      // Lookalike-domain phishing is the top way users get tricked into
      // granting a hostile app — refuse rather than warn.
      setErr(t('This address uses disguised characters (punycode) — refusing to add it.'));
      return;
    }
    try {
      // Register with the full input so the launch URL keeps its path
      // (permissions are still keyed by origin inside the firewall).
      firewall.registerApp(input, appLabel(origin), Date.now());
    } catch {
      setErr(t('This app is on the community blocklist.'));
      return;
    }
    persistFirewall();
    setUrl('');
    refresh();
  };

  const remove = (origin: string) => {
    firewall.removeApp(origin);
    persistFirewall();
    refresh();
  };

  const apps = firewall.listApps();

  return (
    <>
      <Pressable style={s.collapseHeader} onPress={() => setOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="apps-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t('Mini-apps')}</Text>
        </View>
        <Text style={s.collapseChevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <>
          <Text style={s.dim}>{t('Web apps that use your Freeport identity & wallet. Every sensitive action needs your approval — but only add apps you trust.')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={url}
              onChangeText={setUrl}
              placeholder="https://app.example.com"
              placeholderTextColor={palette.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onSubmitEditing={() => url.trim() && add(url)}
            />
            <Pressable style={[s.btnAccept, { paddingHorizontal: 14 }]} onPress={() => (url.trim() ? add(url) : setScanOpen(true))}>
              {url.trim()
                ? <Text style={s.btnText}>{t('Add')}</Text>
                : <Ionicons name="qr-code-outline" size={18} color="#fff" />}
            </Pressable>
          </View>
          {err ? <Text style={[s.dim, { color: '#ef4444' }]}>{err}</Text> : null}
          {apps.map((app) => (
            <View key={app.origin} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border }}>
              <Ionicons name="globe-outline" size={20} color={palette.text2} />
              <Pressable style={{ flex: 1 }} onPress={() => onOpenApp(app)}>
                <Text style={s.toggleTitle} numberOfLines={1}>{app.name}</Text>
                <Text style={[s.dim, { marginTop: 0 }]} numberOfLines={1}>
                  {(app.url || app.origin).replace('https://', '')}
                  {firewall.spentToday(app.origin, Date.now()) > 0
                    ? ` · ${firewall.spentToday(app.origin, Date.now()).toLocaleString()} sats ${t('today')}`
                    : ''}
                </Text>
              </Pressable>
              <Pressable style={[s.btnAccept, { paddingHorizontal: 12, paddingVertical: 7 }]} onPress={() => onOpenApp(app)}>
                <Text style={s.btnText}>{t('Launch')}</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => remove(app.origin)}>
                <Ionicons name="trash-outline" size={18} color={palette.muted} />
              </Pressable>
            </View>
          ))}
          {apps.length === 0 ? <Text style={s.dim}>{t('No mini-apps added yet. Paste a URL or scan a QR code.')}</Text> : null}
        </>
      )}
      <ScanSheet visible={scanOpen} onClose={() => setScanOpen(false)} onCode={(v) => { setScanOpen(false); add(v); }} />
    </>
  );
}
