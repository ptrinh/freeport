/**
 * Message formatting for guest-mode conversations: the offer card (with a
 * reputation line and accept/counter/decline buttons), the deal + contact card,
 * and the post receipt. HTML parse_mode; reuse the escaper from the feed.
 */
import type { Negotiation } from '@freeport/protocol';
import type { ReputationSummary } from '../../reputation.js';
import { esc } from './format.js';
import type { InlineButton } from './api.js';

function termsLine(nego: Negotiation): string {
  const parts: string[] = [];
  const w = nego.terms?.window;
  if (w) {
    const t0 = new Date(w.start * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const t1 = new Date(w.end * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    parts.push(`🕒 ${t0}–${t1}`);
  }
  if (nego.terms?.payment) parts.push(`💰 ${esc(nego.terms.payment)}`);
  return parts.join(' · ') || '(as posted)';
}

function repLine(rep: ReputationSummary | null): string {
  if (!rep || rep.karma.count === 0) return '🆕 new driver — no ratings yet';
  return `⭐ ${rep.karma.average} (${rep.karma.count} rating${rep.karma.count === 1 ? '' : 's'} · ${rep.provenDeals} proven deal${rep.provenDeals === 1 ? '' : 's'})`;
}

export interface OfferCard { text: string; buttons: InlineButton[][] }

export function offerCard(nego: Negotiation, rep: ReputationSummary | null, sid: string): OfferCard {
  const peer = nego.peer.slice(0, 8);
  return {
    text: [
      `🚗 <b>Offer</b> on “${esc(nego.intent.content.title || 'your ride')}”`,
      `from ${esc(peer)}… — ${repLine(rep)}`,
      termsLine(nego),
    ].join('\n'),
    buttons: [[
      { text: '✅ Accept', callback_data: `g:a:${sid}` },
      { text: '↩️ Counter', callback_data: `g:c:${sid}` },
      { text: '❌ Decline', callback_data: `g:d:${sid}` },
    ]],
  };
}

/** Shown (via editMessageText) once a card is resolved. */
export function resolvedCard(nego: Negotiation, outcome: 'accepted' | 'countered' | 'declined' | 'confirmed' | 'expired'): string {
  const title = esc(nego.intent.content.title || 'your ride');
  switch (outcome) {
    case 'confirmed': return `🤝 <b>Deal!</b> — ${title}`;
    case 'accepted': return `✅ You accepted — ${title}. Waiting for confirmation…`;
    case 'countered': return `↩️ You countered — ${title}. Waiting for their reply…`;
    case 'declined': return `❌ Declined — ${title}`;
    case 'expired': return `⌛ Offer expired — ${title}`;
  }
}

/** After a deal confirms, hand the two contacts to the guest. */
export function dealCard(nego: Negotiation): string {
  const theirs = nego.theirContact ? esc(nego.theirContact) : '(they’ll share shortly)';
  return `🤝 <b>Deal confirmed</b> — ${esc(nego.intent.content.title || 'your ride')}\n\nDriver’s contact: ${theirs}\nYour contact was shared with them.`;
}

export function receiptCard(title: string, expiryMin: number): string {
  return `📣 <b>Posted to Freeport</b>\n${esc(title)}\n\nDrivers on the network can now make you offers — I’ll send each one here with Accept / Counter / Decline. Live for ${Math.round(expiryMin / 60)}h. /myposts to manage.`;
}
