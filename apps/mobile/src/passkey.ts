/**
 * Passkey identity — the account key derived from a WebAuthn PRF secret.
 *
 * create/sign-in both end at the same place: evaluate the PRF extension with
 * a fixed app salt → 32 bytes that only this passkey can produce → hash into
 * the Nostr secret key. Because passkeys sync (iCloud Keychain / Google
 * Password Manager), "Sign in with passkey" on a new device re-derives the
 * exact same account — no backup file needed. The nsec backup flow stays as
 * the escape hatch (a lost passkey ≠ a lost account only if exported).
 *
 * Surfaces:
 *  - Web: native WebAuthn. Requires a secure context (not file://).
 *  - Native: react-native-passkeys (in package.json for the NEXT binary;
 *    guarded dynamic import so today's binaries just report unsupported).
 *    Requires the domain association files served from freeport.network
 *    (/.well-known/apple-app-site-association + assetlinks.json).
 */
import { Platform } from 'react-native';
import { sha256 } from '@noble/hashes/sha2.js';
import { getPublicKey } from 'nostr-tools/pure';

const RP_NAME = 'Freeport';
const RP_ID_NATIVE = 'freeport.network';
const PRF_SALT = sha256(new TextEncoder().encode('freeport-passkey-prf-v1'));
const SK_TAG = new TextEncoder().encode('freeport-passkey-sk-v1');

function rpId(): string {
  if (Platform.OS !== 'web') return RP_ID_NATIVE;
  return globalThis.location?.hostname || RP_ID_NATIVE;
}

/** PRF output → valid secp256k1 secret key (domain-separated; retry on the
 *  astronomically-unlikely invalid draw). Exported for tests. */
export function deriveSk(prf: Uint8Array): Uint8Array {
  for (let i = 0; i < 8; i++) {
    const input = new Uint8Array(SK_TAG.length + prf.length + 1);
    input.set(SK_TAG, 0); input.set(prf, SK_TAG.length); input[input.length - 1] = i;
    const sk = sha256(input);
    try { getPublicKey(sk); return sk; } catch { /* next counter */ }
  }
  throw new Error('passkey-derive-failed');
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function nativeModule(): Promise<any | null> {
  try {
    // Probe the native registry BEFORE importing: react-native-passkeys calls
    // requireNativeModule at module top-level, so on binaries that don't link
    // it (≤1.4.x) the import blows up inside Metro's module loader and
    // surfaces as a global error despite this try/catch (GlitchTip issue 19).
    // requireOptionalNativeModule returns null instead of throwing. (Imported
    // lazily — expo-modules-core can't load in the node test environment.)
    const core: any = await import('expo-modules-core').catch(() => null);
    if (!core?.requireOptionalNativeModule?.('ReactNativePasskeys')) return null;
    const mod: any = await import('react-native-passkeys');
    return (await mod.isSupported?.()) ? mod : null;
  } catch { return null; }
}

export async function passkeySupported(): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      return typeof window !== 'undefined'
        && !!(window as any).PublicKeyCredential
        && (window as any).isSecureContext === true
        && globalThis.location?.protocol !== 'file:';
    } catch { return false; }
  }
  return (await nativeModule()) != null;
}

/** Evaluate the PRF via an assertion — the shared tail of create & sign-in. */
async function prfFromAssertion(): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const cred: any = await (navigator as any).credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: rpId(),
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    });
    const first = cred?.getClientExtensionResults?.()?.prf?.results?.first;
    if (!first) throw new Error('passkey-no-prf');
    return new Uint8Array(first);
  }
  const mod = await nativeModule();
  if (!mod) throw new Error('passkey-unsupported');
  const res: any = await mod.get({
    challenge: b64url(crypto.getRandomValues(new Uint8Array(32))),
    rpId: rpId(),
    userVerification: 'required',
    extensions: { prf: { eval: { first: b64url(PRF_SALT) } } },
  });
  const first = res?.clientExtensionResults?.prf?.results?.first;
  if (!first) throw new Error('passkey-no-prf');
  return typeof first === 'string' ? fromB64url(first) : new Uint8Array(first);
}

/**
 * Device-local hint that a passkey for Freeport was created or used in this
 * browser. Survives sign-out on purpose: it lets the Welcome screen fall back
 * to a normal passkey prompt on browsers without "immediate" mediation,
 * without nagging users who never made a passkey.
 */
const HAS_PASSKEY_KEY = 'freeport.hasPasskey';
function markHasPasskey(): void {
  try { if (Platform.OS === 'web') localStorage.setItem(HAS_PASSKEY_KEY, '1'); } catch { /* ignore */ }
}
export function hasLocalPasskeyHint(): boolean {
  try { return Platform.OS === 'web' && localStorage.getItem(HAS_PASSKEY_KEY) === '1'; } catch { return false; }
}

/** Register a new passkey, then derive the account key from its PRF. */
export async function createPasskeyIdentity(accountLabel: string): Promise<Uint8Array> {
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const common = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: RP_NAME, id: rpId() },
    user: { id: userId, name: accountLabel || 'Freeport', displayName: accountLabel || 'Freeport' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    extensions: { prf: { eval: { first: PRF_SALT } } },
  } as any;
  if (Platform.OS === 'web') {
    const cred: any = await (navigator as any).credentials.create({ publicKey: common });
    const ext = cred?.getClientExtensionResults?.()?.prf;
    if (ext?.enabled === false) throw new Error('passkey-no-prf');
    markHasPasskey();
    if (ext?.results?.first) return deriveSk(new Uint8Array(ext.results.first));
    // PRF exists but only evaluates on get() on this platform — assert once.
    return deriveSk(await prfFromAssertion());
  }
  const mod = await nativeModule();
  if (!mod) throw new Error('passkey-unsupported');
  await mod.create({
    ...common,
    challenge: b64url(common.challenge),
    user: { ...common.user, id: b64url(userId) },
    extensions: { prf: { eval: { first: b64url(PRF_SALT) } } },
  });
  return deriveSk(await prfFromAssertion());
}

/** Sign in with an existing (possibly synced) passkey. */
export async function signInWithPasskey(): Promise<Uint8Array> {
  const sk = deriveSk(await prfFromAssertion());
  markHasPasskey();
  return sk;
}

/**
 * Welcome-screen auto sign-in: WebAuthn "immediate" mediation shows the
 * account picker right away when this browser has a matching passkey and
 * rejects silently when it doesn't — so new users never see a prompt.
 * Returns null whenever there's nothing to sign in with (unsupported
 * browser, no credential, user dismissed, authenticator without PRF).
 */
export async function attemptImmediatePasskeySignIn(): Promise<Uint8Array | null> {
  if (Platform.OS !== 'web' || !(await passkeySupported())) return null;
  try {
    const cred: any = await (navigator as any).credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: rpId(),
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
      mediation: 'immediate',
    });
    const first = cred?.getClientExtensionResults?.()?.prf?.results?.first;
    if (first) { markHasPasskey(); return deriveSk(new Uint8Array(first)); }
    return null;
  } catch (e) {
    // NotAllowedError (no credential / user dismissed), SecurityError… —
    // "no auto sign-in", never fatal. One exception: a TypeError means this
    // browser doesn't know "immediate" mediation at all (it's very new). If
    // this device used a Freeport passkey before, fall back to the regular
    // modal prompt — that's still the sign-in the user expects on arrival.
    if (e instanceof TypeError && hasLocalPasskeyHint()) {
      try {
        const sk = await signInWithPasskey();
        markHasPasskey();
        return sk;
      } catch { return null; }
    }
    return null;
  }
}
