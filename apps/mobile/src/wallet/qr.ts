/**
 * QR codes without native deps: qrcode-generator (pure JS, MIT) renders the
 * matrix straight to a GIF data URI that <Image> takes on every surface —
 * no react-native-svg, no canvas, works from file://.
 */
import qrcode from 'qrcode-generator';

export function qrDataUrl(text: string, cellSize = 6): string {
  const qr = qrcode(0, 'M'); // type 0 = auto-size to content
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, 2) as string;
}
