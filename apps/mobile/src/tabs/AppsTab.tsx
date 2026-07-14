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
import { confirmAsync } from '../ui/alerts';
import type { Signer } from '../signer';
import { evaluateAdd, type MiniAppFirewall, type MiniAppRecord } from '../miniapps/firewall';
import { loadFirewall, persistFirewall } from '../miniapps/store';
import { fetchAppMeta, sameOriginAsShell } from '../miniapps/metadata';
import { makeBridgeContext } from '../miniapps/context';
import { activeWalletProvider } from '../wallet';
import { ScanSheet } from './wallet/ScanSheet';

const MiniAppShellLazy = React.lazy(() =>
  import('../miniapps/MiniAppShell').then((m) => ({ default: m.MiniAppShell })),
);

const COLS = 3;
const CELL_H = 108;
const ICON_SIZE = 56;

/** First-party mini-apps are served from a DISTINCT origin from the web shell
 *  (freeport.network) so the web sandbox's same-origin policy actually isolates
 *  them — see sameOriginAsShell / docs/miniapps-security.md. */
const MINIAPP_HOST = 'https://apps.freeport.network';

/** Convenience: the example apps' GitHub source links resolve to their
 *  published homes, so pasting either the repo URL or the web URL works. */
function resolveDemoAlias(input: string): string {
  const m = /^https:\/\/github\.com\/ptrinh\/freeport(?:\/tree\/[^/]+)?\/examples\/([a-z0-9-]+)\/?$/i.exec(input);
  if (m) return `${MINIAPP_HOST}/${m[1]}/`;
  // Bare repo root → the original eSIM demo shop.
  if (/^https:\/\/github\.com\/ptrinh\/freeport\/?$/i.test(input)) return `${MINIAPP_HOST}/esim-store/`;
  // The old same-origin demo homes → their new isolated origin.
  const old = /^https:\/\/freeport\.network\/(esim-store|insurance-store)\/?$/i.exec(input);
  if (old) return `${MINIAPP_HOST}/${old[1]}/`;
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
  const [pendingMeta, setPendingMeta] = useState<{ verified: boolean; permissions: string[] }>({ verified: false, permissions: [] });
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
    setAddStep(null); setErr(''); setBusy(false); setPendingInput(''); setPendingIcon(undefined); setPendingMeta({ verified: false, permissions: [] }); setTitle('');
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
    if (sameOriginAsShell(input)) {
      // On web, a same-origin app isn't sandboxable — it could read your key.
      setErr(t("This app is hosted on Freeport's own domain and can't run safely in the web app. Open it in the mobile app, or use a version hosted elsewhere."));
      return;
    }
    setBusy(true);
    const meta = await fetchAppMeta(input);
    setBusy(false);
    // A valid freeport.json manifest is REQUIRED — no manifest, no add. (On
    // web the manifest must also be served with CORS; the SDK README says so.)
    if (!meta.verified) {
      setErr(t("No freeport.json manifest found — this site can't be added as a mini-app."));
      return;
    }
    setPendingInput(input);
    // The tile falls back to the site favicon / a letter glyph if the
    // manifest icon is missing or never loads.
    setPendingIcon(meta.icon ?? `${origin}/favicon.ico`);
    setTitle(meta.title ?? new URL(origin).hostname.replace(/^www\./, ''));
    setPendingMeta({ verified: true, permissions: meta.permissions });
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
      fw.registerApp(pendingInput, name.slice(0, 60), Date.now(), pendingIcon, pendingMeta.verified);
    } catch {
      setErr(t('This app is on the community blocklist.'));
      return;
    }
    persistFirewall();
    refresh();
    closeAddSheet();
  };

  const remove = async (app: MiniAppRecord) => {
    if (!fw) return;
    // Removing drops the app AND its granted permissions — confirm, since an
    // accidental ✕ tap otherwise silently destroys trust state the user then
    // has to re-approve one dialog at a time.
    const ok = await confirmAsync(
      t('Remove {name}?', { name: app.name }),
      t('This deletes the app and the permissions you granted it. You can add it again later.'),
      t('Remove'),
    );
    if (!ok) return;
    fw.removeApp(app.url);
    persistFirewall();
    refresh();
  };

  // Handlers read current state through refs so ONE PanResponder per tile can
  // be created once and reused — recreating them every render (the old
  // `{...makePan(i).panHandlers}`) dropped in-flight gestures.
  const editRef = useRef(edit); editRef.current = edit;
  const appsRef = useRef(apps); appsRef.current = apps;
  const walletOffsetRef = useRef(walletOffset); walletOffsetRef.current = walletOffset;

  /** Drop the dragged tile: translate its grid slot by the gesture delta. */
  const commitDrag = (index: number, dx: number, dy: number) => {
    const list = appsRef.current;
    if (!fw || gridW.current <= 0) return;
    const cellW = gridW.current / COLS;
    const vis = walletOffsetRef.current + index;
    const col = Math.min(COLS - 1, Math.max(0, Math.round(vis % COLS + dx / cellW)));
    const row = Math.max(0, Math.floor(vis / COLS) + Math.round(dy / CELL_H));
    const target = Math.min(list.length - 1, Math.max(0, row * COLS + col - walletOffsetRef.current));
    if (target === index) return;
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setApps(next);
    fw.reorderApps(next.map((a) => a.url));
    persistFirewall();
  };

  // Lazily-built, stable-per-index PanResponders. Capture the gesture only in
  // edit mode AND only after a clear (>8px) move, so a plain vertical swipe
  // still scrolls the grid instead of being swallowed as a drag.
  const pansRef = useRef(new Map<number, ReturnType<typeof PanResponder.create>>());
  const getPan = (index: number) => {
    let p = pansRef.current.get(index);
    if (!p) {
      p = PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => editRef.current && (g.dx * g.dx + g.dy * g.dy) > 64,
        onPanResponderGrant: () => { setDragIdx(index); pan.setValue({ x: 0, y: 0 }); },
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_e, g) => { commitDrag(index, g.dx, g.dy); setDragIdx(null); pan.setValue({ x: 0, y: 0 }); },
        onPanResponderTerminate: () => { setDragIdx(null); pan.setValue({ x: 0, y: 0 }); },
      });
      pansRef.current.set(index, p);
    }
    return p;
  };

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
                <TileIcon icon={app.icon} name={app.name} seed={app.url} />,
                app.name,
              );
              if (!edit) {
                return (
                  <Pressable key={app.url} style={tileStyle} onPress={() => setOpen(app)}>
                    {body}
                  </Pressable>
                );
              }
              return (
                <Animated.View
                  key={app.url}
                  style={[
                    tileStyle,
                    dragging && { transform: pan.getTranslateTransform(), zIndex: 10, elevation: 10, opacity: 0.85 },
                  ]}
                >
                  <View {...getPan(i).panHandlers}>{body}</View>
                  <Pressable
                    hitSlop={8}
                    onPress={() => void remove(app)}
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                  <Ionicons name="shield-checkmark" size={14} color="#10b981" />
                  <Text style={[s.dim, { color: '#10b981' }]}>{t('Mini-app manifest found')}</Text>
                </View>
                {pendingMeta.permissions.length > 0 ? (
                  <Text style={[s.dim, { marginTop: 6, paddingHorizontal: 4 }]} numberOfLines={3}>
                    {t('May request')}: {pendingMeta.permissions.join(', ')}
                  </Text>
                ) : null}
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

