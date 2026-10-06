/**
 * CloudHost247 Digital Marketing services — managed campaign engagements.
 *
 * Two integrity rules run through this module:
 *
 *  1. **A channel is only "connected" after a real check.** `marketing_channel_connections.status`
 *     is written by `refreshChannelConnection`, which verifies that the provider key is registered
 *     in the AI & Integrations centre; nothing infers a connection from configuration intent.
 *  2. **A report metric always names its source.** `recordMetrics` refuses a metric without one, and
 *     a period with no connected source is stored as `unavailable` (rendered as "no source
 *     connected") rather than as zeros that read like measured performance.
 *
 * Billing goes through the existing commerce stack: a campaign engagement bought as a packaged
 * tier creates an order → invoice → (on verified payment) a `marketing_campaigns.status = planning`
 * transition from the shared fulfilment hook. Email campaigns delegate sending to the platform's
 * existing email marketing engine — this module never becomes a second mailer.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { createNotification } from '../services/notification-service';

export type CampaignStatus =
  | 'requested' | 'planning' | 'active' | 'paused' | 'reporting' | 'completed'
  | 'rejected' | 'cancelled' | 'failed';

const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  requested: ['planning', 'rejected', 'cancelled'],
  planning: ['active', 'cancelled', 'failed'],
  active: ['paused', 'reporting', 'completed', 'failed', 'cancelled'],
  paused: ['active', 'cancelled', 'failed'],
  reporting: ['active', 'completed', 'paused'],
  completed: [],
  rejected: [],
  cancelled: [],
  failed: ['planning', 'cancelled'],
};

export const MARKETING_CHANNELS = [
  'seo', 'search_ads', 'social', 'email', 'advertising', 'analytics', 'content', 'conversion',
] as const;

/** Which AI & Integrations provider keys can serve each channel. Empty = no provider needed. */
export const CHANNEL_PROVIDERS: Record<string, string[]> = {
  seo: ['google_search_console', 'ahrefs', 'semrush'],
  search_ads: ['google_ads', 'bing_ads'],
  social: ['meta_business', 'linkedin_ads'],
  email: ['cpanel_smtp'],
  advertising: ['google_ads', 'meta_business'],
  analytics: ['google_analytics', 'plausible'],
  content: [],
  conversion: ['google_analytics', 'google_tag_manager'],
};

export function providerKeysFor(channel: string): string[] {
  return CHANNEL_PROVIDERS[channel] ?? [];
}

/**
 * Where each integration's credential lives. A channel is only ever shown "connected" when the
 * environment actually holds the credential for its provider — there is no "assume it works" path,
 * and no secret is stored on the channel row.
 */
export const CHANNEL_PROVIDER_ENV: Record<string, string> = {
  google_search_console: 'MARKETING_PROVIDER_GOOGLE_SEARCH_CONSOLE_TOKEN',
  ahrefs: 'MARKETING_PROVIDER_AHREFS_TOKEN',
  semrush: 'MARKETING_PROVIDER_SEMRUSH_TOKEN',
  google_ads: 'MARKETING_PROVIDER_GOOGLE_ADS_TOKEN',
  bing_ads: 'MARKETING_PROVIDER_BING_ADS_TOKEN',
  meta_business: 'MARKETING_PROVIDER_META_BUSINESS_TOKEN',
  linkedin_ads: 'MARKETING_PROVIDER_LINKEDIN_ADS_TOKEN',
  google_analytics: 'MARKETING_PROVIDER_GOOGLE_ANALYTICS_TOKEN',
  plausible: 'MARKETING_PROVIDER_PLAUSIBLE_TOKEN',
  google_tag_manager: 'MARKETING_PROVIDER_GOOGLE_TAG_MANAGER_TOKEN',
  // Email campaigns go out through the platform's own transport, exactly like notifications do.
  cpanel_smtp: 'NOTIFICATION_EMAIL_WEBHOOK_URL',
};

/** The provider keys whose credentials are present right now. */
export function configuredProviderKeys(source: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(CHANNEL_PROVIDER_ENV)
    .filter(([providerKey]) => {
      const variable = CHANNEL_PROVIDER_ENV[providerKey];
      return Boolean(variable && source[variable]);
    })
    .map(([providerKey]) => providerKey);
}

/** What an operator must set to make a provider available — shown in the admin UI, verbatim. */
export function requiredEnvFor(providerKey: string): string | null {
  return CHANNEL_PROVIDER_ENV[providerKey] ?? null;
}

/* --------------------------------------------------------------------------------------------
 * Offerings and channel connections
 * ------------------------------------------------------------------------------------------ */

export async function listOfferings(db: Queryable, includeUnpublished = false) {
  const { rows } = await db.query(
    `SELECT id, code, name, channel, summary, description, deliverables, starting_price_amount, currency,
            billing_period, min_term_months, status, sort_order
       FROM marketing_service_offerings
      ${includeUnpublished ? '' : `WHERE status = 'published'`}
      ORDER BY sort_order ASC, name ASC`
  );
  return rows;
}

export async function upsertOffering(
  db: Queryable,
  input: {
    code?: string;
    name: string;
    channel: string;
    summary?: string;
    description?: string;
    deliverables?: string[];
    startingPriceAmount?: number | null;
    billingPeriod?: 'one_time' | 'monthly' | 'quarterly' | 'semi_annually' | 'annually';
    minTermMonths?: number;
    status?: 'draft' | 'published' | 'archived';
    sortOrder?: number;
  },
  existingId?: string
) {
  if (!MARKETING_CHANNELS.includes(input.channel as (typeof MARKETING_CHANNELS)[number])) {
    throw new ValidationError('Choose a supported marketing channel');
  }
  const name = input.name.trim().slice(0, 160);
  if (!name) throw new ValidationError('A service needs a name');
  const deliverables = (input.deliverables ?? []).slice(0, 20).map((item) => item.trim().slice(0, 200)).filter(Boolean);
  const price = input.startingPriceAmount === undefined || input.startingPriceAmount === null ? null : input.startingPriceAmount.toFixed(2);

  if (existingId) {
    const { rows } = await db.query(
      `UPDATE marketing_service_offerings SET
          name = $2, channel = $3, summary = COALESCE($4, summary), description = COALESCE($5, description),
          deliverables = $6, starting_price_amount = $7, billing_period = COALESCE($8, billing_period),
          min_term_months = COALESCE($9, min_term_months), status = COALESCE($10, status),
          sort_order = COALESCE($11, sort_order), updated_at = now()
        WHERE id = $1 RETURNING id, code, name, channel, status, billing_period, starting_price_amount`,
      [
        existingId,
        name,
        input.channel,
        input.summary ?? null,
        input.description ?? null,
        JSON.stringify(deliverables),
        price,
        input.billingPeriod ?? null,
        input.minTermMonths ?? null,
        input.status ?? null,
        input.sortOrder ?? null,
      ]
    );
    if (!rows[0]) throw new NotFoundError('No marketing service was found with that id');
    return rows[0];
  }

  const code = (input.code ?? name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  const { rows } = await db.query(
    `INSERT INTO marketing_service_offerings
       (id, code, name, channel, summary, description, deliverables, starting_price_amount, currency,
        billing_period, min_term_months, status, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11,$12)
     ON CONFLICT (lower(code)) DO NOTHING
     RETURNING id, code, name, channel, status, billing_period, starting_price_amount`,
    [
      randomUUID(),
      code,
      name,
      input.channel,
      (input.summary ?? '').slice(0, 500),
      (input.description ?? '').slice(0, 6000),
      JSON.stringify(deliverables),
      price,
      input.billingPeriod ?? 'monthly',
      input.minTermMonths ?? 1,
      input.status ?? 'draft',
      input.sortOrder ?? 0,
    ]
  );
  if (!rows[0]) throw new ConflictError('A marketing service with that code already exists');
  return rows[0];
}

export interface MarketingChannelConnectionRow {
  id: string;
  channel: string;
  name: string;
  provider_key: string;
  status: string;
  last_checked_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

export async function listChannelConnections(db: Queryable): Promise<MarketingChannelConnectionRow[]> {
  const { rows } = await db.query<MarketingChannelConnectionRow>(
    `SELECT id, channel, name, provider_key, status, last_checked_at, last_error_code, last_error_message
       FROM marketing_channel_connections ORDER BY channel ASC, name ASC`
  );
  return rows;
}

/**
 * Records a channel connection and refreshes its status from the integration registry.
 * `registeredProviderKeys` is supplied by the caller from the AI & Integrations centre, so this
 * function cannot invent a connection the platform does not have.
 */
export async function upsertChannelConnection(
  db: Queryable,
  input: { channel: string; name?: string; providerKey: string; registeredProviderKeys: readonly string[] }
) {
  if (!MARKETING_CHANNELS.includes(input.channel as (typeof MARKETING_CHANNELS)[number])) {
    throw new ValidationError('Choose a supported marketing channel');
  }
  const allowed = providerKeysFor(input.channel);
  if (allowed.length > 0 && !allowed.includes(input.providerKey)) {
    throw new ValidationError(`"${input.providerKey}" is not a supported integration for the ${input.channel} channel`);
  }
  const registered = input.registeredProviderKeys.includes(input.providerKey);
  const status = registered ? 'connected' : 'not_configured';
  const variable = requiredEnvFor(input.providerKey);
  const message = registered
    ? null
    : variable
      ? `No credential is configured for ${input.providerKey} yet. Set ${variable} in the server environment (or connect the integration in Admin → API & Integrations) to activate this channel.`
      : `${input.providerKey} has no credential slot on this platform yet, so the channel stays inactive.`;

  const { rows } = await db.query<{
    id: string;
    channel: string;
    name: string;
    provider_key: string;
    status: string;
    last_checked_at: string;
    last_error_code: string | null;
    last_error_message: string | null;
  }>(
    `INSERT INTO marketing_channel_connections (id, channel, name, provider_key, status, last_checked_at, last_error_code, last_error_message)
     VALUES ($1,$2,$3,$4,$5,now(),$6,$7)
     ON CONFLICT (channel, provider_key) DO UPDATE SET
       name = EXCLUDED.name, status = EXCLUDED.status, last_checked_at = now(),
       last_error_code = EXCLUDED.last_error_code, last_error_message = EXCLUDED.last_error_message, updated_at = now()
     RETURNING id, channel, name, provider_key, status, last_checked_at, last_error_code, last_error_message`,
    [
      randomUUID(),
      input.channel,
      (input.name ?? input.providerKey).slice(0, 120),
      input.providerKey,
      status,
      registered ? null : 'NOT_CONFIGURED',
      message,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('upsertChannelConnection: upsert returned no row');
  return row;
}

/* --------------------------------------------------------------------------------------------
 * Campaigns
 * ------------------------------------------------------------------------------------------ */

export async function createCampaign(
  db: Queryable,
  userId: string,
  input: {
    offeringCode: string;
    name: string;
    goal: string;
    targetUrl?: string | null;
    targetAudience?: string | null;
    monthlyBudgetAmount?: number | null;
  }
) {
  const { rows: offeringRows } = await db.query<{ id: string; code: string; channel: string; status: string }>(
    `SELECT id, code, channel, status FROM marketing_service_offerings WHERE lower(code) = lower($1) LIMIT 1`,
    [input.offeringCode]
  );
  const offering = offeringRows[0];
  if (!offering || offering.status !== 'published') throw new NotFoundError('No such CloudHost247 marketing service is available');

  const name = input.name.trim().slice(0, 200);
  const goal = input.goal.trim();
  if (name.length < 3) throw new ValidationError('Name the campaign');
  if (goal.length < 20) throw new ValidationError('Describe the goal in at least 20 characters');
  if (input.targetUrl && !/^https:\/\//.test(input.targetUrl)) throw new ValidationError('The target URL must be an https:// address');
  if (input.monthlyBudgetAmount !== undefined && input.monthlyBudgetAmount !== null && !(input.monthlyBudgetAmount >= 0)) {
    throw new ValidationError('A budget cannot be negative');
  }

  const id = randomUUID();
  const reference = `MKT-${randomBytes(4).toString('hex').toUpperCase()}`;
  await withTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO marketing_campaigns
         (id, reference, user_id, offering_id, offering_code, channel, name, goal, target_url, target_audience,
          monthly_budget_amount, currency, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'USD','requested')`,
      [
        id,
        reference,
        userId,
        offering.id,
        offering.code,
        offering.channel,
        name,
        goal,
        input.targetUrl ?? null,
        input.targetAudience?.slice(0, 2000) ?? null,
        input.monthlyBudgetAmount === undefined || input.monthlyBudgetAmount === null ? null : input.monthlyBudgetAmount.toFixed(2),
      ]
    );
    await tx.query(
      `INSERT INTO marketing_campaign_events (id, campaign_id, event_type, actor_id, actor_role, to_status)
       VALUES ($1,$2,'campaign_requested',$3,'customer','requested')`,
      [randomUUID(), id, userId]
    );
    await tx.query(
      `INSERT INTO marketing_campaign_messages (id, campaign_id, author_id, author_role, visibility, body)
       VALUES ($1,$2,$3,'customer','customer',$4)`,
      [randomUUID(), id, userId, goal]
    );
  });

  const { rows: staff } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE role IN ('staff','admin','super_admin') AND status = 'active' LIMIT 25`
  );
  for (const user of staff) {
    await createNotification(db, {
      userId: user.id,
      type: 'MARKETING_CAMPAIGN_QUEUE',
      title: `New marketing campaign request ${reference}`,
      message: `${name} (${offering.channel})\nOpen Admin → Marketing to plan it.`,
      resourceType: 'marketing_campaign',
      resourceId: id,
    });
  }
  return { id, reference };
}

export async function listMyCampaigns(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT c.id, c.reference, c.offering_code, c.channel, c.name, c.status, c.monthly_budget_amount, c.currency,
            c.started_at, c.ends_at, c.completed_at, c.order_id, c.subscription_id, c.created_at, c.updated_at,
            o.name AS offering_name,
            (SELECT count(*)::int FROM marketing_report_periods p WHERE p.campaign_id = c.id AND p.status = 'published') AS published_report_count
       FROM marketing_campaigns c
       LEFT JOIN marketing_service_offerings o ON o.id = c.offering_id
      WHERE c.user_id = $1 ORDER BY c.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getCampaignForCustomer(db: Queryable, userId: string, campaignId: string) {
  const { rows } = await db.query(
    `SELECT c.*, o.name AS offering_name, o.deliverables AS offering_deliverables
       FROM marketing_campaigns c LEFT JOIN marketing_service_offerings o ON o.id = c.offering_id
      WHERE c.id = $1 AND c.user_id = $2 LIMIT 1`,
    [campaignId, userId]
  );
  const campaign = rows[0];
  if (!campaign) throw new NotFoundError('No campaign was found with that id');
  const { rows: messages } = await db.query(
    `SELECT id, author_role, body, created_at FROM marketing_campaign_messages
      WHERE campaign_id = $1 AND visibility = 'customer' ORDER BY created_at ASC`,
    [campaignId]
  );
  const { rows: timeline } = await db.query(
    `SELECT event_type, from_status, to_status, created_at FROM marketing_campaign_events WHERE campaign_id = $1 ORDER BY created_at ASC`,
    [campaignId]
  );
  const { rows: reports } = await db.query(
    `SELECT p.id, p.period_start, p.period_end, p.status, p.summary, p.published_at,
            (SELECT COALESCE(json_agg(json_build_object(
               'key', m.metric_key, 'label', m.metric_label, 'value', m.value, 'unit', m.unit,
               'source', m.source, 'estimated', m.is_estimated) ORDER BY m.metric_label), '[]'::json)
               FROM marketing_report_metrics m WHERE m.period_id = p.id) AS metrics
       FROM marketing_report_periods p WHERE p.campaign_id = $1 ORDER BY p.period_start DESC LIMIT 24`,
    [campaignId]
  );
  return { campaign, messages, timeline, reports };
}

export async function addCampaignMessage(db: Queryable, userId: string, campaignId: string, body: string) {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM marketing_campaigns WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [campaignId, userId]
  );
  if (!rows[0]) throw new NotFoundError('No campaign was found with that id');
  const text = body.trim();
  if (!text) throw new ValidationError('Write a message first');
  const { rows: message } = await db.query(
    `INSERT INTO marketing_campaign_messages (id, campaign_id, author_id, author_role, visibility, body)
     VALUES ($1,$2,$3,'customer','customer',$4) RETURNING id, author_role, body, created_at`,
    [randomUUID(), campaignId, userId, text.slice(0, 8000)]
  );
  return message[0];
}

/* --------------------------------------------------------------------------------------------
 * Staff / admin
 * ------------------------------------------------------------------------------------------ */

export async function listCampaignsForStaff(db: Queryable, filter: { status?: string; search?: string; limit?: number; offset?: number } = {}) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.status) {
    params.push(filter.status);
    where.push(`c.status = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search.trim().slice(0, 100)}%`);
    where.push(`(c.reference ILIKE $${params.length} OR c.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
  params.push(limit, Math.max(filter.offset ?? 0, 0));
  const { rows } = await db.query(
    `SELECT c.id, c.reference, c.name, c.channel, c.status, c.monthly_budget_amount, c.currency,
            c.assigned_staff_id, c.created_at, u.email AS customer_email, u.full_name AS customer_name,
            (SELECT count(*)::int FROM marketing_report_periods p WHERE p.campaign_id = c.id) AS report_count
       FROM marketing_campaigns c JOIN users u ON u.id = c.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: counts } = await db.query<Record<string, string>>(
    `SELECT status, count(*)::text AS count FROM marketing_campaigns GROUP BY status`
  );
  return { campaigns: rows, counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])) };
}

export async function getCampaignForStaff(db: Queryable, campaignId: string) {
  const { rows } = await db.query(
    `SELECT c.*, u.email AS customer_email, u.full_name AS customer_name
       FROM marketing_campaigns c JOIN users u ON u.id = c.user_id WHERE c.id = $1 LIMIT 1`,
    [campaignId]
  );
  const campaign = rows[0];
  if (!campaign) throw new NotFoundError('No campaign was found with that id');
  const { rows: messages } = await db.query(
    `SELECT id, author_role, visibility, body, created_at FROM marketing_campaign_messages WHERE campaign_id = $1 ORDER BY created_at ASC`,
    [campaignId]
  );
  const { rows: events } = await db.query(
    `SELECT event_type, actor_role, from_status, to_status, metadata, created_at FROM marketing_campaign_events
      WHERE campaign_id = $1 ORDER BY created_at ASC`,
    [campaignId]
  );
  const { rows: reports } = await db.query(
    `SELECT p.id, p.period_start, p.period_end, p.status, p.summary, p.published_at,
            (SELECT COALESCE(json_agg(json_build_object('key', m.metric_key, 'value', m.value, 'unit', m.unit, 'source', m.source)
              ORDER BY m.metric_label), '[]'::json) FROM marketing_report_metrics m WHERE m.period_id = p.id) AS metrics
       FROM marketing_report_periods p WHERE p.campaign_id = $1 ORDER BY p.period_start DESC`,
    [campaignId]
  );
  return { campaign, messages, events, reports };
}

export async function updateCampaignStatus(
  db: Queryable,
  actorId: string,
  campaignId: string,
  status: CampaignStatus,
  options: { note?: string | null } = {}
) {
  const { rows } = await db.query<{ id: string; status: CampaignStatus; user_id: string; reference: string }>(
    `SELECT id, status, user_id, reference FROM marketing_campaigns WHERE id = $1 LIMIT 1`,
    [campaignId]
  );
  const campaign = rows[0];
  if (!campaign) throw new NotFoundError('No campaign was found with that id');
  if (campaign.status === status) return { status };
  if (!(TRANSITIONS[campaign.status] ?? []).includes(status)) {
    throw new ConflictError(`A campaign cannot move from ${campaign.status} to ${status}`);
  }

  await withTransaction(db, async (tx) => {
    await tx.query(
      // `$2::text` everywhere: PostgreSQL refuses to deduce one type for a parameter that is both
      // compared with literals and assigned to a varchar column ("inconsistent types deduced").
      `UPDATE marketing_campaigns SET
          status = $2::text,
          started_at = CASE WHEN $2::text = 'active' AND started_at IS NULL THEN now() ELSE started_at END,
          paused_at = CASE WHEN $2::text = 'paused' THEN now() ELSE paused_at END,
          completed_at = CASE WHEN $2::text = 'completed' THEN now() ELSE completed_at END,
          updated_at = now()
        WHERE id = $1`,
      [campaign.id, status]
    );
    await tx.query(
      `INSERT INTO marketing_campaign_events (id, campaign_id, event_type, actor_id, actor_role, from_status, to_status, metadata)
       VALUES ($1,$2,'status_changed',$3,'staff',$4,$5,$6)`,
      [randomUUID(), campaign.id, actorId, campaign.status, status, JSON.stringify({ note: options.note ?? null })]
    );
  });

  await createNotification(db, {
    userId: campaign.user_id,
    type: `MARKETING_CAMPAIGN_${status.toUpperCase()}`,
    title: `Campaign ${campaign.reference} is now ${status}`,
    message: options.note?.trim() || 'Open your CloudHost247 dashboard for the details.',
    resourceType: 'marketing_campaign',
    resourceId: campaign.id,
  });
  return { status };
}

export async function createReportPeriod(
  db: Queryable,
  actorId: string,
  campaignId: string,
  input: { periodStart: string; periodEnd: string; summary?: string | null; status?: 'pending' | 'collecting' | 'published' | 'unavailable' }
) {
  const start = new Date(input.periodStart);
  const end = new Date(input.periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new ValidationError('Enter a valid reporting period');
  if (end.getTime() < start.getTime()) throw new ValidationError('The period end cannot precede its start');
  const { rows: campaignRows } = await db.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM marketing_campaigns WHERE id = $1 LIMIT 1`,
    [campaignId]
  );
  if (!campaignRows[0]) throw new NotFoundError('No campaign was found with that id');

  const { rows } = await db.query(
    `INSERT INTO marketing_report_periods (id, campaign_id, period_start, period_end, status, summary, created_by, published_at)
     VALUES ($1,$2,$3,$4,$5::text,$6,$7, CASE WHEN $5::text = 'published' THEN now() ELSE NULL END)
     ON CONFLICT (campaign_id, period_start, period_end) DO UPDATE SET
        status = EXCLUDED.status,
        summary = COALESCE(EXCLUDED.summary, marketing_report_periods.summary),
        published_at = CASE WHEN EXCLUDED.status = 'published' THEN now() ELSE marketing_report_periods.published_at END
     RETURNING id, period_start, period_end, status, summary, published_at`,
    [
      randomUUID(),
      campaignId,
      input.periodStart,
      input.periodEnd,
      input.status ?? 'collecting',
      input.summary?.slice(0, 2000) ?? null,
      actorId,
    ]
  );
  return rows[0];
}

/**
 * Records metrics for a period. A metric without a `source` is rejected — that is the rule that
 * keeps an unattributable number out of a customer-facing report.
 */
export async function recordMetrics(
  db: Queryable,
  actorId: string,
  periodId: string,
  metrics: Array<{ key: string; label: string; value: number; unit?: 'count' | 'currency' | 'percent' | 'ratio' | 'seconds'; source: string; estimated?: boolean }>
) {
  const { rows: periodRows } = await db.query<{ id: string; campaign_id: string; status: string }>(
    `SELECT id, campaign_id, status FROM marketing_report_periods WHERE id = $1 LIMIT 1`,
    [periodId]
  );
  const period = periodRows[0];
  if (!period) throw new NotFoundError('No reporting period was found with that id');
  if (!metrics.length) throw new ValidationError('Add at least one metric');
  if (metrics.length > 60) throw new ValidationError('Too many metrics for one period');

  for (const metric of metrics) {
    const key = metric.key.trim().slice(0, 60);
    const label = metric.label.trim().slice(0, 120);
    const source = metric.source.trim().slice(0, 60);
    if (!key || !label) throw new ValidationError('Every metric needs a key and a label');
    if (!source) throw new ValidationError(`"${label}" cannot be recorded without naming which integration reported it`);
    if (!Number.isFinite(metric.value)) throw new ValidationError(`"${label}" needs a numeric value`);
    const unit = metric.unit ?? 'count';
    await db.query(
      `INSERT INTO marketing_report_metrics (id, period_id, metric_key, metric_label, value, unit, source, is_estimated)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (period_id, metric_key, source) DO UPDATE SET
         value = EXCLUDED.value, metric_label = EXCLUDED.metric_label, unit = EXCLUDED.unit, is_estimated = EXCLUDED.is_estimated`,
      [randomUUID(), period.id, key, label, metric.value, unit, source, metric.estimated ?? false]
    );
  }

  await db.query(`UPDATE marketing_report_periods SET status = 'published', published_at = now() WHERE id = $1`, [period.id]);
  void actorId;
  return { periodId, metricCount: metrics.length };
}

export async function addStaffCampaignMessage(
  db: Queryable,
  actorId: string,
  campaignId: string,
  input: { body: string; visibility: 'customer' | 'internal' }
) {
  const { rows } = await db.query<{ id: string; user_id: string; reference: string }>(
    `SELECT id, user_id, reference FROM marketing_campaigns WHERE id = $1 LIMIT 1`,
    [campaignId]
  );
  const campaign = rows[0];
  if (!campaign) throw new NotFoundError('No campaign was found with that id');
  const body = input.body.trim();
  if (!body) throw new ValidationError('Write a message first');
  const { rows: message } = await db.query(
    `INSERT INTO marketing_campaign_messages (id, campaign_id, author_id, author_role, visibility, body)
     VALUES ($1,$2,$3,'staff',$4,$5) RETURNING id, author_role, visibility, body, created_at`,
    [randomUUID(), campaign.id, actorId, input.visibility, body.slice(0, 8000)]
  );
  if (input.visibility === 'customer') {
    await createNotification(db, {
      userId: campaign.user_id,
      type: 'MARKETING_CAMPAIGN_MESSAGE',
      title: `New message on ${campaign.reference}`,
      message: body.slice(0, 280),
      resourceType: 'marketing_campaign',
      resourceId: campaign.id,
    });
  }
  return message[0];
}
