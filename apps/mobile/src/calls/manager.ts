/**
 * Call manager — the state machine between call.* DM signaling (client.ts)
 * and a WebRTC peer connection (webrtc.ts). One call at a time.
 *
 * Non-trickle ICE by design: media candidates are gathered to completion
 * (bounded) before the single offer/answer is sent — over relay-transported
 * DMs, per-candidate trickle messages would hit rate limits and reorder.
 * See docs/ROADMAP.md (calls) for the full constraint list.
 */
import {
  makeCallAnswer,
  makeCallHangup,
  makeCallOffer,
  mintCallId,
  CALL_ANSWER,
  CALL_HANGUP,
  CALL_OFFER,
  type CallEnvelope,
  type CallHangupReason,
} from '@freeport/protocol';
import { loadRTC, type RTC } from './webrtc';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

export interface CallState {
  phase: CallPhase;
  peer?: string;
  callId?: string;
  video?: boolean;
  /** Set when phase === 'ended'. */
  reason?: CallHangupReason | 'unsupported' | 'media_denied';
  /** Set when phase === 'active'. */
  startedAt?: number;
  muted?: boolean;
  cameraOff?: boolean;
  /** Web: currently sending the screen instead of the camera. */
  sharingScreen?: boolean;
}

/** Screen share rides replaceTrack on the EXISTING video sender — no
 *  renegotiation round over the DM channel. Web-only (getDisplayMedia);
 *  native needs ReplayKit/MediaProjection (see roadmap). */
export function screenShareSupported(): boolean {
  return typeof (globalThis as any).navigator?.mediaDevices?.getDisplayMedia === 'function';
}

const IDLE: CallState = { phase: 'idle' };

/** Default STUN set — free, stateless. TURN is layered on via fetchIceServers. */
const STUN_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];

/** Wait for ICE gathering to complete (non-trickle), bounded. */
async function gatherComplete(pc: any, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      try { pc.removeEventListener?.('icegatheringstatechange', check); } catch { /* older shims */ }
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === 'complete') done();
    }
    try { pc.addEventListener?.('icegatheringstatechange', check); } catch { /* older shims */ }
    // react-native-webrtc also supports the on* property form.
    pc.onicegatheringstatechange = check;
  });
}

export interface CallManagerDeps {
  /** Send one signaling envelope to a peer (client.sendCallSignal). */
  send: (peer: string, env: CallEnvelope) => Promise<void>;
  /** Live prefs — read at event time, not construction time. */
  prefs: () => { callsEnabled: boolean; turnEnabled: boolean };
  /** TURN credential endpoint ('' = STUN only). */
  turnEndpoint?: () => string;
  onState: (state: CallState) => void;
  /** Streams for the UI (native MediaStream / DOM MediaStream). */
  onStreams: (local: any | null, remote: any | null) => void;
  /** A ring that nobody answered (either direction) — drives the chat notice. */
  onMissed?: (peer: string, direction: 'incoming' | 'outgoing') => void;
  ringTimeoutMs?: number;
  gatherTimeoutMs?: number;
  /** Test seam. */
  rtc?: () => Promise<RTC | null>;
}

export class CallManager {
  private state: CallState = IDLE;
  private pc: any = null;
  private localStream: any = null;
  private remoteStream: any = null;
  private pendingOfferSdp: string | null = null;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private screenTrack: any = null;
  private cameraTrack: any = null;

  constructor(private deps: CallManagerDeps) {}

  getState(): CallState {
    return this.state;
  }

  /** Un-narrowed phase read — `this.state` mutates across awaits, and TS's
   *  control-flow narrowing from an early guard would otherwise flag later
   *  re-checks as impossible comparisons. */
  private phase(): CallPhase {
    return this.state.phase;
  }

  private setState(next: CallState): void {
    this.state = next;
    this.deps.onState(next);
  }

  private clearRing(): void {
    if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = null; }
  }

  private async iceServers(): Promise<any[]> {
    const { turnEnabled } = this.deps.prefs();
    const endpoint = (this.deps.turnEndpoint?.() ?? '').trim();
    if (!turnEnabled || !endpoint) return STUN_SERVERS;
    try {
      const resp = await fetch(`${endpoint.replace(/\/$/, '')}/turn-credentials`, { method: 'POST' });
      const body = await resp.json();
      const servers = body?.iceServers;
      // TURN augments STUN; a bad response degrades to STUN-only (call may
      // fail behind strict NAT, but never errors out here).
      if (Array.isArray(servers) && servers.length) return [...STUN_SERVERS, ...servers];
      if (servers?.urls) return [...STUN_SERVERS, servers];
    } catch { /* offline / worker down → STUN only */ }
    return STUN_SERVERS;
  }

  private async setupPeerConnection(rtc: RTC, video: boolean): Promise<boolean> {
    try {
      this.localStream = await rtc.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
    } catch {
      this.teardown();
      this.setState({ phase: 'ended', peer: this.state.peer, reason: 'media_denied' });
      return false;
    }
    this.pc = new rtc.RTCPeerConnection({ iceServers: await this.iceServers() });
    for (const track of this.localStream.getTracks()) this.pc.addTrack(track, this.localStream);
    const onTrack = (ev: any) => {
      this.remoteStream = ev.streams?.[0] ?? this.remoteStream;
      this.deps.onStreams(this.localStream, this.remoteStream);
    };
    try { this.pc.addEventListener?.('track', onTrack); } catch { /* shim */ }
    this.pc.ontrack = onTrack;
    const onConn = () => {
      const st = this.pc?.connectionState;
      if (st === 'connected' && this.state.phase === 'connecting') {
        this.setState({ ...this.state, phase: 'active', startedAt: Date.now() });
      }
      if ((st === 'failed' || st === 'disconnected') && (this.state.phase === 'active' || this.state.phase === 'connecting')) {
        this.endLocal('error');
      }
    };
    try { this.pc.addEventListener?.('connectionstatechange', onConn); } catch { /* shim */ }
    this.pc.onconnectionstatechange = onConn;
    this.deps.onStreams(this.localStream, this.remoteStream);
    return true;
  }

  /** Place a call to a peer (active friend-chat conversations only — enforced upstream). */
  async startCall(peer: string, video: boolean): Promise<void> {
    if (this.state.phase !== 'idle' && this.state.phase !== 'ended') return;
    const rtc = await (this.deps.rtc ?? loadRTC)();
    if (!rtc) { this.setState({ phase: 'ended', peer, reason: 'unsupported' }); return; }
    const callId = mintCallId();
    this.setState({ phase: 'outgoing', peer, callId, video });
    if (!(await this.setupPeerConnection(rtc, video))) return;
    const offer = await this.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
    await this.pc.setLocalDescription(offer);
    await gatherComplete(this.pc, this.deps.gatherTimeoutMs ?? 3000);
    // Guard: user may have cancelled while gathering.
    if (this.phase() !== 'outgoing' || this.state.callId !== callId) return;
    await this.deps.send(peer, makeCallOffer(callId, this.pc.localDescription.sdp, video));
    this.ringTimer = setTimeout(() => {
      if (this.state.phase === 'outgoing' && this.state.callId === callId) {
        this.deps.send(peer, makeCallHangup(callId, 'missed')).catch(() => {});
        this.deps.onMissed?.(peer, 'outgoing');
        this.teardown();
        this.setState({ phase: 'ended', peer, callId, reason: 'missed' });
      }
    }, this.deps.ringTimeoutMs ?? 45000);
  }

  /** Inbound signaling from client.onCallSignal (already gated for live+active+fresh). */
  handleSignal(from: string, env: CallEnvelope): void {
    if (env.type === CALL_OFFER) {
      if (!this.deps.prefs().callsEnabled) {
        // Roadmap: calls off → incoming invites are declined automatically.
        this.deps.send(from, makeCallHangup(env.call, 'disabled')).catch(() => {});
        return;
      }
      if (this.state.phase !== 'idle' && this.state.phase !== 'ended') {
        if (this.state.callId === env.call) return; // relay echo of the offer we're already ringing on
        this.deps.send(from, makeCallHangup(env.call, 'busy')).catch(() => {});
        return;
      }
      this.pendingOfferSdp = env.sdp!;
      this.setState({ phase: 'incoming', peer: from, callId: env.call, video: !!env.video });
      this.ringTimer = setTimeout(() => {
        if (this.state.phase === 'incoming' && this.state.callId === env.call) {
          this.deps.onMissed?.(from, 'incoming');
          this.teardown();
          this.setState({ phase: 'ended', peer: from, callId: env.call, reason: 'missed' });
        }
      }, this.deps.ringTimeoutMs ?? 45000);
      return;
    }
    // answer/hangup must belong to the current call — anything else is a
    // replayed or crossed message from a dead session.
    if (this.state.callId !== env.call || this.state.peer !== from) return;
    if (env.type === CALL_ANSWER) {
      if (this.state.phase !== 'outgoing') return;
      this.clearRing();
      this.setState({ ...this.state, phase: 'connecting' });
      this.pc?.setRemoteDescription({ type: 'answer', sdp: env.sdp })
        .catch(() => this.endLocal('error'));
      return;
    }
    if (env.type === CALL_HANGUP) {
      const wasRinging = this.state.phase === 'incoming';
      this.clearRing();
      this.teardown();
      if (wasRinging && env.reason !== 'ended') this.deps.onMissed?.(from, 'incoming');
      this.setState({ phase: 'ended', peer: from, callId: env.call, reason: env.reason ?? 'ended' });
    }
  }

  /** Callee accepted the ringing call. */
  async acceptCall(): Promise<void> {
    if (this.state.phase !== 'incoming' || !this.pendingOfferSdp) return;
    const { peer, callId, video } = this.state;
    this.clearRing();
    const rtc = await (this.deps.rtc ?? loadRTC)();
    if (!rtc) { this.setState({ phase: 'ended', peer, callId, reason: 'unsupported' }); return; }
    this.setState({ ...this.state, phase: 'connecting' });
    if (!(await this.setupPeerConnection(rtc, !!video))) return;
    await this.pc.setRemoteDescription({ type: 'offer', sdp: this.pendingOfferSdp });
    this.pendingOfferSdp = null;
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await gatherComplete(this.pc, this.deps.gatherTimeoutMs ?? 3000);
    if (this.phase() !== 'connecting' || this.state.callId !== callId) return;
    await this.deps.send(peer!, makeCallAnswer(callId!, this.pc.localDescription.sdp));
  }

  declineCall(): void {
    if (this.state.phase !== 'incoming') return;
    const { peer, callId } = this.state;
    this.clearRing();
    this.deps.send(peer!, makeCallHangup(callId!, 'declined')).catch(() => {});
    this.teardown();
    this.setState({ phase: 'ended', peer, callId, reason: 'declined' });
  }

  /** Local hangup/cancel from any live phase. */
  hangup(): void {
    const { phase, peer, callId } = this.state;
    if (phase === 'idle' || phase === 'ended') return;
    this.clearRing();
    this.deps.send(peer!, makeCallHangup(callId!, 'ended')).catch(() => {});
    this.teardown();
    this.setState({ phase: 'ended', peer, callId, reason: 'ended' });
  }

  private endLocal(reason: CallHangupReason): void {
    const { peer, callId } = this.state;
    this.clearRing();
    this.teardown();
    this.setState({ phase: 'ended', peer, callId, reason });
  }

  toggleMute(): void {
    if (!this.localStream) return;
    const muted = !this.state.muted;
    for (const tr of this.localStream.getAudioTracks?.() ?? []) tr.enabled = !muted;
    this.setState({ ...this.state, muted });
  }

  toggleCamera(): void {
    if (!this.localStream) return;
    const cameraOff = !this.state.cameraOff;
    for (const tr of this.localStream.getVideoTracks?.() ?? []) tr.enabled = !cameraOff;
    this.setState({ ...this.state, cameraOff });
  }

  /**
   * Toggle screen sharing (web, during a VIDEO call): swap the outgoing video
   * track via sender.replaceTrack — same m-line, so no renegotiation and no
   * extra signaling round over the relays. Ending the browser share (its own
   * "stop sharing" chrome) reverts to the camera automatically.
   */
  async toggleScreenShare(): Promise<void> {
    if (this.state.phase !== 'active' || !this.state.video || !this.pc) return;
    if (!screenShareSupported()) return;
    const sender = this.pc.getSenders?.().find((sn: any) => sn.track?.kind === 'video');
    if (!sender) return;
    if (this.state.sharingScreen) {
      try { this.screenTrack?.stop(); } catch { /* already stopped */ }
      this.screenTrack = null;
      if (this.cameraTrack) await sender.replaceTrack(this.cameraTrack);
      this.setState({ ...this.state, sharingScreen: false });
      return;
    }
    try {
      const display = await (globalThis as any).navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      this.cameraTrack = sender.track;
      this.screenTrack = track;
      await sender.replaceTrack(track);
      // Browser "Stop sharing" chrome ends the track — revert to camera.
      track.onended = () => { this.toggleScreenShare().catch(() => {}); };
      this.setState({ ...this.state, sharingScreen: true });
    } catch { /* user dismissed the picker */ }
  }

  /** Clear an 'ended' banner back to idle (UI dismiss). */
  dismissEnded(): void {
    if (this.state.phase === 'ended') this.setState(IDLE);
  }

  private teardown(): void {
    this.pendingOfferSdp = null;
    try { this.screenTrack?.stop(); } catch { /* platform quirks */ }
    this.screenTrack = null;
    this.cameraTrack = null;
    try { for (const tr of this.localStream?.getTracks?.() ?? []) tr.stop(); } catch { /* platform quirks */ }
    try { this.pc?.close(); } catch { /* already closed */ }
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.deps.onStreams(null, null);
  }
}
