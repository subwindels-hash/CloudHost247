/**
 * Domain transfer — EPP-based, payment-gated, provider-confirmed.
 *
 * The EPP/auth code is encrypted at rest the moment it is received and never appears in any API
 * response, log line, or audit row. A transfer only becomes `completed` when the registrar/
 * registry says so; the payment webhook merely unlocks the provider request.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { createOrder } from '../db/orders';
import { issueInvoiceForOrder } from '../services/billing-service';
import { toCents } from '../lib/money';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { DEFAULT_CURRENCY } from '../config/billing';
import { currentKeyVersion, decryptSecret, encryptSecret, type EncryptionKeyRing } from '../lib/crypto';
import { DomainProviderError, type DomainContactInput, type TransferDomainResult } from './providers/types';
import { resolveConnectedDomainProvider, resolveDomainProviderById } from './provider-service';
import { baseOfferingPriceFor } from './extensions-service';
import { isValidDomainName, normalizeDomainName } from './domain-name';
import { recordDomainTransaction, setDomainTransactionStatus } from './transactions';

export interface StartTransferInput {
  domainName: string;
  currentRegistrar?: string | null;
  authCode: string;
  authorizationConfirmed: boolean;
  contact?: RegistrationContactLite | null;
}

export interface RegistrationContactLite {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  countryCode: string;
}

/** Internal transfer status → the customer-facing lifecycle names from the service spec. */
const TRANSFER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  authorization_required: 'Authorization Required',
  transfer_initiated: 'Transfer Initiated',
  transfer_in_progress: 'Transfer In Progress',
  pending_registry: 'Pending Registry',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function transferStatusLabel(status: string): string {
  return TRANSFER_STATUS_LABELS[status] ?? status;
}

/**
 * Starts a transfer. The order for the transfer fee is created only when a real provider price is
 * resolvable (synced offering transfer price). When the registrar's transfer quote is required
 * instead, the provider is asked directly.
 */
export async function startDomainTransfer(
  db: Queryable,
  ring: EncryptionKeyRing,
  userId: string,
  input: StartTransferInput,
  genId: () => string = randomUUID
): Promise<{ transferId: string; orderId: string | null; invoiceId: string | null; invoiceNumber: string | null; amount: string; currency: string }> {
  const normalized = normalizeDomainName(input.domainName);
  if (!isValidDomainName(normalized)) throw new ValidationError('Enter a valid domain name to transfer');
  if (!input.authorizationConfirmed) {
    throw new ValidationError('You must confirm you are authorized to transfer this domain');
  }
  if (!input.authCode || input.authCode.trim().length < 4 || input.authCode.length > 128) {
    throw new ValidationError('A valid EPP/authorization code (4–128 characters) is required');
  }

  const provider = await resolveConnectedDomainProvider(db, 'registrar');

  // One live transfer per domain across the platform (partial unique index backs this up).
  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM domain_transfers
      WHERE lower(domain_name) = lower($1)
        AND status IN ('pending','authorization_required','transfer_initiated','transfer_in_progress','pending_registry')`,
    [normalized]
  );
  if (existing[0]) {
    throw new ConflictError('A transfer for that domain is already in progress.');
  }

  // Resolve the transfer price from the provider offering catalogue (server-side only).
  const base = await baseOfferingPriceFor(db, normalized);
  const transferPrice = base?.transfer ?? null;
  const currency = base?.currency ?? DEFAULT_CURRENCY;
  if (currency.toUpperCase() !== DEFAULT_CURRENCY) {
    throw new ValidationError('This domain is quoted in a currency this platform does not support yet.');
  }

  const transferId = genId();
  const orderId = transferPrice ? genId() : null;

  const result = await withTransaction(db, async (tx) => {
    let contactId: string | null = null;
    if (input.contact) {
      contactId = genId();
      await tx.query(
        `INSERT INTO domain_contacts (id, user_id, encrypted_contact_data, key_version, display_label)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          contactId,
          userId,
          encryptSecret(ring, JSON.stringify({ ...input.contact, countryCode: input.contact.countryCode.toUpperCase() })),
          currentKeyVersion(ring),
          `${input.contact.firstName} ${input.contact.lastName}`.slice(0, 120),
        ]
      );
    }

    await tx.query(
      `INSERT INTO domain_transfers
         (id, user_id, provider_id, contact_id, domain_name, current_registrar, encrypted_auth_code,
          auth_code_key_version, authorization_confirmed_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),'pending')`,
      [
        transferId,
        userId,
        provider.provider.id,
        contactId,
        normalized,
        input.currentRegistrar?.trim() || null,
        encryptSecret(ring, input.authCode.trim()),
        currentKeyVersion(ring),
      ]
    );

    let order: { id: string; total_amount: string; currency: string } | null = null;
    let invoice: { id: string; invoice_number: string } | null = null;
    if (transferPrice) {
      const created = await createOrder(tx, {
        id: orderId as string,
        userId,
        currency,
        subtotalAmount: transferPrice,
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: transferPrice,
        items: [
          {
            id: genId(),
            productId: null,
            planId: null,
            productNameSnapshot: 'Domain Services',
            planNameSnapshot: `Domain transfer — ${normalized}`,
            billingPeriod: 'one_time',
            quantity: 1,
            unitPriceAmount: transferPrice,
            currency,
            lineTotalAmount: transferPrice,
            metadata: { kind: 'domain_transfer', transferId, domainName: normalized },
          },
        ],
      });
      order = created.order;
      const issued = await issueInvoiceForOrder(tx, created.order, genId);
      invoice = issued;
      await tx.query(`UPDATE domain_transfers SET order_id=$2, invoice_id=$3 WHERE id=$1`, [transferId, order.id, invoice.id]);

      await recordDomainTransaction(tx, {
        userId,
        transactionType: 'transfer',
        status: 'pending',
        amount: transferPrice,
        currency,
        orderId: order.id,
        invoiceId: invoice.id,
        transferId,
        metadata: { domainName: normalized },
      });
    }

    return { order, invoice };
  });

  return {
    transferId,
    orderId: result.order?.id ?? null,
    invoiceId: result.invoice?.id ?? null,
    invoiceNumber: result.invoice?.invoice_number ?? null,
    amount: result.order?.total_amount ?? '0.00',
    currency: result.order?.currency ?? currency,
  };
}

/** Webhook-settlement hook: unlocks a paid transfer for provider initiation (idempotent). */
export async function markTransferPaymentVerified(tx: Queryable, transferId: string): Promise<void> {
  const { rows: advanced } = await tx.query(
    `UPDATE domain_transfers SET status = 'authorization_required', updated_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [transferId]
  );
  if (advanced.length === 0) return;
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM domain_transactions WHERE transfer_id = $1 AND transaction_type = 'transfer' LIMIT 1`,
    [transferId]
  );
  if (rows[0]) await setDomainTransactionStatus(tx, rows[0].id, 'processing');
}

export interface TransferProcessingReport {
  claimed: number;
  initiated: number;
  progressed: number;
  completed: number;
  failed: number;
}

/**
 * Worker sweep: claims `authorization_required` transfers and initiates them with the registrar,
 * then polls in-flight transfers for registry progress. Provider status strings map onto the
 * platform lifecycle; the raw provider string is always preserved.
 */
export async function processDomainTransfers(
  pool: Queryable,
  ring: EncryptionKeyRing,
  batchSize = 10
): Promise<TransferProcessingReport> {
  const report: TransferProcessingReport = { claimed: 0, initiated: 0, progressed: 0, completed: 0, failed: 0 };

  // --- 1. Initiate claimed, paid transfers (or fee-free transfers, which have no order) ---
  // The claim is a lease marker in provider_metadata (5-minute expiry): status stays honest, a
  // crashed worker's claim self-expires, and two concurrent sweep cycles can never both initiate.
  const { rows: toInitiate } = await pool.query<{
    id: string; user_id: string; domain_name: string; encrypted_auth_code: string;
    auth_code_key_version: number | null; provider_id: string | null; contact_id: string | null;
  }>(
    `SELECT t.id, t.user_id, t.domain_name, t.encrypted_auth_code, t.auth_code_key_version, t.provider_id, t.contact_id
       FROM domain_transfers t
      WHERE (t.status = 'authorization_required')
         OR (t.status = 'pending' AND t.order_id IS NULL)
      ORDER BY t.updated_at ASC
      LIMIT $1`,
    [batchSize]
  );

  for (const transfer of toInitiate) {
    const { rows: claimed } = await pool.query<{ id: string }>(
      `UPDATE domain_transfers
          SET provider_metadata = provider_metadata || jsonb_build_object('claim_at', to_jsonb(now())),
              updated_at = now()
        WHERE id = $1
          AND (
            (provider_metadata->>'claim_at') IS NULL
            OR (provider_metadata->>'claim_at')::timestamptz < now() - interval '5 minutes'
          )
        RETURNING id`,
      [transfer.id]
    );
    if (!claimed[0]) continue;
    report.claimed += 1;

    const provider = await resolveDomainProviderById(pool, transfer.provider_id);
    if (!provider) {
      await failTransfer(pool, transfer.id, transfer.user_id, 'PROVIDER_NOT_CONFIGURED', 'Domain registrar is not configured');
      report.failed += 1;
      continue;
    }

    try {
      const authCode = decryptSecret(ring, transfer.encrypted_auth_code as string);
      const contacts = transfer.contact_id ? await loadContact(pool, ring, transfer.contact_id) : undefined;
      const result = await provider.adapter.transferDomain({
        domainName: transfer.domain_name,
        authCode,
        contacts: contacts ? { registrant: contacts } : undefined,
        authorizationConfirmedAt: new Date().toISOString(),
        idempotencyKey: transfer.id,
      });
      await applyTransferProviderResult(pool, transfer.id, transfer.user_id, result);
      report.initiated += 1;
    } catch (error) {
      const code = error instanceof DomainProviderError ? error.code : 'PROVIDER_ERROR';
      await failTransfer(pool, transfer.id, transfer.user_id, code, error instanceof Error ? error.message : String(error));
      report.failed += 1;
    }
  }

  // --- 2. Poll in-flight transfers (rate-limited: only rows not touched in the last 10 minutes) ---
  const { rows: inFlight } = await pool.query<{
    id: string; user_id: string; domain_name: string; provider_reference: string | null; provider_id: string | null;
  }>(
    `SELECT t.id, t.user_id, t.domain_name, t.provider_reference, t.provider_id
       FROM domain_transfers t
      WHERE t.status IN ('transfer_initiated','transfer_in_progress','pending_registry')
        AND t.updated_at < now() - interval '10 minutes'
      ORDER BY t.updated_at ASC
      LIMIT $1`,
    [batchSize]
  );

  for (const transfer of inFlight) {
    const provider = await resolveDomainProviderById(pool, transfer.provider_id);
    if (!provider) continue;
    try {
      const status = await provider.adapter.getDomainStatus(transfer.provider_reference ?? '', transfer.domain_name);
      if (status.transferStatus === 'completed') {
        await withTransaction(pool, async (tx) => {
          const { rows: updated } = await tx.query<{ id: string }>(
            `UPDATE domain_transfers
                SET status='completed', completed_at=now(), provider_status=$2, updated_at=now()
              WHERE id=$1 AND status <> 'completed' RETURNING id`,
            [transfer.id, status.providerStatus]
          );
          if (updated[0]) {
            await linkTransferredDomain(tx, transfer.user_id, transfer.domain_name, provider.provider.name, transfer.id);
            await advanceTransferTransaction(tx, transfer.id, 'paid');
          }
        });
        report.completed += 1;
      } else if (status.transferStatus === 'failed') {
        await failTransfer(pool, transfer.id, transfer.user_id, 'PROVIDER_ERROR', status.providerStatus ?? 'Provider reported transfer failure');
        report.failed += 1;
      } else {
        const mapped = mapProviderTransferStatus(status.providerStatus);
        if (mapped && mapped !== 'unknown') {
          await pool.query(
            `UPDATE domain_transfers SET status=$2, provider_status=$3, updated_at=now() WHERE id=$1`,
            [transfer.id, mapped, status.providerStatus]
          );
          report.progressed += 1;
        }
      }
    } catch {
      // Transient provider errors are retried on the next sweep.
    }
  }

  return report;
}

function mapProviderTransferStatus(providerStatus: string | null): string | null {
  if (!providerStatus) return null;
  const status = providerStatus.toLowerCase();
  if (/awaiting|admin approval|authorization/.test(status)) return 'authorization_required';
  if (/in progress|processing|verif/.test(status)) return 'transfer_in_progress';
  if (/pending registry|registry/.test(status)) return 'pending_registry';
  if (/initiat/.test(status)) return 'transfer_initiated';
  return 'unknown';
}

async function applyTransferProviderResult(
  pool: Queryable,
  transferId: string,
  userId: string,
  result: TransferDomainResult
): Promise<void> {
  const mapped = result.status === 'initiated' ? 'transfer_initiated'
    : result.status === 'authorization_required' ? 'authorization_required'
    : result.status === 'in_progress' ? 'transfer_in_progress'
    : result.status === 'pending_registry' ? 'pending_registry'
    : 'transfer_initiated';

  await withTransaction(pool, async (tx) => {
    await tx.query(
      `UPDATE domain_transfers
          SET status=$2, provider_reference=$3, provider_status=$4,
              provider_metadata = provider_metadata || $5::jsonb, initiated_at=now(), updated_at=now()
        WHERE id=$1`,
      [transferId, mapped, result.providerReference, result.providerStatus, JSON.stringify(result.metadata)]
    );
    await advanceTransferTransaction(tx, transferId, 'processing', result.providerReference);
  });

  const { createNotification } = await import('../services/notification-service');
  await createNotification(pool, {
    userId,
    type: 'DOMAIN_TRANSFER_INITIATED',
    title: 'Domain transfer initiated',
    message: 'Your domain transfer has been submitted to the registrar. We will notify you as it progresses.',
    resourceType: 'domain_transfer',
    resourceId: transferId,
  }).catch(() => undefined);
}

async function loadContact(pool: Queryable, ring: EncryptionKeyRing, contactId: string): Promise<DomainContactInput> {
  const { rows } = await pool.query<{ encrypted_contact_data: string }>(
    `SELECT encrypted_contact_data FROM domain_contacts WHERE id = $1`,
    [contactId]
  );
  const stored = rows[0];
  if (!stored) throw new DomainProviderError('PROVIDER_ERROR', 'Stored domain contact is missing', false, {});
  const parsed = JSON.parse(decryptSecret(ring, stored.encrypted_contact_data)) as RegistrationContactLite;
  return {
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    organization: null,
    email: parsed.email,
    phone: parsed.phone,
    addressLine1: parsed.addressLine1,
    addressLine2: null,
    city: parsed.city,
    state: parsed.state ?? null,
    postalCode: parsed.postalCode ?? null,
    countryCode: parsed.countryCode.toUpperCase(),
  };
}

async function linkTransferredDomain(
  tx: Queryable,
  userId: string,
  domainName: string,
  registrarName: string,
  transferId: string
): Promise<void> {
  const { rows: existing } = await tx.query<{ id: string }>(
    `SELECT id FROM customer_domains WHERE user_id = $1 AND lower(domain_name) = lower($2) LIMIT 1`,
    [userId, domainName]
  );
  const existingDomain = existing[0];
  if (existingDomain) {
    await tx.query(
      `UPDATE customer_domains
          SET registrar=$2, provider=$2, status='active', domain_type='transferred',
              verification_status='verified', verification_method='registrar', verified_at=now(),
              external_reference=$3, updated_at=now()
        WHERE id=$1`,
      [existingDomain.id, registrarName, transferId]
    );
    return;
  }
  await tx.query(
    `INSERT INTO customer_domains
       (id, user_id, domain_name, registrar, status, external_reference, created_by, domain_type,
        provider, verification_status, verification_method, verified_at, created_by_user)
     VALUES ($1,$2,$3,$4,'active',$5,$6,'transferred',$4,'verified','registrar',now(),false)`,
    [randomUUID(), userId, domainName, registrarName, transferId, userId]
  );

  const { createNotification } = await import('../services/notification-service');
  const { rows: transfer } = await tx.query<{ domain_name: string }>(
    `SELECT domain_name FROM domain_transfers WHERE id=$1`,
    [transferId]
  );
  await createNotification(tx, {
    userId,
    type: 'DOMAIN_TRANSFER_COMPLETED',
    title: 'Domain transfer completed',
    message: `${transfer[0]?.domain_name ?? 'Your domain'} has been transferred to your CloudHost247 account.`,
    resourceType: 'domain_transfer',
    resourceId: transferId,
  }).catch(() => undefined);
}

async function failTransfer(
  pool: Queryable,
  transferId: string,
  userId: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  await withTransaction(pool, async (tx) => {
    await tx.query(
      `UPDATE domain_transfers
          SET status='failed', failed_at=now(), error_code=$2, error_message=$3, updated_at=now()
        WHERE id=$1`,
      [transferId, errorCode, errorMessage.slice(0, 500)]
    );
    await advanceTransferTransaction(tx, transferId, 'failed', null, errorCode);
  });
  const { createNotification } = await import('../services/notification-service');
  await createNotification(pool, {
    userId,
    type: 'DOMAIN_TRANSFER_FAILED',
    title: 'Domain transfer failed',
    message: 'We could not complete your domain transfer. Our team will review it and follow up with you.',
    resourceType: 'domain_transfer',
    resourceId: transferId,
  }).catch(() => undefined);
}

async function advanceTransferTransaction(
  tx: Queryable,
  transferId: string,
  status: 'processing' | 'paid' | 'failed',
  providerReference?: string | null,
  errorCode?: string
): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM domain_transactions WHERE transfer_id=$1 AND transaction_type='transfer' LIMIT 1`,
    [transferId]
  );
  if (rows[0]) {
    await setDomainTransactionStatus(tx, rows[0].id, status, {
      providerReference: providerReference ?? null,
      errorCode: errorCode ?? null,
    });
  }
}

/** Dashboard: the caller's transfers (auth-code never included). */
export async function listMyTransfers(
  db: Queryable,
  userId: string
): Promise<Array<Record<string, unknown> & { status: string }>> {
  const { rows } = await db.query<Record<string, unknown> & { status: string }>(
    `SELECT t.id, t.domain_name, t.current_registrar, t.status, t.provider_status, t.provider_reference,
            t.initiated_at, t.completed_at, t.failed_at, t.error_code, t.error_message, t.created_at, t.updated_at,
            o.order_number, i.invoice_number, i.status AS invoice_status
       FROM domain_transfers t
       LEFT JOIN orders o ON o.id = t.order_id
       LEFT JOIN invoices i ON i.id = t.invoice_id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getMyTransfer(db: Queryable, userId: string, transferId: string) {
  const { rows } = await db.query(
    `SELECT t.id, t.domain_name, t.current_registrar, t.status, t.provider_status, t.provider_reference,
            t.authorization_confirmed_at, t.initiated_at, t.completed_at, t.failed_at, t.error_code,
            t.error_message, t.created_at, t.updated_at, o.order_number, i.invoice_number, i.status AS invoice_status
       FROM domain_transfers t
       LEFT JOIN orders o ON o.id = t.order_id
       LEFT JOIN invoices i ON i.id = t.invoice_id
      WHERE t.id = $1 AND t.user_id = $2`,
    [transferId, userId]
  );
  if (!rows[0]) throw new NotFoundError('No transfer was found with that id');
  return rows[0];
}

/**
 * Admin: retry-able provider poll for one transfer (re-checks provider state immediately instead
 * of waiting for the sweep window).
 */
export async function adminRefreshTransfer(
  pool: Queryable,
  ring: EncryptionKeyRing,
  transferId: string
): Promise<{ status: string; providerStatus: string | null }> {
  const { rows } = await pool.query<{
    id: string; user_id: string; domain_name: string; provider_reference: string | null; provider_id: string | null;
  }>(
    `SELECT id, user_id, domain_name, provider_reference, provider_id FROM domain_transfers WHERE id = $1`,
    [transferId]
  );
  const transfer = rows[0];
  if (!transfer) throw new NotFoundError('No transfer was found with that id');

  const provider = await resolveDomainProviderById(pool, transfer.provider_id);
  if (!provider) throw new ValidationError('The registrar provider for this transfer is not available');

  const status = await provider.adapter.getDomainStatus(transfer.provider_reference ?? '', transfer.domain_name);
  const mapped = mapProviderTransferStatus(status.providerStatus) ?? 'transfer_in_progress';
  if (status.transferStatus === 'completed' || status.registrationStatus === 'registered') {
    await withTransaction(pool, async (tx) => {
      const { rows: updated } = await tx.query(
        `UPDATE domain_transfers SET status='completed', provider_status=$2, completed_at=now(), updated_at=now()
          WHERE id=$1 AND status <> 'completed' RETURNING id`,
        [transferId, status.providerStatus]
      );
      if (updated[0]) {
        await linkTransferredDomain(tx, transfer.user_id, transfer.domain_name, provider.provider.name, transferId);
        await advanceTransferTransaction(tx, transferId, 'paid');
      }
    });
    return { status: 'completed', providerStatus: status.providerStatus };
  }
  await pool.query(`UPDATE domain_transfers SET status=$2, provider_status=$3, updated_at=now() WHERE id=$1`, [
    transferId,
    mapped,
    status.providerStatus,
  ]);
  return { status: mapped, providerStatus: status.providerStatus };
}

/** Admin: update the internal status/notes of a transfer (audit-logged by the route). */
export async function adminUpdateTransferStatus(
  db: Queryable,
  transferId: string,
  status: string,
  note?: string
): Promise<void> {
  const valid = ['pending', 'authorization_required', 'transfer_initiated', 'transfer_in_progress', 'pending_registry', 'completed', 'failed', 'cancelled'];
  if (!valid.includes(status)) throw new ValidationError('Invalid transfer status');
  const { rows: updated } = await db.query(
    `UPDATE domain_transfers
        SET status=$2,
            provider_metadata = provider_metadata || $3::jsonb,
            completed_at = CASE WHEN $2='completed' THEN now() ELSE completed_at END,
            updated_at=now()
      WHERE id=$1
      RETURNING id`,
    [transferId, status, JSON.stringify({ adminNote: note ?? null, adminUpdatedAt: new Date().toISOString() })]
  );
  if (updated.length === 0) throw new NotFoundError('No transfer was found with that id');
}
