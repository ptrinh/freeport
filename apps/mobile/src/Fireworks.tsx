/**
 * Full-screen fireworks celebration overlay.
 *
 * Renders several burst origins, each spawning a ring of small colored dots that
 * fly outward, fade, and shrink over ~1.6–2s (staggered). Absolutely positioned,
 * pointerEvents="none", high zIndex — it never intercepts touches and the app UI
 * stays interactive underneath. Plays the celebration sound+haptic once on mount,
 * then calls onDone after ~2s so the parent can unmount it.
 *
 * Performance: particle count is capped (~72) and every animated value drives only
 * opacity/transform with useNativeDriver: true.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { playCelebrate } from './haptics';

const COLORS = ['#fbbf24', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb7185', '#fcd34d'];
const BURSTS = 5; // origins
const PER_BURST = 14; // dots per origin → ~70 particles total

type Particle = {
  origin: { x: number; y: number };
  angle: number;
  distance: number;
  size: number;
  color: string;
  delay: number;
};

export function Fireworks({ onDone }: { onDone: () => void }) {
  const { width, height } = Dimensions.get('window');
  const done = useRef(false);

  // Build the particle layout once.
  const particles = useMemo<Particle[]>(() => {
    const out: Particle[] = [];
    for (let b = 0; b < BURSTS; b++) {
      const origin = {
        x: width * (0.2 + Math.random() * 0.6),
        y: height * (0.2 + Math.random() * 0.45),
      };
      const burstDelay = Math.random() * 500;
      for (let i = 0; i < PER_BURST; i++) {
        const angle = (i / PER_BURST) * Math.PI * 2 + Math.random() * 0.3;
        out.push({
          origin,
          angle,
          distance: 90 + Math.random() * 120,
          size: 5 + Math.random() * 5,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          delay: burstDelay,
        });
      }
    }
    return out;
  }, [width, height]);

  useEffect(() => {
    playCelebrate();
    const timer = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      onDone();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View pointerEvents="none" style={styles.overlay}>
      {particles.map((p, idx) => (
        <Dot key={idx} p={p} />
      ))}
    </View>
  );
}

function Dot({ p }: { p: Particle }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 1700,
      delay: p.delay,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dx = Math.cos(p.angle) * p.distance;
  const dy = Math.sin(p.angle) * p.distance;
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, dx] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, dy] });
  const opacity = anim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [1, 1, 0] });
  const scale = anim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.4, 1, 0.3] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: p.origin.x,
        top: p.origin.y,
        width: p.size,
        height: p.size,
        borderRadius: p.size / 2,
        backgroundColor: p.color,
        opacity,
        transform: [{ translateX }, { translateY }, { scale }],
      }}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
});
