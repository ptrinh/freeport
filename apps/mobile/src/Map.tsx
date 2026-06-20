/**
 * Native map wrappers (react-native-maps). The web build swaps in Map.web.tsx
 * (react-leaflet) automatically via Metro platform resolution, so App.tsx
 * never imports react-native-maps directly (it has no web implementation).
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';

export interface LatLng { latitude: number; longitude: number }

/** Static map: marker + radius circle, non-interactive. */
export function AreaMap({
  center,
  radiusMeters = 5000,
  style,
  follow: _follow = false,
  markerColor,
}: {
  center: LatLng;
  radiusMeters?: number;
  style?: StyleProp<ViewStyle>;
  /** Web-only: pan to follow a moving center. No-op on native. */
  follow?: boolean;
  /** Live-marker color. Native tints the pin; web shows a pulsing dot. */
  markerColor?: string;
}) {
  return (
    <MapView
      style={style}
      initialRegion={{ ...center, latitudeDelta: 0.12, longitudeDelta: 0.12 }}
      scrollEnabled={false}
      zoomEnabled={false}
      pitchEnabled={false}
      rotateEnabled={false}
    >
      <Marker coordinate={center} pinColor={markerColor} />
      <Circle center={center} radius={radiusMeters} strokeColor="rgba(59, 130, 246, 0.8)" fillColor="rgba(59, 130, 246, 0.15)" />
    </MapView>
  );
}

/** Interactive map for picking a point. Reports the map center as it moves. */
export function PickerMap({
  initial,
  onCenterChange,
  style,
}: {
  initial: LatLng;
  onCenterChange: (c: LatLng) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <MapView
      style={style}
      initialRegion={{ ...initial, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
      onRegionChangeComplete={(r) => onCenterChange({ latitude: r.latitude, longitude: r.longitude })}
      showsUserLocation
    />
  );
}
