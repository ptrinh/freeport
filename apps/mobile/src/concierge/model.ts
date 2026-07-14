/**
 * AI concierge — natural language → a structured intent draft, using the
 * ON-DEVICE model only (Apple Foundation Models, iOS 26+): free, offline,
 * and the request text never leaves the phone. No cloud tier — that's the
 * roadmap's privacy line ("a hosted model must be explicit opt-in") taken
 * one step further: we simply don't ship one.
 *
 * The native module (react-native-apple-llm) registers with
 * TurboModuleRegistry.getEnforcing at module init, which throws where
 * try/catch can't reach on binaries without it (crash class #13/#14) —
 * probe with TurboModuleRegistry.get BEFORE importing, the breezNative
 * pattern. The module ships in 1.6.0+ binaries (ship-ahead policy);
 * Android (Gemini Nano) gets its own provider here once the Prompt API
 * stabilises.
 */
import { Platform, TurboModuleRegistry } from 'react-native';
import type { RepostDraft } from '../deals';

export type ConciergeAvailability =
  | 'available'
  | 'not_enabled'    // hardware can, user hasn't enabled Apple Intelligence
  | 'model_not_ready' // still downloading
  | 'unsupported';   // wrong platform / old binary / ineligible hardware

/** Cheap sync probe — safe anywhere; gates the ✨ button's existence.
 *  Web: Chrome's Prompt API (Gemini Nano, desktop Chrome/Edge) — feature-
 *  detected; iOS: the Apple FM TurboModule. Android native waits for a
 *  stable Gemini Nano surface. */
export function conciergeModulePresent(): boolean {
  if (Platform.OS === 'web') {
    return typeof (globalThis as any).LanguageModel?.create === 'function';
  }
  if (Platform.OS !== 'ios') return false;
  try {
    return TurboModuleRegistry.get('AppleLLMModule') != null;
  } catch {
    return false;
  }
}

export async function conciergeAvailability(): Promise<ConciergeAvailability> {
  if (!conciergeModulePresent()) return 'unsupported';
  if (Platform.OS === 'web') {
    try {
      // Conservative: 'downloadable' means a multi-GB pull on first create —
      // only light the button up once the model is actually on disk.
      switch (await (globalThis as any).LanguageModel.availability()) {
        case 'available': return 'available';
        case 'downloadable':
        case 'downloading': return 'model_not_ready';
        default: return 'unsupported';
      }
    } catch {
      return 'unsupported';
    }
  }
  try {
    const m = await import('react-native-apple-llm');
    switch (await m.isFoundationModelsEnabled()) {
      case 'available': return 'available';
      case 'appleIntelligenceNotEnabled': return 'not_enabled';
      case 'modelNotReady': return 'model_not_ready';
      default: return 'unsupported';
    }
  } catch {
    return 'unsupported';
  }
}

import type { StructureSchema } from 'react-native-apple-llm';

/** What the model must return — guided generation keeps it on-schema. */
const DRAFT_STRUCTURE: StructureSchema = {
  kind: { type: 'string', enum: ['ride', 'service'], description: 'ride = transport from A to B; service = any other job, task or purchase' },
  from: { type: 'string', description: 'pickup place for a ride (empty when unknown or not a ride)' },
  to: { type: 'string', description: 'destination for a ride (empty when unknown or not a ride)' },
  service: { type: 'string', description: 'short label of the service/product wanted (empty for rides)' },
  location: { type: 'string', description: 'where the service happens (empty for rides or when unknown)' },
  price: { type: 'number', description: 'offered/max price as a plain number, 0 when not mentioned' },
  currency: { type: 'string', description: 'ISO currency code if the user named one, else empty' },
  note: { type: 'string', description: 'everything else that matters (time, seats, constraints), one short line' },
};

export interface ConciergeParse {
  kind?: string;
  from?: string;
  to?: string;
  service?: string;
  location?: string;
  price?: number;
  currency?: string;
  note?: string;
}

export interface ConciergeContext {
  servicesEnabled: boolean;
  defaultCurrency: string;
}

/**
 * Pure mapper: model output → the Post form's prefill draft (the same
 * RepostDraft the Repost feature uses, so PostTab needs zero changes).
 * Returns null when the parse is too empty to be useful.
 */
export function parseToDraft(p: ConciergeParse, ctx: ConciergeContext): RepostDraft | null {
  const clean = (s?: string) => (typeof s === 'string' ? s.trim() : '');
  const isRide = p.kind !== 'service' || (!clean(p.service) && !!clean(p.to));
  const price = typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0 ? p.price : 0;
  const payment = price ? `${clean(p.currency) || ctx.defaultCurrency} ${price}` : undefined;
  if (isRide) {
    if (!clean(p.from) && !clean(p.to)) return null;
    return {
      schema: 'rideshare/1',
      from: clean(p.from) || undefined,
      to: clean(p.to) || undefined,
      payment,
      note: clean(p.note) || undefined,
    };
  }
  if (!ctx.servicesEnabled) return null; // services vertical is off — no form to fill
  if (!clean(p.service)) return null;
  return {
    schema: 'service/1',
    service: clean(p.service),
    location: clean(p.location) || undefined,
    payment,
    note: clean(p.note) || undefined,
  };
}

/** The same schema as JSON Schema, for Chrome's responseConstraint. */
const WEB_DRAFT_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    Object.entries(DRAFT_STRUCTURE).map(([k, v]) => [k, { type: v.type, ...(v.enum ? { enum: v.enum } : {}), description: v.description }]),
  ),
  required: ['kind'],
};

function conciergeInstructions(ctx: ConciergeContext): string {
  return (
    'You turn one user request into a structured marketplace intent draft. ' +
    'The marketplace has rides (transport from A to B) and services (any other job, task or purchase). ' +
    'Extract only what the user actually said — never invent places or prices. ' +
    `Default currency when the user names a price without one: ${ctx.defaultCurrency}. ` +
    'Understand any language; keep extracted place names exactly as written.'
  );
}

async function draftIntentWeb(text: string, ctx: ConciergeContext): Promise<RepostDraft | null> {
  const g = globalThis as any;
  const session = await g.LanguageModel.create({
    initialPrompts: [{ role: 'system', content: conciergeInstructions(ctx) }],
  });
  try {
    const raw = await session.prompt(text.trim(), { responseConstraint: WEB_DRAFT_SCHEMA });
    return parseToDraft(JSON.parse(raw) as ConciergeParse, ctx);
  } catch {
    return null;
  } finally {
    session.destroy?.();
  }
}

/** Natural language → draft, entirely on-device. Null = model couldn't parse. */
export async function draftIntent(text: string, ctx: ConciergeContext): Promise<RepostDraft | null> {
  if (!text.trim()) return null;
  if (Platform.OS === 'web') return draftIntentWeb(text, ctx);
  const m = await import('react-native-apple-llm');
  await m.configureSession({ instructions: conciergeInstructions(ctx) });
  try {
    const out = await m.generateStructuredOutput({ structure: DRAFT_STRUCTURE, prompt: text.trim() });
    return parseToDraft((out ?? {}) as ConciergeParse, ctx);
  } finally {
    m.resetSession().catch(() => {});
  }
}
