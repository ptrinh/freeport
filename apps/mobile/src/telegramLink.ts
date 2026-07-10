/**
 * Link this identity's Telegram account for content-blind activity pings,
 * delivered by the same notification server as Web Push / Expo push (the
 * Telegram bridge in freeport-self-hosted). Platform-neutral: opening a
 * `https://t.me/<bot>?start=<code>` link works on native and web alike, so —
 * unlike push.ts — there's no `.web` twin.
 *
 * Flow: POST /telegram/link {pubkey} → { url } → open it → the user taps Start
 * → the bridge binds their chat to the pubkey. Unlink is done in Telegram
 * (`/stop`), so there's no unauthenticated HTTP unlink here.
 */
import { Linking } from 'react-native';

const api = (endpoint: string, path: string): string => endpoint.replace(/\/$/, '') + path;

/**
 * Request a link code and open the bot chat. Returns false if the endpoint has
 * no Telegram bridge (404) or is unreachable — callers can surface that.
 */
export async function requestTelegramLink(endpoint: string, pubkeyHex: string): Promise<boolean> {
  try {
    const res = await fetch(api(endpoint, '/telegram/link'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: pubkeyHex }),
    });
    if (!res.ok) return false; // 404 = bridge not enabled on this server
    const { url } = (await res.json()) as { url?: string };
    if (!url) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Whether this pubkey currently has a linked Telegram chat on the server. */
export async function telegramLinkStatus(endpoint: string, pubkeyHex: string): Promise<boolean> {
  try {
    const res = await fetch(api(endpoint, `/telegram/status?pubkey=${encodeURIComponent(pubkeyHex)}`));
    if (!res.ok) return false;
    return !!((await res.json()) as { linked?: boolean }).linked;
  } catch {
    return false;
  }
}
