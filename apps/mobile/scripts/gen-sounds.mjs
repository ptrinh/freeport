// Generates two tiny UI sounds as 8kHz mono 16-bit PCM WAVs:
//   assets/click.wav  — a short detent "tick" for the amount wheel
//   assets/notify.wav — a two-tone "di-ding" for new request / new message
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
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);          // PCM
  header.writeUInt16LE(1, 22);          // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);   // byte rate
  header.writeUInt16LE(2, 32);          // block align
  header.writeUInt16LE(16, 34);         // bits
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function tone(freq, ms, { decay = 1, vol = 0.6, startAt = 0, into = null } = {}) {
  const n = Math.floor((ms / 1000) * RATE);
  const buf = into ?? new Float32Array(startAt + n);
  for (let i = 0; i < n; i++) {
    const env = Math.pow(1 - i / n, decay);
    buf[startAt + i] += Math.sin((2 * Math.PI * freq * i) / RATE) * vol * env;
  }
  return buf;
}

// Click: very short, snappy, high-pitched detent.
// Soft, low-pitched, very short detent tick (like the iOS photo-zoom wheel) —
// gentler than a high 1800Hz beep even at low volume.
const click = tone(1050, 14, { decay: 3.5, vol: 0.28 });

// Notify: pleasant rising two-tone (A5 → E6), each tone decays.
const total = Math.floor(0.42 * RATE);
const notify = new Float32Array(total);
tone(880, 150, { decay: 1.6, vol: 0.55, startAt: 0, into: notify });
tone(1318, 260, { decay: 1.8, vol: 0.55, startAt: Math.floor(0.13 * RATE), into: notify });

fs.writeFileSync(path.join(outDir, 'click.wav'), wav(click));
fs.writeFileSync(path.join(outDir, 'notify.wav'), wav(notify));
console.log('wrote click.wav', click.length, 'samples; notify.wav', notify.length, 'samples');
