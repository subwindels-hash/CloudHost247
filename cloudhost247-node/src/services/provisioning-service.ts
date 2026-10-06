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
import { resolveAvailableConfiguration } from '../db/operating-systems';
import { findInstallationById, updateInstallation } from '../db/application-installations';
import { createSubscription, findSubscriptionById } from '../db/ops-tables';
import { enqueueDeployment } from '../db/deployments';
import {
  enqueueServerProvisioningJob,
  findCustomerServerById,
  updateCustomerServerProvisioning,
} from '../db/server-provisioning';

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
  cloudflare?: Record<string, unknown>;
  // --- Domain Services link ids (see src/domain-services/*): set server-side at order creation. ---
  registrationId?: string;
  transferId?: string;
  appraisalId?: string;
  membershipId?: string;
  auctionId?: string;
  domainName?: string;
  serverProvision?: {
    serverId: string;
  };
  serverResize?: {
    serverId: string;
    sourcePlanId?: string;
    targetPlanId: string;
    targetConfigurationId?: string;
    subscriptionId?: string | null;
  };
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
  serverJobsQueued: string[];
  cloudflareServicesQueued: string[];
  /** Platform-service tiers attached to a customer resource by the fulfilment hook. */
  platformPlanResourcesAttached: string[];
}

/**
 * Runs inside the webhook's settlement transaction. Creates subscriptions for recurring items
 * and queues the INSTALL deployment for each application installation the paid order contains.
 */
export async function provisionPaidOrder(tx: Queryable, order: OrderRow, genId: () => string = randomUUID): Promise<ProvisioningReport> {
  // Re-read inside the settlement transaction. Webhook callers hold the order snapshot loaded
  // before setOrderPaymentStatus(), so its in-memory payment_status is intentionally stale even
  // though the authoritative row in this same transaction is already paid.
  const paymentState = await tx.query<{ payment_status: string }>(
    `SELECT payment_status FROM orders WHERE id=$1`,[order.id]
  );
  if (paymentState.rows[0]?.payment_status !== 'paid') {
    throw new Error(`Refusing provisioning for unpaid order ${order.id}`);
  }
  const report: ProvisioningReport = {
    installationsQueued: [],
    subscriptionsCreated: [],
    hostingJobsQueued: [],
    serverJobsQueued: [],
    cloudflareServicesQueued: [],
    platformPlanResourcesAttached: [],
  };
  const items = await listOrderItemsForOrder(tx, order.id);

  for (const item of items) {
    const metadata = parseMetadata(item);

    // --- Domain Services: verified payment unlocks the provider workflow; the registrar call
    // itself is performed by the worker sweep (never inside the settlement transaction). Each
    // hook is idempotent on its status transition, so webhook redelivery is a no-op. ---
    if (metadata.kind === 'domain_registration' && typeof metadata.registrationId === 'string') {
      const { markRegistrationPaymentVerified } = await import('../domain-services/registration-service');
      await markRegistrationPaymentVerified(tx, metadata.registrationId);
      continue;
    }
    if (metadata.kind === 'domain_transfer' && typeof metadata.transferId === 'string') {
      const { markTransferPaymentVerified } = await import('../domain-services/transfer-service');
      await markTransferPaymentVerified(tx, metadata.transferId);
      continue;
    }
    if (metadata.kind === 'domain_appraisal' && typeof metadata.appraisalId === 'string') {
      const { markAppraisalPaymentVerified } = await import('../domain-services/appraisal-service');
      await markAppraisalPaymentVerified(tx, metadata.appraisalId);
      continue;
    }
    if (metadata.kind === 'domain_club_membership' && typeof metadata.membershipId === 'string') {
      const { markMembershipPaymentVerified } = await import('../domain-services/club-service');
      await markMembershipPaymentVerified(tx, metadata.membershipId);
      continue;
    }
    if (metadata.kind === 'domain_auction_payment' && typeof metadata.auctionId === 'string') {
      const { markAuctionPaymentVerified } = await import('../domain-services/auction-service');
      await markAuctionPaymentVerified(tx, metadata.auctionId);
      continue;
    }

    // --- Cloudflare service / plan change: verified payment -> pending service + durable job ---
    if (metadata.kind === 'cloudflare' || metadata.cloudflare) {
      const { provisionCloudflareOrderItem } = await import('./cloudflare-service');
      const result = await provisionCloudflareOrderItem(tx, order, item, genId);
      if (result.cloudflareServiceId) report.cloudflareServicesQueued.push(result.cloudflareServiceId);
      continue;
    }

    // --- Packaged CloudHost247 platform services (Website Builder tiers, AI builder, Online Store,
    // Digital Marketing, Unified Inbox) and paid expert/marketing engagements. One dispatch point
    // (src/commerce/fulfilment-service.ts) so no product module needs its own payment listener. ---
    if (metadata.kind === 'platform_plan') {
      const { fulfilPlatformPlanItem } = await import('../commerce/fulfilment-service');
      const result = await fulfilPlatformPlanItem(tx, order, item);
      if (result.subscriptionId) report.subscriptionsCreated.push(result.subscriptionId);
      if (result.resourceId) report.platformPlanResourcesAttached.push(`${result.resourceType}:${result.resourceId}`);
      continue;
    }
    if (metadata.kind === 'expert_service') {
      const { fulfilExpertServiceItem } = await import('../commerce/fulfilment-service');
      await fulfilExpertServiceItem(tx, order, item);
      continue;
    }
    if (metadata.kind === 'marketing_plan') {
      const { fulfilMarketingPlanItem } = await import('../commerce/fulfilment-service');
      await fulfilMarketingPlanItem(tx, order, item);
      continue;
    }

    // --- Paid server resize: re-resolve the target at settlement, then queue the provider call --
    if (metadata.serverResize?.serverId) {
      const resize = metadata.serverResize;
      const server = await findCustomerServerById(tx, resize.serverId);
      if (!server || server.customer_id !== order.user_id || !server.provider_id || !server.region_id
        || !server.operating_system_version_id || !server.architecture || !server.provider_server_id) continue;
      if (!['active', 'stopped'].includes(server.status) || server.plan_id !== resize.sourcePlanId) continue;

      // The price snapshot was captured at quote time, but provider/location/image availability is
      // deliberately checked again after payment. A stale paid order never grants an unverified
      // provider resize simply because an operator disabled a template in the meantime.
      const configuration = await resolveAvailableConfiguration(tx, {
        planId: resize.targetPlanId,
        providerId: server.provider_id,
        regionId: server.region_id,
        datacenterId: server.datacenter_id,
        operatingSystemVersionId: server.operating_system_version_id,
        architecture: server.architecture,
        serverType: server.server_type,
      });
      const targetMetadata = configuration?.configuration_metadata ?? null;
      const capabilities = targetMetadata && typeof targetMetadata.capabilities === 'object' && targetMetadata.capabilities !== null
        ? targetMetadata.capabilities as Record<string, unknown>
        : {};
      if (!configuration || capabilities.resize !== true) continue;

      const result = await enqueueServerProvisioningJob(tx, {
        serverId: server.id,
        orderId: order.id,
        providerId: server.provider_id,
        osImageId: server.os_image_id,
        operation: 'RESIZE',
        requestedBy: order.user_id,
        idempotencyKey: `server-resize:${server.id}:${order.id}`,
        payload: {
          targetPlanId: resize.targetPlanId,
          targetConfigurationId: configuration.configuration_id,
          subscriptionId: resize.subscriptionId ?? null,
        },
      }, { alreadyInTransaction: true });
      if (result.created) report.serverJobsQueued.push(result.job.id);
      continue;
    }

    // --- VPS/cloud/dedicated server: verified payment → durable provisioning queue -------------
    if (metadata.serverProvision?.serverId) {
      const server = await findCustomerServerById(tx, metadata.serverProvision.serverId);
      if (!server || server.customer_id !== order.user_id) continue;
      if (server.order_id && server.order_id !== order.id) continue;
      if (!server.provider_id || !server.os_image_id) continue;

      // One subscription per order/plan. Duplicate verified events reuse it rather than extending
      // or creating another billable service.
      if (item.plan_id) {
        const existing = await tx.query<{ id: string }>(
          `SELECT id FROM subscriptions WHERE order_id=$1 AND plan_id=$2 LIMIT 1`,
          [order.id,item.plan_id]
        );
        if (!existing.rows[0]) {
          const subscription = await createSubscription(tx, {
            customerId: order.user_id,
            planId: item.plan_id,
            orderId: order.id,
            provider: 'cloudhost247',
            periodEnd: new Date(Date.now() + (PERIOD_DAYS[item.billing_period] ?? 30) * 86_400_000),
          });
          report.subscriptionsCreated.push(subscription.id);
        }
      }

      const result = await enqueueServerProvisioningJob(tx, {
        serverId: server.id,
        orderId: order.id,
        providerId: server.provider_id,
        osImageId: server.os_image_id,
        operation: 'PROVISION',
        requestedBy: order.user_id,
        idempotencyKey: `server-provision:${server.id}:${order.id}`,
        payload: { serverId: server.id },
      },{alreadyInTransaction:true});
      if (result.created) {
        report.serverJobsQueued.push(result.job.id);
        await updateCustomerServerProvisioning(tx,server.id,{ status: 'queued',provisioningStatus: 'QUEUED' });
      }
      continue;
    }

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
