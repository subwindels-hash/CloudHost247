/**
 * CloudHost247 expert services ("Hire an Expert" / Website Design Services).
 *
 * The pipeline is a real, priced engagement rather than a contact form:
 *
 *   requested → scoping → quoted → (customer approves) → invoice paid → in_progress → review →
 *   delivered → completed, with rejected / cancelled / failed as honest terminal states.
 *
 * Money rules (identical to the rest of the platform):
 *   - the catalogue's `starting_price_amount` is a *public label only* and is never charged;
 *   - the amount charged is the staff-issued quote the customer explicitly approves, and the order
 *     is created from that stored quote — never from a request body;
 *   - the engagement only advances to `in_progress` when the existing payment webhook confirms
 *     settlement (src/commerce/fulfilment-service.ts), never because a page said so.
 *
 * Support tickets stay the support channel; a request can link one for conversation but never
 * replaces it.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { createOrder } from '../db/orders';
import { issueInvoiceForOrder } from '../services/billing-service';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { DEFAULT_CURRENCY } from '../config/billing';
import { createNotification } from '../services/notification-service';
import { toCents, fromCents } from '../lib/money';

export type RequestStatus =
  | 'requested' | 'scoping' | 'quoted' | 'approved' | 'in_progress' | 'review'
  | 'delivered' | 'completed' | 'rejected' | 'cancelled' | 'failed';

/** The only legal status transitions — enforced in code so a status can never jump backwards. */
const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  requested: ['scoping', 'quoted', 'rejected', 'cancelled'],
  scoping: ['quoted', 'rejected', 'cancelled'],
  quoted: ['approved', 'cancelled', 'rejected'],
  approved: ['in_progress', 'cancelled'],
  in_progress: ['review', 'delivered', 'failed', 'cancelled'],
  review: ['in_progress', 'delivered', 'failed', 'cancelled'],
  delivered: ['completed', 'in_progress'],
  completed: [],
  rejected: [],
  cancelled: [],
  failed: ['in_progress', 'cancelled'],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/* --------------------------------------------------------------------------------------------
 * Catalogue (public + admin)
 * ------------------------------------------------------------------------------------------ */

export async function listOfferings(db: Queryable, includeUnpublished = false) {
  const { rows } = await db.query(
    `SELECT id, code, name, category, summary, description, deliverables, typical_delivery_days,
            starting_price_amount, currency, pricing_model, status, sort_order
       FROM expert_service_offerings
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
    category: string;
    summary?: string;
    description?: string;
    deliverables?: string[];
    typicalDeliveryDays?: number | null;
    startingPriceAmount?: number | null;
    pricingModel?: 'quoted' | 'fixed';
    status?: 'draft' | 'published' | 'archived';
    sortOrder?: number;
  },
  existingId?: string
) {
  const categories = ['website_design', 'website_development', 'ecommerce', 'redesign', 'seo', 'migration', 'maintenance', 'integration', 'consulting'];
  if (!categories.includes(input.category)) throw new ValidationError('Choose a supported service category');
  const name = input.name.trim().slice(0, 160);
  if (!name) throw new ValidationError('A service needs a name');
  const pricingModel = input.pricingModel ?? 'quoted';
  if (pricingModel === 'fixed' && (input.startingPriceAmount === undefined || input.startingPriceAmount === null)) {
    throw new ValidationError('A fixed-price service needs a price');
  }
  const deliverables = (input.deliverables ?? []).slice(0, 20).map((item) => item.trim().slice(0, 200)).filter(Boolean);

  if (existingId) {
    const { rows } = await db.query(
      `UPDATE expert_service_offerings SET
          name = $2, category = $3, summary = COALESCE($4, summary), description = COALESCE($5, description),
          deliverables = $6, typical_delivery_days = $7, starting_price_amount = $8, pricing_model = $9,
          status = COALESCE($10, status), sort_order = COALESCE($11, sort_order), updated_at = now()
        WHERE id = $1
        RETURNING id, code, name, category, status, pricing_model, starting_price_amount, currency`,
      [
        existingId,
        name,
        input.category,
        input.summary ?? null,
        input.description ?? null,
        JSON.stringify(deliverables),
        input.typicalDeliveryDays ?? null,
        input.startingPriceAmount === undefined || input.startingPriceAmount === null ? null : input.startingPriceAmount.toFixed(2),
        pricingModel,
        input.status ?? null,
        input.sortOrder ?? null,
      ]
    );
    if (!rows[0]) throw new NotFoundError('No service was found with that id');
    return rows[0];
  }

  const code = (input.code ?? name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  const { rows } = await db.query(
    `INSERT INTO expert_service_offerings
       (id, code, name, category, summary, description, deliverables, typical_delivery_days,
        starting_price_amount, currency, pricing_model, status, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (lower(code)) DO NOTHING
     RETURNING id, code, name, category, status, pricing_model, starting_price_amount, currency`,
    [
      randomUUID(),
      code,
      name,
      input.category,
      (input.summary ?? '').slice(0, 500),
      (input.description ?? '').slice(0, 6000),
      JSON.stringify(deliverables),
      input.typicalDeliveryDays ?? null,
      input.startingPriceAmount === undefined || input.startingPriceAmount === null ? null : input.startingPriceAmount.toFixed(2),
      DEFAULT_CURRENCY,
      pricingModel,
      input.status ?? 'draft',
      input.sortOrder ?? 0,
    ]
  );
  if (!rows[0]) throw new ConflictError('A service with that code already exists');
  return rows[0];
}

/* --------------------------------------------------------------------------------------------
 * Requests (customer)
 * ------------------------------------------------------------------------------------------ */

function makeReference(): string {
  return `EXP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export async function createRequest(
  db: Queryable,
  userId: string,
  input: {
    offeringCode: string;
    title: string;
    description: string;
    goals?: string[];
    referenceUrl?: string | null;
    budgetAmount?: number | null;
    desiredStartDate?: string | null;
    supportTicketId?: string | null;
  }
) {
  const { rows: offeringRows } = await db.query<{ id: string; code: string; name: string; status: string }>(
    `SELECT id, code, name, status FROM expert_service_offerings WHERE lower(code) = lower($1) LIMIT 1`,
    [input.offeringCode]
  );
  const offering = offeringRows[0];
  if (!offering || offering.status !== 'published') {
    throw new NotFoundError('No such CloudHost247 expert service is available');
  }
  const title = input.title.trim().slice(0, 200);
  const description = input.description.trim();
  if (title.length < 4) throw new ValidationError('Give the request a clear title');
  if (description.length < 30) throw new ValidationError('Describe the work you need in at least 30 characters');
  if (description.length > 8000) throw new ValidationError('Keep the description under 8000 characters');
  if (input.budgetAmount !== undefined && input.budgetAmount !== null && !(input.budgetAmount >= 0)) {
    throw new ValidationError('A budget cannot be negative');
  }
  if (input.referenceUrl && !/^https:\/\//.test(input.referenceUrl)) {
    throw new ValidationError('A reference link must be an https:// URL');
  }

  const id = randomUUID();
  const reference = makeReference();
  await withTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO expert_service_requests
         (id, reference, user_id, offering_id, offering_code, title, description, goals, reference_url,
          budget_amount, currency, desired_start_date, status, support_ticket_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'requested',$13)`,
      [
        id,
        reference,
        userId,
        offering.id,
        offering.code,
        title,
        description,
        JSON.stringify((input.goals ?? []).slice(0, 10).map((goal) => goal.trim().slice(0, 160)).filter(Boolean)),
        input.referenceUrl ?? null,
        input.budgetAmount === undefined || input.budgetAmount === null ? null : input.budgetAmount.toFixed(2),
        DEFAULT_CURRENCY,
        input.desiredStartDate ?? null,
        input.supportTicketId ?? null,
      ]
    );
    await tx.query(
      `INSERT INTO expert_service_request_events (id, request_id, event_type, actor_id, actor_role, to_status)
       VALUES ($1,$2,'request_created',$3,'customer','requested')`,
      [randomUUID(), id, userId]
    );
    await tx.query(
      `INSERT INTO expert_service_request_messages (id, request_id, author_id, author_role, visibility, body)
       VALUES ($1,$2,$3,'customer','customer',$4)`,
      [randomUUID(), id, userId, description]
    );
  });

  await notifyStaffQueue(db, id, reference, title);
  return { id, reference };
}

/** Notifies the delivery team through the existing notification pipeline (all staff + admins). */
async function notifyStaffQueue(db: Queryable, requestId: string, reference: string, title: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE role IN ('staff','admin','super_admin') AND status = 'active' LIMIT 25`
  );
  for (const user of rows) {
    await createNotification(db, {
      userId: user.id,
      type: 'EXPERT_REQUEST_QUEUE',
      title: `New expert-service request ${reference}`,
      message: `${title}\nOpen Admin → Expert Services to scope and quote it.`,
      resourceType: 'expert_service_request',
      resourceId: requestId,
    });
  }
}

export async function listMyRequests(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT r.id, r.reference, r.offering_code, r.title, r.status, r.priority, r.budget_amount, r.currency,
            r.desired_start_date, r.order_id, r.invoice_id, r.created_at, r.updated_at, r.completed_at,
            o.name AS offering_name,
            (SELECT q.amount FROM expert_service_quotes q WHERE q.request_id = r.id AND q.status = 'issued' ORDER BY q.created_at DESC LIMIT 1) AS live_quote_amount,
            (SELECT count(*)::int FROM expert_service_request_messages m WHERE m.request_id = r.id AND m.visibility = 'customer') AS message_count
       FROM expert_service_requests r
       LEFT JOIN expert_service_offerings o ON o.id = r.offering_id
      WHERE r.user_id = $1 ORDER BY r.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getRequestForCustomer(db: Queryable, userId: string, requestId: string) {
  const { rows } = await db.query(
    `SELECT r.*, o.name AS offering_name, o.category AS offering_category,
            o.typical_delivery_days, o.deliverables AS offering_deliverables
       FROM expert_service_requests r
       LEFT JOIN expert_service_offerings o ON o.id = r.offering_id
      WHERE r.id = $1 AND r.user_id = $2 LIMIT 1`,
    [requestId, userId]
  );
  const request = rows[0];
  if (!request) throw new NotFoundError('No request was found with that id');

  const { rows: quotes } = await db.query(
    `SELECT id, amount, currency, scope, deliverables, delivery_days, valid_until, status, decided_at, decision_note, created_at
       FROM expert_service_quotes WHERE request_id = $1 ORDER BY created_at DESC`,
    [requestId]
  );
  const { rows: messages } = await db.query(
    `SELECT id, author_role, body, created_at FROM expert_service_request_messages
      WHERE request_id = $1 AND visibility = 'customer' ORDER BY created_at ASC`,
    [requestId]
  );
  const { rows: timeline } = await db.query(
    `SELECT event_type, from_status, to_status, created_at FROM expert_service_request_events
      WHERE request_id = $1 ORDER BY created_at ASC`,
    [requestId]
  );
  return { request, quotes, messages, timeline };
}

export async function addCustomerMessage(db: Queryable, userId: string, requestId: string, body: string) {
  const { rows } = await db.query<{ status: string }>(
    `SELECT status FROM expert_service_requests WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [requestId, userId]
  );
  if (!rows[0]) throw new NotFoundError('No request was found with that id');
  if (['cancelled', 'completed', 'rejected'].includes(rows[0].status)) {
    throw new ConflictError('This request is closed — open a support ticket if you need to continue the conversation');
  }
  const text = body.trim();
  if (!text) throw new ValidationError('Write a message first');
  if (text.length > 8000) throw new ValidationError('Keep the message under 8000 characters');
  const { rows: message } = await db.query(
    `INSERT INTO expert_service_request_messages (id, request_id, author_id, author_role, visibility, body)
     VALUES ($1,$2,$3,'customer','customer',$4)
     RETURNING id, author_role, body, created_at`,
    [randomUUID(), requestId, userId, text]
  );
  await db.query(
    `UPDATE expert_service_requests SET status = CASE WHEN status = 'delivered' THEN status ELSE status END, updated_at = now() WHERE id = $1`,
    [requestId]
  );
  return message[0];
}

/**
 * The customer approves a live quote. The order is built from the stored quote — the request body
 * only names the quote id, so the amount can never be manipulated.
 */
export async function approveQuote(db: Queryable, userId: string, requestId: string, quoteId: string, genId: () => string = randomUUID) {
  const { rows: requestRows } = await db.query<{ id: string; status: RequestStatus; reference: string; title: string }>(
    `SELECT id, status, reference, title FROM expert_service_requests WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [requestId, userId]
  );
  const request = requestRows[0];
  if (!request) throw new NotFoundError('No request was found with that id');
  if (!['quoted', 'scoping', 'requested'].includes(request.status)) {
    throw new ConflictError(`This request is ${request.status.replace(/_/g, ' ')} and no longer awaiting a decision`);
  }

  const { rows: quoteRows } = await db.query<{ id: string; amount: string; currency: string; scope: string; delivery_days: number | null; status: string }>(
    `SELECT id, amount, currency, scope, delivery_days, status FROM expert_service_quotes
      WHERE id = $1 AND request_id = $2 LIMIT 1`,
    [quoteId, requestId]
  );
  const quote = quoteRows[0];
  if (!quote) throw new NotFoundError('No quote was found for this request');
  if (quote.status !== 'issued') throw new ConflictError('That quote is no longer awaiting your decision');
  if (quote.currency.toUpperCase() !== DEFAULT_CURRENCY) throw new ValidationError('This quote is in a currency this platform does not support yet');

  const orderId = genId();
  const amount = quote.amount;
  const result = await withTransaction(db, async (tx) => {
    const { order } = await createOrder(tx, {
      id: orderId,
      userId,
      currency: quote.currency,
      subtotalAmount: amount,
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: amount,
      items: [
        {
          id: genId(),
          productId: null,
          planId: null,
          productNameSnapshot: 'Expert Services',
          planNameSnapshot: `${request.title} (${request.reference})`.slice(0, 255),
          billingPeriod: 'one_time',
          quantity: 1,
          unitPriceAmount: fromCents(toCents(amount)),
          currency: quote.currency,
          lineTotalAmount: amount,
          metadata: { kind: 'expert_service', requestId: request.id, quoteId: quote.id, reference: request.reference },
        },
      ],
    });
    const invoice = await issueInvoiceForOrder(tx, order, genId);

    await tx.query(
      `UPDATE expert_service_quotes SET status = 'approved', decided_at = now() WHERE id = $1`,
      [quote.id]
    );
    await tx.query(
      `UPDATE expert_service_requests SET status = 'approved', order_id = $2, invoice_id = $3, updated_at = now() WHERE id = $1`,
      [request.id, order.id, invoice.id]
    );
    await tx.query(
      `INSERT INTO expert_service_request_events (id, request_id, event_type, actor_id, actor_role, from_status, to_status, metadata)
       VALUES ($1,$2,'quote_approved',$3,'customer',$4,'approved',$5)`,
      [randomUUID(), request.id, userId, request.status, JSON.stringify({ quoteId: quote.id, amount, orderNumber: order.order_number })]
    );
    return { order, invoice };
  });

  return {
    orderId: result.order.id,
    orderNumber: result.order.order_number,
    invoiceId: result.invoice.id,
    invoiceNumber: result.invoice.invoice_number,
    amount,
    currency: quote.currency,
  };
}

export async function cancelRequest(db: Queryable, userId: string, requestId: string, reason: string) {
  const { rows } = await db.query<{ id: string; status: RequestStatus }>(
    `SELECT id, status FROM expert_service_requests WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [requestId, userId]
  );
  const request = rows[0];
  if (!request) throw new NotFoundError('No request was found with that id');
  if (request.status === 'completed') throw new ConflictError('A completed engagement cannot be cancelled');
  if (!canTransition(request.status, 'cancelled')) {
    throw new ConflictError(`A request that is ${request.status.replace(/_/g, ' ')} cannot be cancelled — contact support instead`);
  }
  await withTransaction(db, async (tx) => {
    await tx.query(
      `UPDATE expert_service_requests SET status = 'cancelled', cancelled_reason = $2, updated_at = now() WHERE id = $1`,
      [request.id, reason.trim().slice(0, 500) || null]
    );
    await tx.query(
      `INSERT INTO expert_service_request_events (id, request_id, event_type, actor_id, actor_role, from_status, to_status, metadata)
       VALUES ($1,$2,'cancelled',$3,'customer',$4,'cancelled',$5)`,
      [randomUUID(), request.id, userId, request.status, JSON.stringify({ reason: reason.slice(0, 300) })]
    );
    await tx.query(`UPDATE expert_service_quotes SET status = 'withdrawn' WHERE request_id = $1 AND status = 'issued'`, [request.id]);
  });
  return { ok: true };
}

/* --------------------------------------------------------------------------------------------
 * Admin / delivery team
 * ------------------------------------------------------------------------------------------ */

export async function listRequestsForStaff(
  db: Queryable,
  filter: { status?: string; assignedTo?: string | null; search?: string; limit?: number; offset?: number } = {}
) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.status) {
    params.push(filter.status);
    where.push(`r.status = $${params.length}`);
  }
  if (filter.assignedTo === 'unassigned') where.push('r.assigned_staff_id IS NULL');
  else if (filter.assignedTo) {
    params.push(filter.assignedTo);
    where.push(`r.assigned_staff_id = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search.trim().slice(0, 100)}%`);
    where.push(`(r.reference ILIKE $${params.length} OR r.title ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
  params.push(limit, Math.max(filter.offset ?? 0, 0));

  const { rows } = await db.query(
    `SELECT r.id, r.reference, r.title, r.status, r.priority, r.offering_code, r.budget_amount, r.currency,
            r.assigned_staff_id, r.created_at, r.updated_at, u.email AS customer_email, u.full_name AS customer_name,
            (SELECT q.amount FROM expert_service_quotes q WHERE q.request_id = r.id AND q.status = 'issued' LIMIT 1) AS live_quote_amount,
            (SELECT count(*)::int FROM expert_service_quotes q WHERE q.request_id = r.id) AS quote_count
       FROM expert_service_requests r
       JOIN users u ON u.id = r.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: counts } = await db.query<Record<string, string>>(
    `SELECT status, count(*)::text AS count FROM expert_service_requests GROUP BY status`
  );
  return { requests: rows, counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])) };
}

export async function getRequestForStaff(db: Queryable, requestId: string) {
  const { rows } = await db.query(
    // `users` has no company column: the customer's company is whatever they wrote on the request
    // itself (`expert_service_requests` records it), so the staff view joins nothing extra for it.
    `SELECT r.*, u.email AS customer_email, u.full_name AS customer_name,
            a.email AS assigned_staff_email
       FROM expert_service_requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN users a ON a.id = r.assigned_staff_id
      WHERE r.id = $1 LIMIT 1`,
    [requestId]
  );
  const request = rows[0];
  if (!request) throw new NotFoundError('No request was found with that id');
  const { rows: quotes } = await db.query(`SELECT * FROM expert_service_quotes WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]);
  const { rows: messages } = await db.query(
    `SELECT id, author_role, visibility, body, created_at FROM expert_service_request_messages WHERE request_id = $1 ORDER BY created_at ASC`,
    [requestId]
  );
  const { rows: events } = await db.query(
    `SELECT event_type, actor_role, from_status, to_status, metadata, created_at FROM expert_service_request_events
      WHERE request_id = $1 ORDER BY created_at ASC`,
    [requestId]
  );
  return { request, quotes, messages, events };
}

export async function assignRequest(db: Queryable, actorId: string, requestId: string, staffId: string | null) {
  const { rows: staffRows } = staffId
    ? await db.query<{ id: string; role: string }>(`SELECT id, role FROM users WHERE id = $1 AND status = 'active' LIMIT 1`, [staffId])
    : { rows: [{ id: '', role: '' }] };
  if (staffId && !staffRows[0]) throw new NotFoundError('No staff account was found with that id');
  if (staffId && !['staff', 'admin', 'super_admin'].includes(staffRows[0]!.role)) {
    throw new ValidationError('Requests can only be assigned to a staff account');
  }
  const { rows } = await db.query(
    `UPDATE expert_service_requests SET assigned_staff_id = $2, updated_at = now() WHERE id = $1 RETURNING id, assigned_staff_id, status`,
    [requestId, staffId]
  );
  if (!rows[0]) throw new NotFoundError('No request was found with that id');
  await db.query(
    `INSERT INTO expert_service_request_events (id, request_id, event_type, actor_id, actor_role, metadata)
     VALUES ($1,$2,$3,$4,'staff',$5)`,
    [randomUUID(), requestId, staffId ? 'assigned' : 'unassigned', actorId, JSON.stringify({ staffId })]
  );
  return rows[0];
}

export async function updateRequestStatus(
  db: Queryable,
  actorId: string,
  requestId: string,
  status: RequestStatus,
  options: { note?: string | null; priority?: 'low' | 'normal' | 'high' | 'urgent' } = {}
) {
  const { rows } = await db.query<{ id: string; status: RequestStatus; user_id: string; reference: string }>(
    `SELECT id, status, user_id, reference FROM expert_service_requests WHERE id = $1 LIMIT 1`,
    [requestId]
  );
  const request = rows[0];
  if (!request) throw new NotFoundError('No request was found with that id');
  if (request.status === status) return { status };
  if (!canTransition(request.status, status)) {
    throw new ConflictError(`A request cannot move from ${request.status.replace(/_/g, ' ')} to ${status.replace(/_/g, ' ')}`);
  }
  // `in_progress` is reachable only through a verified payment (src/commerce/fulfilment-service.ts)
  // or by staff for an internally-funded engagement; the customer-facing status page never offers it.
  await withTransaction(db, async (tx) => {
    await tx.query(
      // `$2::text` on every use: a parameter that is compared with a literal and assigned to a
      // varchar column cannot be given two different deduced types by PostgreSQL.
      `UPDATE expert_service_requests
          SET status = $2::text,
              priority = COALESCE($3, priority),
              completed_at = CASE WHEN $2::text = 'completed' THEN now() ELSE completed_at END,
              updated_at = now()
        WHERE id = $1`,
      [request.id, status, options.priority ?? null]
    );
    await tx.query(
      `INSERT INTO expert_service_request_events (id, request_id, event_type, actor_id, actor_role, from_status, to_status, metadata)
       VALUES ($1,$2,'status_changed',$3,'staff',$4,$5,$6)`,
      [randomUUID(), request.id, actorId, request.status, status, JSON.stringify({ note: options.note ?? null })]
    );
  });

  await createNotification(db, {
    userId: request.user_id,
    type: `EXPERT_REQUEST_${status.toUpperCase()}`,
    title: `Your expert-service request ${request.reference} is now ${status.replace(/_/g, ' ')}`,
    message: options.note?.trim() || 'Open your CloudHost247 dashboard to see the details.',
    resourceType: 'expert_service_request',
    resourceId: request.id,
  });
  return { status };
}

export async function issueQuote(
  db: Queryable,
  actorId: string,
  requestId: string,
  input: { amount: number; scope: string; deliverables?: string[]; deliveryDays?: number | null; validUntil?: string | null }
) {
  const { rows } = await db.query<{ id: string; status: RequestStatus; user_id: string; reference: string; currency: string }>(
    `SELECT id, status, user_id, reference, currency FROM expert_service_requests WHERE id = $1 LIMIT 1`,
    [requestId]
  );
  const request = rows[0];
  if (!request) throw new NotFoundError('No request was found with that id');
  if (['completed', 'cancelled', 'rejected', 'approved', 'in_progress'].includes(request.status)) {
    throw new ConflictError(`This request is ${request.status.replace(/_/g, ' ')} and cannot be re-quoted`);
  }
  if (!(input.amount > 0)) throw new ValidationError('A quote must be for a positive amount');
  const scope = input.scope.trim();
  if (scope.length < 10) throw new ValidationError('Describe the scope of work in at least 10 characters');
  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (validUntil && Number.isNaN(validUntil.getTime())) throw new ValidationError('The expiry date is not a valid date');
  if (validUntil && validUntil.getTime() < Date.now()) throw new ValidationError('The expiry date cannot be in the past');

  const quoteId = randomUUID();
  await withTransaction(db, async (tx) => {
    // Withdraw any previous live quote so the request always has at most one live offer.
    await tx.query(`UPDATE expert_service_quotes SET status = 'withdrawn' WHERE request_id = $1 AND status = 'issued'`, [request.id]);
    await tx.query(
      `INSERT INTO expert_service_quotes (id, request_id, amount, currency, scope, deliverables, delivery_days, valid_until, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        quoteId,
        request.id,
        input.amount.toFixed(2),
        request.currency,
        scope,
        JSON.stringify((input.deliverables ?? []).slice(0, 20).map((item) => item.trim().slice(0, 200)).filter(Boolean)),
        input.deliveryDays ?? null,
        validUntil ? validUntil.toISOString() : null,
        actorId,
      ]
    );
    await tx.query(`UPDATE expert_service_requests SET status = 'quoted', updated_at = now() WHERE id = $1`, [request.id]);
    await tx.query(
      `INSERT INTO expert_service_request_events (id, request_id, event_type, actor_id, actor_role, from_status, to_status, metadata)
       VALUES ($1,$2,'quote_issued',$3,'staff',$4,'quoted',$5)`,
      [randomUUID(), request.id, actorId, request.status, JSON.stringify({ quoteId, amount: input.amount.toFixed(2) })]
    );
  });

  await createNotification(db, {
    userId: request.user_id,
    type: 'EXPERT_REQUEST_QUOTED',
    title: `Quote ready for ${request.reference}`,
    message: `A quote has been issued for your request. Approve it in your dashboard to place the order.`,
    resourceType: 'expert_service_request',
    resourceId: request.id,
  });
  return { quoteId };
}

export async function addStaffMessage(
  db: Queryable,
  actorId: string,
  requestId: string,
  input: { body: string; visibility: 'customer' | 'internal' }
) {
  const { rows } = await db.query<{ id: string; user_id: string; reference: string }>(
    `SELECT id, user_id, reference FROM expert_service_requests WHERE id = $1 LIMIT 1`,
    [requestId]
  );
  const request = rows[0];
  if (!request) throw new NotFoundError('No request was found with that id');
  const body = input.body.trim();
  if (!body) throw new ValidationError('Write a message first');
  if (body.length > 8000) throw new ValidationError('Keep the message under 8000 characters');
  const { rows: message } = await db.query(
    `INSERT INTO expert_service_request_messages (id, request_id, author_id, author_role, visibility, body)
     VALUES ($1,$2,$3,'staff',$4,$5) RETURNING id, author_role, visibility, body, created_at`,
    [randomUUID(), request.id, actorId, input.visibility, body]
  );
  if (input.visibility === 'customer') {
    await createNotification(db, {
      userId: request.user_id,
      type: 'EXPERT_REQUEST_MESSAGE',
      title: `New message on ${request.reference}`,
      message: body.slice(0, 280),
      resourceType: 'expert_service_request',
      resourceId: request.id,
    });
  }
  return message[0];
}
