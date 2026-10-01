/**
 * Domain registration — payment-gated, provider-confirmed.
 *
 * The only path to a `registered` domain:
 *   1. Server re-verifies availability and resolves the price from the provider (never the client).
 *   2. An order + invoice are created through the EXISTING billing primitives with order-item
 *      metadata { kind: 'domain_registration', registrationId }.
 *   3. The customer pays; the verified payment webhook (the only authority) advances the
 *      registration to `payment_verified` via provisionPaidOrder.
 *   4. The worker sweep claims the registration, calls the registrar adapter, and only a real
 *      provider confirmation can set `registered` (linking a customer_domains row at that point).
 *
 * A frontend payment-success page can never mark a domain registered.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { createOrder } from '../db/orders';
import { issueInvoiceForOrder } from '../services/billing-service';
import { toCents, fromCents } from '../lib/money';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { DEFAULT_CURRENCY } from '../config/billing';
import { DomainProviderError } from './providers/types';
import { resolveConnectedDomainProvider, resolveDomainProviderById } from './provider-service';
import { baseOfferingPriceFor } from './extensions-service';
import { isValidDomainName, normalizeDomainName } from './domain-name';
import { REGISTRATION_MAX_YEARS, REGISTRATION_MIN_YEARS } from './config';
import { recordDomainTransaction, setDomainTransactionStatus } from './transactions';
import { getActiveMembershipDiscount } from './club-service';
import { encryptSecret, type EncryptionKeyRing } from '../lib/crypto';

export interface RegistrationContactInput {
  firstName: string;
  lastName: string;
  organization?: string | null;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  countryCode: string;
}

export interface CreateRegistrationOrderInput {
  domainName: string;
  years: number;
  contact: RegistrationContactInput;
}

export interface RegistrationQuote {
  domainName: string;
  years: number;
  isPremium: boolean;
  standardPrice: string;
  memberPrice: string | null;
  discountAmount: string | null;
  currency: string;
  clubName: string | null;
}

export interface CreateRegistrationOrderResult {
  registrationId: string;
  orderId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
}

function validateContact(contact: RegistrationContactInput): void {
  const required: Array<[keyof RegistrationContactInput, string]> = [
    ['firstName', 'First name'],
    ['lastName', 'Last name'],
    ['email', 'Email'],
    ['phone', 'Phone'],
    ['addressLine1', 'Address'],
    ['city', 'City'],
    ['countryCode', 'Country'],
  ];
  for (const [key, label] of required) {
    const value = contact[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError(`Domain contact is missing ${label}`);
    }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) {
    throw new ValidationError('Domain contact email is not valid');
  }
  if (!/^[A-Z]{2}$/.test(contact.countryCode.toUpperCase())) {
    throw new ValidationError('Domain contact country must be a 2-letter ISO code');
  }
}

/**
 * Resolves the authoritative registration price for a domain right now: a fresh provider
 * availability check (which quotes premium prices) or, failing that, the synced base offering.
 * Throws for unavailable/registered domains — a quote is only ever produced for a domain the
 * provider currently says is registerable.
 */
export async function quoteRegistration(
  db: Queryable,
  domainName: string,
  years: number
): Promise<{
  price: string;
  currency: string;
  isPremium: boolean;
  availability: 'available' | 'premium';
}> {
  const normalized = normalizeDomainName(domainName);
  if (!isValidDomainName(normalized)) throw new ValidationError('Enter a valid domain name, e.g. example.com');
  if (!Number.isInteger(years) || years < REGISTRATION_MIN_YEARS || years > REGISTRATION_MAX_YEARS) {
    throw new ValidationError(`Registration term must be between ${REGISTRATION_MIN_YEARS} and ${REGISTRATION_MAX_YEARS} years`);
  }

  const provider = await resolveConnectedDomainProvider(db, 'registrar');
  const availabilityResults = await provider.adapter.checkAvailability([normalized]);
  const availability = availabilityResults.find((entry) => entry.domainName === normalized);
  if (!availability) {
    throw new ValidationError('The domain provider did not answer for that domain. Please try again.');
  }
  if (availability.status !== 'available' && availability.status !== 'premium') {
    if (availability.status === 'registered') {
      throw new ConflictError('That domain is already registered. Try transferring it instead.');
    }
    throw new ConflictError('That domain is not available for registration right now.');
  }

  const isPremium = availability.status === 'premium';
  let price: string | null = null;
  let currency: string = DEFAULT_CURRENCY;
  if (availability.pricing?.registration) {
    price = availability.pricing.registration.amount;
    currency = availability.pricing.registration.currency;
  }
  if (!price) {
    const base = await baseOfferingPriceFor(db, normalized);
    if (base) {
      price = base.registration;
      currency = base.currency;
    }
  }
  if (!price) {
    throw new ValidationError('The registration price for this domain is not available right now.');
  }
  if (currency.toUpperCase() !== DEFAULT_CURRENCY) {
    // Single-currency platform (docs/API_BILLING.md) — a non-USD provider quote cannot be charged.
    throw new ValidationError('This domain is quoted in a currency this platform does not support yet.');
  }
  return { price, currency, isPremium, availability: isPremium ? 'premium' : 'available' };
}

/** Computes the member price for a user (null when the user has no active Domain Club membership). */
export async function registrationQuoteWithMembership(
  db: Queryable,
  userId: string,
  domainName: string,
  years: number
): Promise<RegistrationQuote> {
  const quote = await quoteRegistration(db, domainName, years);
  const discount = await getActiveMembershipDiscount(db, userId, domainName);
  if (!discount) {
    return {
      domainName: normalizeDomainName(domainName),
      years,
      isPremium: quote.isPremium,
      standardPrice: quote.price,
      memberPrice: null,
      discountAmount: null,
      currency: quote.currency,
      clubName: null,
    };
  }
  const discountCents = discount.type === 'percentage'
    ? Math.round((toCents(quote.price) * discount.value) / 100)
    : Math.min(discount.value, toCents(quote.price));
  const memberCents = Math.max(0, toCents(quote.price) - discountCents);
  return {
    domainName: normalizeDomainName(domainName),
    years,
    isPremium: quote.isPremium,
    standardPrice: quote.price,
    memberPrice: fromCents(memberCents),
    discountAmount: fromCents(discountCents),
    currency: quote.currency,
    clubName: discount.clubName,
  };
}

/**
 * Creates the registration order. Runs in one transaction: registration row, encrypted contact,
 * order + invoice, domain transaction. The registration is `pending_payment` — nothing is owed to
 * or claimed from the registrar until the payment webhook verifies settlement.
 */
export async function createRegistrationOrder(
  db: Queryable,
  ring: EncryptionKeyRing,
  userId: string,
  input: CreateRegistrationOrderInput,
  genId: () => string = randomUUID
): Promise<CreateRegistrationOrderResult> {
  validateContact(input.contact);
  const normalized = normalizeDomainName(input.domainName);
  const quote = await registrationQuoteWithMembership(db, userId, normalized, input.years);
  const chargeAmount = quote.memberPrice ?? quote.standardPrice;
  if (toCents(chargeAmount) < 0) throw new ValidationError('Computed registration price is invalid');

  // One live registration attempt per domain (database partial unique index backs this up).
  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM domain_registrations
      WHERE lower(domain_name) = lower($1)
        AND status IN ('payment_verified','registration_requested','pending_provider_confirmation','registered')`,
    [normalized]
  );
  if (existing[0]) {
    throw new ConflictError('A registration for that domain is already in progress on an account.');
  }

  // Provider recorded on the registration row; resolved again below through the shared helper.
  const providerRow = await resolveConnectedRegistrarRow(db);
  const registrationId = genId();
  const contactId = genId();

  const result = await withTransaction(db, async (tx) => {
    // Encrypted domain contact (AES-256-GCM envelope, same keyring as provider credentials).
    await tx.query(
      `INSERT INTO domain_contacts (id, user_id, encrypted_contact_data, key_version, display_label)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        contactId,
        userId,
        encryptSecret(ring, JSON.stringify({ ...input.contact, countryCode: input.contact.countryCode.toUpperCase() })),
        1,
        `${input.contact.firstName} ${input.contact.lastName}`.slice(0, 120),
      ]
    );

    await tx.query(
      `INSERT INTO domain_registrations
         (id, user_id, provider_id, contact_id, order_id, domain_name, registration_years, status, provider_metadata)
       VALUES ($1,$2,$3,$4,NULL,$5,$6,'pending_payment',$7)`,
      [
        registrationId,
        userId,
        providerRow.id,
        contactId,
        normalized,
        input.years,
        JSON.stringify({ quotedPrice: quote.standardPrice, memberPrice: quote.memberPrice, isPremium: quote.isPremium }),
      ]
    );

    const unitCents = toCents(chargeAmount);
    const totalCents = unitCents * input.years;
    const { order, invoice } = await createRegistrationCommerceRecords(tx, userId, {
      registrationId,
      domainName: normalized,
      years: input.years,
      unitPriceAmount: fromCents(unitCents),
      lineTotalAmount: fromCents(totalCents),
      currency: quote.currency,
      genId,
    });

    await tx.query(`UPDATE domain_registrations SET order_id=$2, invoice_id=$3, updated_at=now() WHERE id=$1`, [
      registrationId,
      order.id,
      invoice.id,
    ]);

    await recordDomainTransaction(tx, {
      userId,
      transactionType: 'registration',
      status: 'pending',
      amount: fromCents(totalCents),
      currency: quote.currency,
      orderId: order.id,
      invoiceId: invoice.id,
      registrationId,
      metadata: { domainName: normalized, years: input.years, isPremium: quote.isPremium },
    });

    return { order, invoice };
  });

  return {
    registrationId,
    orderId: result.order.id,
    invoiceId: result.invoice.id,
    invoiceNumber: result.invoice.invoice_number,
    amount: result.order.total_amount,
    currency: result.order.currency,
  };
}

async function createRegistrationCommerceRecords(
  tx: Queryable,
  userId: string,
  input: {
    registrationId: string;
    domainName: string;
    years: number;
    unitPriceAmount: string;
    lineTotalAmount: string;
    currency: string;
    genId: () => string;
  }
) {
  const orderId = input.genId();
  const { order } = await createOrder(tx, {
    id: orderId,
    userId,
    currency: input.currency,
    subtotalAmount: input.lineTotalAmount,
    discountAmount: '0.00',
    taxAmount: '0.00',
    totalAmount: input.lineTotalAmount,
    items: [
      {
        id: input.genId(),
        productId: null,
        planId: null,
        productNameSnapshot: 'Domain Services',
        planNameSnapshot: `Domain registration — ${input.domainName} (${input.years} year${input.years === 1 ? '' : 's'})`,
        billingPeriod: 'one_time',
        quantity: 1,
        unitPriceAmount: input.lineTotalAmount,
        currency: input.currency,
        lineTotalAmount: input.lineTotalAmount,
        metadata: { kind: 'domain_registration', registrationId: input.registrationId, domainName: input.domainName, years: input.years },
      },
    ],
  });
  const invoice = await issueInvoiceForOrder(tx, order, input.genId);
  return { order, invoice };
}

/** The connected registrar's row (id needed for the registration FK), failing closed. */
async function resolveConnectedRegistrarRow(db: Queryable): Promise<{ id: string; name: string }> {
  const provider = await resolveConnectedDomainProvider(db, 'registrar');
  return { id: provider.provider.id, name: provider.provider.name };
}

/**
 * Webhook-settlement hook (called from provisionPaidOrder inside the payment transaction):
 * advances the registration from `pending_payment` to `payment_verified`. The provider call
 * itself is deliberately NOT made here — the worker sweep owns that, so a slow registrar API can
 * never hold the settlement transaction open.
 */
export async function markRegistrationPaymentVerified(tx: Queryable, registrationId: string): Promise<void> {
  const { rows: advanced } = await tx.query(
    `UPDATE domain_registrations
        SET status = 'payment_verified', updated_at = now()
      WHERE id = $1 AND status = 'pending_payment'
      RETURNING id`,
    [registrationId]
  );
  if (advanced.length === 0) return; // Already advanced (duplicate webhook) — idempotent no-op.
  const { rows } = await tx.query<{ user_id: string }>(`SELECT user_id FROM domain_registrations WHERE id = $1`, [registrationId]);
  const registration = rows[0];
  if (registration) {
    const { rows: txn } = await tx.query<{ id: string }>(
      `SELECT id FROM domain_transactions WHERE registration_id = $1 AND transaction_type = 'registration' LIMIT 1`,
      [registrationId]
    );
    if (txn[0]) {
      await setDomainTransactionStatus(tx, txn[0].id, 'processing');
    }
  }
}

export interface RegistrationProcessingReport {
  claimed: number;
  registered: number;
  pending: number;
  failed: number;
}

/**
 * Worker sweep step 1: claim every `payment_verified` registration (compare-and-swap on status)
 * and call the registrar. A successful provider call records `pending_provider_confirmation` or
 * `registered` (per the provider's own answer); failure marks `failed` with a sanitized reason
 * and notifies the customer — the money stays recorded for staff refund handling.
 */
export async function processPaidRegistrations(
  pool: Queryable,
  ring: EncryptionKeyRing,
  batchSize = 10
): Promise<RegistrationProcessingReport> {
  const { rows: candidates } = await pool.query<{
    id: string; user_id: string; domain_name: string; registration_years: number; provider_id: string | null;
    contact_id: string | null;
  }>(
    `SELECT r.id, r.user_id, r.domain_name, r.registration_years, r.provider_id, r.contact_id
       FROM domain_registrations r
      WHERE r.status = 'payment_verified'
      ORDER BY r.updated_at ASC
      LIMIT $1`,
    [batchSize]
  );

  const report: RegistrationProcessingReport = { claimed: 0, registered: 0, pending: 0, failed: 0 };

  for (const candidate of candidates) {
    // CAS claim: only one worker cycle can move this row forward.
    const { rows: claimed } = await pool.query(
      `UPDATE domain_registrations
          SET status = 'registration_requested', requested_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'payment_verified'
        RETURNING id`,
      [candidate.id]
    );
    if (!claimed[0]) continue;
    report.claimed += 1;

    const provider = await resolveDomainProviderById(pool, candidate.provider_id);
    if (!provider) {
      await failRegistration(pool, candidate.id, candidate.user_id, 'PROVIDER_NOT_CONFIGURED', 'Domain registrar is not configured');
      report.failed += 1;
      continue;
    }

    try {
      const contact = await loadDecryptedContact(pool, ring, candidate.user_id, candidate.contact_id);
      const result = await provider.adapter.registerDomain({
        domainName: candidate.domain_name,
        years: candidate.registration_years,
        contacts: {
          registrant: contact,
          administrative: contact,
          technical: contact,
          billing: contact,
        },
        idempotencyKey: candidate.id,
      });

      const confirmed = result.status === 'registered';
      await withTransaction(pool, async (tx) => {
        await tx.query(
          `UPDATE domain_registrations
              SET status = $2, provider_reference = $3, provider_status = $4, provider_metadata = $5,
                  confirmed_at = CASE WHEN $6 THEN now() ELSE confirmed_at END,
                  updated_at = now()
            WHERE id = $1`,
          [
            candidate.id,
            confirmed ? 'registered' : 'pending_provider_confirmation',
            result.providerReference,
            result.providerStatus,
            JSON.stringify(result.metadata),
            confirmed,
          ]
        );
        if (confirmed) {
          await linkRegisteredDomain(tx, candidate.user_id, candidate.domain_name, provider.provider.name, candidate.id);
          await notifyRegistrationSucceeded(tx, candidate.id, candidate.user_id, candidate.domain_name);
        }
        await advanceRegistrationTransaction(tx, candidate.id, confirmed ? 'paid' : 'processing', result.providerReference);
      });
      if (confirmed) report.registered += 1;
      else report.pending += 1;
    } catch (error) {
      const code = error instanceof DomainProviderError ? error.code : 'PROVIDER_ERROR';
      const message = error instanceof Error ? error.message : String(error);
      await failRegistration(pool, candidate.id, candidate.user_id, code, message);
      report.failed += 1;
    }
  }
  return report;
}

/** Worker sweep step 2: poll registrations awaiting provider confirmation. */
export async function confirmPendingRegistrations(pool: Queryable, batchSize = 10): Promise<number> {
  const { rows: candidates } = await pool.query<{
    id: string; user_id: string; domain_name: string; provider_reference: string | null; provider_id: string | null;
  }>(
    `SELECT r.id, r.user_id, r.domain_name, r.provider_reference, r.provider_id
       FROM domain_registrations r
      WHERE r.status IN ('registration_requested', 'pending_provider_confirmation')
      ORDER BY r.updated_at ASC
      LIMIT $1`,
    [batchSize]
  );

  let confirmedCount = 0;
  for (const candidate of candidates) {
    const provider = await resolveDomainProviderById(pool, candidate.provider_id);
    if (!provider) continue;
    try {
      const status = await provider.adapter.getDomainStatus(candidate.provider_reference ?? '', candidate.domain_name);
      if (status.registrationStatus === 'registered') {
        await withTransaction(pool, async (tx) => {
          const { rows: updated } = await tx.query(
            `UPDATE domain_registrations
                SET status = 'registered', provider_status = $2, confirmed_at = now(), updated_at = now()
              WHERE id = $1 AND status <> 'registered'
              RETURNING id`,
            [candidate.id, status.providerStatus]
          );
          if (updated[0]) {
            await linkRegisteredDomain(tx, candidate.user_id, candidate.domain_name, provider.provider.name, candidate.id);
            await notifyRegistrationSucceeded(tx, candidate.id, candidate.user_id, candidate.domain_name);
            await advanceRegistrationTransaction(tx, candidate.id, 'paid', candidate.provider_reference);
            confirmedCount += 1;
          }
        });
      } else if (status.registrationStatus === 'failed') {
        await failRegistration(pool, candidate.id, candidate.user_id, 'PROVIDER_ERROR', status.providerStatus ?? 'Provider reported failure');
      }
    } catch {
      // Transient provider errors are retried on the next sweep by design.
    }
  }
  return confirmedCount;
}

async function loadDecryptedContact(
  pool: Queryable,
  ring: EncryptionKeyRing,
  userId: string,
  contactId: string | null
) {
  // The registration's own contact row is authoritative. Only when the FK is missing (legacy row)
  // do we fall back to the user's most recent contact.
  const { rows } = await pool.query<{ encrypted_contact_data: string }>(
    `SELECT encrypted_contact_data FROM domain_contacts
      WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
         OR ($1::uuid IS NULL AND user_id = $2 AND id = (
              SELECT id FROM domain_contacts WHERE user_id = $2 ORDER BY created_at DESC LIMIT 1
            ))
      LIMIT 1`,
    [contactId, userId]
  );
  const stored = rows[0];
  if (!stored) throw new DomainProviderError('PROVIDER_ERROR', 'No domain contact on file for this registration', false, {});
  const { decryptSecret } = await import('../lib/crypto');
  const parsed = JSON.parse(decryptSecret(ring, stored.encrypted_contact_data)) as RegistrationContactInput;
  return { ...parsed, countryCode: parsed.countryCode.toUpperCase() };
}

/** Creates (or links) the customer_domains record for a registrar-confirmed registration. */
export async function linkRegisteredDomain(
  tx: Queryable,
  userId: string,
  domainName: string,
  registrarName: string,
  registrationId: string
): Promise<void> {
  const { rows: existing } = await tx.query<{ id: string }>(
    `SELECT id FROM customer_domains WHERE user_id = $1 AND lower(domain_name) = lower($2) LIMIT 1`,
    [userId, domainName]
  );
  const existingDomain = existing[0];
  if (existingDomain) {
    await tx.query(
      `UPDATE customer_domains
          SET registrar = $2, provider = $2, status = 'active',
              verification_status = 'verified', verification_method = 'registrar',
              verified_at = now(), external_reference = $3, updated_at = now()
        WHERE id = $1`,
      [existingDomain.id, registrarName, registrationId]
    );
    return;
  }
  await tx.query(
    `INSERT INTO customer_domains
       (id, user_id, domain_name, registrar, status, external_reference, created_by,
        domain_type, provider, verification_status, verification_method, verified_at, created_by_user)
     VALUES ($1,$2,$3,$4,'active',$5,$6,'custom',$4,'verified','registrar',now(),false)`,
    [randomUUID(), userId, domainName, registrarName, registrationId, userId]
  );
}

async function failRegistration(
  pool: Queryable,
  registrationId: string,
  userId: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  await withTransaction(pool, async (tx) => {
    await tx.query(
      `UPDATE domain_registrations
          SET status = 'failed', failed_at = now(), error_code = $2, error_message = $3, updated_at = now()
        WHERE id = $1`,
      [registrationId, errorCode, errorMessage.slice(0, 500)]
    );
    await advanceRegistrationTransaction(tx, registrationId, 'failed', null, errorCode);
  });
  const { createNotification } = await import('../services/notification-service');
  await createNotification(pool, {
    userId,
    type: 'DOMAIN_REGISTRATION_FAILED',
    title: 'Domain registration could not be completed',
    message: `We could not complete the registration request for your domain. Our team will review the order and follow up. Reference: ${registrationId}`,
    resourceType: 'domain_registration',
    resourceId: registrationId,
  }).catch(() => undefined);
}

/**
 * "Domain registration succeeded" — sent only after the REGISTRAR confirmed the domain, never on
 * payment alone. Deduped on (user, type, registration), so the settle path and the polling path
 * cannot both notify for the same registration.
 */
async function notifyRegistrationSucceeded(
  tx: Queryable,
  registrationId: string,
  userId: string,
  domainName: string
): Promise<void> {
  const { createNotification } = await import('../services/notification-service');
  await createNotification(tx, {
    userId,
    type: 'DOMAIN_REGISTRATION_COMPLETED',
    title: 'Your domain registration is complete',
    message: `${domainName} has been registered and is now live in your CloudHost247 account. Manage it from your dashboard.`,
    resourceType: 'domain_registration',
    resourceId: registrationId,
  }).catch(() => undefined);
}

async function advanceRegistrationTransaction(
  tx: Queryable,
  registrationId: string,
  status: 'processing' | 'paid' | 'failed',
  providerReference: string | null,
  errorCode?: string
): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM domain_transactions WHERE registration_id = $1 AND transaction_type = 'registration' LIMIT 1`,
    [registrationId]
  );
  if (rows[0]) {
    await setDomainTransactionStatus(tx, rows[0].id, status, { providerReference, errorCode: errorCode ?? null });
  }
}

/** Dashboard listing for the authenticated user. */
export async function listMyRegistrations(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT r.id, r.domain_name, r.registration_years, r.status, r.provider_reference, r.provider_status,
            r.requested_at, r.confirmed_at, r.error_code, r.error_message, r.created_at, r.updated_at,
            o.order_number, i.invoice_number, i.status AS invoice_status
       FROM domain_registrations r
       LEFT JOIN orders o ON o.id = r.order_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getMyRegistration(db: Queryable, userId: string, registrationId: string) {
  const { rows } = await db.query(
    `SELECT r.*, o.order_number, i.invoice_number, i.status AS invoice_status, i.id AS invoice_id
       FROM domain_registrations r
       LEFT JOIN orders o ON o.id = r.order_id
       LEFT JOIN invoices i ON i.id = r.invoice_id
      WHERE r.id = $1 AND r.user_id = $2`,
    [registrationId, userId]
  );
  if (!rows[0]) throw new NotFoundError('No registration was found with that id');
  return rows[0];
}
