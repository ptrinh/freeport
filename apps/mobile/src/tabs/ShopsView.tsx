/**
 * Storefronts (NIP-15) — the Shops view inside Browse: durable product
 * listings grouped by seller, plus the "My shop" editor (publish / edit /
 * remove kind-30018 products). Buying is conversational by design: "Chat
 * with seller" starts a friend-chat request — negotiation, payment (in-chat
 * ⚡) and reputation all reuse the existing rails; no checkout server.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { mintProductId, type Product } from '@freeport/protocol';
import { t } from '../i18n';
import { MobileClient } from '../client';
import { uploadImage, UploadError } from '../upload';
import { npubFromHex } from '../identity';
import { defaultAvatarUrl } from '../profile';
import { s, palette } from '../ui/theme';
import { uiAlert, confirmAsync } from '../ui/alerts';
import { Field } from '../ui/fields';

function sellerName(pubkey: string, client: MobileClient | null): string {
  return (client?.profiles.get(pubkey)?.name || npubFromHex(pubkey).slice(0, 12) + '…').trim();
}

function sellerAvatar(pubkey: string, client: MobileClient | null): string {
  return client?.profiles.get(pubkey)?.picture || defaultAvatarUrl(npubFromHex(pubkey));
}

function fmtPrice(p: Product): string {
  return `${p.content.price.toLocaleString()} ${p.content.currency}`;
}

// ─── Product editor (My shop) ────────────────────────────────────────────────

function ProductEditor({ client, market, defaultCurrency, product, onDone }: {
  client: MobileClient | null;
  market: string;
  defaultCurrency: string;
  /** Present when editing; absent when adding. */
  product?: Product;
  onDone: () => void;
}) {
  const [name, setName] = useState(product?.content.name ?? '');
  const [description, setDescription] = useState(product?.content.description ?? '');
  const [price, setPrice] = useState(product ? String(product.content.price) : '');
  const [currency, setCurrency] = useState(product?.content.currency ?? defaultCurrency);
  const [image, setImage] = useState<string | null>(product?.content.images?.[0] ?? null);
  const [busy, setBusy] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setBusy(true);
    try { setImage(await uploadImage(result.assets[0])); }
    catch (e) { Alert.alert('Upload failed', e instanceof UploadError ? e.message : 'Try again.'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    const priceNum = Number(price.replace(',', '.'));
    if (!name.trim()) { uiAlert(t('Name is required')); return; }
    if (!Number.isFinite(priceNum) || priceNum < 0) { uiAlert(t('Enter a valid price')); return; }
    setBusy(true);
    try {
      await client?.publishProduct({
        d: product?.d ?? mintProductId(),
        market,
        name, description,
        images: image ? [image] : undefined,
        currency: currency.trim().toUpperCase() || defaultCurrency,
        price: priceNum,
      });
      onDone();
    } catch (e) {
      uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined);
    } finally { setBusy(false); }
  };

  return (
    <View style={s.counterBox}>
      <Text style={s.sectionTitle}>{product ? t('Edit product') : t('Add a product')}</Text>
      <Field label={t('Name')} value={name} onChange={setName} placeholder={t('What are you selling?')} />
      <Field label={t('Description')} value={description} onChange={setDescription} placeholder={t('optional note')} />
      <View style={[s.row, { gap: 8 }]}>
        <View style={{ flex: 2 }}><Field label={t('Price')} value={price} onChange={setPrice} placeholder="0" keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Field label={t('Currency')} value={currency} onChange={setCurrency} placeholder={defaultCurrency} /></View>
      </View>
      <Pressable style={[s.btnGhost, { marginTop: 8 }]} onPress={pickImage} disabled={busy}>
        <Text style={s.btnGhostText}>{image ? t('Change photo') : t('Add photo')}</Text>
      </Pressable>
      {image ? <Image source={{ uri: image }} style={{ width: 84, height: 84, borderRadius: 8, marginTop: 8 }} /> : null}
      <View style={[s.btnRow, { marginTop: 10 }]}>
        <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={save} disabled={busy}>
          {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Publish')}</Text>}
        </Pressable>
        <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={onDone} disabled={busy}>
          <Text style={s.btnText}>{t('Cancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MyShopSheet({ client, market, defaultCurrency, myProducts, onClose }: {
  client: MobileClient | null;
  market: string;
  defaultCurrency: string;
  myProducts: Product[];
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Product | 'new' | null>(myProducts.length ? null : 'new');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={[s.sortSheet, { maxHeight: '85%' }]} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.sectionTitle}>{t('My shop')}</Text>
            <Text style={s.dim}>{t('Durable listings — they stay up until you remove them, unlike posts.')}</Text>
            {myProducts.map((p) => (
              <View key={p.d} style={[s.card, { marginHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                {p.content.images?.[0] ? <Image source={{ uri: p.content.images[0] }} style={{ width: 44, height: 44, borderRadius: 6 }} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>{p.content.name}</Text>
                  <Text style={s.dim}>{fmtPrice(p)}</Text>
                </View>
                <Pressable hitSlop={8} onPress={() => setEditing(p)} accessibilityRole="button" accessibilityLabel={t('Edit product')}>
                  <Ionicons name="pencil-outline" size={18} color={palette.text2} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button" accessibilityLabel={t('Remove product')}
                  onPress={async () => {
                    const ok = await confirmAsync(t('Remove this product?'), p.content.name, t('Remove'));
                    if (ok) client?.removeProduct(p.d, market).catch(() => uiAlert(t('Could not connect. Check your internet and try again.')));
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={palette.danger} />
                </Pressable>
              </View>
            ))}
            {editing ? (
              <ProductEditor
                client={client}
                market={market}
                defaultCurrency={defaultCurrency}
                product={editing === 'new' ? undefined : editing}
                onDone={() => setEditing(null)}
              />
            ) : (
              <Pressable style={[s.btnAccept, { marginTop: 10 }]} onPress={() => setEditing('new')}>
                <Text style={s.btnText}>{'+ ' + t('Add a product')}</Text>
              </Pressable>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Shops browse ────────────────────────────────────────────────────────────

export function ShopsView({ client, products, myPubkey, market, defaultCurrency, onChatSeller, onScroll }: {
  client: MobileClient | null;
  products: Product[];
  myPubkey: string;
  market: string;
  defaultCurrency: string;
  /** Start a chat request with a seller (the conversational checkout). */
  onChatSeller: (pubkey: string) => void;
  onScroll?: (e: any) => void;
}) {
  const [showMyShop, setShowMyShop] = useState(false);
  const myProducts = useMemo(() => products.filter((p) => p.pubkey === myPubkey).sort((a, b) => b.createdAt - a.createdAt), [products, myPubkey]);
  const bySeller = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      if (p.pubkey === myPubkey) continue;
      const list = map.get(p.pubkey) ?? [];
      list.push(p);
      map.set(p.pubkey, list);
    }
    // Freshest shop first; products newest-first within a shop.
    return [...map.entries()]
      .map(([pubkey, list]) => ({ pubkey, list: list.sort((a, b) => b.createdAt - a.createdAt) }))
      .sort((a, b) => b.list[0].createdAt - a.list[0].createdAt);
  }, [products, myPubkey]);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
      {showMyShop && (
        <MyShopSheet client={client} market={market} defaultCurrency={defaultCurrency} myProducts={myProducts} onClose={() => setShowMyShop(false)} />
      )}
      <Pressable style={[s.btnCounter, { marginBottom: 10 }]} onPress={() => setShowMyShop(true)}>
        <View style={[s.row, { gap: 6, justifyContent: 'center' }]}>
          <Ionicons name="storefront-outline" size={15} color="white" />
          <Text style={s.btnText}>{t('My shop')}{myProducts.length ? ` (${myProducts.length})` : ''}</Text>
        </View>
      </Pressable>
      {bySeller.length === 0 ? (
        <View style={s.emptyWrap}>
          <Ionicons name="storefront-outline" size={40} color={palette.dim} />
          <Text style={s.emptyText}>{t('No shops yet. Open yours with "My shop".')}</Text>
        </View>
      ) : bySeller.map(({ pubkey, list }) => (
        <View key={pubkey} style={[s.card, { marginHorizontal: 0 }]}>
          <View style={[s.row, { gap: 8, alignItems: 'center' }]}>
            <Image source={{ uri: sellerAvatar(pubkey, client) }} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.chipBg }} />
            <Text style={[s.cardTitle, { flex: 1 }]} numberOfLines={1}>{sellerName(pubkey, client)}</Text>
            <Pressable style={s.mapLink} onPress={() => onChatSeller(pubkey)} accessibilityRole="button" accessibilityLabel={t('Chat with seller')}>
              <Text style={s.mapLinkText}>{'💬 ' + t('Chat with seller')}</Text>
            </Pressable>
          </View>
          {list.map((p) => (
            <View key={p.d} style={[s.row, { marginTop: 8, gap: 10, alignItems: 'center' }]}>
              {p.content.images?.[0] ? (
                <Image source={{ uri: p.content.images[0] }} style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: palette.chipBg }} />
              ) : (
                <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: palette.chipBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="pricetag-outline" size={20} color={palette.dim} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{p.content.name}</Text>
                {p.content.description ? <Text style={s.dim} numberOfLines={2}>{p.content.description}</Text> : null}
                <Text style={[s.mapLinkText, { marginTop: 2 }]}>{fmtPrice(p)}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
