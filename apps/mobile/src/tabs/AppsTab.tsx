/**
 * Apps tab — the mini-app launcher, shown as a dedicated bottom-tab when the
 * Mini-apps feature is enabled. A 3-column home-screen-style grid: every app
 * has an icon + title (required at add time), "Add App" opens a URL/QR sheet,
 * "Edit" turns on drag-to-reorder + ✕-to-remove. When the Wallet feature is
 * also on, the wallet lives here as the first (built-in) tile instead of its
 * own bottom tab. Native opens apps in the WebView shell; web in the
 * sandboxed-iframe shell (Metro platform resolution on the lazy import).
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import type { Signer } from '../signer';
import { evaluateAdd, type MiniAppFirewall, type MiniAppRecord } from '../miniapps/firewall';
import { loadFirewall, persistFirewall } from '../miniapps/store';
import { fetchAppMeta } from '../miniapps/metadata';
import { makeBridgeContext } from '../miniapps/context';
import { activeWalletProvider } from '../wallet';
import { ScanSheet } from './wallet/ScanSheet';

const MiniAppShellLazy = React.lazy(() =>
  import('../miniapps/MiniAppShell').then((m) => ({ default: m.MiniAppShell })),
);

const COLS = 3;
const CELL_H = 108;
const ICON_SIZE = 56;

/** Convenience: the example apps' GitHub source links resolve to their
 *  published homes, so pasting either the repo URL or the web URL works. */
function resolveDemoAlias(input: string): string {
  const m = /^https:\/\/github\.com\/ptrinh\/freeport(?:\/tree\/[^/]+)?\/examples\/([a-z0-9-]+)\/?$/i.exec(input);
  if (m) return `https://freeport.network/${m[1]}/`;
  // Bare repo root → the original eSIM demo shop.
  if (/^https:\/\/github\.com\/ptrinh\/freeport\/?$/i.test(input)) return 'https://freeport.network/demo-app/';
  return input;
}

const GLYPH_COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#6366f1'];

function glyphColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GLYPH_COLORS[h % GLYPH_COLORS.length];
}

/** App icon image with a letter-glyph fallback when the URL fails to load. */
function TileIcon({ icon, name, seed }: { icon?: string; name: string; seed: string }) {
  const [failed, setFailed] = useState(false);
  if (icon && !failed) {
    return (
      <Image
        source={{ uri: icon }}
        style={{ width: ICON_SIZE, height: ICON_SIZE, borderRadius: 13, backgroundColor: palette.inset }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={{ width: ICON_SIZE, height: ICON_SIZE, borderRadius: 13, backgroundColor: glyphColor(seed), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700' }}>{(name.trim()[0] || '?').toUpperCase()}</Text>
    </View>
  );
}

function tileBody(iconEl: React.ReactNode, title: string) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 10 }}>
      {iconEl}
      <Text style={[s.dim, { marginTop: 6, color: palette.text, textAlign: 'center', paddingHorizontal: 4 }]} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

export function AppsTab({
  signerRef,
  walletEnabled,
  walletNwcUrl,
  onOpenWallet,
  onScroll,
}: {
  signerRef: React.MutableRefObject<Signer | null>;
  walletEnabled: boolean;
  walletNwcUrl: string;
  /** Set when the wallet lives inside this tab (both features on) — renders a
   *  built-in Wallet tile that opens the wallet screen. */
  onOpenWallet?: (() => void) | null;
  onScroll?: (e: { nativeEvent: { contentOffset: { y: number } } }) => void;
}) {
  const [fw, setFw] = useState<MiniAppFirewall | null>(null);
  const [apps, setApps] = useState<MiniAppRecord[]>([]);
  const [open, setOpen] = useState<MiniAppRecord | null>(null);
  const [edit, setEdit] = useState(false);

  // Add-app sheet state
  const [addStep, setAddStep] = useState<null | 'url' | 'confirm'>(null);
  const [url, setUrl] = useState('https://');
  const [pendingInput, setPendingInput] = useState('');
  const [pendingIcon, setPendingIcon] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

  // Drag-to-reorder state (edit mode)
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const pan = useRef(new Animated.ValueXY()).current;
  const gridW = useRef(0);

  useEffect(() => {
    void loadFirewall().then((f) => { setFw(f); setApps(f.listApps()); }).catch(() => {});
  }, []);

  const getWallet = walletEnabled ? () => activeWalletProvider(walletNwcUrl) : null;
  const walletOffset = onOpenWallet ? 1 : 0; // the built-in Wallet tile shifts the grid

  const refresh = () => { if (fw) setApps(fw.listApps()); };

  const openAddSheet = () => {
    setUrl('https://'); setErr(''); setBusy(false); setAddStep('url');
  };

  const closeAddSheet = () => {
    setAddStep(null); setErr(''); setBusy(false); setPendingInput(''); setPendingIcon(undefined); setTitle('');
  };

  /** Step 1 → 2: validate the URL, probe it for a title + icon. */
  const proceed = async (raw: string) => {
    setErr('');
    const input = resolveDemoAlias(raw.trim());
    const { origin, warnings } = evaluateAdd(input);
    if (!origin) { setErr(t('Enter a valid https:// URL.')); return; }
    if (warnings.includes('punycode')) {
      // Lookalike-domain phishing is the top way users get tricked into
      // granting a hostile app — refuse rather than warn.
      setErr(t('This address uses disguised characters (punycode) — refusing to add it.'));
      return;
    }
    setBusy(true);
    const meta = await fetchAppMeta(input);
    setBusy(false);
    setPendingInput(input);
    // Every tile needs an icon: fall back to the site favicon, and the tile
    // itself falls back to a letter glyph if that image never loads.
    setPendingIcon(meta.icon ?? `${origin}/favicon.ico`);
    setTitle(meta.title ?? new URL(origin).hostname.replace(/^www\./, ''));
    setAddStep('confirm');
  };

  /** Step 2: title is required, then register + persist. */
  const confirmAdd = () => {
    if (!fw) return;
    const name = title.trim();
    if (!name) { setErr(t('Title is required.')); return; }
    setErr('');
    try {
      // Register with the full input so the launch URL keeps its path
      // (permissions are still keyed by origin inside the firewall).
      fw.registerApp(pendingInput, name.slice(0, 60), Date.now(), pendingIcon);
    } catch {
      setErr(t('This app is on the community blocklist.'));
      return;
    }
    persistFirewall();
    refresh();
    closeAddSheet();
  };

  const remove = (origin: string) => {
    if (!fw) return;
    fw.removeApp(origin);
    persistFirewall();
    refresh();
  };

  /** Drop the dragged tile: translate its grid slot by the gesture delta. */
  const commitDrag = (index: number, dx: number, dy: number) => {
    if (!fw || gridW.current <= 0) return;
    const cellW = gridW.current / COLS;
    const vis = walletOffset + index;
    const col = Math.min(COLS - 1, Math.max(0, Math.round(vis % COLS + dx / cellW)));
    const row = Math.max(0, Math.floor(vis / COLS) + Math.round(dy / CELL_H));
    const target = Math.min(apps.length - 1, Math.max(0, row * COLS + col - walletOffset));
    if (target === index) return;
    const next = [...apps];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setApps(next);
    fw.reorderApps(next.map((a) => a.origin));
    persistFirewall();
  };

  const makePan = (index: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => edit,
    onMoveShouldSetPanResponder: () => edit,
    onPanResponderGrant: () => { setDragIdx(index); pan.setValue({ x: 0, y: 0 }); },
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_e, g) => { commitDrag(index, g.dx, g.dy); setDragIdx(null); pan.setValue({ x: 0, y: 0 }); },
    onPanResponderTerminate: () => { setDragIdx(null); pan.setValue({ x: 0, y: 0 }); },
  });

  const tileStyle = { width: `${100 / COLS}%` as const, height: CELL_H };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      scrollEnabled={dragIdx == null}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Ionicons name="apps-outline" size={22} color={palette.text} />
        <Text style={[s.collapseTitle, { fontSize: 18, flex: 1 }]}>{t('Apps')}</Text>
        {apps.length > 0 ? (
          <Pressable style={[s.btnAccept, { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: edit ? undefined : palette.inset }]} onPress={() => { setEdit((v) => !v); setDragIdx(null); }}>
            <Text style={[s.btnText, edit ? null : { color: palette.text }]}>{edit ? t('Done') : t('Edit')}</Text>
          </Pressable>
        ) : null}
        <Pressable style={[s.btnAccept, { paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }]} onPress={openAddSheet}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={s.btnText}>{t('Add App')}</Text>
        </Pressable>
      </View>

      {!fw ? <Text style={s.dim}>{t('Loading…')}</Text> : (
        <>
          {edit ? <Text style={[s.dim, { marginBottom: 6 }]}>{t('Drag apps to rearrange. Tap ✕ to remove.')}</Text> : null}
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap' }}
            onLayout={(e) => { gridW.current = e.nativeEvent.layout.width; }}
          >
            {onOpenWallet ? (
              <Pressable key="wallet" style={[tileStyle, edit && { opacity: 0.5 }]} disabled={edit} onPress={onOpenWallet}>
                {tileBody(
                  <View style={{ width: ICON_SIZE, height: ICON_SIZE, borderRadius: 13, backgroundColor: '#f59e0b', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="wallet" size={30} color="#fff" />
                  </View>,
                  t('Wallet'),
                )}
              </Pressable>
            ) : null}
            {apps.map((app, i) => {
              const dragging = dragIdx === i;
              const body = tileBody(
                <TileIcon icon={app.icon} name={app.name} seed={app.origin} />,
                app.name,
              );
              if (!edit) {
                return (
                  <Pressable key={app.origin} style={tileStyle} onPress={() => setOpen(app)}>
                    {body}
                  </Pressable>
                );
              }
              return (
                <Animated.View
                  key={app.origin}
                  style={[
                    tileStyle,
                    dragging && { transform: pan.getTranslateTransform(), zIndex: 10, elevation: 10, opacity: 0.85 },
                  ]}
                >
                  <View {...makePan(i).panHandlers}>{body}</View>
                  <Pressable
                    hitSlop={8}
                    onPress={() => remove(app.origin)}
                    style={{ position: 'absolute', top: 0, right: '14%', width: 22, height: 22, borderRadius: 11, backgroundColor: palette.muted, alignItems: 'center', justifyContent: 'center', zIndex: 11 }}
                  >
                    <Ionicons name="close" size={14} color="#fff" />
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
          {apps.length === 0 && !onOpenWallet ? (
            <Text style={s.dim}>{t('No apps yet — tap "Add App" to add one by URL or QR code.')}</Text>
          ) : null}
        </>
      )}

      {/* Add-app sheet: URL/QR step, then required icon+title confirm step. */}
      <Modal visible={addStep != null} transparent animationType="fade" onRequestClose={closeAddSheet}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
          {/* Cap the sheet on wide screens (desktop web) — full-bleed otherwise. */}
          <View style={[s.card, { marginHorizontal: 0, width: '100%', maxWidth: 440, alignSelf: 'center' }]}>
            <Text style={s.toggleTitle}>{t('Add App')}</Text>
            {addStep === 'url' ? (
              <>
                <Text style={[s.dim, { marginTop: 4 }]}>{t('Web apps that use your Freeport identity & wallet. Every sensitive action needs your approval — but only add apps you trust.')}</Text>
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
                    autoFocus
                    onSubmitEditing={() => void proceed(url)}
                  />
                  <Pressable style={[s.btnAccept, { paddingHorizontal: 14, backgroundColor: palette.inset }]} onPress={() => setScanOpen(true)}>
                    <Ionicons name="qr-code-outline" size={18} color={palette.text} />
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={{ alignItems: 'center', marginTop: 12 }}>
                <TileIcon icon={pendingIcon} name={title || '?'} seed={pendingInput} />
                <Text style={[s.dim, { marginTop: 6 }]} numberOfLines={1}>{pendingInput.replace('https://', '')}</Text>
                <TextInput
                  style={[s.input, { alignSelf: 'stretch', marginTop: 10 }]}
                  value={title}
                  onChangeText={setTitle}
                  placeholder={t('App title')}
                  placeholderTextColor={palette.placeholder}
                  maxLength={60}
                />
              </View>
            )}
            {err ? <Text style={[s.dim, { color: '#ef4444', marginTop: 6 }]}>{err}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable style={[s.btnAccept, { flex: 1, backgroundColor: palette.inset }]} onPress={closeAddSheet}>
                <Text style={[s.btnText, { color: palette.text }]}>{t('Cancel')}</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                style={[s.btnAccept, { flex: 1, opacity: busy ? 0.45 : 1 }]}
                onPress={() => (addStep === 'url' ? void proceed(url) : confirmAdd())}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{addStep === 'url' ? t('Next') : t('Add')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <ScanSheet visible={scanOpen} onClose={() => setScanOpen(false)} onCode={(v) => { setScanOpen(false); setUrl(v); void proceed(v); }} />

      {open && fw && signerRef.current ? (
        <React.Suspense fallback={null}>
          <MiniAppShellLazy
            app={open}
            firewall={fw}
            signer={signerRef.current}
            getWallet={getWallet}
            context={makeBridgeContext(getWallet)}
            onClose={() => setOpen(null)}
          />
        </React.Suspense>
      ) : null}
    </ScrollView>
  );
}

