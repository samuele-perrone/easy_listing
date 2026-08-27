import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

/**
 * Provider selection, by which key is configured:
 * 1. ANTHROPIC_API_KEY  → direct Anthropic API (best quality)
 * 2. GOOGLE_GENERATIVE_AI_API_KEY → Google Gemini (free tier, no card)
 * 3. otherwise          → Vercel AI Gateway (needs credits)
 */
export function resolveModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    return anthropic(process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5');
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return google(process.env.GOOGLE_MODEL ?? 'gemini-2.5-flash');
  }
  return process.env.GENERATION_MODEL ?? 'anthropic/claude-sonnet-5';
}
