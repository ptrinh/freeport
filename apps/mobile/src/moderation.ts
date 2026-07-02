/**
 * Prohibited-content screening now lives in @freeport/protocol (it's pure,
 * protocol-level self-policing shared by the app, the CLI agent, and the
 * Telegram guest bridge). This shim re-exports it so existing `./moderation`
 * imports keep working.
 */
export { screenIntent, screenIntentContent, BANNED_CATEGORIES, type ModerationVerdict } from '@freeport/protocol';
