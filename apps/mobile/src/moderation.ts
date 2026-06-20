/**
 * Prohibited-content screening — client-side self-policing for the "Group 2"
 * categories that are outright illegal (not the legal-but-platform-restricted
 * wedge, which is allowed). Two enforcement points:
 *
 *   1. On POST   — refuse to publish a matching intent (protect the user from
 *                  posting illegal content under their own key).
 *   2. On RECEIVE — hide matching intents from the feed, so the market
 *                  self-cleans even when a bad actor publishes from elsewhere.
 *
 * This is a denylist heuristic, deliberately conservative, and a STARTING
 * point each community/relay should tune. It is not a substitute for the
 * relay write-policy (see relay/write-policy.md) — relays are the real
 * gate; the client filter is defense-in-depth and keeps honest clients clean.
 */

export interface ModerationVerdict {
  allowed: boolean;
  /** Machine rule id that matched, e.g. "weapons". */
  rule?: string;
  /** Human-readable reason for the block. */
  reason?: string;
}

/** Categories that may never be posted, regardless of keywords. */
export const BANNED_CATEGORIES = new Set<string>([
  // none of the built-in categories are banned outright; this guards against
  // custom/injected category strings a modified client might send.
  'Weapons', 'Drugs', 'Stolen Goods', 'Counterfeits',
]);

/**
 * Denylist rules. Terms are lowercase, accent-stripped stems matched as
 * substrings against the intent's text. Kept minimal and non-graphic — the
 * intent is detection, not enumeration.
 */
const RULES: { rule: string; label: string; terms: string[] }[] = [
  {
    rule: 'csae',
    label: 'child sexual abuse material',
    terms: ['child porn', 'childporn', 'csam', 'underage', 'minor nude', 'loli', 'jailbait'],
  },
  {
    rule: 'drugs',
    label: 'illegal drugs',
    terms: ['cocaine', 'heroin', 'meth', 'methamphetamine', 'mdma', 'ecstasy pill', 'ketamine', 'lsd tab', 'fentanyl'],
  },
  {
    rule: 'weapons',
    label: 'weapons / explosives trafficking',
    terms: ['buy gun', 'sell gun', 'firearm for sale', 'ak47', 'ak-47', 'ammo for sale', 'grenade', 'explosive', 'c4 ', 'silencer'],
  },
  {
    rule: 'stolen',
    label: 'stolen goods or data',
    terms: ['stolen ', 'cloned card', 'carded ', 'cc dump', 'fullz', 'bank logs', 'paypal logs'],
  },
  {
    rule: 'counterfeit',
    label: 'counterfeit goods / forged documents',
    terms: ['counterfeit', 'fake id', 'fake passport', 'forged ', 'replica rolex'],
  },
  {
    rule: 'fraud',
    label: 'fraud / financial crime',
    terms: ['cvv ', 'fullz', 'money launder', 'cash out method', 'scam method', 'otp bypass'],
  },
  {
    rule: 'cybercrime',
    label: 'hacking-for-hire / malware',
    terms: ['hack account', 'ddos for hire', 'ransomware', 'botnet', 'spyware install', 'rat malware'],
  },
  {
    rule: 'trafficking',
    label: 'human trafficking / exploitation',
    terms: ['human traffick', 'organ for sale', 'sell kidney', 'buy kidney'],
  },
  {
    rule: 'wildlife',
    label: 'endangered wildlife',
    terms: ['ivory', 'rhino horn', 'tiger bone', 'pangolin scale'],
  },
  {
    rule: 'violence',
    label: 'violence-for-hire',
    terms: ['hitman', 'contract kill', 'assassinat'],
  },
];

function normalize(s: string): string {
  return (' ' + s + ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Screen an intent's text + category. Returns a verdict; callers block on
 * `allowed === false`.
 */
export function screenIntent(category: string | undefined, ...textParts: (string | undefined)[]): ModerationVerdict {
  if (category && BANNED_CATEGORIES.has(category)) {
    return { allowed: false, rule: 'category', reason: `The category "${category}" is not allowed.` };
  }
  // Both text and terms are space-wrapped by normalize(), so includes() is
  // word-boundary aware ("meth" won't match "method", but matches "... meth ...").
  const hay = normalize(textParts.filter(Boolean).join(' '));
  for (const r of RULES) {
    for (const t of r.terms) {
      if (hay.includes(normalize(t))) {
        return { allowed: false, rule: r.rule, reason: `Blocked: appears to involve ${r.label}.` };
      }
    }
  }
  return { allowed: true };
}

/** Convenience for screening a parsed intent's content+payload. */
export function screenIntentContent(schema: string, title: string, payload: Record<string, any>): ModerationVerdict {
  return screenIntent(
    payload?.category,
    title,
    payload?.service,
    payload?.notes,
    payload?.note,
    payload?.from?.name,
    payload?.to?.name,
    payload?.location?.name,
    payload?.subcategory,
  );
}
