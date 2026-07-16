/**
 * Remote image with expo-image's disk cache, downscaled decode and view
 * recycling. Falls back to the core react-native <Image> on binaries that
 * don't link the ExpoImage pod (runtimes ≤1.6.0) — same optional-native-
 * module probe as passkey.ts / cloudBackup.ts.
 */
import React from 'react';
import { Image as RNImage, Platform, type ImageStyle, type StyleProp } from 'react-native';

let ExpoImage: React.ComponentType<Record<string, unknown>> | null = null;
try {
  // Probe the native registry BEFORE importing: expo-image resolves its
  // native view at module load, so on binaries without the pod the import
  // itself throws inside Metro's module loader (see passkey.ts). The web
  // implementation is pure JS and always available.
  const core = require('expo-modules-core');
  if (Platform.OS === 'web' || core?.requireOptionalNativeModule?.('ExpoImage')) {
    ExpoImage = require('expo-image').Image;
  }
} catch { ExpoImage = null; }

type Props = {
  uri: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain';
  /** Stable per-row key so recycled list cells don't flash the previous image. */
  recyclingKey?: string;
};

export function CachedImage({ uri, style, contentFit = 'cover', recyclingKey }: Props) {
  if (ExpoImage) {
    return (
      <ExpoImage
        source={{ uri }}
        style={style}
        contentFit={contentFit}
        recyclingKey={recyclingKey}
        cachePolicy="memory-disk"
      />
    );
  }
  return <RNImage source={{ uri }} style={style} resizeMode={contentFit} />;
}
