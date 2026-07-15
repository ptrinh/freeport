/**
 * Proof of pubkey ownership for the notifier's /subscribe (shared by the
 * native and web push variants — push.ts / push.web.ts).
 *
 * The server only enrolls a DM-watch on a pubkey when the request carries a
 * NIP-98-style event (kind 27235) signed BY that pubkey, fresh (±5 min), and
 * bound via the `u` tag to THIS push endpoint/token — otherwise anyone could
 * enroll a push watch on an arbitrary pubkey and learn its DM timing metadata.
 */

/** Signs an event template with the user's key (MobileClient.signAuthEvent). */
export type SignAuthFn = (template: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<unknown>;

/**
 * Build the signed proof. Null when no signer is available or signing fails —
 * the /subscribe request is still sent without it (the server accepts
 * proofless legacy subscribes until REQUIRE_SUBSCRIBE_AUTH is enforced).
 *
 * @param transportKey the Expo push token (native) or Web Push endpoint URL.
 */
export async function buildSubscribeAuth(sign: SignAuthFn | undefined, transportKey: string): Promise<unknown | null> {
  if (!sign) return null;
  try {
    return await sign({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', transportKey], ['method', 'POST']],
      content: '',
    });
  } catch {
    return null;
  }
}
