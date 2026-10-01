/**
 * Phase 6 — customer installation wizard business logic (spec §23, §43, §20).
 *
 * createInstallationRequest is the single entry point the POST /api/v1/app-installations route
 * calls. It performs EVERY validation server-side and creates, atomically:
 *
 *   application_installations (status 'pending')  — what will run
 *   orders + order_items (unpaid)                 — what authorizes it (spec §20: no
 *                                                    provisioning before a verified payment)
 *   invoices + ledger charge entry                — how it gets paid (existing Phase 5 stack)
 *
 * Pricing is read fresh from plan_pricing exactly like commerce-service.ts — never accepted from
 * the client. The deployment job is NOT created here; the paid-order webhook creates it
 * (src/services/provisioning-service.ts), which is the only path from money to infrastructure.
 *
 * When the requested application version needs a plan the customer already holds (an existing
 * active subscription for the same plan), the order total is an honest 0 and provisioning is
 * authorized by that subscription instead of a new payment — recorded the same way, never a
 * client assertion.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { DEFAULT_CURRENCY } from '../config/billing';
import { fromCents, toCents } from '../lib/money';
import { shortId } from '../lib/crypto';
import { findApplicationById, findApplicationBySlug, findApplicationVersionById, findStableVersion, listApplicationVersions, type ApplicationRow, type ApplicationVersionRow } from '../db/applications';
import { findServerById, listServers, getServerAllocation } from '../db/servers';
import { createInstallation, listInstallationsForCustomer, findInstallationById } from '../db/application-installations';
import { upsertEnvironmentEntry, upsertVolume } from '../db/application-config';
import { getKeyRing } from '../lib/keyring';
import { issueInvoiceForOrder } from './billing-service';
import { createOrder, listOrderItemsForOrder } from '../db/orders';
import { enqueueDeployment } from '../db/deployments';
import { setInvoiceStatus } from '../db/invoices';
import { setOrderPaymentStatus } from '../db/orders';
import { findPlanById } from '../db/catalog-plans';
import { listPublishedPricingForPlan, type BillingPeriod } from '../db/catalog-pricing';
import type { ApplicationManifest, HostingType, ManifestEnvironmentEntry } from '../marketplace/manifest-schema';

export interface CreateInstallationInput {
  applicationIdOrSlug: string;
  versionId?: string;
  serverId?: string;
  name?: string;
  domain?: string | null;
  planId?: string;
  billingPeriod?: BillingPeriod;
  environment?: Record<string, string>;
  backupEnabled?: boolean;
}

export interface InstallationRequestResult {
  installationId: string;
  orderId: string;
  orderNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  totalAmount: string;
  currency: string;
  paymentRequired: boolean;
  status: string;
}

/** Server auto-selection (spec §43 step 3): first active compatible server with capacity. */
export async function selectServerForApplication(
  db: Queryable,
  manifest: ApplicationManifest
): Promise<string | null> {
  const candidates = await listServers(db, { status: 'active' });
  const wants: HostingType[] = manifest.supportedHostingTypes;
  for (const server of candidates) {
    const dockerOk = wants.includes('docker') && server.docker_enabled && (server.server_type === 'VPS' || server.server_type === 'DEDICATED');
    const cpanelOk = wants.includes('cpanel') && server.cpanel_enabled && server.server_type === 'CPANEL';
    const k8sOk = wants.includes('kubernetes') && server.kubernetes_enabled && server.server_type === 'KUBERNETES';
    if (!dockerOk && !cpanelOk && !k8sOk) continue;
    const allocation = await getServerAllocation(db, server.id);
    const cpuOk = allocation.cpu + manifest.requirements.cpu <= server.cpu_cores;
    const memOk = allocation.memoryMb + manifest.requirements.memory <= server.memory_mb;
    const storageOk = allocation.storageMb + manifest.requirements.storage <= server.storage_mb;
    if (cpuOk && memOk && storageOk) return server.id;
  }
  return null;
}

async function resolveVersion(
  db: Queryable,
  application: ApplicationRow,
  requestedVersionId?: string
): Promise<ApplicationVersionRow> {
  if (requestedVersionId) {
    const version = await findApplicationVersionById(db, requestedVersionId);
    if (!version || version.application_id !== application.id) {
      throw new NotFoundError('No application version was found with that id');
    }
    return version;
  }
  const stable = await findStableVersion(db, application.id);
  if (stable) return stable;
  const published = (await listApplicationVersions(db, application.id, true))[0];
  if (!published) throw new ValidationError('This application has no published versions yet');
  return published;
}

function assertHostingCompatible(serverType: string, manifest: ApplicationManifest): void {
  const wants = manifest.supportedHostingTypes;
  const ok =
    (wants.includes('docker') && (serverType === 'VPS' || serverType === 'DEDICATED')) ||
    (wants.includes('cpanel') && serverType === 'CPANEL') ||
    (wants.includes('kubernetes') && serverType === 'KUBERNETES') ||
    (wants.includes('shared') && serverType === 'SHARED') ||
    (wants.includes('vps') && serverType === 'VPS') ||
    (wants.includes('dedicated') && serverType === 'DEDICATED');
  if (!ok) {
    throw new ValidationError(
      `This application supports ${wants.join(', ')} hosting, which the selected server (${serverType}) does not provide`
    );
  }
}

export async function createInstallationRequest(
  db: Queryable,
  userId: string,
  input: CreateInstallationInput,
  genId: () => string = randomUUID
): Promise<InstallationRequestResult> {
  // --- Application + version -------------------------------------------------------------------
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    input.applicationIdOrSlug
  );
  const application = isUuid
    ? (await findApplicationById(db, input.applicationIdOrSlug)) ??
      (await findApplicationBySlug(db, input.applicationIdOrSlug))
    : await findApplicationBySlug(db, input.applicationIdOrSlug);
  if (!application || application.status !== 'published') {
    throw new NotFoundError('No application was found with that identifier');
  }
  const version = await resolveVersion(db, application, input.versionId);
  if (version.status !== 'published') {
    throw new ValidationError('That application version is not published');
  }
  const manifest = version.manifest;

  // --- Server ------------------------------------------------------------------------------------
  let serverId = input.serverId ?? null;
  if (serverId) {
    const server = await findServerById(db, serverId);
    if (!server || server.status !== 'active') throw new NotFoundError('No active server was found with that id');
    assertHostingCompatible(server.server_type, manifest);
  } else {
    serverId = await selectServerForApplication(db, manifest);
    if (!serverId) {
      throw new ConflictError(
        'No server with spare capacity is currently available for this application — please try again later or contact support'
      );
    }
  }

  // --- Domain ------------------------------------------------------------------------------------
  if (input.domain) {
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
    if (!domainRegex.test(input.domain) || input.domain.length > 253) {
      throw new ValidationError('domain must be a valid hostname');
    }
  } else if (manifest.domain.primaryRequired) {
    throw new ValidationError('This application requires a domain to be specified');
  }

  // --- Environment validation (spec §23 request example) -----------------------------------------
  const rawEnvironment = input.environment ?? {};
  const requiredEntries = manifest.environment.required.map((entry) => ({ ...entry, required: true }));
  const optionalEntries = manifest.environment.optional.map((entry) => ({ ...entry, required: false }));
  const entriesByKey = new Map<string, ManifestEnvironmentEntry & { required: boolean }>(
    [...requiredEntries, ...optionalEntries].map((entry) => [entry.key, entry])
  );
  for (const key of Object.keys(rawEnvironment)) {
    if (!entriesByKey.has(key)) {
      throw new ValidationError(`Environment variable ${key} is not configurable for this application`);
    }
  }

  // Blank browser inputs mean "use the manifest default / generate server-side" — never persist
  // an empty string that would override a generated secret and make the worker fail later.
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawEnvironment)) {
    const entry = entriesByKey.get(key);
    if (!entry) continue;
    const text = String(value);
    const canBeDerivedServerSide =
      entry.generate === 'random_32' || entry.defaultFromDomain || entry.defaultFromUrl || entry.default !== undefined;
    if (text.trim() === '' && (!entry.required || canBeDerivedServerSide)) {
      continue;
    }
    environment[key] = text;
  }

  const customerMustProvide = manifest.environment.required.filter(
    (e) => !e.generate && !e.defaultFromDomain && !e.defaultFromUrl && e.default === undefined
  );
  for (const entry of customerMustProvide) {
    if (!environment[entry.key]?.trim()) {
      throw new ValidationError(`Environment variable ${entry.key} is required for this application`);
    }
  }

  // --- Pricing (always server-side) --------------------------------------------------------------
  let totalCents = 0;
  let planId: string | null = null;
  let billingPeriod: BillingPeriod = 'monthly';
  if (input.planId) {
    const plan = await findPlanById(db, input.planId);
    if (!plan || plan.status !== 'active') throw new NotFoundError('No purchasable plan was found with that id');
    billingPeriod = input.billingPeriod ?? 'monthly';
    const pricing = (await listPublishedPricingForPlan(db, plan.id)).find(
      (p) => p.billing_period === billingPeriod && p.currency === DEFAULT_CURRENCY
    );
    if (!pricing || pricing.amount === null) {
      throw new ValidationError(`Plan has no published ${billingPeriod} price in ${DEFAULT_CURRENCY}`);
    }
    totalCents = toCents(pricing.amount);
    planId = plan.id;
  }

  const installationId = genId();
  const containerProject = `c${shortId(userId, 6)}-${shortId(installationId, 6)}`;

  // --- Atomic creation: installation + order + invoice -------------------------------------------
  return withTransaction(db, async (tx) => {
    const installation = await createInstallation(tx, {
      id: installationId,
      customerId: userId,
      applicationId: application.id,
      applicationVersionId: version.id,
      serverId,
      name: input.name?.trim() || `${application.name} (${containerProject})`,
      domain: input.domain ?? null,
      containerProject,
      cpuLimit: manifest.requirements.cpu,
      memoryLimitMb: manifest.requirements.memory,
      storageLimitMb: manifest.requirements.storage,
    });
    if (input.backupEnabled === false) {
      await tx.query(`UPDATE application_installations SET backup_enabled = false WHERE id = $1`, [installation.id]);
    }

    // Persist customer-supplied environment now (encrypted at rest — spec §16).
    const ring = getKeyRing();
    for (const [key, value] of Object.entries(environment)) {
      const isSecret = manifest.environment.required.some((e) => e.key === key && (e.secret || e.generate === 'random_32'))
        || manifest.environment.optional.some((e) => e.key === key && e.secret);
      await upsertEnvironmentEntry(tx, ring, installation.id, key, value, isSecret);
    }
    // Record declared volumes up-front so the customer sees storage before first deploy.
    for (const [serviceName, service] of Object.entries(manifest.services)) {
      for (const mount of service.volumes) {
        await upsertVolume(tx, installation.id, {
          name: `${serviceName}_${mount.replace(/\//g, '-').replace(/[^a-zA-Z0-9_.-]/g, '')}`,
          mountPath: mount,
          hostPath: `/opt/cloudhost247/apps/${containerProject}/volumes/${serviceName}${mount}`,
        });
      }
    }

    // Order + invoice (unpaid — spec §20). metadata.installationId is what the provisioning
    // hook reads when the verified webhook lands.
    const orderId = genId();
    const totalAmount = fromCents(totalCents);
    const { order } = await createOrder(tx, {
      id: orderId,
      userId,
      currency: DEFAULT_CURRENCY,
      subtotalAmount: totalAmount,
      discountAmount: '0',
      taxAmount: '0',
      totalAmount,
      items: [
        {
          id: genId(),
          productId: null,
          planId,
          productNameSnapshot: application.name,
          planNameSnapshot: `${application.name} ${version.version} hosting`,
          billingPeriod,
          quantity: 1,
          unitPriceAmount: totalAmount,
          currency: DEFAULT_CURRENCY,
          lineTotalAmount: totalAmount,
          metadata: { installationId: installation.id, kind: 'app_installation' },
        },
      ],
    });
    // Link the order to the installation: the engine's first install step re-verifies
    // payment_status from this order (spec §20) — the linkage must exist before any deploy.
    await tx.query(`UPDATE application_installations SET order_id = $2, updated_at = now() WHERE id = $1`, [
      installation.id,
      order.id,
    ]);
    const invoice = await issueInvoiceForOrder(tx, order, genId);

    // Free installations (total 0 — e.g. covered by an active subscription) skip the payment
    // webhook entirely, but provisioning still must NOT happen synchronously (spec §23): mark
    // the order paid and enqueue the same INSTALL job the paid-order hook would.
    if (totalCents === 0) {
      await setOrderPaymentStatus(tx, order.id, 'paid');
      await setInvoiceStatus(tx, invoice.id, 'paid');
      await enqueueDeployment(tx, {
        installationId: installation.id,
        serverId,
        orderId: order.id,
        action: 'install',
        idempotencyKey: `install:${installation.id}:${order.id}`,
        requestedBy: userId,
      });
      await tx.query(
        `UPDATE application_installations SET status = 'queued', updated_at = now() WHERE id = $1 AND status IN ('pending')`,
        [installation.id]
      );
    }

    return {
      installationId: installation.id,
      orderId: order.id,
      orderNumber: order.order_number,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      totalAmount,
      currency: order.currency,
      paymentRequired: totalCents > 0,
      // Free installs were already queued above; paid installs wait for the webhook.
      status: totalCents === 0 ? 'queued' : installation.status,
    };
  });
}

/** Customer-scoped listing with app/server names for the "My Applications" page (spec §44). */
export async function listMyInstallations(db: Queryable, userId: string) {
  const installations = await listInstallationsForCustomer(db, userId);
  const result = [];
  for (const installation of installations) {
    const application = await findApplicationById(db, installation.application_id);
    const version = await findApplicationVersionById(db, installation.application_version_id);
    const server = installation.server_id ? await findServerById(db, installation.server_id) : null;
    result.push({
      id: installation.id,
      name: installation.name,
      application: application ? { name: application.name, slug: application.slug, logoUrl: application.logo_url } : null,
      version: version?.version ?? null,
      server: server ? { name: server.name, type: server.server_type } : null,
      status: installation.status,
      domain: installation.domain,
      health: installation.health_status,
      cpuLimit: installation.cpu_limit,
      memoryLimitMb: installation.memory_limit_mb,
      storageLimitMb: installation.storage_limit_mb,
      restartCount: installation.restart_count,
      lastBackupAt: installation.last_backup_at,
      createdAt: installation.created_at,
    });
  }
  return result;
}

export async function getMyInstallationDetail(db: Queryable, userId: string, installationId: string) {
  const installation = await findInstallationById(db, installationId);
  if (!installation || installation.customer_id !== userId) {
    throw new NotFoundError('No installation was found with that id'); // 404, never 403
  }
  const application = await findApplicationById(db, installation.application_id);
  const version = await findApplicationVersionById(db, installation.application_version_id);
  const items = await listOrderItemsForOrder(db, installation.order_id ?? '');
  return { installation, application, version, orderItems: installation.order_id ? items : [] };
}
