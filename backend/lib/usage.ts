import { list, put } from '@vercel/blob';

/**
 * How many generations one install gets per day.
 *
 * Generous for a real seller — nobody photographs 30 things in a day — and
 * small enough that a single abuser can't run up a bill worth having.
 */
const PER_INSTALL_DAILY = Number(process.env.DAILY_LIMIT_PER_INSTALL ?? 30);

/**
 * How many generations the whole backend serves per day, across everyone.
 *
 * This is the one that actually bounds the bill. The install id is sent by the
 * app and is not a secret — anyone can invent one, or send a fresh one per
 * request — so the per-install limit shapes honest use while this backstop is
 * what holds when someone isn't honest.
 */
const GLOBAL_DAILY = Number(process.env.DAILY_LIMIT_TOTAL ?? 200);

/** Requests that arrive without an install id all share one allowance. */
const ANONYMOUS = 'unidentified';

export interface UsageDecision {
  allowed: boolean;
  /** Set when refused, in the error/fix shape the app already renders. */
  error?: string;
  fix?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * An install id is sent by the app, so treat it as untrusted input: clamp the
 * length and strip anything that isn't safe in a blob path, or a caller could
 * pick their own storage layout.
 */
export function normaliseInstallId(raw: string | null): string {
  if (!raw) return ANONYMOUS;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned || ANONYMOUS;
}

async function countWithPrefix(prefix: string, stopAt: number): Promise<number> {
  // Only ever needs to know "at least the limit", so it never pages past it.
  const { blobs } = await list({ prefix, limit: stopAt + 1 });
  return blobs.length;
}

/**
 * Whether this install may start another generation today.
 *
 * Deliberately checked *before* the work starts: a generation that has already
 * reached a paid model has already cost money, so refusing afterwards would
 * bound nothing.
 */
export async function checkUsage(installId: string): Promise<UsageDecision> {
  const day = today();

  const [mine, everyone] = await Promise.all([
    countWithPrefix(`usage/${day}/${installId}/`, PER_INSTALL_DAILY),
    countWithPrefix(`usage/${day}/`, GLOBAL_DAILY),
  ]);

  if (everyone >= GLOBAL_DAILY) {
    return {
      allowed: false,
      error: 'Easy Listing has hit its daily limit.',
      fix: 'The limit resets tomorrow. If this keeps happening, get in touch.',
    };
  }

  if (mine >= PER_INSTALL_DAILY) {
    return {
      allowed: false,
      error: `You've used your ${PER_INSTALL_DAILY} listings for today.`,
      fix: 'The allowance resets tomorrow.',
    };
  }

  return { allowed: true };
}

/**
 * Records one generation as its own object.
 *
 * A counter would need read-modify-write, and two requests arriving together
 * would each read the same number and write the same increment — the cap would
 * leak under exactly the load it exists to stop. One marker per generation has
 * no such race, and counting is a prefix list bounded by the cap itself.
 */
export async function recordUsage(installId: string): Promise<void> {
  const day = today();
  // Blob refuses an empty body, so the marker carries the one thing worth
  // having if these are ever read rather than counted: when it happened.
  await put(`usage/${day}/${installId}/${crypto.randomUUID()}`, new Date().toISOString(), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'text/plain',
  });
}
