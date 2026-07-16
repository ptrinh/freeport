/**
 * A floating action button the user can DRAG anywhere on screen (position
 * persisted per button), while a plain tap still fires onPress. Tap vs drag
 * is decided by movement distance, so there's no gesture-priority fight.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, PanResponder, View } from 'react-native';
import { kvGet, kvSet } from '../kv';

const TAP_SLOP = 8;
const SIZE = 54; // matches the round FABs

export function DraggableFab({ storageKey, onPress, children, style, anchor, accessibilityLabel }: {
  /** kv key suffix — each button remembers its own spot. */
  storageKey: string;
  onPress: () => void;
  children: React.ReactNode;
  /** The button's own look (size/color); position comes from the drag. */
  style?: object;
  /** Resting spot (offset from the bottom-right corner) the drag is measured from. */
  anchor?: { end?: number; bottom?: number };
  accessibilityLabel?: string;
}) {
  const end = anchor?.end ?? 18;
  const bottom = anchor?.bottom ?? 18;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const value = useRef({ x: 0, y: 0 });
  const pressRef = useRef(onPress);
  pressRef.current = onPress;

  // Offsets are measured from the anchored corner, so clamping keeps the
  // button on screen: x can only go LEFT (negative), y only UP (negative).
  const clamp = (p: { x: number; y: number }) => {
    const { width, height } = Dimensions.get('window');
    return {
      x: Math.min(0, Math.max(-(width - SIZE - end), p.x)),
      y: Math.min(0, Math.max(-(height - SIZE - bottom - 40), p.y)),
    };
  };
  const clampRef = useRef(clamp);
  clampRef.current = clamp;

  useEffect(() => {
    const id = pan.addListener((v) => { value.current = v; });
    kvGet('freeport.fabpos.' + storageKey).then((raw) => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) pan.setValue(clampRef.current(p));
      } catch { /* stale */ }
    }).catch(() => {});
    return () => pan.removeListener(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > TAP_SLOP,
      onPanResponderGrant: () => {
        pan.setOffset({ x: value.current.x, y: value.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_e, g) => {
        pan.flattenOffset();
        if (Math.abs(g.dx) + Math.abs(g.dy) <= TAP_SLOP) {
          pressRef.current();
          return;
        }
        const snapped = clampRef.current(value.current);
        pan.setValue(snapped);
        kvSet('freeport.fabpos.' + storageKey, JSON.stringify(snapped)).catch(() => {});
      },
    }),
  ).current;

  return (
    <Animated.View
      {...responder.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{ position: 'absolute', end, bottom, transform: pan.getTranslateTransform() }}
    >
      <View style={style}>{children}</View>
    </Animated.View>
  );
}
