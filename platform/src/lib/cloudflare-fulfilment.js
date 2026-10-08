/**
 * Cloudflare actions that were promised at checkout — and the settlement that keeps the promise.
 *
 * Two routes in `domains/cloudflare.js` took a customer's money-adjacent request and answered with a
 * sentence nothing implemented:
 *
 *  - `POST /cloudflare/orders` — "The Cloudflare service will be provisioned automatically after
 *    payment is confirmed." No service row was created and no zone was ever asked for.
 *  - `POST /cloudflare/services/:id/plan/change` (paid path) — an invoice was issued and a
 *    `cloudflare_jobs` row was queued, and no worker existed to read it.
 *
 * Both now record an explicit, itemised intent in `cloudflare_jobs` with the status
 * **`awaiting_payment`** (not `queued` — a queued job implies a runner, and there was none), carrying
 * the `orderId` they are waiting on. `billing-apply.js` calls `fulfillPendingCloudflareActions` once
 * the payment has been applied, and this module performs the work:
 *
 *  - `provision_zone` — create the zone at Cloudflare, then create the customer's service row from
 *    *Cloudflare's* answer (zone id, nameservers, activation status). Nothing is invented.
 *  - `plan_change` — apply the new plan mapping to the service.
 *
 * Failure policy, stated because it matters: money has already moved by the time this runs, so a
 * provider failure **must not** fail the payment. The job is marked `failed` with the sanitized
 * evidence, the service is left alone, and an operator can retry it from Admin → Cloudflare. A
 * fulfilled job is marked `succeeded` with the outcome recorded beside it, so the job list is a
 * record of what actually happened rather than of what was hoped for.
 */
'use strict';

const { uuidv7 } = require('./ids');
const { clientForAccount } = require('./cloudflare-service');
const { errorEvidence } = require('./cloudflare-client');

const AWAITING_PAYMENT = 'awaiting_payment';

/** Record an action that is waiting on a specific order's payment. */
async function recordPendingAction(store, { kind, orderId, serviceId = null, accountId = null, payload = {} }) {
  return store.table('cloudflare_jobs').insert({
    id: uuidv7(),
    account_id: accountId,
    service_id: serviceId,
    kind,
    type: kind,
    status: AWAITING_PAYMENT,
    payload: { orderId, ...payload },
  });
}

/** Apply a plan mapping to a service. Local by design: the mapping is the platform's own entitlement model. */
async function applyPlanChange(store, service, mapping) {
  const before = { planId: service.plan_id ?? null, cloudflarePlan: service.cloudflare_plan ?? null };
  const updated = await store.table('cloudflare_services').updateById(service.id, {
    plan_id: mapping.plan_id ?? mapping.id,
    cloudflare_plan: mapping.cloudflare_plan ?? service.cloudflare_plan ?? 'free',
    plan_name: mapping.plan_name ?? null,
  });
  return { before, after: { planId: updated.plan_id ?? null, cloudflarePlan: updated.cloudflare_plan ?? null } };
}

/**
 * Settle every Cloudflare action waiting on a now-paid order.
 *
 * @param {object} store  the store (or transaction store) the payment is being applied in
 * @param {object} deps   `{ config, logger, store }` — what a Cloudflare client needs to be built
 * @returns {Promise<{ fulfilled: object[], failed: object[] }>}
 */
async function fulfillPendingCloudflareActions(store, deps) {
  const fulfilled = [];
  const failed = [];
  const jobs = (await store.table('cloudflare_jobs').all()).filter((job) => job.status === AWAITING_PAYMENT);
  if (jobs.length === 0) return { fulfilled, failed };

  const orders = await store.table('orders').all();
  const orderById = new Map(orders.map((order) => [order.id, order]));

  for (const job of jobs) {
    const orderId = job.payload?.orderId ?? null;
    const order = orderId ? orderById.get(orderId) : null;
    // Anything still unpaid stays exactly where it is — the job is the evidence that the action is
    // owed, and marking it failed would erase a promise the customer paid attention to.
    if (!order || order.status !== 'paid') continue;

    try {
      if (job.kind === 'provision_zone') {
        const outcome = await provisionZoneFromJob(store, deps, job);
        fulfilled.push({ jobId: job.id, kind: job.kind, ...outcome });
      } else if (job.kind === 'plan_change') {
        const service = await store.table('cloudflare_services').findById(job.service_id);
        if (!service) throw new Error('the service this plan change belongs to no longer exists');
        const mapping = await store.table('cloudflare_plan_mappings').findById(job.payload?.planId)
          ?? await store.table('cloudflare_plan_mappings').findOne({ plan_id: job.payload?.planId });
        if (!mapping) throw new Error('the plan this change targets no longer exists');
        const change = await applyPlanChange(store, service, mapping);
        fulfilled.push({ jobId: job.id, kind: job.kind, serviceId: service.id, ...change });
      } else {
        // An unknown kind is not silently completed: the platform cannot claim to have done work it
        // does not recognise.
        throw new Error(`unrecognised pending Cloudflare action kind '${job.kind}'`);
      }
      await store.table('cloudflare_jobs').updateById(job.id, {
        status: 'succeeded',
        payload: { ...job.payload, outcome: 'fulfilled_after_payment' },
      });
    } catch (error) {
      const evidence = errorEvidence(error);
      await store.table('cloudflare_jobs').updateById(job.id, {
        status: 'failed',
        payload: { ...job.payload, failure: { ...evidence, reason: String(error?.message ?? 'unknown').slice(0, 300) } },
      });
      deps?.logger?.warn?.(
        { jobId: job.id, kind: job.kind, orderId, failureCode: evidence.code },
        'pending cloudflare action could not be fulfilled after payment',
      );
      failed.push({ jobId: job.id, kind: job.kind, failureCode: evidence.code });
    }
  }

  return { fulfilled, failed };
}

/**
 * Create a customer's zone and service row from a `provision_zone` job.
 *
 * Idempotent on the zone name: a retried fulfilment looks the zone up before creating anything, so a
 * crash between the Cloudflare call and the local insert cannot leave two zones for one order.
 */
async function provisionZoneFromJob(store, deps, job) {
  const { zoneName, userId, planId } = job.payload ?? {};
  if (!zoneName || !userId) throw new Error('the pending provision has no zone name or owner recorded');

  const existing = (await store.table('cloudflare_services').all())
    .find((s) => s.zone_name === zoneName && s.user_id === userId && s.status !== 'terminated');
  if (existing?.zone_id) return { serviceId: existing.id, zoneId: existing.zone_id, alreadyProvisioned: true };

  const account = job.account_id
    ? await store.table('cloudflare_accounts').findById(job.account_id)
    : null;
  if (!account) throw new Error('the Cloudflare account this order was placed against no longer exists');

  const client = clientForAccount(deps, account, existing?.id ?? null);
  let zone = await client.findZoneByName(zoneName);
  if (!zone) {
    zone = await client.createZone({
      name: zoneName,
      accountId: account.cloudflare_account_id ?? account.account_id,
      type: account.default_zone_type ?? 'full',
    });
  }
  if (!zone.id) throw new Error('Cloudflare accepted the zone request but returned no zone id');

  const mapping = planId
    ? (await store.table('cloudflare_plan_mappings').findById(planId) ?? await store.table('cloudflare_plan_mappings').findOne({ plan_id: planId }))
    : null;

  const fields = {
    user_id: userId,
    account_id: account.id,
    zone_name: zoneName,
    zone_id: zone.id,
    name_server_1: zone.nameServers[0] ?? null,
    name_server_2: zone.nameServers[1] ?? null,
    activation_status: zone.activationStatus,
    status: 'active',
    plan_id: mapping?.plan_id ?? planId ?? null,
    cloudflare_plan: mapping?.cloudflare_plan ?? null,
    plan_name: mapping?.plan_name ?? null,
    created_at: new Date().toISOString(),
  };
  const service = existing
    ? await store.table('cloudflare_services').updateById(existing.id, fields)
    : await store.table('cloudflare_services').insert({ id: uuidv7(), ...fields });
  return { serviceId: service.id, zoneId: zone.id, nameservers: zone.nameservers ?? zone.nameServers, created: !existing };
}

module.exports = {
  recordPendingAction,
  applyPlanChange,
  fulfillPendingCloudflareActions,
  provisionZoneFromJob,
  AWAITING_PAYMENT,
};
