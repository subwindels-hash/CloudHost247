/**
 * The raw subscription row as the original returns it (db/ops-tables.ts updateSubscription).
 *
 * This schema names the owner column user_id where the source calls it customer_id, and the
 * lifecycle fields (cancel_at_period_end, cancelled_at, past_due_since, suspended_at,
 * terminated_at, grace_period_days, provider_subscription_id, installation_id) are carried on the
 * same table, so the row is mapped back to the source's column names on the way out.
 */
'use strict';

function subscriptionRow(s) {
  return {
    id: s.id,
    customer_id: s.user_id,
    plan_id: s.plan_id ?? null,
    status: s.status,
    current_period_start: s.current_period_start ?? null,
    current_period_end: s.current_period_end ?? null,
    cancel_at_period_end: s.cancel_at_period_end ?? false,
    cancelled_at: s.cancelled_at ?? null,
    past_due_since: s.past_due_since ?? null,
    suspended_at: s.suspended_at ?? null,
    terminated_at: s.terminated_at ?? null,
    grace_period_days: s.grace_period_days ?? null,
    provider_subscription_id: s.provider_subscription_id ?? null,
    installation_id: s.installation_id ?? null,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

module.exports = { subscriptionRow };
