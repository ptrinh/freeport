import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
import { passkeySupported, signInWithPasskey, createPasskeyIdentity, deriveSk, attemptImmediatePasskeySignIn } from '../src/passkey';

// Frozen vectors: the PRF salt and derivation are consensus-critical — every
// existing passkey account depends on them. If either changes, sign-in on a
// new device silently derives a DIFFERENT account. These hex values pin them.
const SALT_HEX = '5e58356ba4a31b6f6179d4dffc5542cb7378ff305d82afc6971b058788298316';
const SK_FOR_PRF7 = 'd792d05a9889df04129b1ab25509b4fa89a965243c0160b3d8a837f70d82da60';
const PRF7 = new Uint8Array(32).fill(7);
const hex = (b: Uint8Array | ArrayBuffer) => Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b).toString('hex');

const webEnv = (over: Partial<{ secure: boolean; protocol: string; hostname: string; pkc: boolean }> = {}) => {
  const { secure = true, protocol = 'https:', hostname = 'freeport.network', pkc = true } = over;
  (globalThis as any).window = {
    PublicKeyCredential: pkc ? function PublicKeyCredential() {} : undefined,
    isSecureContext: secure,
  };
  (globalThis as any).location = { protocol, hostname };
};

const mockCredentials = (impl: { get?: any; create?: any }) => {
  // Node's globalThis.navigator is getter-only — replace it via defineProperty.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { credentials: { get: impl.get, create: impl.create } },
  });
};

/** A WebAuthn credential whose PRF extension evaluated to `prf`. */
const credWithPrf = (prf: Uint8Array | null, extra: Record<string, unknown> = {}) => ({
  getClientExtensionResults: () => ({ prf: { ...(prf ? { results: { first: prf.buffer.slice(0) } } : {}), ...extra } }),
});

beforeEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).location;
});

describe('passkeySupported (web)', () => {
  it('true only in a secure non-file context with WebAuthn', async () => {
    webEnv();
    expect(await passkeySupported()).toBe(true);
  });

  it('false without PublicKeyCredential', async () => {
    webEnv({ pkc: false });
    expect(await passkeySupported()).toBe(false);
  });

  it('false in an insecure context', async () => {
    webEnv({ secure: false });
    expect(await passkeySupported()).toBe(false);
  });

  it('false in the offline single-file build (file://)', async () => {
    webEnv({ protocol: 'file:' });
    expect(await passkeySupported()).toBe(false);
  });
});

describe('signInWithPasskey', () => {
  it('derives the frozen key from the PRF output', async () => {
    webEnv();
    const get = vi.fn(async () => credWithPrf(PRF7));
    mockCredentials({ get });
    const sk = await signInWithPasskey();
    expect(hex(sk)).toBe(SK_FOR_PRF7);
  });

  it('asserts with the frozen app salt and the page rpId', async () => {
    webEnv({ hostname: 'freeport.network' });
    const get = vi.fn(async () => credWithPrf(PRF7));
    mockCredentials({ get });
    await signInWithPasskey();
    const arg = (get.mock.calls[0] as any[])[0].publicKey;
    expect(arg.rpId).toBe('freeport.network');
    expect(hex(arg.extensions.prf.eval.first)).toBe(SALT_HEX);
    expect(arg.challenge).toHaveLength(32); // fresh random challenge
  });

  it('rejects with passkey-no-prf when the authenticator lacks PRF', async () => {
    webEnv();
    mockCredentials({ get: async () => credWithPrf(null) });
    await expect(signInWithPasskey()).rejects.toThrow('passkey-no-prf');
  });

  it('propagates user cancellation (NotAllowedError)', async () => {
    webEnv();
    mockCredentials({ get: async () => { throw new Error('NotAllowedError: user aborted'); } });
    await expect(signInWithPasskey()).rejects.toThrow(/NotAllowed/);
  });
});

describe('createPasskeyIdentity', () => {
  it('uses the PRF evaluated at create() when the platform returns it', async () => {
    webEnv();
    const create = vi.fn(async () => credWithPrf(PRF7));
    const get = vi.fn();
    mockCredentials({ create, get });
    const sk = await createPasskeyIdentity('Freeport account');
    expect(hex(sk)).toBe(SK_FOR_PRF7);
    expect(get).not.toHaveBeenCalled();
    const req = (create.mock.calls[0] as any[])[0].publicKey;
    expect(req.rp).toEqual({ name: 'Freeport', id: 'freeport.network' });
    expect(req.authenticatorSelection.residentKey).toBe('required'); // discoverable → sign-in works with no username
  });

  it('falls back to an assertion when create() only reports prf.enabled', async () => {
    webEnv();
    const create = vi.fn(async () => credWithPrf(null, { enabled: true }));
    const get = vi.fn(async () => credWithPrf(PRF7));
    mockCredentials({ create, get });
    const sk = await createPasskeyIdentity('x');
    expect(hex(sk)).toBe(SK_FOR_PRF7);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('rejects when the authenticator reports PRF unsupported', async () => {
    webEnv();
    mockCredentials({ create: async () => credWithPrf(null, { enabled: false }), get: vi.fn() });
    await expect(createPasskeyIdentity('x')).rejects.toThrow('passkey-no-prf');
  });

  it('create → sign-in round-trip lands on the SAME account', async () => {
    webEnv();
    mockCredentials({ create: async () => credWithPrf(PRF7), get: async () => credWithPrf(PRF7) });
    const created = await createPasskeyIdentity('x');
    const signedIn = await signInWithPasskey();
    expect(hex(signedIn)).toBe(hex(created));
  });
});

describe('deriveSk frozen vector', () => {
  it('never changes for existing accounts', () => {
    expect(hex(deriveSk(PRF7))).toBe(SK_FOR_PRF7);
  });
});


describe('attemptImmediatePasskeySignIn (Welcome auto-prompt)', () => {
  it('signs in when the browser holds a passkey (mediation: immediate)', async () => {
    webEnv();
    const get = vi.fn(async (req: any) => {
      expect(req.mediation).toBe('immediate');
      return credWithPrf(PRF7);
    });
    mockCredentials({ get });
    const sk = await attemptImmediatePasskeySignIn();
    expect(sk && hex(sk)).toBe(SK_FOR_PRF7);
  });

  it('null when no credential exists (NotAllowedError) — new users see nothing', async () => {
    webEnv();
    mockCredentials({ get: async () => { throw new DOMException('no creds', 'NotAllowedError'); } });
    expect(await attemptImmediatePasskeySignIn()).toBeNull();
  });

  it('null on browsers without immediate mediation (TypeError)', async () => {
    webEnv();
    mockCredentials({ get: async () => { throw new TypeError('mediation'); } });
    expect(await attemptImmediatePasskeySignIn()).toBeNull();
  });

  it('null outside a supported context (file://)', async () => {
    webEnv({ protocol: 'file:' });
    expect(await attemptImmediatePasskeySignIn()).toBeNull();
  });
});

describe('fallback when "immediate" mediation is unsupported (older browsers)', () => {
  const mockStorage = (init: Record<string, string> = {}) => {
    const store: Record<string, string> = { ...init };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
      },
    });
    return store;
  };

  it('device that used a passkey before → regular modal prompt instead', async () => {
    webEnv();
    mockStorage({ 'freeport.hasPasskey': '1' });
    const get = vi.fn(async (req: any) => {
      if (req.mediation === 'immediate') throw new TypeError('mediation');
      return credWithPrf(PRF7); // the plain modal assertion
    });
    mockCredentials({ get });
    const sk = await attemptImmediatePasskeySignIn();
    expect(sk && hex(sk)).toBe(SK_FOR_PRF7);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('device with NO passkey history → stays silent (no nagging modal)', async () => {
    webEnv();
    mockStorage();
    const get = vi.fn(async () => { throw new TypeError('mediation'); });
    mockCredentials({ get });
    expect(await attemptImmediatePasskeySignIn()).toBeNull();
    expect(get).toHaveBeenCalledTimes(1); // never opened the modal
  });

  it('signInWithPasskey records the device hint for future visits', async () => {
    webEnv();
    const store = mockStorage();
    mockCredentials({ get: async () => credWithPrf(PRF7) });
    await signInWithPasskey();
    expect(store['freeport.hasPasskey']).toBe('1');
  });

  it('createPasskeyIdentity records the device hint too', async () => {
    webEnv();
    const store = mockStorage();
    mockCredentials({ create: async () => credWithPrf(PRF7), get: async () => credWithPrf(PRF7) });
    await createPasskeyIdentity('Test');
    expect(store['freeport.hasPasskey']).toBe('1');
  });

  it('user dismissing the fallback modal is not fatal', async () => {
    webEnv();
    mockStorage({ 'freeport.hasPasskey': '1' });
    const get = vi.fn(async (req: any) => {
      if (req.mediation === 'immediate') throw new TypeError('mediation');
      throw new DOMException('dismissed', 'NotAllowedError');
    });
    mockCredentials({ get });
    expect(await attemptImmediatePasskeySignIn()).toBeNull();
  });
});
