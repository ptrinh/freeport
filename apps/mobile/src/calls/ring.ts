/**
 * Gentle incoming-call ring — a soft generated two-note chime (assets/
 * ringtone.wav, created in-repo, no third-party asset), looped at modest
 * volume while the call rings. expo-av is already in the tree (voice memos).
 */
import { Audio } from 'expo-av';

let sound: Audio.Sound | null = null;
let starting = false;

export async function startRinging(): Promise<void> {
  if (sound || starting) return;
  starting = true;
  try {
    const created = await Audio.Sound.createAsync(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../assets/ringtone.wav'),
      { isLooping: true, volume: 0.45 },
    );
    sound = created.sound;
    await sound.playAsync();
  } catch { /* silent devices ring visually only */ }
  finally { starting = false; }
}

export async function stopRinging(): Promise<void> {
  const s = sound;
  sound = null;
  try { await s?.stopAsync(); } catch { /* already stopped */ }
  try { await s?.unloadAsync(); } catch { /* already unloaded */ }
}
