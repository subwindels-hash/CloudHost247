/**
 * Platform-service entitlements.
 *
 * A customer's limits come from, in order of precedence:
 *   1. the highest published `platform_service_plans` row they have an ACTIVE subscription for
 *      (the tier they actually bought — the subscription's own `platform_plan_id`);
 *   2. otherwise the free tier, whose sizes are platform settings an admin controls
 *      (`platform.free_limits.*`).
 *
 * Two rules, both deliberately strict:
 *   - A limit is only ever read from a row that exists. There is no hardcoded "premium" fallback,
 *     so publishing a tier in Admin → Platform Services is what changes what customers get.
 *   - An entitlement check either passes or throws. No caller silently degrades a purchase, and no
 *     UI claims a limit the server will not honour.
 */
import type { Queryable } from '../db/types';
import { ForbiddenError } from '../lib/errors';
import { getSetting } from '../db/ops-tables';
import { parseLimits, type PlatformServiceKind } from '../commerce/platform-plans';

export interface SiteLimits {
  sites: number;
  pagesPerSite: number;
  aiGenerationsPerMonth: number;
  mediaPerSite: number;
  planCode: string;
}

export interface StoreLimits {
  stores: number;
  productsPerStore: number;
  planCode: string;
}

export interface InboxLimits {
  channels: number;
  seats: number;
  planCode: string;
}

/** Free-tier defaults. Admin-configurable, published in the UI, and never a hidden cap. */
export const FREE_TIER_DEFAULTS = {
  sites: 1,
  pagesPerSite: 10,
  aiGenerationsPerMonth: 3,
  mediaPerSite: 50,
  stores: 1,
  productsPerStore: 25,
  channels: 2,
  seats: 2,
} as const;

interface EntitledPlan {
  code: string;
  limits: Record<string, number>;
}

/**
 * The customer's best active platform plan for a service kind. "Best" is the one granting the
 * largest value for the requested limit key, so holding two tiers never accidentally gives the
 * customer the smaller one.
 */
async function activePlatformPlan(
  db: Queryable,
  userId: string,
  serviceKind: PlatformServiceKind,
  limitKey: string
): Promise<EntitledPlan | null> {
  const { rows } = await db.query<{ code: string; limits: Record<string, number> }>(
    `SELECT p.code, p.limits
       FROM subscriptions s
       JOIN platform_service_plans p ON p.id = s.platform_plan_id
      WHERE s.customer_id = $1
        AND s.status IN ('active', 'trialing')
        AND p.service_kind = $2
        AND p.status = 'published'`,
    [userId, serviceKind]
  );
  let best: EntitledPlan | null = null;
  for (const row of rows) {
    const limits = parseLimits(row.limits);
    if (limits[limitKey] === undefined) continue;
    if (!best || (best.limits[limitKey] ?? 0) < limits[limitKey]) {
      best = { code: row.code, limits };
    }
  }
  return best;
}

export async function getSiteLimits(db: Queryable, userId: string): Promise<SiteLimits> {
  const plan = await activePlatformPlan(db, userId, 'website_builder', 'sites');
  const freeSites = await getSetting<number>(db, 'platform.free_limits.sites', FREE_TIER_DEFAULTS.sites);
  const freePages = await getSetting<number>(db, 'platform.free_limits.pages_per_site', FREE_TIER_DEFAULTS.pagesPerSite);
  const freeAi = await getSetting<number>(db, 'platform.free_limits.ai_generations_per_month', FREE_TIER_DEFAULTS.aiGenerationsPerMonth);
  const freeMedia = await getSetting<number>(db, 'platform.free_limits.media_per_site', FREE_TIER_DEFAULTS.mediaPerSite);

  return {
    sites: plan?.limits.sites ?? freeSites,
    pagesPerSite: plan?.limits.pagesPerSite ?? plan?.limits.pages ?? freePages,
    aiGenerationsPerMonth: await aiAllowance(db, userId, plan, freeAi),
    mediaPerSite: plan?.limits.mediaPerSite ?? plan?.limits.media ?? freeMedia,
    planCode: plan?.code ?? 'free',
  };
}

/**
 * The AI generation allowance is the larger of the Website Builder tier's allowance and the
 * dedicated AI Website Builder tier's allowance — the two products meter the same capability, so a
 * customer who bought either one gets the best of what they bought.
 */
async function aiAllowance(
  db: Queryable,
  userId: string,
  sitePlan: EntitledPlan | null,
  freeAi: number
): Promise<number> {
  const aiPlan = await activePlatformPlan(db, userId, 'ai_builder', 'aiGenerationsPerMonth');
  const candidates = [
    sitePlan?.limits.aiGenerationsPerMonth,
    aiPlan?.limits.aiGenerationsPerMonth,
    freeAi,
  ].filter((value): value is number => typeof value === 'number' && value > 0);
  return candidates.length ? Math.max(...candidates) : freeAi;
}

export async function getStoreLimits(db: Queryable, userId: string): Promise<StoreLimits> {
  const plan = await activePlatformPlan(db, userId, 'online_store', 'products');
  const freeStores = await getSetting<number>(db, 'platform.free_limits.stores', FREE_TIER_DEFAULTS.stores);
  const freeProducts = await getSetting<number>(db, 'platform.free_limits.products_per_store', FREE_TIER_DEFAULTS.productsPerStore);
  return {
    stores: plan?.limits.stores ?? freeStores,
    productsPerStore: plan?.limits.products ?? freeProducts,
    planCode: plan?.code ?? 'free',
  };
}

export async function getInboxLimits(db: Queryable, userId: string): Promise<InboxLimits> {
  const plan = await activePlatformPlan(db, userId, 'inbox', 'channels');
  const freeChannels = await getSetting<number>(db, 'platform.free_limits.inbox_channels', FREE_TIER_DEFAULTS.channels);
  const freeSeats = await getSetting<number>(db, 'platform.free_limits.inbox_seats', FREE_TIER_DEFAULTS.seats);
  return {
    channels: plan?.limits.channels ?? freeChannels,
    seats: plan?.limits.seats ?? freeSeats,
    planCode: plan?.code ?? 'free',
  };
}

/** Throws a customer-facing 403 when `current + adding` would exceed `limit`. */
export function assertEntitlement(limit: number, current: number, adding: number, label: string, planCode: string): void {
  if (current + adding <= limit) return;
  throw new ForbiddenError(
    `Your CloudHost247 plan (${planCode}) includes ${limit} ${label}. ` +
      `You are using ${current}. Upgrade your plan to add more.`
  );
}

/**
 * Counts AI generations inside the current calendar month for a user — the metering basis for the
 * allowance above. Counted from the ledger table, so a restart, a redeploy or a second app process
 * cannot reset it.
 */
export async function countAiGenerationsThisMonth(db: Queryable, userId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ai_site_generations
      WHERE user_id = $1 AND status = 'succeeded' AND created_at >= date_trunc('month', now())`,
    [userId]
  );
  return Number(rows[0]?.count ?? '0');
}
