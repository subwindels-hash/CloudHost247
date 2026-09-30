import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { findPlanById } from '../db/catalog-plans';
import { findProductById } from '../db/catalog-products';
import { listPublishedPricingForPlan, type BillingPeriod } from '../db/catalog-pricing';
import { createOrder, setOrderPaymentStatus } from '../db/orders';
import { setInvoiceStatus } from '../db/invoices';
import { issueInvoiceForOrder } from './billing-service';
import { createCustomerServer, attachOrderToCustomerServer } from '../db/server-provisioning';
import { resolveAvailableConfiguration } from '../db/operating-systems';
import { fromCents, sumCents, toCents } from '../lib/money';
import { DEFAULT_CURRENCY } from '../config/billing';
import { NotFoundError, ValidationError } from '../lib/errors';
import { provisionPaidOrder } from './provisioning-service';

export interface CreateServerOrderInput {
  planId: string;
  billingPeriod: BillingPeriod;
  providerId: string;
  regionId: string;
  datacenterId?: string | null;
  operatingSystemVersionId: string;
  architecture: 'x86_64' | 'arm64';
  serverType: 'VPS' | 'DEDICATED' | 'CLOUD';
  sshKeyIds: string[];
  hostname: string;
  controlPanelId?: string | null;
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function integerMetadata(metadata: Record<string, unknown>, key: string, min: number): number {
  const value = metadata[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new ValidationError(`The selected product configuration is incomplete (${key})`);
  }
  return value;
}

async function validateSshKeys(db: Queryable, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) throw new ValidationError('Select at least one SSH key');
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM customer_ssh_keys WHERE user_id=$1 AND id=ANY($2::uuid[])`, [userId,ids]
  );
  if (rows.length !== new Set(ids).size) {
    throw new ValidationError('One or more SSH keys are invalid or do not belong to your account');
  }
}

async function validateControlPanel(
  db: Queryable,
  input: { controlPanelId?: string | null; versionId: string; planId: string; architecture: string }
): Promise<void> {
  if (!input.controlPanelId) return;
  const explicit = await db.query(
    `SELECT cp.id FROM control_panels cp
     JOIN control_panel_compatibility c ON c.control_panel_id=cp.id
     WHERE cp.id=$1 AND cp.status='ACTIVE' AND c.status='ACTIVE'
       AND c.operating_system_version_id=$2 AND c.architecture=$3
       AND (c.plan_id IS NULL OR c.plan_id=$4) LIMIT 1`,
    [input.controlPanelId, input.versionId, input.architecture, input.planId]
  );
  if (explicit.rows[0]) return;

  const osInfo = await db.query<{ slug: string }>(
    `SELECT os.slug FROM operating_system_versions v
     JOIN operating_systems os ON os.id=v.operating_system_id
     WHERE v.id=$1`,
    [input.versionId]
  );
  const osSlug = osInfo.rows[0]?.slug;

  const panel = await db.query<{ id: string; supported_os: string[] }>(
    `SELECT id, supported_os FROM control_panels WHERE id=$1 AND status='ACTIVE'`,
    [input.controlPanelId]
  );
  if (!panel.rows[0]) {
    throw new ValidationError('The selected control panel is unavailable or inactive');
  }

  if (osSlug && !panel.rows[0].supported_os.some((os) => osSlug.includes(os) || os.includes(osSlug))) {
    throw new ValidationError(`The selected control panel is not compatible with operating system '${osSlug}'`);
  }
}

/**
 * Creates the unpaid financial records and a non-provisioned local server placeholder atomically.
 * Provider contact is deliberately absent: only the verified-payment hook may enqueue deployment.
 */
export async function createServerOrder(
  db: Queryable,
  userId: string,
  input: CreateServerOrderInput,
  genId: () => string = randomUUID
) {
  if (!HOSTNAME_RE.test(input.hostname)) throw new ValidationError('Enter a valid lowercase hostname');
  const plan = await findPlanById(db,input.planId);
  if (!plan || plan.status !== 'active') throw new NotFoundError('No purchasable server plan was found with that id');
  const product = await findProductById(db,plan.product_id);
  if (!product || product.status !== 'active' || product.visibility !== 'public') {
    throw new NotFoundError('No purchasable server plan was found with that id');
  }
  const price = (await listPublishedPricingForPlan(db,plan.id)).find(
    (row) => row.billing_period === input.billingPeriod && row.currency === DEFAULT_CURRENCY && row.amount !== null
  );
  if (!price?.amount) throw new ValidationError(`This plan has no published ${input.billingPeriod} price in ${DEFAULT_CURRENCY}`);

  const configuration = await resolveAvailableConfiguration(db,{
    planId: input.planId,
    providerId: input.providerId,
    regionId: input.regionId,
    datacenterId: input.datacenterId,
    operatingSystemVersionId: input.operatingSystemVersionId,
    architecture: input.architecture,
    serverType: input.serverType,
  });
  if (!configuration) {
    throw new ValidationError('That operating system, version, architecture, region, and plan combination is unavailable');
  }
  await validateSshKeys(db,userId,input.sshKeyIds);
  await validateControlPanel(db,{
    controlPanelId: input.controlPanelId,
    versionId: input.operatingSystemVersionId,
    planId: input.planId,
    architecture: input.architecture,
  });

  const metadata = configuration.configuration_metadata ?? {};
  const cpuCores = integerMetadata(metadata,'cpuCores',1);
  const memoryMb = integerMetadata(metadata,'memoryMb',256);
  const storageMb = integerMetadata(metadata,'storageMb',1024);
  const bandwidthGb = typeof metadata.bandwidthGb === 'number' && Number.isInteger(metadata.bandwidthGb)
    ? metadata.bandwidthGb : null;
  const capabilities = typeof metadata.capabilities === 'object' && metadata.capabilities !== null
    ? metadata.capabilities as Record<string,boolean> : {};

  return withTransaction(db,async (tx) => {
    const server = await createCustomerServer(tx,{
      customerId: userId,
      name: input.hostname,
      hostname: input.hostname.toLowerCase(),
      serverType: input.serverType,
      planId: input.planId,
      providerId: configuration.provider_id,
      regionId: configuration.region_id,
      datacenterId: configuration.datacenter_id,
      operatingSystemVersionId: configuration.version_id,
      osImageId: configuration.image_id,
      architecture: configuration.architecture,
      cpuCores,memoryMb,storageMb,bandwidthGb,
      controlPanelId: input.controlPanelId,
      capabilities,
      metadata: {
        productConfigurationId: configuration.configuration_id,
        sshKeyIds: input.sshKeyIds,
        providerPlan: metadata,
      },
    });

    const recurringCents = toCents(price.amount as string);
    const setupCents = price.setup_fee ? toCents(price.setup_fee) : 0;
    const totalCents = sumCents([recurringCents,setupCents]);
    const total = fromCents(totalCents);
    const { order } = await createOrder(tx,{
      id: genId(),userId,currency: DEFAULT_CURRENCY,
      subtotalAmount: total,discountAmount: '0.00',taxAmount: '0.00',totalAmount: total,
      items: [{
        id: genId(),productId: product.id,planId: plan.id,
        productNameSnapshot: product.name,planNameSnapshot: plan.name,
        billingPeriod: input.billingPeriod,quantity: 1,unitPriceAmount: total,
        currency: DEFAULT_CURRENCY,lineTotalAmount: total,
        metadata: { kind: 'server_provisioning',serverProvision: { serverId: server.id } },
      }],
    });
    await attachOrderToCustomerServer(tx,server.id,order.id);
    const invoice = await issueInvoiceForOrder(tx,order,genId);

    // Zero-priced plans have no payment to verify, but still use the same durable worker queue.
    if (totalCents === 0) {
      const paidOrder = await setOrderPaymentStatus(tx,order.id,'paid');
      await setInvoiceStatus(tx,invoice.id,'paid');
      if (paidOrder) await provisionPaidOrder(tx,paidOrder,genId);
    }

    return {
      serverId: server.id,
      orderId: order.id,
      orderNumber: order.order_number,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      totalAmount: invoice.total_amount,
      currency: invoice.currency,
      paymentRequired: totalCents > 0,
      provisioningStatus: totalCents > 0 ? 'AWAITING_PAYMENT' : 'QUEUED',
    };
  });
}
