/**
 * Freeport — P2P marketplace client.
 * Tabs: Market · Post · Deals · Key
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import {
  DEMO_MARKET,
  DEMO_SCHEMA,
  SERVICE_MARKET,
  SERVICE_SCHEMA,
  type Intent,
  type Negotiation,
  type ProposedTerms,
} from '@freeport/protocol';
import { loadOrCreateKey, npubOf, makeBackup } from './src/identity';
import { MobileClient } from './src/client';
import { uploadImage, UploadError } from './src/upload';

type Tab = 'market' | 'post' | 'deals' | 'key';
type PostType = 'rideshare' | 'service';

// ─── Root ────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<Tab>('market');
  const [client, setClient] = useState<MobileClient | null>(null);
  const [npub, setNpub] = useState('');
  const [intents, setIntents] = useState<Intent[]>([]);
  const [negos, setNegos] = useState<Negotiation[]>([]);
  const skRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    (async () => {
      const sk = await loadOrCreateKey();
      skRef.current = sk;
      setNpub(npubOf(sk));
      const c = new MobileClient(sk);
      c.onIntent = (i) =>
        setIntents((prev) => (prev.some((p) => p.id === i.id) ? prev : [i, ...prev].slice(0, 100)));
      c.onNegotiationUpdate = () => setNegos([...c.negotiations.values()]);
      c.watchMarket(DEMO_MARKET);
      c.watchMarket(SERVICE_MARKET);
      c.watchDMs();
      setClient(c);
    })();
  }, []);

  const pendingCount = negos.filter(
    (n) => n.state === 'open' && n.termsBy === 'them' || n.state === 'accepted_by_them',
  ).length;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <View style={s.titleBar}>
        <Text style={s.header}>Freeport</Text>
        <Text style={s.headerSub}>decentralised marketplace</Text>
      </View>
      {tab === 'market' && <MarketTab intents={intents} />}
      {tab === 'post' && <PostTab client={client} />}
      {tab === 'deals' && <DealsTab client={client} negos={negos} setNegos={setNegos} />}
      {tab === 'key' && <KeyTab npub={npub} sk={skRef} />}
      <View style={s.tabbar}>
        {(['market', 'post', 'deals', 'key'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>{t}</Text>
            {t === 'deals' && pendingCount > 0 && (
              <View style={s.badge}><Text style={s.badgeText}>{pendingCount}</Text></View>
            )}
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ─── Market tab ──────────────────────────────────────────────────────────────

function MarketTab({ intents }: { intents: Intent[] }) {
  return (
    <FlatList
      data={intents}
      keyExtractor={(i) => i.id}
      contentContainerStyle={{ paddingVertical: 8 }}
      ListEmptyComponent={<Text style={[s.dim, { padding: 20 }]}>Listening for intents on the relays…</Text>}
      renderItem={({ item }) => {
        const p = item.content.payload as Record<string, any>;
        const isRide = item.content.schema.startsWith('rideshare');
        const isSvc = item.content.schema.startsWith('service');
        return (
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.chip}>{isRide ? 'Rideshare' : isSvc ? 'Service' : item.content.market}</Text>
              <Text style={[s.chip, item.content.side === 'offer' ? s.chipGreen : s.chipBlue]}>
                {item.content.side}
              </Text>
            </View>
            <Text style={s.cardTitle}>{item.content.title}</Text>
            {isRide && (
              <>
                <Row label="From" value={p.from?.name} />
                <Row label="To" value={p.to?.name} />
                {p.payment && <Row label="Payment" value={p.payment} />}
              </>
            )}
            {isSvc && (
              <>
                <Row label="Service" value={p.service} />
                <Row label="Location" value={p.location?.name} />
                {p.payment && <Row label="Payment" value={p.payment} />}
                {p.duration_minutes && <Row label="Duration" value={`${p.duration_minutes} min`} />}
                {p.notes && <Row label="Notes" value={p.notes} />}
              </>
            )}
            {item.content.window && (
              <Row label="Time" value={fmtWindow(item.content.window)} />
            )}
            {Array.isArray(p.images) && p.images.length > 0 && (
              <View style={s.imageGrid}>
                {(p.images as string[]).map((url: string) => (
                  <Image key={url} source={{ uri: url }} style={s.imageThumb} />
                ))}
              </View>
            )}
            <Text style={s.meta}>
              {item.pubkey.slice(0, 10)}… · expires {new Date(item.content.expires_at * 1000).toLocaleTimeString()}
            </Text>
          </View>
        );
      }}
    />
  );
}

// ─── Post tab ────────────────────────────────────────────────────────────────

function PostTab({ client }: { client: MobileClient | null }) {
  const [type, setType] = useState<PostType>('rideshare');
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Text style={s.sectionTitle}>New intent</Text>
        <View style={s.segRow}>
          {(['rideshare', 'service'] as PostType[]).map((t) => (
            <Pressable key={t} onPress={() => setType(t)} style={[s.seg, type === t && s.segActive]}>
              <Text style={[s.segText, type === t && s.segTextActive]}>{t === 'rideshare' ? 'Rideshare' : 'Service'}</Text>
            </Pressable>
          ))}
        </View>
        {type === 'rideshare' ? <RideshareForm client={client} /> : <ServiceForm client={client} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RideshareForm({ client }: { client: MobileClient | null }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [time, setTime] = useState('');
  const [payment, setPayment] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);

  const post = async () => {
    if (!client) return;
    if (!from.trim() || !to.trim()) { Alert.alert('Missing fields', 'From and To are required.'); return; }
    setPosting(true);
    try {
      const window = parseTimeToWindow(time);
      await client.postIntent({
        side: 'request',
        market: DEMO_MARKET,
        schema: DEMO_SCHEMA,
        title: `Ride ${from} → ${to}${time ? ' at ' + time : ''}`,
        payload: { from: { name: from, geohash: 'w21z6v' }, to: { name: to, geohash: 'w21zgc' }, payment: payment || undefined, images: images.length ? images : undefined },
        window: window ?? undefined,
        flexMinutes: 30,
        expiresAt: Math.floor(Date.now() / 1000) + 6 * 3600,
        geohashes: ['w21z6'],
      });
      Alert.alert('Posted', 'Your ride request is live.');
    } finally { setPosting(false); }
  };

  return (
    <>
      <Field label="From *" value={from} onChange={setFrom} placeholder="e.g. Orchard Rd" />
      <Field label="To *" value={to} onChange={setTo} placeholder="e.g. Hougang Central" />
      <Field label="Time" value={time} onChange={setTime} placeholder="HH:MM (leave blank for flexible)" />
      <Field label="Payment" value={payment} onChange={setPayment} placeholder="e.g. $12 or split petrol" />
      <ImagePickerField images={images} onChange={setImages} />
      <PostButton onPress={post} loading={posting} />
    </>
  );
}

function ServiceForm({ client }: { client: MobileClient | null }) {
  const [location, setLocation] = useState('');
  const [service, setService] = useState('');
  const [payment, setPayment] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);

  const post = async () => {
    if (!client) return;
    if (!location.trim() || !service.trim()) { Alert.alert('Missing fields', 'Location and Service are required.'); return; }
    setPosting(true);
    try {
      const window = parseTimeToWindow(time);
      const durationMin = duration ? parseInt(duration, 10) : undefined;
      await client.postIntent({
        side: 'request',
        market: SERVICE_MARKET,
        schema: SERVICE_SCHEMA,
        title: `${service} at ${location}${time ? ' at ' + time : ''}`,
        payload: {
          location: { name: location, geohash: 'w21z6v' },
          service,
          payment: payment || undefined,
          duration_minutes: durationMin,
          notes: notes || undefined,
          images: images.length ? images : undefined,
        },
        window: window ?? undefined,
        flexMinutes: 30,
        expiresAt: Math.floor(Date.now() / 1000) + 6 * 3600,
        geohashes: ['w21z6'],
      });
      Alert.alert('Posted', 'Your service request is live.');
    } finally { setPosting(false); }
  };

  return (
    <>
      <Field label="Location *" value={location} onChange={setLocation} placeholder="e.g. Toa Payoh" />
      <Field label="Service *" value={service} onChange={setService} placeholder="e.g. Plumber, House cleaning" />
      <Field label="Payment" value={payment} onChange={setPayment} placeholder="e.g. $80/hr" />
      <Field label="Time" value={time} onChange={setTime} placeholder="HH:MM" />
      <Field label="Duration (minutes)" value={duration} onChange={setDuration} placeholder="e.g. 120" keyboardType="numeric" />
      <Field label="Additional information" value={notes} onChange={setNotes} placeholder="Any details…" multiline />
      <ImagePickerField images={images} onChange={setImages} label="Photos (optional)" />
      <PostButton onPress={post} loading={posting} />
    </>
  );
}

// ─── Deals tab ───────────────────────────────────────────────────────────────

function DealsTab({
  client,
  negos,
  setNegos,
}: {
  client: MobileClient | null;
  negos: Negotiation[];
  setNegos: React.Dispatch<React.SetStateAction<Negotiation[]>>;
}) {
  const [counteringId, setCounteringId] = useState<string | null>(null);
  const sorted = [...negos].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <FlatList
      data={sorted}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ paddingVertical: 8 }}
      ListEmptyComponent={<Text style={[s.dim, { padding: 20 }]}>No negotiations yet.</Text>}
      renderItem={({ item }) => {
        const needsAction =
          item.state === 'accepted_by_them' ||
          (item.state === 'open' && item.termsBy === 'them');
        const isCountering = counteringId === item.id;
        return (
          <View style={[s.card, needsAction && s.cardHighlight]}>
            <View style={s.row}>
              <Text style={s.chip}>{item.intent.content.schema.startsWith('rideshare') ? 'Rideshare' : 'Service'}</Text>
              <Text style={[s.chip, stateColor(item.state)]}>{item.state.replace(/_/g, ' ')}</Text>
            </View>
            <Text style={s.cardTitle}>{item.intent.content.title}</Text>
            <Text style={s.meta}>peer {item.peer.slice(0, 10)}…</Text>

            {/* Current terms on the table */}
            {item.terms && <TermsSummary terms={item.terms} schema={item.intent.content.schema} />}

            {/* Confirmed deal */}
            {item.state === 'confirmed' && (
              <View style={s.dealBanner}>
                <Text style={s.dealText}>Deal confirmed</Text>
                <Text style={s.dealContact}>Contact: {item.theirContact ?? '—'}</Text>
              </View>
            )}

            {/* Action buttons when peer proposed terms */}
            {needsAction && !isCountering && (
              <View style={s.btnRow}>
                <Pressable style={s.btnAccept} onPress={() => client?.accept(item.id, 'tg:@me')}>
                  <Text style={s.btnText}>Accept</Text>
                </Pressable>
                <Pressable style={s.btnCounter} onPress={() => setCounteringId(item.id)}>
                  <Text style={s.btnText}>Counter</Text>
                </Pressable>
                <Pressable style={s.btnDecline} onPress={() => { client?.decline(item.id); setCounteringId(null); }}>
                  <Text style={s.btnText}>Decline</Text>
                </Pressable>
              </View>
            )}

            {/* Counter-offer editor */}
            {isCountering && (
              <CounterEditor
                nego={item}
                onSend={async (terms) => {
                  await client?.counter(item.id, terms);
                  setCounteringId(null);
                }}
                onCancel={() => setCounteringId(null)}
              />
            )}
          </View>
        );
      }}
    />
  );
}

function CounterEditor({
  nego,
  onSend,
  onCancel,
}: {
  nego: Negotiation;
  onSend: (terms: ProposedTerms) => Promise<void>;
  onCancel: () => void;
}) {
  const isRide = nego.intent.content.schema.startsWith('rideshare');
  const existing = nego.terms ?? {};
  const existingWindow = existing.window;
  const [time, setTime] = useState(existingWindow ? fmtTime(existingWindow.start) : '');
  const [payment, setPayment] = useState(existing.payment ?? '');
  const [from, setFrom] = useState(existing.from ?? '');
  const [to, setTo] = useState(existing.to ?? '');
  const [location, setLocation] = useState(existing.location ?? '');
  const [service, setService] = useState(existing.service ?? '');
  const [duration, setDuration] = useState(existing.duration_minutes ? String(existing.duration_minutes) : '');
  const [note, setNote] = useState(existing.note ?? '');

  const send = async () => {
    const window = parseTimeToWindow(time, existingWindow);
    const terms: ProposedTerms = {
      window: window ?? existingWindow,
      payment: payment || undefined,
      note: note || undefined,
    };
    if (isRide) {
      if (from) terms.from = from;
      if (to) terms.to = to;
    } else {
      if (location) terms.location = location;
      if (service) terms.service = service;
      if (duration) terms.duration_minutes = parseInt(duration, 10);
    }
    await onSend(terms);
  };

  return (
    <View style={s.counterBox}>
      <Text style={s.sectionTitle}>Your counter-offer</Text>
      {isRide ? (
        <>
          <Field label="From" value={from} onChange={setFrom} placeholder="leave blank to keep" />
          <Field label="To" value={to} onChange={setTo} placeholder="leave blank to keep" />
        </>
      ) : (
        <>
          <Field label="Location" value={location} onChange={setLocation} placeholder="leave blank to keep" />
          <Field label="Service" value={service} onChange={setService} placeholder="leave blank to keep" />
          <Field label="Duration (min)" value={duration} onChange={setDuration} keyboardType="numeric" />
        </>
      )}
      <Field label="Time (HH:MM)" value={time} onChange={setTime} placeholder="leave blank to keep" />
      <Field label="Payment" value={payment} onChange={setPayment} placeholder="e.g. $15" />
      <Field label="Note" value={note} onChange={setNote} placeholder="optional note" />
      <View style={s.btnRow}>
        <Pressable style={s.btnAccept} onPress={send}><Text style={s.btnText}>Send counter</Text></Pressable>
        <Pressable style={s.btnDecline} onPress={onCancel}><Text style={s.btnText}>Cancel</Text></Pressable>
      </View>
    </View>
  );
}

// ─── Key tab ─────────────────────────────────────────────────────────────────

function KeyTab({ npub, sk }: { npub: string; sk: React.MutableRefObject<Uint8Array | null> }) {
  const [pass, setPass] = useState('');
  const [blob, setBlob] = useState('');
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Text style={s.sectionTitle}>Your identity</Text>
      <Text style={s.dim}>Created silently on first launch — no signup required.</Text>
      <Text selectable style={s.mono}>{npub}</Text>
      <Text style={s.sectionTitle}>Encrypted key backup (NIP-49)</Text>
      <Text style={s.dim}>Set a passphrase → copy the blob anywhere (email, cloud). Unreadable without the passphrase.</Text>
      <Field label="Passphrase" value={pass} onChange={setPass} secure />
      <Pressable style={s.btnAccept} onPress={() => sk.current && pass && setBlob(makeBackup(sk.current, pass))}>
        <Text style={s.btnText}>Generate backup</Text>
      </Pressable>
      {blob ? <Text selectable style={s.mono}>{blob}</Text> : null}
    </ScrollView>
  );
}

// ─── Shared components ───────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder = '', multiline = false, keyboardType = 'default', secure = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean; keyboardType?: any; secure?: boolean;
}) {
  return (
    <>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, multiline && { height: 80, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#4b5563"
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoCapitalize="none"
      />
    </>
  );
}

function PostButton({ onPress, loading = false }: { onPress: () => void; loading?: boolean }) {
  return (
    <Pressable style={[s.btnAccept, { marginTop: 20 }, loading && { opacity: 0.6 }]} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>Post to market</Text>}
    </Pressable>
  );
}

function ImagePickerField({
  images,
  onChange,
  label = 'Photos (optional)',
}: {
  images: string[];
  onChange: (urls: string[]) => void;
  label?: string;
}) {
  const [uploading, setUploading] = useState(false);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to attach images.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 4,
    });
    if (result.canceled || !result.assets.length) return;
    setUploading(true);
    try {
      const urls = await Promise.all(result.assets.map((a) => uploadImage(a.uri)));
      onChange([...images, ...urls]);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof UploadError ? e.message : 'Try again.');
    } finally {
      setUploading(false);
    }
  };

  const remove = (url: string) => onChange(images.filter((u) => u !== url));

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.imageGrid}>
        {images.map((url) => (
          <View key={url} style={s.imageThumbWrap}>
            <Image source={{ uri: url }} style={s.imageThumb} />
            <Pressable style={s.imageRemove} onPress={() => remove(url)}>
              <Text style={s.imageRemoveText}>✕</Text>
            </Pressable>
          </View>
        ))}
        {images.length < 4 && (
          <Pressable style={s.imageAdd} onPress={pick} disabled={uploading}>
            {uploading
              ? <ActivityIndicator color="#4b5a6e" />
              : <Text style={s.imageAddText}>{images.length === 0 ? '+ Add photos' : '+'}</Text>
            }
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

function TermsSummary({ terms, schema }: { terms: ProposedTerms; schema: string }) {
  const isRide = schema.startsWith('rideshare');
  return (
    <View style={s.termsBox}>
      <Text style={s.termsTitle}>Proposed terms</Text>
      {isRide ? (
        <>
          {terms.from && <Row label="From" value={terms.from} />}
          {terms.to && <Row label="To" value={terms.to} />}
        </>
      ) : (
        <>
          {terms.location && <Row label="Location" value={terms.location} />}
          {terms.service && <Row label="Service" value={terms.service} />}
          {terms.duration_minutes && <Row label="Duration" value={`${terms.duration_minutes} min`} />}
        </>
      )}
      {terms.window && <Row label="Time" value={fmtWindow(terms.window)} />}
      {terms.payment && <Row label="Payment" value={terms.payment} />}
      {terms.note && <Row label="Note" value={terms.note} />}
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseTimeToWindow(
  timeStr: string,
  fallback?: { start: number; end: number },
): { start: number; end: number } | null {
  if (!timeStr.trim()) return fallback ?? null;
  const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback ?? null;
  const d = new Date();
  d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  const start = Math.floor(d.getTime() / 1000);
  return { start, end: start + 15 * 60 };
}

function fmtTime(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtWindow(w: { start: number; end: number }): string {
  return `${new Date(w.start * 1000).toLocaleString()} → ${new Date(w.end * 1000).toLocaleTimeString()}`;
}

function stateColor(state: string) {
  if (state === 'confirmed') return s.chipGreen;
  if (state === 'cancelled' || state === 'expired') return s.chipRed;
  if (state.startsWith('accepted')) return s.chipBlue;
  return {};
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0d12' },
  titleBar: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#1a2030' },
  header: { color: '#e8edf2', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  headerSub: { color: '#4b5a6e', fontSize: 11 },
  sectionTitle: { color: '#e8edf2', fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  tabbar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#1a2030' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderTopWidth: 2, borderTopColor: '#3b82f6' },
  tabText: { color: '#4b5a6e', fontSize: 12, textTransform: 'capitalize' },
  tabTextActive: { color: '#e8edf2', fontWeight: '600' },
  badge: { position: 'absolute', top: 6, right: 12, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: 'white', fontSize: 10, fontWeight: '700' },
  card: { backgroundColor: '#111827', marginHorizontal: 12, marginVertical: 5, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#1e2a3a' },
  cardHighlight: { borderColor: '#3b82f6' },
  cardTitle: { color: '#e8edf2', fontWeight: '600', fontSize: 15, marginTop: 6, marginBottom: 4 },
  meta: { color: '#3d4d5e', fontSize: 11, marginTop: 4 },
  dim: { color: '#4b5a6e', fontSize: 13 },
  pad: { padding: 16, paddingBottom: 40 },
  label: { color: '#6b7a8e', fontSize: 12, marginTop: 12, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#111827', color: '#e8edf2', borderRadius: 8, padding: 11, borderWidth: 1, borderColor: '#1e2a3a', fontSize: 15 },
  mono: { color: '#60a5fa', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12, marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  rowLabel: { color: '#4b5a6e', fontSize: 12, width: 70 },
  rowValue: { color: '#c9d5e0', fontSize: 13, flex: 1 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btnAccept: { backgroundColor: '#1d4ed8', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  btnCounter: { backgroundColor: '#065f46', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  btnDecline: { backgroundColor: '#374151', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: '600', fontSize: 14 },
  chip: { backgroundColor: '#1e2a3a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, color: '#8b97a6', marginRight: 6, marginBottom: 4 },
  chipGreen: { backgroundColor: '#064e3b', color: '#6ee7b7' },
  chipBlue: { backgroundColor: '#1e3a5f', color: '#93c5fd' },
  chipRed: { backgroundColor: '#450a0a', color: '#fca5a5' },
  termsBox: { backgroundColor: '#0d1520', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#1e2a3a' },
  termsTitle: { color: '#4b5a6e', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  dealBanner: { backgroundColor: '#052e16', borderRadius: 8, padding: 10, marginTop: 8 },
  dealText: { color: '#4ade80', fontWeight: '700' },
  dealContact: { color: '#6ee7b7', fontSize: 13, marginTop: 2 },
  counterBox: { marginTop: 12, padding: 12, backgroundColor: '#0d1520', borderRadius: 10, borderWidth: 1, borderColor: '#1e3a5f' },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  imageThumbWrap: { position: 'relative' },
  imageThumb: { width: 80, height: 80, borderRadius: 8, backgroundColor: '#1a2030' },
  imageRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: '#374151', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  imageRemoveText: { color: 'white', fontSize: 10, fontWeight: '700' },
  imageAdd: { width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: '#1e2a3a', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827' },
  imageAddText: { color: '#4b5a6e', fontSize: 13 },
  segRow: { flexDirection: 'row', marginTop: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#1e2a3a' },
  seg: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: '#111827' },
  segActive: { backgroundColor: '#1e3a5f' },
  segText: { color: '#4b5a6e', fontWeight: '600' },
  segTextActive: { color: '#93c5fd' },
});
