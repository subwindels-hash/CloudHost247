import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { findPlanById, listActivePlansForProduct } from '../db/catalog-plans';
import { findProductById } from '../db/catalog-products';
import { listPublishedPricingForPlan, type BillingPeriod } from '../db/catalog-pricing';
import { createOrder, listOrderItemsForOrder, setOrderPaymentStatus, type OrderItemRow } from '../db/orders';
import { setInvoiceStatus } from '../db/invoices';
import { findOwnedCustomerServer } from '../db/server-provisioning';
import { resolveAvailableConfiguration, type AvailableConfigurationRow } from '../db/operating-systems';
import { issueInvoiceForOrder } from './billing-service';
import { provisionPaidOrder } from './provisioning-service';
import { DEFAULT_CURRENCY } from '../config/billing';
import { fromCents, sumCents, toCents } from '../lib/money';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';

interface ServerProvisionMetadata {
  serverProvision?: { serverId?: string };
  serverResize?: { serverId?: string; targetPlanId?: string };
}

function metadataOf(item: OrderItemRow): ServerProvisionMetadata {
  return item.metadata && typeof item.metadata === 'object' ? item.metadata as ServerProvisionMetadata : {};
}

function wholeNumber(metadata: Record<string, unknown>, key: string, minimum: number): number {
  const value = metadata[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new ValidationError(`The target server configuration is incomplete (${key})`);
  }
  return value;
}

function booleanCapabilities(metadata: Record<string, unknown>): Record<string, boolean> {
  const raw = metadata.capabilities;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === 'boolean')) as Record<string, boolean>;
}

function configurationResources(configuration: AvailableConfigurationRow) {
  const metadata = configuration.configuration_metadata ?? {};
  return {
    metadata,
    cpuCores: wholeNumber(metadata, 'cpuCores', 1),
    memoryMb: wholeNumber(metadata, 'memoryMb', 256),
    storageMb: wholeNumber(metadata, 'storageMb', 1024),
    bandwidthGb: typeof metadata.bandwidthGb === 'number' && Number.isInteger(metadata.bandwidthGb)
      ? metadata.bandwidthGb
      : null,
    capabilities: booleanCapabilities(metadata),
  };
}

function findSourceOrderItem(items: OrderItemRow[], serverId: string, planId: string): OrderItemRow | null {
  return items.find((item) => {
    const metadata = metadataOf(item);
    return item.plan_id === planId && metadata.serverProvision?.serverId === serverId;
  }) ?? null;
}

interface ExistingResizeOrder {
  orderId: string;
  orderNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  totalAmount: string;
  currency: string;
  targetPlanId: string;
}

async function findOpenResizeOrder(db: Queryable, userId: string, serverId: string): Promise<ExistingResizeOrder | null> {
  // Do not rely on a JSON predicate for correctness: parsing the small set of pending customer
  // order rows also works against PostgreSQL-compatible test engines and keeps the metadata shape
  // checked in one place.
  const { rows } = await db.query<{
    order_id: string; order_number: string; payment_status: string; status: string;
    invoice_id: string | null; invoice_number: string | null; total_amount: string; currency: string;
    plan_id: string | null; metadata: Record<string, unknown> | null;
  }>(
    `SELECT o.id order_id,o.order_number,o.payment_status,o.status,o.total_amount,o.currency,
            i.id invoice_id,i.invoice_number,oi.plan_id,oi.metadata
       FROM orders o
       JOIN order_items oi ON oi.order_id=o.id
       LEFT JOIN invoices i ON i.order_id=o.id
      WHERE o.user_id=$1 AND o.status='pending' AND o.payment_status IN ('unpaid','paid')`,
    [userId],
  );
  const row = rows.find((candidate) => {
    const metadata = candidate.metadata && typeof candidate.metadata === 'object'
      ? candidate.metadata as ServerProvisionMetadata
      : {};
    return metadata.serverResize?.serverId === serverId;
  });
  if (!row || !row.invoice_id || !row.invoice_number) return null;
  return {
    orderId: row.order_id, orderNumber: row.order_number, invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number, totalAmount: row.total_amount, currency: row.currency,
    targetPlanId: (row.metadata as ServerProvisionMetadata).serverResize?.targetPlanId ?? row.plan_id ?? '',
  };
}

export interface CreateServerResizeOrderInput {
  serverId: string;
  targetPlanId: string;
}

export interface ServerResizeOrderResult extends ExistingResizeOrder {
  created: boolean;
  paymentRequired: boolean;
}

/**
 * Creates a customer-visible invoice for a server plan increase. The target template, price and
 * resource metadata are all selected server-side. This deliberately uses a transparent whole-term
 * credit policy: the exact amount billed for the original server order item is credited against
 * the target plan's currently published price. Proration/downgrades require a separate reviewed
 * billing policy and are not guessed here.
 */
export async function createServerResizeOrder(
  db: Queryable,
  userId: string,
  input: CreateServerResizeOrderInput,
  genId: () => string = randomUUID,
): Promise<ServerResizeOrderResult> {
  return withTransaction(db, async (tx) => {
    // Serialize an upgrade quote against other server work before calculating a price snapshot.
    await tx.query(`SELECT id FROM servers WHERE id=$1 FOR UPDATE`, [input.serverId]);
    const server = await findOwnedCustomerServer(tx, input.serverId, userId);
    if (!server || !server.provider_id || !server.region_id || !server.plan_id || !server.operating_system_version_id || !server.architecture) {
      throw new NotFoundError('No server was found with that id');
    }
    if (!server.provider_server_id || !['active', 'stopped'].includes(server.status)) {
      throw new ConflictError('This server cannot be resized in its current state');
    }
    if (server.capabilities?.resize !== true) throw new ValidationError('Resize is not supported for this server');

    const existing = await findOpenResizeOrder(tx, userId, server.id);
    if (existing) {
      if (existing.targetPlanId !== input.targetPlanId) {
        throw new ConflictError('A different server resize order is already awaiting completion');
      }
      return { ...existing, created: false, paymentRequired: existing.totalAmount !== '0.00' };
    }

    const activeJob = await tx.query<{ id: string; operation: string }>(
      `SELECT id,operation FROM provisioning_jobs
       WHERE server_id=$1 AND status NOT IN ('READY','FAILED','CANCELLED') LIMIT 1`,
      [server.id],
    );
    if (activeJob.rows[0]) {
      throw new ConflictError(`Server operation ${activeJob.rows[0].operation} is already active`);
    }
    if (input.targetPlanId === server.plan_id) throw new ValidationError('Select a different, larger server plan');

    const [sourcePlan, targetPlan] = await Promise.all([findPlanById(tx, server.plan_id), findPlanById(tx, input.targetPlanId)]);
    if (!sourcePlan || !targetPlan || sourcePlan.status !== 'active' || targetPlan.status !== 'active' || sourcePlan.product_id !== targetPlan.product_id) {
      throw new ValidationError('The target must be an active plan in the same server product');
    }
    const product = await findProductById(tx, targetPlan.product_id);
    if (!product || product.status !== 'active' || product.visibility !== 'public') {
      throw new ValidationError('The target server plan is unavailable');
    }

    const originalItems = server.order_id ? await listOrderItemsForOrder(tx, server.order_id) : [];
    const sourceItem = findSourceOrderItem(originalItems, server.id, server.plan_id);
    if (!sourceItem) {
      // Legacy/manual rows lack the immutable price snapshot that makes a customer self-service
      // quote safe. An operator can still issue a reviewed manual invoice instead.
      throw new ConflictError('This server has no billable source price snapshot for a self-service resize');
    }
    const billingPeriod = sourceItem.billing_period as BillingPeriod;
    const targetPrice = (await listPublishedPricingForPlan(tx, targetPlan.id)).find(
      (price) => price.billing_period === billingPeriod && price.currency === DEFAULT_CURRENCY && price.amount !== null,
    );
    if (!targetPrice?.amount) {
      throw new ValidationError(`The target plan has no published ${billingPeriod} price in ${DEFAULT_CURRENCY}`);
    }

    const configuration = await resolveAvailableConfiguration(tx, {
      planId: targetPlan.id,
      providerId: server.provider_id,
      regionId: server.region_id,
      datacenterId: server.datacenter_id,
      operatingSystemVersionId: server.operating_system_version_id,
      architecture: server.architecture,
      serverType: server.server_type,
    });
    if (!configuration) throw new ValidationError('The target plan is not available for this server location and operating system');
    const resources = configurationResources(configuration);
    if (resources.capabilities.resize !== true) {
      throw new ValidationError('The target server template does not support resize');
    }
    const grows = resources.cpuCores >= server.cpu_cores
      && resources.memoryMb >= server.memory_mb
      && resources.storageMb >= server.storage_mb
      && (resources.cpuCores > server.cpu_cores || resources.memoryMb > server.memory_mb || resources.storageMb > server.storage_mb);
    if (!grows) throw new ValidationError('Self-service resize supports only plans that increase at least one resource without reducing another');

    const targetCents = sumCents([toCents(targetPrice.amount), targetPrice.setup_fee ? toCents(targetPrice.setup_fee) : 0]);
    const sourceCreditCents = toCents(sourceItem.line_total_amount);
    const dueCents = targetCents - sourceCreditCents;
    if (dueCents <= 0) {
      throw new ValidationError('This target is not a billable upgrade under the current whole-term credit policy');
    }
    const due = fromCents(dueCents);

    const subscription = await tx.query<{ id: string }>(
      `SELECT id FROM subscriptions
       WHERE customer_id=$1 AND order_id=$2 AND plan_id=$3 AND status IN ('active','past_due','grace_period')
       ORDER BY created_at DESC LIMIT 1`,
      [userId,server.order_id,server.plan_id],
    );
    const subscriptionId = subscription.rows[0]?.id ?? null;

    const { order } = await createOrder(tx, {
      id: genId(), userId, currency: DEFAULT_CURRENCY,
      subtotalAmount: due, discountAmount: '0.00', taxAmount: '0.00', totalAmount: due,
      items: [{
        id: genId(), productId: product.id, planId: targetPlan.id,
        productNameSnapshot: product.name, planNameSnapshot: `${targetPlan.name} server upgrade`,
        billingPeriod, quantity: 1, unitPriceAmount: due, currency: DEFAULT_CURRENCY, lineTotalAmount: due,
        metadata: {
          kind: 'server_resize',
          serverResize: {
            serverId: server.id,
            sourcePlanId: server.plan_id,
            targetPlanId: targetPlan.id,
            targetConfigurationId: configuration.configuration_id,
            subscriptionId,
            sourceCreditAmount: sourceItem.line_total_amount,
            targetPriceAmount: fromCents(targetCents),
          },
        },
      }],
    });
    const invoice = await issueInvoiceForOrder(tx, order, genId);

    if (dueCents === 0) {
      await setOrderPaymentStatus(tx, order.id, 'paid');
      await setInvoiceStatus(tx, invoice.id, 'paid');
      await provisionPaidOrder(tx, order, genId);
    }

    return {
      orderId: order.id, orderNumber: order.order_number, invoiceId: invoice.id, invoiceNumber: invoice.invoice_number,
      totalAmount: invoice.total_amount, currency: invoice.currency, targetPlanId: targetPlan.id,
      created: true, paymentRequired: dueCents > 0,
    };
  });
}

export interface ServerResizeOption {
  planId: string;
  name: string;
  cpuCores: number;
  memoryMb: number;
  storageMb: number;
  bandwidthGb: number | null;
  upgradeAmount: string;
  currency: string;
}

/** Returns only resize targets that can be safely quoted for the customer's existing server. */
export async function listServerResizeOptions(db: Queryable, userId: string, serverId: string): Promise<ServerResizeOption[]> {
  const server = await findOwnedCustomerServer(db, serverId, userId);
  if (!server || !server.provider_id || !server.region_id || !server.plan_id || !server.operating_system_version_id || !server.architecture) {
    throw new NotFoundError('No server was found with that id');
  }
  if (!server.provider_server_id || !['active', 'stopped'].includes(server.status) || server.capabilities?.resize !== true) return [];
  const sourcePlan = await findPlanById(db, server.plan_id);
  if (!sourcePlan) return [];
  const sourceItem = server.order_id ? findSourceOrderItem(await listOrderItemsForOrder(db, server.order_id), server.id, server.plan_id) : null;
  if (!sourceItem) return [];
  const billingPeriod = sourceItem.billing_period as BillingPeriod;
  const sourceCreditCents = toCents(sourceItem.line_total_amount);
  const plans = await listActivePlansForProduct(db, sourcePlan.product_id);
  const options: ServerResizeOption[] = [];
  for (const plan of plans) {
    if (plan.id === server.plan_id) continue;
    const [configuration, pricing] = await Promise.all([
      resolveAvailableConfiguration(db, {
        planId: plan.id, providerId: server.provider_id, regionId: server.region_id, datacenterId: server.datacenter_id,
        operatingSystemVersionId: server.operating_system_version_id, architecture: server.architecture, serverType: server.server_type,
      }),
      listPublishedPricingForPlan(db, plan.id),
    ]);
    const target = pricing.find((price) => price.billing_period === billingPeriod && price.currency === DEFAULT_CURRENCY && price.amount !== null);
    if (!configuration || !target?.amount) continue;
    const resources = configurationResources(configuration);
    const grows = resources.capabilities.resize === true && resources.cpuCores >= server.cpu_cores
      && resources.memoryMb >= server.memory_mb && resources.storageMb >= server.storage_mb
      && (resources.cpuCores > server.cpu_cores || resources.memoryMb > server.memory_mb || resources.storageMb > server.storage_mb);
    const dueCents = sumCents([toCents(target.amount), target.setup_fee ? toCents(target.setup_fee) : 0]) - sourceCreditCents;
    if (!grows || dueCents <= 0) continue;
    options.push({
      planId: plan.id, name: plan.name, cpuCores: resources.cpuCores, memoryMb: resources.memoryMb,
      storageMb: resources.storageMb, bandwidthGb: resources.bandwidthGb, upgradeAmount: fromCents(dueCents), currency: DEFAULT_CURRENCY,
    });
  }
  return options;
}
