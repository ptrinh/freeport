/* eslint-disable @typescript-eslint/no-explicit-any -- MediaStream is a different class on native (react-native-webrtc) vs web; the overlay renders both */
/**
 * Full-screen call UI: incoming ring (Accept/Decline), outgoing ring,
 * in-call controls (mute, camera, hang up), remote video + local PiP.
 * Rendered at the App root whenever the CallManager isn't idle.
 */
import React, { useEffect, useState } from 'react';
import { Image, Modal, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { loadRTC, type RTC } from './webrtc';
import { startRinging, stopRinging } from './ring';
import { screenShareSupported, type CallState } from './manager';

/** Cross-platform stream renderer: RTCView natively, a DOM <video> on web.
 *  On web this is ALSO the audio sink — rendered (hidden) for voice calls. */
function RTCVideo({ stream, rtc, style, mirror = false, muted = false }: {
  stream: any; rtc: RTC | null; style?: any; mirror?: boolean; muted?: boolean;
}) {
  if (Platform.OS === 'web') {
    return React.createElement('video', {
      autoPlay: true,
      playsInline: true,
      muted,
      ref: (el: any) => { if (el && el.srcObject !== stream) el.srcObject = stream; },
      style: { width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined, ...(style ?? {}) },
    });
  }
  const RTCView = rtc?.RTCView;
  if (!RTCView || !stream?.toURL) return null;
  return <RTCView streamURL={stream.toURL()} style={[{ width: '100%', height: '100%' }, style]} objectFit="cover" mirror={mirror} />;
}

function RoundBtn({ icon, bg, label, onPress }: { icon: any; bg: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name={icon} size={26} color="white" />
    </Pressable>
  );
}

export function CallOverlay({ state, localStream, remoteStream, peerName, peerAvatar, onAccept, onDecline, onHangup, onToggleMute, onToggleCamera, onToggleScreenShare, onDismiss }: {
  state: CallState;
  localStream: any;
  remoteStream: any;
  peerName: string;
  peerAvatar?: string;
  onAccept: () => void;
  onDecline: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare?: () => void;
  onDismiss: () => void;
}) {
  const [rtc, setRtc] = useState<RTC | null>(null);
  useEffect(() => { loadRTC().then(setRtc).catch(() => {}); }, []);

  // Gentle ring while an incoming call waits for an answer.
  useEffect(() => {
    if (state.phase === 'incoming') startRinging();
    else stopRinging();
    return () => { stopRinging(); };
  }, [state.phase]);

  // In-call duration ticker.
  const [, tick] = useState(0);
  useEffect(() => {
    if (state.phase !== 'active') return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state.phase]);

  // Auto-dismiss the "ended" banner after a beat.
  useEffect(() => {
    if (state.phase !== 'ended') return;
    const id = setTimeout(onDismiss, 2500);
    return () => clearTimeout(id);
  }, [state.phase]);

  if (state.phase === 'idle') return null;

  const dur = state.startedAt ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0;
  const mmss = `${String(Math.floor(dur / 60)).padStart(2, '0')}:${String(dur % 60).padStart(2, '0')}`;
  const showVideo = !!state.video && !!remoteStream;
  const statusText =
    state.phase === 'incoming' ? (state.video ? t('Incoming video call') : t('Incoming call'))
    : state.phase === 'outgoing' ? t('Calling…')
    : state.phase === 'connecting' ? t('Connecting…')
    : state.phase === 'active' ? mmss
    : state.reason === 'declined' ? t('Call declined')
    : state.reason === 'missed' ? t('No answer')
    : state.reason === 'busy' ? t('Busy')
    : state.reason === 'disabled' ? t('Calls are turned off on their side')
    : state.reason === 'unsupported' ? t('Calls need a newer app version')
    : state.reason === 'media_denied' ? t('Microphone/camera permission denied')
    : t('Call ended');

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={state.phase === 'incoming' ? onDecline : onHangup}>
      <View style={{ flex: 1, backgroundColor: '#0b1220' }}>
        {/* Remote video fills the screen; the web element doubles as audio sink. */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: showVideo ? 1 : 0 }} pointerEvents="none">
          {remoteStream ? <RTCVideo stream={remoteStream} rtc={rtc} /> : null}
        </View>
        {/* Local PiP (video calls). */}
        {state.video && localStream && !state.cameraOff ? (
          <View style={{ position: 'absolute', top: 54, end: 16, width: 96, height: 144, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }} pointerEvents="none">
            <RTCVideo stream={localStream} rtc={rtc} mirror muted />
          </View>
        ) : null}

        {/* Identity + status (over the video when there is one). */}
        <View style={{ alignItems: 'center', marginTop: 90, gap: 10 }}>
          {!showVideo && (
            peerAvatar
              ? <Image source={{ uri: peerAvatar }} style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#1e293b' }} />
              : <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="person" size={44} color="#64748b" />
                </View>
          )}
          <Text style={{ color: 'white', fontSize: 24, fontWeight: '700' }} numberOfLines={1}>{peerName}</Text>
          <Text style={{ color: '#94a3b8', fontSize: 15 }}>{statusText}</Text>
        </View>

        {/* Controls */}
        <View style={{ position: 'absolute', bottom: 60, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 26 }}>
          {state.phase === 'incoming' ? (
            <>
              <RoundBtn icon="close" bg="#dc2626" label={t('Decline')} onPress={onDecline} />
              <RoundBtn icon={state.video ? 'videocam' : 'call'} bg="#16a34a" label={t('Accept')} onPress={onAccept} />
            </>
          ) : state.phase === 'ended' ? (
            <RoundBtn icon="close" bg="#334155" label={t('Close')} onPress={onDismiss} />
          ) : (
            <>
              <RoundBtn icon={state.muted ? 'mic-off' : 'mic'} bg={state.muted ? '#b45309' : '#334155'} label={state.muted ? t('Unmute') : t('Mute')} onPress={onToggleMute} />
              {state.video ? (
                <RoundBtn icon={state.cameraOff ? 'videocam-off' : 'videocam'} bg={state.cameraOff ? '#b45309' : '#334155'} label={t('Toggle camera')} onPress={onToggleCamera} />
              ) : null}
              {state.video && state.phase === 'active' && onToggleScreenShare && screenShareSupported() ? (
                <RoundBtn icon={state.sharingScreen ? 'stop-circle' : 'share-outline'} bg={state.sharingScreen ? '#b45309' : '#334155'} label={state.sharingScreen ? t('Stop sharing screen') : t('Share screen')} onPress={onToggleScreenShare} />
              ) : null}
              <RoundBtn icon="call" bg="#dc2626" label={t('Hang up')} onPress={onHangup} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
