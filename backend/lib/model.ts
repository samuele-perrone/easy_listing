import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export interface ModelCandidate {
  /** Short name for logs — never a key or anything secret. */
  label: string;
  model: LanguageModel;
  /** Whether calling this one costs money. Logged so the bill is traceable. */
  paid: boolean;
}

/**
 * The free tier's daily cap is **per model**, not just per project — the quota
 * that rejected us read `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, 20
 * requests. So listing several models multiplies the free allowance (20 each)
 * and gives somewhere to go when one model has no capacity, at no cost.
 *
 * `GOOGLE_MODELS` is a comma-separated list, tried in order. `GOOGLE_MODEL`
 * (singular) still works for pinning exactly one.
 */
function freeGoogleModels(): string[] {
  const configured = process.env.GOOGLE_MODELS ?? process.env.GOOGLE_MODEL ?? 'gemini-3.6-flash';
  const ids = configured
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  // Duplicates would share one quota pool and just waste an attempt.
  return [...new Set(ids)];
}

/**
 * The providers to try, cheapest first.
 *
 * This deliberately reverses the old precedence (Anthropic first, "best
 * quality"). Gemini's free tier allows 20 generations per model per day and
 * periodically has no capacity at all, so the useful arrangement is free first —
 * several free models, then a paid key only if one is configured, which pays
 * for just what the free tier refused. `runWithProviders` walks this in order.
 *
 * Free-only is a valid and supported setup: list several models in
 * `GOOGLE_MODELS` and set no paid key. Nothing bills, and the chain still has
 * somewhere to fall through to. A paid entry appears only if its key is set.
 *
 * Don't pin an old Gemini id: Google 404s retired models for callers who hadn't
 * used them ("no longer available to new users"), and the error names the
 * replacement.
 */
export function resolveModelChain(): ModelCandidate[] {
  const chain: ModelCandidate[] = [];

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    for (const id of freeGoogleModels()) {
      chain.push({ label: `google:${id}`, model: google(id), paid: false });
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const id = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
    chain.push({ label: `anthropic:${id}`, model: anthropic(id), paid: true });
  }

  // No direct key at all: fall back to the gateway, which needs credits. Its
  // free tier rejects every model, which is why it isn't in the chain above.
  if (chain.length === 0) {
    const id = process.env.GENERATION_MODEL ?? 'anthropic/claude-sonnet-5';
    chain.push({ label: `gateway:${id}`, model: id, paid: true });
  }

  return chain;
}
