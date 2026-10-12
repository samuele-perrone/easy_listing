import { list, put } from '@vercel/blob';

/**
 * Free listings per signed-in account, per calendar month.
 *
 * This is the limit a person actually meets, so it is the one that has to be
 * explainable: "you've used your 10 listings this month" is something a seller
 * can understand and plan around. Contrast the global ceiling below, which is
 * not — being told to come back tomorrow because strangers used up the day is
 * what makes an app feel broken.
 */
const FREE_PER_MONTH = Number(process.env.FREE_LISTINGS_PER_MONTH ?? 10);

/**
 * How many generations one install gets per day.
 *
 * Kept for the record: superseded by the per-account monthly quota on
 * 12 Oct 2026, once every caller had to be signed in. An install id is
 * self-asserted, so it could never bound anything on its own.
 */
const PER_INSTALL_DAILY = Number(process.env.DAILY_LIMIT_PER_INSTALL ?? 30);

/**
 * How many generations the whole backend serves per day, across everyone.
 *
 * A circuit breaker, not a product rule. Set it well above what normal use
 * reaches: when it fires, somebody who has done nothing wrong is turned away
 * for reasons they can neither see nor fix, so it should only ever catch a
 * runaway. The per-account quota above is what shapes ordinary use.
 */
const GLOBAL_DAILY = Number(process.env.DAILY_LIMIT_TOTAL ?? 200);

/** Requests that arrive without an install id all share one allowance. */
const ANONYMOUS = 'unidentified';

export interface UsageDecision {
  allowed: boolean;
  /** Generations used this month by this account. */
  used: number;
  /** The monthly allowance, or null when this account is uncapped. */
  limit: number | null;
  /** Set when refused, in the error/fix shape the app already renders. */
  error?: string;
  fix?: string;
}

/** The account a generation is charged to. */
export interface Account {
  /** Stable id from the sign-in provider — safe for a blob path. */
  key: string;
  email: string;
}

function month(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Accounts with no monthly cap, from `UNLIMITED_ACCOUNTS` (falling back to the
 * old `ALLOWED_EMAILS`). This is no longer a gate — anyone signed in may use
 * the app — only a way for the owner to avoid being rate-limited by their own
 * allowance while testing.
 */
function uncappedAccounts(): string[] {
  const raw = process.env.UNLIMITED_ACCOUNTS ?? process.env.ALLOWED_EMAILS ?? '';
  return raw.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isUncapped(email: string): boolean {
  return uncappedAccounts().includes(email.trim().toLowerCase());
}

/**
 * Turns a provider's user id into something safe to put in a blob path. Same
 * clamping as an install id: the value comes from outside, so it must not be
 * able to choose its own storage layout.
 */
export function normaliseAccountKey(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'unknown';
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
export async function checkUsage(account: Account): Promise<UsageDecision> {
  const uncapped = isUncapped(account.email);
  const limit = uncapped ? null : FREE_PER_MONTH;

  const [used, everyone] = await Promise.all([
    countWithPrefix(`accounts/${month()}/${account.key}/`, uncapped ? 1 : FREE_PER_MONTH),
    countWithPrefix(`usage/${today()}/`, GLOBAL_DAILY),
  ]);

  // The circuit breaker is checked first but worded as ours, not theirs: this
  // is never the seller's fault and there is nothing for them to do differently.
  if (everyone >= GLOBAL_DAILY) {
    return {
      allowed: false,
      used,
      limit,
      error: 'Easy Listing is over capacity right now.',
      fix: 'This is on our side, not yours. Your photos are saved — tap Retry in a little while.',
    };
  }

  if (!uncapped && used >= FREE_PER_MONTH) {
    return {
      allowed: false,
      used,
      limit,
      error: `You've used your ${FREE_PER_MONTH} free listings this month.`,
      fix: 'The allowance resets on the 1st. Everything you have already generated stays available.',
    };
  }

  return { allowed: true, used, limit };
}

/** What's left this month, for the app to show before anyone hits the wall. */
export async function quotaFor(account: Account): Promise<{ used: number; limit: number | null }> {
  if (isUncapped(account.email)) return { used: 0, limit: null };
  const used = await countWithPrefix(`accounts/${month()}/${account.key}/`, FREE_PER_MONTH);
  return { used, limit: FREE_PER_MONTH };
}

/**
 * Records one generation as its own object.
 *
 * A counter would need read-modify-write, and two requests arriving together
 * would each read the same number and write the same increment — the cap would
 * leak under exactly the load it exists to stop. One marker per generation has
 * no such race, and counting is a prefix list bounded by the cap itself.
 */
export async function recordUsage(account: Account): Promise<void> {
  const stamp = new Date().toISOString();
  const id = crypto.randomUUID();
  // Blob refuses an empty body, so each marker carries the one thing worth
  // having if these are ever read rather than counted: when it happened.
  const options = { access: 'public' as const, addRandomSuffix: false, contentType: 'text/plain' };
  // Two markers: one against the account's monthly allowance, one against the
  // day's global ceiling. Separate prefixes because they are counted over
  // different windows.
  await Promise.all([
    put(`accounts/${month()}/${account.key}/${id}`, stamp, options),
    put(`usage/${today()}/${id}`, stamp, options),
  ]);
}
