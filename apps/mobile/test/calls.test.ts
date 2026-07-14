/**
 * Calls: the CallManager state machine against a fake WebRTC stack, and the
 * client-side signaling gates (active-conversation spam gate + stale-offer
 * TTL) over the FakeRelay with real signing + NIP-04.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/kv', () => {
  const store = new Map<string, string>();
  return {
    kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
    kvSet: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    kvDelete: vi.fn(async (k: string) => { store.delete(k); }),
    profileId: () => '', storagePrefix: () => '', storageKey: (k: string) => k,
  };
});
// manager.ts → webrtc.ts imports react-native (Flow-typed source node can't
// parse) — mock it like breez-native-guard.test does. The manager tests inject
// their own fake RTC via the deps seam, so loadRTC itself is never exercised.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  NativeModules: { WebRTCModule: {} },
}));
vi.mock('../src/pow', () => ({ minePowAsync: async (e: any) => e }));
vi.mock('../src/profile', () => ({ publishProfile: vi.fn(async () => {}), maskPhone: (s: string) => s }));
vi.mock('../src/karma', () => ({ publishKarma: vi.fn(async () => {}) }));
vi.mock('../src/receipts', () => ({ publishReceipt: vi.fn(async () => {}) }));
vi.mock('../src/reputation', () => ({ fetchReputation: vi.fn(async () => ({})) }));
vi.mock('../src/wot', () => ({ buildTrustMap: vi.fn(async () => new Map()) }));

import { generateSecretKey } from 'nostr-tools/pure';
import { makeCallOffer, mintCallId, CALL_HANGUP, CALL_ANSWER, CALL_OFFER, type CallEnvelope } from '@freeport/protocol';
import { CallManager, type CallManagerDeps, type CallState } from '../src/calls/manager';
import { MobileClient } from '../src/client';
import { LocalSigner } from '../src/signer';
import { FakeRelay, flush } from './fake-relay';

// ─── Fake WebRTC ─────────────────────────────────────────────────────────────

const pcs: FakePC[] = [];
class FakePC {
  iceGatheringState = 'complete'; // non-trickle path: already gathered
  localDescription: any = null;
  remoteDescription: any = null;
  connectionState = 'new';
  closed = false;
  ontrack: any = null;
  onconnectionstatechange: any = null;
  onicegatheringstatechange: any = null;
  constructor(public config: any) { pcs.push(this); }
  addEventListener() {}
  removeEventListener() {}
  addTrack() {}
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' }; }
  async setLocalDescription(d: any) { this.localDescription = d; }
  async setRemoteDescription(d: any) { this.remoteDescription = d; }
  close() { this.closed = true; }
  connect() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
}
const audioTrack = { enabled: true, stop: vi.fn() };
const fakeStream = { getTracks: () => [audioTrack], getAudioTracks: () => [audioTrack], getVideoTracks: () => [] };
const fakeRTC = async () => ({ RTCPeerConnection: FakePC as any, mediaDevices: { getUserMedia: async () => fakeStream } });

function makeManager(over: Partial<CallManagerDeps> = {}) {
  const sent: Array<{ peer: string; env: CallEnvelope }> = [];
  const states: CallState[] = [];
  const missed: Array<{ peer: string; dir: string }> = [];
  const mgr = new CallManager({
    send: async (peer, env) => { sent.push({ peer, env }); },
    prefs: () => ({ callsEnabled: true, turnEnabled: false }),
    onState: (s) => states.push(s),
    onStreams: () => {},
    onMissed: (peer, dir) => missed.push({ peer, dir }),
    ringTimeoutMs: 60,
    gatherTimeoutMs: 10,
    rtc: fakeRTC,
    ...over,
  });
  return { mgr, sent, states, missed };
}

const PEER = 'e'.repeat(64);

describe('CallManager', () => {
  it('startCall sends ONE offer (non-trickle) and rings out to missed', async () => {
    const { mgr, sent, missed } = makeManager();
    await mgr.startCall(PEER, false);
    expect(sent).toHaveLength(1);
    expect(sent[0].env.type).toBe(CALL_OFFER);
    expect(sent[0].env.sdp).toBe('offer-sdp');
    expect(mgr.getState().phase).toBe('outgoing');
    await new Promise((r) => setTimeout(r, 100)); // past ringTimeoutMs
    expect(mgr.getState().phase).toBe('ended');
    expect(mgr.getState().reason).toBe('missed');
    expect(sent[1].env.type).toBe(CALL_HANGUP);
    expect(missed).toEqual([{ peer: PEER, dir: 'outgoing' }]);
  });

  it('answer with the right call id connects; wrong id / wrong peer ignored', async () => {
    const { mgr, sent } = makeManager();
    await mgr.startCall(PEER, false);
    const callId = sent[0].env.call;
    mgr.handleSignal(PEER, { v: 1, type: CALL_ANSWER, call: 'bogus', sdp: 'x', ts: 1 });
    expect(mgr.getState().phase).toBe('outgoing');
    mgr.handleSignal('a'.repeat(64), { v: 1, type: CALL_ANSWER, call: callId, sdp: 'x', ts: 1 });
    expect(mgr.getState().phase).toBe('outgoing');
    mgr.handleSignal(PEER, { v: 1, type: CALL_ANSWER, call: callId, sdp: 'answer-sdp', ts: 1 });
    expect(mgr.getState().phase).toBe('connecting');
    pcs[pcs.length - 1].connect();
    expect(mgr.getState().phase).toBe('active');
  });

  it('incoming offer rings; accept sends ONE answer; hangup ends both ways', async () => {
    const { mgr, sent } = makeManager();
    mgr.handleSignal(PEER, makeCallOffer(mintCallId(), 'their-offer', false));
    expect(mgr.getState().phase).toBe('incoming');
    await mgr.acceptCall();
    expect(sent.filter((s) => s.env.type === CALL_ANSWER)).toHaveLength(1);
    expect(mgr.getState().phase).toBe('connecting');
    pcs[pcs.length - 1].connect();
    expect(mgr.getState().phase).toBe('active');
    mgr.hangup();
    expect(mgr.getState().phase).toBe('ended');
    expect(sent[sent.length - 1].env.type).toBe(CALL_HANGUP);
    expect(audioTrack.stop).toHaveBeenCalled();
  });

  it('decline / calls-disabled auto-decline / busy', async () => {
    // Decline.
    const a = makeManager();
    a.mgr.handleSignal(PEER, makeCallOffer(mintCallId(), 'sdp', false));
    a.mgr.declineCall();
    expect(a.sent[0].env.type).toBe(CALL_HANGUP);
    expect(a.sent[0].env.reason).toBe('declined');

    // Calls off → automatic decline with 'disabled'.
    const b = makeManager({ prefs: () => ({ callsEnabled: false, turnEnabled: false }) });
    b.mgr.handleSignal(PEER, makeCallOffer(mintCallId(), 'sdp', false));
    expect(b.mgr.getState().phase).toBe('idle');
    expect(b.sent[0].env.reason).toBe('disabled');

    // Busy: second offer while one is live.
    const c = makeManager();
    c.mgr.handleSignal(PEER, makeCallOffer(mintCallId(), 'sdp', false));
    c.mgr.handleSignal('b'.repeat(64), makeCallOffer(mintCallId(), 'sdp2', false));
    expect(c.sent[0].env.reason).toBe('busy');
    // …but a relay ECHO of the ringing offer is silently ignored.
    const ringing = c.mgr.getState().callId!;
    const echoes = c.sent.length;
    c.mgr.handleSignal(PEER, { v: 1, type: CALL_OFFER, call: ringing, sdp: 'sdp', ts: Math.floor(Date.now() / 1000) });
    expect(c.sent.length).toBe(echoes);
  });

  it('caller cancel while ringing → peer records a missed call (not silent)', async () => {
    // Caller side: cancel after a beat — the hangup must say 'missed'.
    const a = makeManager();
    await a.mgr.startCall(PEER, false);
    a.mgr.hangup();
    expect(a.sent[1].env.type).toBe(CALL_HANGUP);
    expect(a.sent[1].env.reason).toBe('missed');
    expect(a.missed).toEqual([{ peer: PEER, dir: 'outgoing' }]);
    // Callee side: that hangup lands while still ringing → onMissed fires.
    const b = makeManager();
    b.mgr.handleSignal(PEER, { v: 1, type: 'call.offer', call: 'c1', sdp: 'x', video: false, ts: Math.floor(Date.now() / 1000) } as any);
    expect(b.mgr.getState().phase).toBe('incoming');
    b.mgr.handleSignal(PEER, { v: 1, type: 'call.hangup', call: 'c1', reason: 'missed', ts: Math.floor(Date.now() / 1000) } as any);
    expect(b.missed).toEqual([{ peer: PEER, dir: 'incoming' }]);
    // A normal post-answer 'ended' hangup must NOT create a missed entry.
    const c = makeManager();
    c.mgr.handleSignal(PEER, { v: 1, type: 'call.offer', call: 'c2', sdp: 'x', ts: Math.floor(Date.now() / 1000) } as any);
    c.mgr.handleSignal(PEER, { v: 1, type: 'call.hangup', call: 'c2', reason: 'ended', ts: Math.floor(Date.now() / 1000) } as any);
    expect(c.missed).toEqual([]);
  });

  it('unanswered incoming ring times out to missed', async () => {
    const { mgr, missed } = makeManager();
    mgr.handleSignal(PEER, makeCallOffer(mintCallId(), 'sdp', false));
    await new Promise((r) => setTimeout(r, 100));
    expect(mgr.getState().phase).toBe('ended');
    expect(mgr.getState().reason).toBe('missed');
    expect(missed).toEqual([{ peer: PEER, dir: 'incoming' }]);
  });

  it('toggleMute flips the audio track', async () => {
    const { mgr } = makeManager();
    await mgr.startCall(PEER, false);
    audioTrack.enabled = true;
    mgr.toggleMute();
    expect(audioTrack.enabled).toBe(false);
    expect(mgr.getState().muted).toBe(true);
    mgr.toggleMute();
    expect(audioTrack.enabled).toBe(true);
  });
});

// ─── Client signaling gates ──────────────────────────────────────────────────

describe('client call-signal gating', () => {
  function makeUser(relay: FakeRelay) {
    const client = new MobileClient(new LocalSigner(generateSecretKey()), ['ws://fake']);
    (client as any).pool = relay;
    const signals: Array<{ from: string; env: CallEnvelope }> = [];
    client.onCallSignal = (from, env) => signals.push({ from, env });
    client.watchDMs();
    return { client, signals };
  }

  it('drops offers from strangers; delivers after the chat handshake; drops stale offers', async () => {
    const relay = new FakeRelay();
    const alice = makeUser(relay);
    const bob = makeUser(relay);

    // Stranger (no conversation): dropped — the call spam gate.
    await bob.client.sendCallSignal(alice.client.pubkey, makeCallOffer(mintCallId(), 'sdp', false));
    await flush();
    expect(alice.signals).toHaveLength(0);

    // Handshake → active conversation → offers flow.
    await bob.client.chatInvite(alice.client.pubkey, 'Bob');
    await flush();
    await alice.client.chatAccept(bob.client.pubkey, 'Alice');
    await flush();
    await bob.client.sendCallSignal(alice.client.pubkey, makeCallOffer(mintCallId(), 'sdp', false));
    await flush();
    expect(alice.signals).toHaveLength(1);
    expect(alice.signals[0].from).toBe(bob.client.pubkey);

    // A stale offer (relay-delayed past its TTL) never rings.
    const stale = { ...makeCallOffer(mintCallId(), 'sdp', false), ts: Math.floor(Date.now() / 1000) - 120 };
    await bob.client.sendCallSignal(alice.client.pubkey, stale);
    await flush();
    expect(alice.signals).toHaveLength(1);

    // Blocked peer: dropped before decrypt.
    alice.client.setBlocked([bob.client.pubkey]);
    await bob.client.sendCallSignal(alice.client.pubkey, makeCallOffer(mintCallId(), 'sdp', false));
    await flush();
    expect(alice.signals).toHaveLength(1);
  });
});
