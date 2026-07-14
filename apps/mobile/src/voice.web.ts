/**
 * Voice memo recording & playback — web (MediaRecorder + HTMLAudio).
 * Mirrors voice.ts so App.tsx imports the same API on every platform.
 *
 * Record returns a Blob (handed to upload.uploadFile()), a filename, and the
 * mime type the browser picked. Playback uses a plain HTMLAudioElement.
 */
export interface VoiceClip {
  data: Blob;
  mime: string;
  name: string;
}

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let stream: MediaStream | null = null;
let audioEl: HTMLAudioElement | null = null;

/** Pick the first mime type the browser can record. */
function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export async function startRecording(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Recording not supported');
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  chunks = [];
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start();
}

export async function stopRecording(): Promise<VoiceClip | null> {
  const rec = recorder;
  if (!rec) return null;
  recorder = null;
  const clip = await new Promise<VoiceClip | null>((resolve) => {
    rec.onstop = () => {
      const mime = rec.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      chunks = [];
      if (blob.size === 0) { resolve(null); return; }
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      resolve({ data: blob, mime, name: `voice-memo.${ext}` });
    };
    rec.stop();
  });
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  return clip;
}

export function isRecording(): boolean {
  return recorder !== null;
}

export async function playAudio(url: string): Promise<void> {
  if (audioEl) { audioEl.pause(); audioEl = null; }
  audioEl = new Audio(url);
  await audioEl.play();
}

export interface VoicePlayback {
  playing: boolean;
  positionMillis: number;
  durationMillis: number;
  done?: boolean;
  /** Playback speed (1 or 2) — WhatsApp-style, remembered across clips. */
  rate?: number;
}

// One clip at a time (WhatsApp behavior). NOTE: this file REPLACES voice.ts
// on web — every export the bubbles import must exist here too (a missing
// toggleVoice here once made the play button a silent no-op on web).
let currentUrl: string | null = null;
let currentListener: ((st: VoicePlayback) => void) | null = null;
let playbackRate = 1;

/** Current playback speed (applies to the next clip too). */
export function voiceRate(): number {
  return playbackRate;
}

/** Set playback speed (1 or 2); applies immediately to the playing clip. */
export async function setVoiceRate(rate: number): Promise<void> {
  playbackRate = rate;
  if (audioEl) {
    audioEl.playbackRate = rate;
    emit(audioEl);
  }
}

/** Jump to a fraction (0–1) of the clip; starts playback if needed. Streams
 *  with unknown duration (Chrome webm) can't seek — silently skipped. */
export async function seekVoice(url: string, fraction: number, onStatus: (st: VoicePlayback) => void): Promise<void> {
  if (currentUrl !== url || !audioEl) await toggleVoice(url, onStatus);
  else currentListener = onStatus;
  const el = audioEl;
  if (!el) return;
  const apply = () => {
    if (Number.isFinite(el.duration) && el.duration > 0) {
      el.currentTime = Math.max(0, Math.min(1, fraction)) * el.duration;
    }
  };
  if (el.readyState >= 1) apply();
  else el.addEventListener('loadedmetadata', apply, { once: true });
  if (el.paused) await el.play().catch(() => {});
  emit(el);
}

function emit(el: HTMLAudioElement, done = false): void {
  // Chrome reports Infinity duration for streamed MediaRecorder output.
  const dur = Number.isFinite(el.duration) ? el.duration * 1000 : 0;
  currentListener?.({ playing: !el.paused && !el.ended, positionMillis: el.currentTime * 1000, durationMillis: dur, done, rate: playbackRate });
}

/** Toggle play/pause; starting a different clip stops the previous one. */
export async function toggleVoice(url: string, onStatus: (st: VoicePlayback) => void): Promise<void> {
  if (currentUrl === url && audioEl) {
    currentListener = onStatus; // rebind (bubble re-mounted)
    if (audioEl.paused) await audioEl.play();
    else audioEl.pause();
    emit(audioEl);
    return;
  }
  if (audioEl) {
    audioEl.pause();
    currentListener?.({ playing: false, positionMillis: 0, durationMillis: 0, done: true });
    audioEl = null;
  }
  const el = new Audio(url);
  el.playbackRate = playbackRate;
  audioEl = el;
  currentUrl = url;
  currentListener = onStatus;
  el.addEventListener('timeupdate', () => emit(el));
  el.addEventListener('pause', () => emit(el));
  el.addEventListener('play', () => emit(el));
  el.addEventListener('ended', () => {
    emit(el, true);
    if (audioEl === el) { audioEl = null; currentUrl = null; }
  });
  el.addEventListener('error', () => {
    currentListener?.({ playing: false, positionMillis: 0, durationMillis: 0, done: true });
    if (audioEl === el) { audioEl = null; currentUrl = null; }
  });
  await el.play();
  emit(el);
}
