/**
 * The web build silently REPLACES voice.ts with voice.web.ts, so any export
 * missing on either side becomes a platform-specific no-op nobody sees at
 * build time — exactly how the web play button shipped dead (stuck at 0:00:
 * toggleVoice existed only natively). This test pins the two files to the
 * same public API by parsing their export declarations.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function exportedNames(file: string): string[] {
  const src = readFileSync(join(__dirname, '..', 'src', file), 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]);
  }
  // Type-only exports matter too — App code imports `type VoicePlayback`.
  for (const m of src.matchAll(/export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]);
  }
  return [...names].sort();
}

describe('voice.ts ↔ voice.web.ts export parity', () => {
  it('both platforms expose the same public API', () => {
    expect(exportedNames('voice.web.ts')).toEqual(exportedNames('voice.ts'));
  });

  it('the playback surface the bubbles use exists on both', () => {
    for (const file of ['voice.ts', 'voice.web.ts']) {
      const names = exportedNames(file);
      for (const needed of ['toggleVoice', 'seekVoice', 'setVoiceRate', 'voiceRate', 'startRecording', 'stopRecording', 'VoicePlayback']) {
        expect(names, `${file} is missing ${needed}`).toContain(needed);
      }
    }
  });
});
