/**
 * Identity for the mobile app: keypair generated silently on first launch,
 * stored in the platform keystore (SecureStore). Backup = NIP-49 ncryptsec
 * blob the user can copy anywhere — provider-storable, provider-unreadable.
 */
import 'react-native-get-random-values';
import * as SecureStore from 'expo-secure-store';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip49 from 'nostr-tools/nip49';

const KEY = 'freeport.nsec';

export async function loadOrCreateKey(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(KEY);
  if (stored) return nip19.decode(stored).data as Uint8Array;
  const sk = generateSecretKey();
  await SecureStore.setItemAsync(KEY, nip19.nsecEncode(sk));
  return sk;
}

export function npubOf(sk: Uint8Array): string {
  return nip19.npubEncode(getPublicKey(sk));
}

export function makeBackup(sk: Uint8Array, passphrase: string): string {
  return nip49.encrypt(sk, passphrase);
}

export async function restoreBackup(ncryptsec: string, passphrase: string): Promise<Uint8Array> {
  const sk = nip49.decrypt(ncryptsec, passphrase);
  await SecureStore.setItemAsync(KEY, nip19.nsecEncode(sk));
  return sk;
}
