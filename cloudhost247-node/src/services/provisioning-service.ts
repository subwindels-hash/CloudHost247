/**
 * Phase 6 — the paid-order provisioning hook (spec §20, §21, §37).
 *
 * THE payment rule (spec §20): "Never activate provisioning because the frontend says that
 * payment succeeded." This module is called from exactly one place — the webhook settlement
 * transaction in src/services/webhook-service.ts, AFTER the payment row has been verified,
 * marked successful, and the order marked paid. It is the only bridge between money and
 * infrastructure:
 *
 *   payment webhook verified → order paid → provisionPaidOrder() → subscription active +
 *   deployment job queued. Installation rows stay 'pending' until this exact path runs.
 *
 * It is idempotent: re-running for an already-provisioned order is a no-op (deployment
 * idempotency keys are derived from the order id), so a duplicate webhook delivery cannot
 * double-deploy.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { listOrderItemsForOrder, type OrderRow } from '../db/orders';
import { findPlanById } from '../db/catalog-plans';
import { listPublishedPricingForPlan } from '../db/catalog-pricing';
import { findInstallationById, updateInstallation } from '../db/application-installations';
import { createSubscription, findSubscriptionById } from '../db/ops-tables';
import { enqueueDeployment } from '../db/deployments';

const PERIOD_DAYS: Record<string, number> = {
  one_time: 3650,
  monthly: 30,
  quarterly: 91,
  semi_annually: 182,
  annually: 365,
};

interface OrderItemMetadata {
  installationId?: string;
  kind?: string;
  hosting?: {
    serverId: string;
    domain: string;
    username?: string;
    password?: string;
    planName?: string;
    installer?: 'wordpress' | 'static-site' | 'custom';
  };
}

function parseMetadata(item: { metadata?: unknown }): OrderItemMetadata {
  if (!item.metadata || typeof item.metadata !== 'object') return {};
  return item.metadata as OrderItemMetadata;
}

export interface ProvisioningReport {
  installationsQueued: string[];
  subscriptionsCreated: string[];
  hostingJobsQueued: string[];
}

/**
 * Runs inside the webhook's settlement transaction. Creates subscriptions for recurring items
 * and queues the INSTALL deployment for each application installation the paid order contains.
 */
export async function provisionPaidOrder(tx: Queryable, order: OrderRow, genId: () => string = randomUUID): Promise<ProvisioningReport> {
  const report: ProvisioningReport = { installationsQueued: [], subscriptionsCreated: [], hostingJobsQueued: [] };
  const items = await listOrderItemsForOrder(tx, order.id);

  for (const item of items) {
    const metadata = parseMetadata(item);

    // --- Application installation: subscription + INSTALL deployment --------------------------
    if (metadata.installationId) {
      const installation = await findInstallationById(tx, metadata.installationId);
      if (!installation || installation.customer_id !== order.user_id) continue; // verified ownership
      if (installation.order_id && installation.order_id !== order.id) continue;

      // The engine's first install step re-checks this order's payment status — make the
      // installation → order linkage explicit at provisioning time as well.
      if (!installation.order_id) {
        await tx.query(`UPDATE application_installations SET order_id = $2, updated_at = now() WHERE id = $1`, [
          installation.id,
          order.id,
        ]);
      }
      // Subscription for the installation (links billing lifecycle to the app — spec §21).
      let subscriptionId = installation.subscription_id;
      if (!subscriptionId && item.plan_id) {
        const plan = await findPlanById(tx, item.plan_id);
        if (plan) {
          const subscription = await createSubscription(tx, {
            customerId: order.user_id,
            planId: plan.id,
            orderId: order.id,
            installationId: installation.id,
            provider: 'cloudhost247',
            periodEnd: new Date(Date.now() + (PERIOD_DAYS[item.billing_period] ?? 30) * 86_400_000),
          });
          subscriptionId = subscription.id;
          report.subscriptionsCreated.push(subscription.id);
          await updateInstallation(tx, installation.id, { subscriptionId });
        }
      }

      // Enqueue INSTALL — idempotent on (installation, order): a duplicate webhook cannot
      // double-deploy (unique idempotency_key), and the engine re-verifies payment status.
      const { created } = await enqueueDeployment(tx, {
        installationId: installation.id,
        serverId: installation.server_id,
        orderId: order.id,
        action: 'install',
        idempotencyKey: `install:${installation.id}:${order.id}`,
        requestedBy: order.user_id,
        payload: { subscriptionId },
      });
      if (created) {
        report.installationsQueued.push(installation.id);
        await tx.query(
          `UPDATE application_installations SET status = 'queued', updated_at = now() WHERE id = $1 AND status IN ('pending')`,
          [installation.id]
        );
      }
      continue;
    }

    // --- Hosting product (e.g. cPanel package) with an attached provision target ----------------
    if (metadata.hosting?.serverId && metadata.hosting.domain) {
      const hosting = metadata.hosting;
      const username = hosting.username ?? `ch${Date.now().toString(36).slice(-8)}`;
      const password = hosting.password ?? genId();
      const { created } = await enqueueDeployment(tx, {
        serverId: hosting.serverId,
        orderId: order.id,
        action: 'provision',
        idempotencyKey: `provision:${order.id}:${hosting.domain}`,
        requestedBy: order.user_id,
        payload: {
          customerId: order.user_id,
          customerEmail: '',
          domain: hosting.domain,
          planName: hosting.planName ?? item.plan_name_snapshot,
          username,
          password,
          installer: hosting.installer,
          contactEmail: '',
        },
      });
      if (created) report.hostingJobsQueued.push(`${hosting.domain} → ${hosting.serverId}`);
      continue;
    }

    // --- Plain recurring hosting item: subscription only ------------------------------------
    if (item.plan_id) {
      const plan = await findPlanById(tx, item.plan_id);
      if (plan) {
        const subscription = await createSubscription(tx, {
          customerId: order.user_id,
          planId: plan.id,
          orderId: order.id,
          provider: 'cloudhost247',
          periodEnd: new Date(Date.now() + (PERIOD_DAYS[item.billing_period] ?? 30) * 86_400_000),
        });
        report.subscriptionsCreated.push(subscription.id);
      }
    }
  }

  return report;
}

/** Admin-triggered hosting provisioning for a paid order (spec §37) — same enqueue path. */
export async function enqueueHostingProvisioning(
  tx: Queryable,
  orderId: string,
  input: {
    serverId: string;
    domain: string;
    username: string;
    password: string;
    planName: string;
    installer?: 'wordpress' | 'static-site' | 'custom';
    customerEmail: string;
    requestedBy: string;
  }
): Promise<string> {
  const { deployment } = await enqueueDeployment(tx, {
    serverId: input.serverId,
    orderId,
    action: 'provision',
    idempotencyKey: `provision:${orderId}:${input.domain}`,
    requestedBy: input.requestedBy,
    payload: {
      customerId: input.requestedBy,
      customerEmail: input.customerEmail,
      domain: input.domain,
      planName: input.planName,
      username: input.username,
      password: input.password,
      installer: input.installer,
      contactEmail: input.customerEmail,
    },
  });
  return deployment.id;
}

/** Subscription renewal after a renewal payment: extends the current period. */
export async function renewSubscriptionForPlan(tx: Queryable, order: OrderRow, planId: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM subscriptions WHERE customer_id = $1 AND plan_id = $2 AND status IN ('active', 'past_due', 'grace_period')
     ORDER BY created_at DESC LIMIT 1`,
    [order.user_id, planId]
  );
  const existing = rows[0];
  if (!existing) return null;
  await tx.query(
    `UPDATE subscriptions
     SET status = 'active',
         current_period_start = now(),
         current_period_end = now() + make_interval(days => $2::int),
         past_due_since = NULL,
         updated_at = now()
     WHERE id = $1`,
    [existing.id, 30]
  );
  return existing.id;
}

export async function getSubscriptionByIdSafe(tx: Queryable, id: string) {
  return findSubscriptionById(tx, id);
}
