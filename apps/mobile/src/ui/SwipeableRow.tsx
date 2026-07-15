/**
 * WhatsApp-style swipeable list row (pure PanResponder + Animated — no native
 * gesture deps, so it works on web and in the offline HTML build and ships
 * over OTA).
 *   - swipe LEFT reveals `rightActions` (e.g. Archive · More)
 *   - swipe RIGHT reveals `leftAction` (e.g. Delete)
 * Vertical drags pass through to the surrounding ScrollView; a tap while the
 * row is open closes it instead of activating the row. Parents keep a single
 * row open at a time via `onOpenRow`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type SwipeAction = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  onPress: () => void;
};

const ACTION_W = 72;
const SLOP = 12;

export function SwipeableRow({ children, leftAction, rightActions = [], onOpenRow }: {
  children: React.ReactNode;
  /** Revealed by swiping RIGHT (sits at the start edge). */
  leftAction?: SwipeAction;
  /** Revealed by swiping LEFT (sit at the end edge). */
  rightActions?: SwipeAction[];
  /** Called when this row opens; receives a closer so the parent can shut the previous open sibling. */
  onOpenRow?: (close: () => void) => void;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const cur = useRef(0);
  const base = useRef(0);
  const openRef = useRef(false);
  // While the PanResponder owns the touch (a real horizontal drag, or the
  // start-capture of an already-open row) we disable pointer events on the
  // children so the trailing tap — and, crucially on react-native-web, the
  // synthetic `click` fired after a mouse drag — can NEVER reach the inner
  // Pressable and open the chat. A plain tap on a closed row never grants the
  // responder, so it still opens as normal.
  const [dragging, setDragging] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginDrag = () => {
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    setDragging(true);
  };
  // Keep pointer events off briefly past release so web's post-drag click
  // (dispatched after mouseup) lands on nothing instead of the row.
  const endDrag = () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => { setDragging(false); clearTimer.current = null; }, 120);
  };
  useEffect(() => {
    const id = x.addListener((v) => { cur.current = v.value; });
    return () => {
      x.removeListener(id);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [x]);

  // Widths live in refs so the once-created PanResponder always sees the
  // current action set.
  const dims = useRef({ leftW: 0, rightW: 0 });
  dims.current = { leftW: leftAction ? ACTION_W : 0, rightW: rightActions.length * ACTION_W };
  const onOpenRowRef = useRef(onOpenRow);
  onOpenRowRef.current = onOpenRow;

  const snapTo = (to: number) => {
    openRef.current = to !== 0;
    Animated.spring(x, { toValue: to, useNativeDriver: false, bounciness: 0, speed: 24 }).start();
  };
  const closeRef = useRef(() => snapTo(0));

  const pan = useRef(
    PanResponder.create({
      // A tap anywhere on an OPEN row closes it instead of activating the row.
      onStartShouldSetPanResponderCapture: () => openRef.current,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > SLOP && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => { base.current = cur.current; beginDrag(); },
      onPanResponderMove: (_e, g) => {
        const { leftW, rightW } = dims.current;
        x.setValue(Math.max(-rightW, Math.min(leftW, base.current + g.dx)));
      },
      onPanResponderRelease: (_e, g) => {
        const { leftW, rightW } = dims.current;
        endDrag();
        if (Math.abs(g.dx) < SLOP) { snapTo(0); return; } // tap on an open row
        const moved = base.current + g.dx;
        if (rightW > 0 && (moved < -rightW / 2 || (g.vx < -0.3 && moved < 0))) {
          snapTo(-rightW);
          onOpenRowRef.current?.(closeRef.current);
        } else if (leftW > 0 && (moved > leftW / 2 || (g.vx > 0.3 && moved > 0))) {
          snapTo(leftW);
          onOpenRowRef.current?.(closeRef.current);
        } else snapTo(0);
      },
      onPanResponderTerminate: () => { endDrag(); snapTo(0); },
    }),
  ).current;

  const actionBtn = (a: SwipeAction) => (
    <Pressable
      key={a.label}
      onPress={() => { snapTo(0); a.onPress(); }}
      style={{ width: ACTION_W, backgroundColor: a.color, alignItems: 'center', justifyContent: 'center', gap: 2 }}
      accessibilityRole="button" accessibilityLabel={a.label}
    >
      <Ionicons name={a.icon} size={20} color="white" />
      <Text style={{ color: 'white', fontSize: 10 }} numberOfLines={1}>{a.label}</Text>
    </Pressable>
  );

  return (
    <View style={{ position: 'relative' }}>
      {/* Underlay aligned with the card's vertical margin + radius so the
          revealed buttons read as part of the row. */}
      <View style={{ position: 'absolute', top: 8, bottom: 8, start: 0, end: 0, flexDirection: 'row', justifyContent: 'space-between', borderRadius: 14, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row' }}>{leftAction ? actionBtn(leftAction) : null}</View>
        <View style={{ flexDirection: 'row' }}>{rightActions.map(actionBtn)}</View>
      </View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }] }}>
        {/* pointerEvents gate: while a drag owns the touch the row's own
            Pressable can't receive the tap/click, so a swipe never opens the
            chat; touches still fall through to the PanResponder itself, so
            re-swiping and vertical scrolling stay unaffected. */}
        <View pointerEvents={dragging ? 'none' : 'auto'}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}
