/**
 * DM-notification coalescing gate.
 *
 * Freeport sends negotiation CONTROL messages (offers, accepts, counters, stage
 * updates, contact exchange, the auto-shared trip link) as kind-4 DMs too, not
 * just human chat. The notifier is content-blind (NIP-04), so it can't tell them
 * apart — without this, an active deal spams "New message". Coalesce: at most one
 * DM push per subscriber per cooldown window.
 */

/**
 * Decide whether a DM push is DUE.
 *
 * @param lastPushMs  epoch-ms of the last DM push for this subscriber, or
 *   `undefined` if none has been sent yet.
 * @param nowMs       current epoch-ms.
 * @param cooldownMs  coalescing window in ms. `0` disables coalescing.
 * @returns true when a push should be sent (no prior push, or the window has
 *   elapsed). False when within the cooldown window of the last push.
 */
export function dmCoalesceDue(lastPushMs: number | undefined, nowMs: number, cooldownMs: number): boolean {
  if (lastPushMs === undefined) return true;
  return nowMs - lastPushMs >= cooldownMs;
}
