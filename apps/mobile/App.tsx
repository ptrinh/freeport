/**
 * Freeport — minimal mobile client.
 * Tabs: Market (browse intents) · Post · Deals (confirm/track) · Key (backup).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  DEMO_MARKET,
  DEMO_SCHEMA,
  type Intent,
  type Negotiation,
} from '@freeport/protocol';
import { loadOrCreateKey, npubOf, makeBackup } from './src/identity';
import { MobileClient } from './src/client';

type Tab = 'market' | 'post' | 'deals' | 'key';

export default function App() {
  const [tab, setTab] = useState<Tab>('market');
  const [client, setClient] = useState<MobileClient | null>(null);
  const [npub, setNpub] = useState('');
  const [intents, setIntents] = useState<Intent[]>([]);
  const [negos, setNegos] = useState<Negotiation[]>([]);
  const skRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    (async () => {
      const sk = await loadOrCreateKey(); // silent identity, no signup
      skRef.current = sk;
      setNpub(npubOf(sk));
      const c = new MobileClient(sk);
      c.onIntent = (i) =>
        setIntents((prev) => (prev.some((p) => p.id === i.id) ? prev : [i, ...prev].slice(0, 100)));
      c.onNegotiationUpdate = () => setNegos([...c.negotiations.values()]);
      c.watchMarket(DEMO_MARKET);
      c.watchDMs();
      setClient(c);
    })();
  }, []);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <Text style={s.header}>Freeport · {DEMO_MARKET}</Text>
      {tab === 'market' && <MarketTab intents={intents} />}
      {tab === 'post' && <PostTab client={client} />}
      {tab === 'deals' && <DealsTab client={client} negos={negos} />}
      {tab === 'key' && <KeyTab npub={npub} sk={skRef} />}
      <View style={s.tabbar}>
        {(['market', 'post', 'deals', 'key'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
            <Text style={s.tabText}>{t}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function MarketTab({ intents }: { intents: Intent[] }) {
  return (
    <FlatList
      data={intents}
      keyExtractor={(i) => i.id}
      ListEmptyComponent={<Text style={s.dim}>Listening for intents…</Text>}
      renderItem={({ item }) => (
        <View style={s.card}>
          <Text style={s.cardTitle}>
            {item.content.side === 'offer' ? '🟢' : '🔵'} {item.content.title}
          </Text>
          <Text style={s.dim}>
            by {item.pubkey.slice(0, 12)}… · expires{' '}
            {new Date(item.content.expires_at * 1000).toLocaleTimeString()}
          </Text>
        </View>
      )}
    />
  );
}

function PostTab({ client }: { client: MobileClient | null }) {
  const [title, setTitle] = useState('Ride Orchard → Hougang');
  const [time, setTime] = useState('15:45');
  const post = async () => {
    if (!client) return;
    const [h, m] = time.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    const start = Math.floor(d.getTime() / 1000);
    await client.postIntent({
      side: 'request',
      market: DEMO_MARKET,
      schema: DEMO_SCHEMA,
      title,
      payload: {
        from: { name: 'Orchard Rd', geohash: 'w21z6v' },
        to: { name: 'Hougang Central', geohash: 'w21zgc' },
        seats: 1,
      },
      window: { start, end: start + 15 * 60 },
      flexMinutes: 30,
      expiresAt: Math.floor(Date.now() / 1000) + 6 * 3600,
      geohashes: ['w21z6'],
    });
    Alert.alert('Posted', 'Your intent is live on the relays.');
  };
  return (
    <View style={s.pad}>
      <Text style={s.label}>What do you need?</Text>
      <TextInput style={s.input} value={title} onChangeText={setTitle} />
      <Text style={s.label}>Around what time?</Text>
      <TextInput style={s.input} value={time} onChangeText={setTime} placeholder="HH:MM" />
      <Pressable style={s.btn} onPress={post}>
        <Text style={s.btnText}>Post to market</Text>
      </Pressable>
    </View>
  );
}

function DealsTab({ client, negos }: { client: MobileClient | null; negos: Negotiation[] }) {
  return (
    <FlatList
      data={negos}
      keyExtractor={(n) => n.id}
      ListEmptyComponent={<Text style={s.dim}>No negotiations yet.</Text>}
      renderItem={({ item }) => (
        <View style={s.card}>
          <Text style={s.cardTitle}>{item.intent.content.title}</Text>
          <Text style={s.dim}>state: {item.state}</Text>
          {item.terms?.window && (
            <Text style={s.dim}>
              proposed: {new Date(item.terms.window.start * 1000).toLocaleString()}
            </Text>
          )}
          {item.state === 'accepted_by_them' || (item.state === 'open' && item.termsBy === 'them') ? (
            <View style={s.row}>
              <Pressable style={s.btn} onPress={() => client?.accept(item.id, 'tg:@me')}>
                <Text style={s.btnText}>Accept</Text>
              </Pressable>
              <Pressable style={[s.btn, s.btnGhost]} onPress={() => client?.decline(item.id)}>
                <Text style={s.btnText}>Decline</Text>
              </Pressable>
            </View>
          ) : null}
          {item.state === 'confirmed' && (
            <Text style={s.ok}>✅ Deal — contact: {item.theirContact}</Text>
          )}
        </View>
      )}
    />
  );
}

function KeyTab({ npub, sk }: { npub: string; sk: React.MutableRefObject<Uint8Array | null> }) {
  const [pass, setPass] = useState('');
  const [blob, setBlob] = useState('');
  return (
    <View style={s.pad}>
      <Text style={s.label}>Your identity (created silently on first launch)</Text>
      <Text selectable style={s.mono}>{npub}</Text>
      <Text style={s.label}>Encrypted backup (NIP-49) — choose a passphrase:</Text>
      <TextInput style={s.input} secureTextEntry value={pass} onChangeText={setPass} />
      <Pressable
        style={s.btn}
        onPress={() => sk.current && pass && setBlob(makeBackup(sk.current, pass))}
      >
        <Text style={s.btnText}>Generate backup blob</Text>
      </Pressable>
      {blob ? (
        <>
          <Text style={s.dim}>
            Store this anywhere (cloud, email to yourself) — unreadable without your passphrase.
          </Text>
          <Text selectable style={s.mono}>{blob}</Text>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c0f14' },
  header: { color: '#e8edf2', fontSize: 18, fontWeight: '700', padding: 16 },
  tabbar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#1d2430' },
  tab: { flex: 1, padding: 14, alignItems: 'center' },
  tabActive: { backgroundColor: '#1d2430' },
  tabText: { color: '#e8edf2', textTransform: 'capitalize' },
  card: { backgroundColor: '#141a23', margin: 8, marginHorizontal: 16, padding: 12, borderRadius: 10 },
  cardTitle: { color: '#e8edf2', fontWeight: '600', marginBottom: 4 },
  dim: { color: '#8b97a6', fontSize: 13, padding: 2, textAlign: 'left' },
  ok: { color: '#5dd882', marginTop: 6 },
  pad: { padding: 16 },
  label: { color: '#8b97a6', marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: '#141a23', color: '#e8edf2', borderRadius: 8, padding: 10 },
  mono: { color: '#9fd3ff', fontFamily: 'Courier', fontSize: 12, marginVertical: 6 },
  btn: { backgroundColor: '#2563eb', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 12, marginRight: 8 },
  btnGhost: { backgroundColor: '#374151' },
  btnText: { color: 'white', fontWeight: '600' },
  row: { flexDirection: 'row' },
});
