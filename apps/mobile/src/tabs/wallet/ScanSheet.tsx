import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { s, palette } from '../../ui/theme';

/**
 * QR scanner for the Send flow.
 *  - Web: getUserMedia + BarcodeDetector where available, jsQR (pure JS)
 *    elsewhere — no native deps, works in every modern browser.
 *  - Native: expo-camera via guarded dynamic import; binaries without the
 *    module simply don't show the Scan button (see scanSupported()).
 */
export async function scanSupported(): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      return !!(navigator as any)?.mediaDevices?.getUserMedia && (window as any).isSecureContext === true;
    } catch { return false; }
  }
  try {
    const cam: any = await import('expo-camera');
    return !!cam?.CameraView;
  } catch { return false; }
}

function WebScanner({ onCode }: { onCode: (v: string) => void }) {
  const videoRef = useRef<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const start = async () => {
      try {
        stream = await (navigator as any).mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch {
        setErr(t('Camera access was denied'));
        return;
      }
      const video = videoRef.current;
      if (!video || stopped) { stream?.getTracks().forEach((t2) => t2.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      const Detector = (window as any).BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let jsqr: any = null;
      if (!detector) jsqr = (await import('jsqr')).default;
      const tick = async () => {
        if (stopped) return;
        if (video.readyState >= 2) {
          try {
            if (detector) {
              const codes = await detector.detect(video);
              if (codes?.[0]?.rawValue) { onCode(codes[0].rawValue); return; }
            } else if (ctx && jsqr) {
              canvas.width = video.videoWidth; canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsqr(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (code?.data) { onCode(code.data); return; }
            }
          } catch { /* keep scanning */ }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t2) => t2.stop());
    };
  }, [onCode]);

  if (err) return <Text style={[s.dim, { color: palette.danger, textAlign: 'center', padding: 24 }]}>{err}</Text>;
  return React.createElement('video', {
    ref: videoRef,
    muted: true,
    playsInline: true,
    style: { width: '100%', height: 320, objectFit: 'cover', borderRadius: 14, background: 'black' },
  });
}

function NativeScanner({ onCode }: { onCode: (v: string) => void }) {
  const [Camera, setCamera] = useState<any>(null);
  const [err, setErr] = useState('');
  const fired = useRef(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const cam: any = await import('expo-camera');
        const perm = await cam.Camera.requestCameraPermissionsAsync();
        if (dead) return;
        if (!perm?.granted) { setErr(t('Camera access was denied')); return; }
        setCamera(() => cam.CameraView);
      } catch {
        if (!dead) setErr(t('Not available for this wallet')); // module not in this binary
      }
    })();
    return () => { dead = true; };
  }, []);

  if (err) return <Text style={[s.dim, { color: palette.danger, textAlign: 'center', padding: 24 }]}>{err}</Text>;
  if (!Camera) return <View style={{ height: 320 }} />;
  return (
    <Camera
      style={{ width: '100%', height: 320, borderRadius: 14, overflow: 'hidden' }}
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={({ data }: { data: string }) => {
        if (!fired.current && data) { fired.current = true; onCode(data); }
      }}
    />
  );
}

export function ScanSheet({
  visible,
  onClose,
  onCode,
}: {
  visible: boolean;
  onClose: () => void;
  onCode: (value: string) => void;
}) {
  const [pickErr, setPickErr] = useState('');

  // Decode a QR from a picked photo. Web: canvas + BarcodeDetector/jsQR.
  // Native: expo-image-picker (in the binary) + expo-camera's scanFromURLAsync
  // (next binary; the button still works for camera-less decode paths on web).
  const pickImage = async () => {
    setPickErr('');
    try {
      if (Platform.OS === 'web') {
        const file = await new Promise<File | null>((resolve) => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/*';
          inp.onchange = () => resolve(inp.files?.[0] ?? null);
          inp.click();
        });
        if (!file) return;
        const bmp = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width; canvas.height = bmp.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const Detector = (window as any).BarcodeDetector;
        if (Detector) {
          const codes = await new Detector({ formats: ['qr_code'] }).detect(canvas);
          if (codes?.[0]?.rawValue) { onCode(codes[0].rawValue); return; }
        } else {
          const jsqr = (await import('jsqr')).default;
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsqr(img.data, img.width, img.height);
          if (code?.data) { onCode(code.data); return; }
        }
        setPickErr(t('No QR code found in that photo'));
        return;
      }
      const picker: any = await import('expo-image-picker');
      const res = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      const uri = res?.assets?.[0]?.uri;
      if (!uri) return;
      const cam: any = await import('expo-camera');
      const codes = await cam.Camera.scanFromURLAsync(uri, ['qr']);
      if (codes?.[0]?.data) { onCode(codes[0].data); return; }
      setPickErr(t('No QR code found in that photo'));
    } catch {
      setPickErr(t('No QR code found in that photo'));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ backgroundColor: palette.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 26, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: palette.border, marginTop: 8 }} />
        <View style={[s.row, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }]}>
          <Ionicons name="qr-code-outline" size={16} color={palette.accent} style={{ marginEnd: 8 }} />
          <Text style={{ color: palette.text, fontSize: 18, fontWeight: '800', flex: 1 }}>{t('Scan')}</Text>
          <Pressable hitSlop={10} onPress={onClose}><Ionicons name="close" size={20} color={palette.dim} /></Pressable>
        </View>
        <View style={{ paddingHorizontal: 16 }}>
          {visible && (Platform.OS === 'web' ? <WebScanner onCode={onCode} /> : <NativeScanner onCode={onCode} />)}
          <Text style={[s.dim, { textAlign: 'center', marginTop: 10 }]}>{t('Point the camera at a payment QR code')}</Text>
          <Pressable onPress={pickImage} style={[s.btnGhost, { marginTop: 10 }]}>
            <View style={[s.row, { gap: 6, justifyContent: 'center' }]}>
              <Ionicons name="image-outline" size={14} color={palette.text2} />
              <Text style={s.btnGhostText}>{t('Choose from photos')}</Text>
            </View>
          </Pressable>
          {!!pickErr && <Text style={[s.dim, { color: palette.danger, textAlign: 'center', marginTop: 6 }]}>{pickErr}</Text>}
        </View>
      </View>
    </Modal>
  );
}
