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
 * The providers to try, cheapest first.
 *
 * This deliberately reverses the old precedence (Anthropic first, "best
 * quality"). Gemini's free tier is capped at 20 generations per project per day
 * and periodically has no capacity at all, so the useful arrangement is free
 * first with a paid key as the safety net — you pay only for the requests the
 * free tier couldn't serve. `runWithProviders` walks this list in order.
 *
 * Set both keys to get the fallback. With only one, the list has one entry and
 * behaviour matches the old single-provider path.
 *
 * Don't pin an old Gemini id: Google 404s retired models for callers who hadn't
 * used them ("no longer available to new users"), and the error names the
 * replacement.
 */
export function resolveModelChain(): ModelCandidate[] {
  const chain: ModelCandidate[] = [];

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const id = process.env.GOOGLE_MODEL ?? 'gemini-3.6-flash';
    chain.push({ label: `google:${id}`, model: google(id), paid: false });
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
