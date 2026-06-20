/**
 * Tiny pub/sub so the guided tour (App level) can nudge the amount wheel (deep
 * inside the Request form) to play a one-shot demo — slide right, then back to
 * 0 — without prop-drilling through PostTab → RideshareForm → PaymentField.
 *
 * The trigger can fire BEFORE the wheel has mounted/subscribed (e.g. on tour
 * replay the Post tab remounts and the subscribe effect runs a beat late), so
 * the request LATCHES: if there's no subscriber yet, the next one to subscribe
 * runs it (as long as the request is still fresh).
 */
type Fn = () => void;
const subs = new Set<Fn>();
let pendingUntil = 0; // epoch ms; a queued demo runs if a subscriber appears before this

export function onWheelDemo(fn: Fn): () => void {
  subs.add(fn);
  if (pendingUntil && Date.now() < pendingUntil) {
    pendingUntil = 0;
    try { fn(); } catch { /* ignore */ }
  }
  return () => { subs.delete(fn); };
}

export function triggerWheelDemo(): void {
  if (subs.size === 0) {
    pendingUntil = Date.now() + 8000; // wait up to 8s for the wheel to mount
    return;
  }
  subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
}
