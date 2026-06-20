// Generates assets/celebrate.wav — a short upward arpeggio "tada" for deal
// completion / onboarding finish. 8kHz mono 16-bit, ~1.4s, tiny.
import fs from 'fs';
import path from 'path';
const RATE = 8000;
const outDir = path.resolve('assets');

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE((s * 32767) | 0, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
function add(buf, freq, startMs, ms, vol, decay) {
  const start = Math.floor((startMs / 1000) * RATE);
  const n = Math.floor((ms / 1000) * RATE);
  for (let i = 0; i < n; i++) {
    const env = Math.pow(1 - i / n, decay);
    if (start + i < buf.length) buf[start + i] += Math.sin((2 * Math.PI * freq * i) / RATE) * vol * env;
  }
}
const total = Math.floor(1.4 * RATE);
const buf = new Float32Array(total);
// C5 E5 G5 quick arpeggio → C6 sustained chord (the "tada")
add(buf, 523, 0,   140, 0.45, 1.6);
add(buf, 659, 120, 140, 0.45, 1.6);
add(buf, 784, 240, 160, 0.45, 1.6);
add(buf, 1046, 380, 900, 0.40, 1.4); // C6
add(buf, 1318, 380, 900, 0.28, 1.4); // E6
add(buf, 1568, 380, 900, 0.22, 1.4); // G6
fs.writeFileSync(path.join(outDir, 'celebrate.wav'), wav(buf));
console.log('wrote celebrate.wav', total, 'samples');
