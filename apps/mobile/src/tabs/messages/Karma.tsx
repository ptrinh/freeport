import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KIND_KARMA } from '@freeport/protocol';
import { t } from '../../i18n';
import { MobileClient } from '../../client';
import { karmaLabel, type KarmaScore } from '../../karma';
import { query } from '../../query';
import { fetchReputation } from '../../reputation';
import { kvGet, kvSet } from '../../kv';
import { dirIcon } from '../../rtl';
import { s, palette } from '../../ui/theme';
import { formatAge } from '../../ui/format';
import { uiAlert } from '../../ui/alerts';
import { Field, type IoniconName } from '../../ui/fields';

/** Karma/feedback this user has RECEIVED (kind:32103 with #p = my pubkey). */
/** Compact self stats under the avatar: Karma · Completed deals · Account age.
 *  Tap → open Messages → Completed (feedback received). */
export function SelfStats({ client, onPress }: { client: MobileClient; onPress: () => void }) {
  const [rep, setRep] = useState<{ score: number; deals: number; count: number } | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Account-creation timestamp — stamped here lazily if not set yet.
      let c = await kvGet('freeport.created');
      if (!c) { c = String(Math.floor(Date.now() / 1000)); await kvSet('freeport.created', c); }
      if (!cancelled) setCreatedAt(parseInt(c, 10));
    })();
    fetchReputation(client.pool, client.relays, client.pubkey, null)
      .then((r) => { if (!cancelled) setRep({ score: r.score, deals: r.deals, count: r.ratingCount }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [client]);

  const age = createdAt ? formatAge(Date.now() / 1000 - createdAt) : '…';
  return (
    <Pressable style={s.statsRow} onPress={onPress}>
      <View style={s.statBox}>
        <Text style={s.statValue} numberOfLines={1}>{rep ? karmaLabel(rep.score, rep.count) : '…'}</Text>
        <Text style={s.statLabel}>{t("Karma score")}{rep && rep.count ? ` · ${rep.count}` : ''}</Text>
      </View>
      <View style={s.statBox}>
        <Text style={s.statValue}>{rep ? rep.deals : '…'}</Text>
        <Text style={s.statLabel}>{t("Completed deals")}</Text>
      </View>
      <View style={s.statBox}>
        <Text style={s.statValue}>{age}</Text>
        <Text style={s.statLabel}>{t("Account age")}</Text>
      </View>
      <Ionicons name={dirIcon('chevron-forward', 'chevron-back')} size={16} color={palette.dim} />
    </Pressable>
  );
}

export function KarmaReceived({ client }: { client: MobileClient }) {
  const [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState<{ score: number; note?: string; from: string; ts: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Keep the latest karma event per (rater, d-tag). Backfill once, then keep
    // a live subscription open so a rating that lands while this screen is open
    // shows up without a reload (previously it only fetched once on mount).
    const latest = new Map<string, any>();
    const recompute = () => {
      if (cancelled) return;
      const parsed = [...latest.values()]
        .flatMap((ev) => {
          try {
            const c = JSON.parse(ev.content);
            if (typeof c.score !== 'number') return [];
            return [{ score: c.score as number, note: c.note as string | undefined, from: ev.pubkey as string, ts: ev.created_at as number }];
          } catch { return []; }
        })
        .sort((a, b) => b.ts - a.ts);
      setRatings(parsed);
    };
    const ingest = (ev: any) => {
      const d = ev.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
      const k = `${ev.pubkey}|${d}`;
      const prev = latest.get(k);
      if (prev && prev.created_at >= ev.created_at) return false;
      latest.set(k, ev);
      return true;
    };
    query(client.pool, client.relays, { kinds: [KIND_KARMA], '#p': [client.pubkey], limit: 200 })
      .then((events) => { if (cancelled) return; events.forEach(ingest); recompute(); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const sub = client.pool.subscribeMany(
      client.relays,
      { kinds: [KIND_KARMA], '#p': [client.pubkey], since: Math.floor(Date.now() / 1000) },
      { onevent: (ev: any) => { if (ingest(ev)) recompute(); } },
    );
    return () => { cancelled = true; sub.close(); };
  }, [client]);

  const count = ratings.length;
  const avg = count ? ratings.reduce((sum, r) => sum + r.score, 0) / count : 0;
  const emoji = (sc: number) => (sc >= 2 ? '⭐' : sc >= 1 ? '👍' : sc >= 0 ? '😐' : '👎');

  return (
    <View style={[s.card, { marginTop: 4 }]}>
      <Text style={[s.sectionTitle, { marginTop: 0 }]}>{t("Feedback received")}</Text>
      {loading ? (
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 6 }} />
      ) : count === 0 ? (
        <Text style={s.dim}>{t("No ratings yet. Complete deals to build karma.")}</Text>
      ) : (
        <>
          <Text style={[s.repLine, { marginStart: 0 }]}>
            {karmaLabel(avg, count)} · {t('{count} ratings', { count })} · avg {avg.toFixed(1)}
          </Text>
          {ratings.map((r, i) => (
            <View key={i} style={[s.row, { marginTop: 6, alignItems: 'flex-start' }]}>
              <Text style={{ fontSize: 14, marginEnd: 6 }}>{emoji(r.score)}</Text>
              <Text style={s.rowValue}>
                {r.note || t('(no note)')} <Text style={s.meta}>· {r.from.slice(0, 8)}…</Text>
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

export function KarmaRater({
  onSubmit,
  onCancel,
  glow = false,
}: {
  onSubmit: (score: KarmaScore, note: string | undefined, contactVerified: boolean) => Promise<void>;
  onCancel: () => void;
  /** Pulse a colored glow on the panel to draw attention after a celebration. */
  glow?: boolean;
}) {
  const [score, setScore] = useState<KarmaScore | null>(null);
  const [note, setNote] = useState('');
  const [contactVerified, setContactVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Attention glow: loop the panel's shadow/border opacity while `glow` is true.
  const glowAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!glow) { glowAnim.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow, glowAnim]);
  const glowStyle = glow
    ? {
        borderColor: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [palette.accentBorder, palette.warn] }),
        shadowColor: palette.warn,
        shadowOpacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.9] }) as unknown as number,
        shadowRadius: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [2, 12] }) as unknown as number,
        shadowOffset: { width: 0, height: 0 },
        elevation: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 10] }) as unknown as number,
      }
    : null;

  const SCORES: { value: KarmaScore; label: string; icon: IoniconName; color: string }[] = [
    { value: -1, label: t('Bad'), icon: 'thumbs-down-outline', color: palette.danger },
    { value: 0, label: t('Neutral'), icon: 'remove-outline', color: palette.muted },
    { value: 1, label: t('Good'), icon: 'thumbs-up-outline', color: palette.success },
    { value: 2, label: t('Excellent'), icon: 'star-outline', color: palette.warn },
  ];

  const submit = async () => {
    if (score === null) { uiAlert(t('Select a score')); return; }
    setSubmitting(true);
    try {
      await onSubmit(score, note || undefined, contactVerified);
    } catch (e) {
      uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined);
    } finally { setSubmitting(false); }
  };

  return (
    <Animated.View style={[s.counterBox, glowStyle]}>
      <Text style={s.sectionTitle}>{t("Rate this deal")}</Text>
      <View style={s.karmaBtns}>
        {SCORES.map((opt) => (
          <Pressable
            key={opt.value}
            style={[s.karmaBtn, { flexDirection: 'row', gap: 6 }, score === opt.value && s.karmaBtnActive]}
            onPress={() => setScore(opt.value)}
          >
            <Ionicons name={opt.icon} size={15} color={score === opt.value ? 'white' : opt.color} />
            <Text style={[s.karmaBtnText, score === opt.value && s.karmaBtnTextActive]}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={s.checkRow} onPress={() => setContactVerified((v) => !v)}>
        <View style={[s.checkbox, contactVerified && s.checkboxOn]}>
          {contactVerified && <Text style={s.checkboxTick}>✓</Text>}
        </View>
        <Text style={s.checkLabel}>{'📱 ' + t('I reached them at their listed phone number')}</Text>
      </Pressable>
      <Field label={t("Note (optional)")} value={note} onChange={setNote} placeholder={t("Leave a comment…")} multiline />
      <View style={s.btnRow}>
        <Pressable style={[s.btnAccept, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t("Submit")}</Text>}
        </Pressable>
        <Pressable style={s.btnDecline} onPress={onCancel}><Text style={s.btnText}>{t("Skip")}</Text></Pressable>
      </View>
    </Animated.View>
  );
}
