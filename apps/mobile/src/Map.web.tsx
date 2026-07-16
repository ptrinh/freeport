/**
 * Web map wrappers (react-leaflet + OpenStreetMap tiles). API mirrors Map.tsx
 * so App.tsx is platform-agnostic. Uses circle markers to avoid bundling
 * Leaflet's default marker image assets.
 */
import React from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Circle, CircleMarker, Marker, useMapEvents, useMap } from 'react-leaflet';

export interface LatLng { latitude: number; longitude: number }

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIB = '&copy; OpenStreetMap';

// A pulsing "live location" dot (expanding ring + solid core), colored via the
// CSS var --ft-c. Injected once; used by AreaMap's follow/live marker.
if (typeof document !== 'undefined' && !document.getElementById('ft-pulse-css')) {
  const st = document.createElement('style');
  st.id = 'ft-pulse-css';
  st.textContent = `
.ft-pulse{position:relative;display:block;width:20px;height:20px}
.ft-pulse .ft-core{position:absolute;left:4px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--ft-c);box-shadow:0 0 0 2.5px #fff,0 1px 4px rgba(0,0,0,.5);transition:background .4s ease}
.ft-pulse .ft-ring{position:absolute;left:1px;top:1px;width:18px;height:18px;border-radius:50%;background:var(--ft-c);opacity:.55;animation:ft-pulse 1.6s ease-out infinite;transition:background .4s ease}
.ft-pulse.ft-stale .ft-ring{animation-duration:2.6s}
@keyframes ft-pulse{0%{transform:scale(.5);opacity:.55}80%{transform:scale(2.5);opacity:0}100%{transform:scale(2.5);opacity:0}}`;
  document.head.appendChild(st);
}

function pulseIcon(color: string, stale: boolean) {
  return L.divIcon({
    className: '',
    html: `<span class="ft-pulse${stale ? ' ft-stale' : ''}" style="--ft-c:${color}"><span class="ft-ring"></span><span class="ft-core"></span></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

/** Pans the map to follow a moving center (used by the live-trip viewer). */
function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  React.useEffect(() => { map.setView(center); }, [center[0], center[1]]);
  return null;
}

export function AreaMap({
  center,
  radiusMeters = 5000,
  style,
  follow = false,
  markerColor,
}: {
  center: LatLng;
  radiusMeters?: number;
  style?: object;
  /** Pan to keep `center` in view as it changes (live tracking). */
  follow?: boolean;
  /** When set (live mode), render a pulsing dot in this color instead of a static dot. */
  markerColor?: string;
}) {
  const c: [number, number] = [center.latitude, center.longitude];
  // Stale ⇒ slower, calmer pulse (amber/red); fresh ⇒ brisk green pulse.
  const icon = React.useMemo(
    () => (markerColor ? pulseIcon(markerColor, markerColor !== '#22c55e') : null),
    [markerColor],
  );
  return (
    <MapContainer
      center={c}
      zoom={follow ? 15 : 13}
      style={{ height: 160, borderRadius: 10, ...(style as object) }}
      dragging={follow}
      zoomControl={follow}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      attributionControl={false}
    >
      <TileLayer url={TILE_URL} attribution={ATTRIB} />
      {follow && <Recenter center={c} />}
      {icon
        ? <Marker position={c} icon={icon} />
        : <CircleMarker center={c} radius={6} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }} />}
      {!follow && <Circle center={c} radius={radiusMeters} pathOptions={{ color: 'rgba(59,130,246,0.8)', fillColor: 'rgba(59,130,246,0.15)', fillOpacity: 0.15 }} />}
    </MapContainer>
  );
}

function CenterReporter({ onCenterChange }: { onCenterChange: (c: LatLng) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const ctr = map.getCenter();
      onCenterChange({ latitude: ctr.lat, longitude: ctr.lng });
    },
  });
  return null;
}

export function PickerMap({
  initial,
  onCenterChange,
  style,
}: {
  initial: LatLng;
  onCenterChange: (c: LatLng) => void;
  style?: object;
}) {
  const c: [number, number] = [initial.latitude, initial.longitude];
  return (
    <MapContainer center={c} zoom={15} style={{ flex: 1, minHeight: 300, ...(style as object) }}>
      <TileLayer url={TILE_URL} attribution={ATTRIB} />
      <CenterReporter onCenterChange={onCenterChange} />
    </MapContainer>
  );
}
