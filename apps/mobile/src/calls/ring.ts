/**
 * Gentle incoming-call ring — a soft generated two-note chime (assets/
 * ringtone.wav, created in-repo, no third-party asset), looped at modest
 * volume while the call rings. Played via audioShim (expo-audio when the
 * binary has it, expo-av otherwise — voice memos use the same shim).
 */
import { createSound, type ShimSound } from '../audioShim';

let sound: ShimSound | null = null;
let starting = false;

export async function startRinging(): Promise<void> {
  if (sound || starting) return;
  starting = true;
  try {
    sound = await createSound(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../assets/ringtone.wav'),
      { isLooping: true, volume: 0.45 },
    );
    await sound.play();
  } catch { /* silent devices ring visually only */ }
  finally { starting = false; }
}

export async function stopRinging(): Promise<void> {
  const s = sound;
  sound = null;
  try { await s?.stop(); } catch { /* already stopped */ }
  try { await s?.unload(); } catch { /* already unloaded */ }
}
