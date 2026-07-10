import React from 'react';
import { Image } from 'react-native';
import { palette, DARK } from './theme';

/**
 * Custom Erlenmeyer-flask icon (Experimental section) — drawn to match the
 * brand mark the owner picked (bubbles + liquid-level ticks) instead of the
 * generic Ionicons flask. Source of truth: assets/flask.svg; the PNGs are
 * pre-tinted per theme because react-native-svg isn't in the binary (native
 * module — can't arrive via OTA) and RN-web has no reliable Image tintColor.
 */
export function FlaskIcon({ size = 20, style }: { size?: number; style?: object }) {
  const src = palette === DARK
    ? require('../../assets/flask-dark.png')
    : require('../../assets/flask-light.png');
  return <Image source={src} style={[{ width: size, height: size }, style]} resizeMode="contain" />;
}
