/**
 * Domain auctions — internal marketplace with a locked, transactional bidding engine.
 *
 * Concurrency contract (the important part):
 *   - Every bid is placed inside a transaction that takes `SELECT ... FOR UPDATE` on the auction
 *     row. Two concurrent bids serialize on that lock; the loser sees the winner's new
 *     `current_highest_bid` when its transaction proceeds and is rejected for being below the
 *     new minimum. There is no read-then-write window.
 *   - `bid_sequence` is assigned inside the lock and enforced UNIQUE(auction_id, bid_sequence) —
 *     the database backstop against any sequence race.
 *   - Idempotency keys are enforced by the partial unique index on
 *     (auction_id, user_id, idempotency_key), so a double-submit cannot create two bids.
 *   - The server alone computes the minimum acceptable bid
 *     (max(current_highest_bid, minimum_bid) + bid_increment) and the authoritative highest bid.
 *     No price or bid state from the client is ever trusted.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { DEFAULT_CURRENCY } from '../config/billing';
import { createOrder } from '../db/orders';
import { issueInvoiceForOrder } from '../services/billing-service';
import { toCents, fromCents } from '../lib/money';
import { isValidDomainName, normalizeDomainName } from './domain-name';
import { AUCTIONS_PAGE_MAX_LIMIT, AUCTION_MAX_DURATION_DAYS, AUCTION_MIN_DURATION_HOURS } from './config';
import { recordDomainTransaction, setDomainTransactionStatus } from './transactions';

export interface AuctionDto {
  id: string;
  domainName: string;
  status: string;
  currency: string;
  minimumBid: string;
  bidIncrement: string;
  currentHighestBid: string | null;
  bidCount: number;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  description?: string | null;
  /** Present only in detail views for the owner of a bid. */
  myHighestBid?: string | null;
}

interface AuctionRow {
  id: string;
  domain_name: string;
  status: string;
  currency: string;
  minimum_bid: string;
  bid_increment: string;
  current_highest_bid: string | null;
  current_highest_bidder_id: string | null;
  bid_count: number;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

export async function listAuctions(
  db: Queryable,
  filters: { status?: string; search?: string; page?: number; limit?: number }
): Promise<{ auctions: AuctionDto[]; page: number; limit: number; total: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(AUCTIONS_PAGE_MAX_LIMIT, Math.max(1, filters.limit ?? 20));
  const params: unknown[] = [];
  const where: string[] = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  } else {
    // Default browse view: everything a bidder can act on or review.
    where.push(`status IN ('scheduled','live','ending_soon','ended')`);
  }
  if (filters.search) {
    params.push(`%${normalizeDomainName(filters.search).slice(0, 100)}%`);
    where.push(`domain_name LIKE $${params.length}`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM domain_auctions ${whereClause}`,
    params
  );
  const total = Number(countRows[0]?.count ?? 0);

  params.push(limit, (page - 1) * limit);
  const { rows } = await db.query<AuctionRow>(
    `SELECT id, domain_name, status, currency, minimum_bid, bid_increment, current_highest_bid,
            bid_count, starts_at, ends_at, created_at
       FROM domain_auctions
       ${whereClause}
      ORDER BY (status IN ('live','ending_soon')) DESC,
               CASE WHEN status IN ('live','ending_soon') THEN ends_at END ASC NULLS LAST,
               created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    auctions: rows.map(mapAuctionRow),
    page,
    limit,
    total,
  };
}

function mapAuctionRow(row: AuctionRow): AuctionDto {
  return {
    id: row.id,
    domainName: row.domain_name,
    status: row.status,
    currency: row.currency,
    minimumBid: row.minimum_bid,
    bidIncrement: row.bid_increment,
    currentHighestBid: row.current_highest_bid ?? null,
    bidCount: row.bid_count,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
  };
}

export async function getAuctionDetail(db: Queryable, auctionId: string, userId?: string) {
  const { rows } = await db.query<AuctionRow>(`SELECT * FROM domain_auctions WHERE id = $1 LIMIT 1`, [auctionId]);
  const auction = rows[0];
  if (!auction) throw new NotFoundError('No auction was found with that id');

  const dto = mapAuctionRow(auction);
  if (userId) {
    const { rows: mine } = await db.query<{ amount: string | null }>(
      `SELECT max(amount)::text AS amount FROM domain_bids WHERE auction_id=$1 AND user_id=$2 AND status <> 'void'`,
      [auctionId, userId]
    );
    dto.myHighestBid = mine[0]?.amount ?? null;
  }

  // Public bidding history: masked bidders (no user IDs or emails leak to clients).
  const { rows: bids } = await db.query(
    `SELECT b.amount, b.currency, b.created_at,
            'Bidder ' || to_char(row_number() OVER (ORDER BY b.created_at ASC), 'FM00') AS bidder_label
       FROM domain_bids b
      WHERE b.auction_id = $1 AND b.status <> 'void'
      ORDER BY b.created_at ASC
      LIMIT 100`,
    [auctionId]
  );
  return { auction: dto, bids };
}

export interface PlaceBidInput {
  auctionId: string;
  userId: string;
  amount: string;
  idempotencyKey?: string | null;
}

export interface PlaceBidResult {
  bidId: string;
  amount: string;
  isHighest: boolean;
  previousHighestBidderNotified: boolean;
}

/**
 * The bidding engine. Everything happens under the auction row lock, so the server's view of the
 * highest bid is authoritative under any concurrency.
 */
export async function placeBid(db: Queryable, input: PlaceBidInput, genId: () => string = randomUUID): Promise<PlaceBidResult> {
  const amountCents = toCents(input.amount);
  if (amountCents <= 0) throw new ValidationError('Bid amount must be positive');

  return withTransaction(db, async (tx) => {
    // Serialize concurrent bidders on the auction row.
    const { rows: auctionRows } = await tx.query<AuctionRow>(
      `SELECT id, domain_name, status, currency, minimum_bid, bid_increment, current_highest_bid,
              current_highest_bidder_id, bid_count, starts_at, ends_at
         FROM domain_auctions WHERE id = $1 FOR UPDATE`,
      [input.auctionId]
    );
    const auction = auctionRows[0];
    if (!auction) throw new NotFoundError('No auction was found with that id');

    const now = new Date();
    if (auction.status === 'scheduled' || new Date(auction.starts_at) > now) {
      throw new ConflictError('This auction has not started yet');
    }
    if (auction.status === 'cancelled') throw new ConflictError('This auction has been cancelled');
    if (['ended', 'completed'].includes(auction.status) || new Date(auction.ends_at) <= now) {
      throw new ConflictError('This auction has ended');
    }

    // Duplicate idempotent submission: return the existing bid instead of erroring.
    if (input.idempotencyKey) {
      const { rows: existing } = await tx.query<{ id: string; amount: string }>(
        `SELECT id, amount FROM domain_bids
          WHERE auction_id=$1 AND user_id=$2 AND idempotency_key=$3 AND status <> 'void' LIMIT 1`,
        [input.auctionId, input.userId, input.idempotencyKey]
      );
      if (existing[0]) {
        return { bidId: existing[0].id, amount: existing[0].amount, isHighest: true, previousHighestBidderNotified: false };
      }
    }

    // Server-computed minimum acceptable bid.
    const floorCents = Math.max(toCents(auction.current_highest_bid ?? auction.minimum_bid), toCents(auction.minimum_bid));
    const requiredCents = floorCents + toCents(auction.bid_increment);
    if (amountCents < requiredCents) {
      throw new ValidationError(
        `Your bid must be at least ${fromCents(requiredCents)} ${auction.currency} ` +
          `(current ${(auction.current_highest_bid ?? auction.minimum_bid)} ${auction.currency} plus ` +
          `an increment of ${auction.bid_increment} ${auction.currency}).`
      );
    }

    // A bidder cannot outbid themselves with the same amount (no-op duplicate bid).
    if (auction.current_highest_bidder_id === input.userId && toCents(auction.current_highest_bid ?? '0') === amountCents) {
      throw new ConflictError('You already hold the highest bid at that amount');
    }

    const nextSequence = (auction.bid_count ?? 0) + 1;

    const { rows: bidRows } = await tx.query<{ id: string; amount: string }>(
      `INSERT INTO domain_bids (id, auction_id, user_id, bid_sequence, amount, currency, idempotency_key, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active') RETURNING id, amount`,
      [genId(), input.auctionId, input.userId, nextSequence, fromCents(amountCents), auction.currency, input.idempotencyKey ?? null]
    );
    const bid = bidRows[0];
    if (!bid) throw new Error('Failed to place bid');

    // Previous highest bid is outbid (only if it belonged to a different bidder).
    let previousBidderId: string | null = null;
    if (auction.current_highest_bidder_id && auction.current_highest_bidder_id !== input.userId) {
      previousBidderId = auction.current_highest_bidder_id;
      await tx.query(
        `UPDATE domain_bids SET status='outbid'
          WHERE auction_id=$1 AND user_id=$2 AND status IN ('active','winning')`,
        [input.auctionId, previousBidderId]
      );
    }
    await tx.query(`UPDATE domain_bids SET status='winning' WHERE id=$1`, [bid.id]);

    // Mark the new highest bid on the auction row (still under the lock).
    await tx.query(
      `UPDATE domain_auctions
          SET current_highest_bid=$2, current_highest_bidder_id=$3, bid_count=$4, updated_at=now()
        WHERE id=$1`,
      [input.auctionId, fromCents(amountCents), input.userId, nextSequence]
    );

    let notified = false;
    if (previousBidderId) {
      const { createNotification } = await import('../services/notification-service');
      await createNotification(tx, {
        userId: previousBidderId,
        type: 'DOMAIN_AUCTION_OUTBID',
        title: 'You have been outbid',
        message: `Your bid on ${auction.domain_name} has been outbid. The new highest bid is ${fromCents(amountCents)} ${auction.currency}.`,
        resourceType: 'domain_auction',
        resourceId: input.auctionId,
      }).catch(() => undefined);
      notified = true;
    }

    return { bidId: bid.id, amount: bid.amount, isHighest: true, previousHighestBidderNotified: notified };
  });
}

/**
 * Worker sweep: transitions auction states.
 *   scheduled → live when the start time arrives
 *   live → ending_soon inside the final hour
 *   live/ending_soon → ended when the end time passes (winner determined, bidders notified)
 * Auction completion (winner pays) is a separate, payment-gated step.
 */
export async function sweepAuctionStates(db: Queryable): Promise<{ started: number; endingSoon: number; ended: number }> {
  const started = await db.query(
    `UPDATE domain_auctions SET status='live', updated_at=now()
      WHERE status='scheduled' AND starts_at <= now()
      RETURNING id`
  );

  const endingSoon = await db.query(
    `UPDATE domain_auctions SET status='ending_soon', updated_at=now()
      WHERE status='live' AND ends_at <= now() + interval '1 hour'
      RETURNING id`
  );

  const { rows: toEnd } = await db.query<{ id: string; domain_name: string; current_highest_bidder_id: string | null; current_highest_bid: string | null; currency: string }>(
    `SELECT id, domain_name, current_highest_bidder_id, current_highest_bid, currency
       FROM domain_auctions
      WHERE status IN ('live','ending_soon') AND ends_at <= now()`
  );

  let endedCount = 0;
  for (const auction of toEnd) {
    await withTransaction(db, async (tx) => {
      const { rows: ended } = await tx.query<{ id: string }>(
        `UPDATE domain_auctions SET status='ended', updated_at=now()
          WHERE id=$1 AND status IN ('live','ending_soon') RETURNING id`,
        [auction.id]
      );
      if (!ended[0]) return;

      if (auction.current_highest_bidder_id) {
        await tx.query(
          `UPDATE domain_bids SET status='won'
            WHERE auction_id=$1 AND user_id=$2 AND status='winning'`,
          [auction.id, auction.current_highest_bidder_id]
        );
        await tx.query(
          `UPDATE domain_bids SET status='lost'
            WHERE auction_id=$1 AND status IN ('active','outbid','winning') AND user_id <> $2`,
          [auction.id, auction.current_highest_bidder_id]
        );

        const { createNotification } = await import('../services/notification-service');
        await createNotification(tx, {
          userId: auction.current_highest_bidder_id,
          type: 'DOMAIN_AUCTION_WON',
          title: 'You won the auction',
          message: `You won the auction for ${auction.domain_name} with a bid of ${auction.current_highest_bid} ${auction.currency}. Complete payment from your dashboard to claim the domain.`,
          resourceType: 'domain_auction',
          resourceId: auction.id,
        }).catch(() => undefined);
      }
      endedCount += 1;
    });
  }

  return {
    started: started.rows.length,
    endingSoon: endingSoon.rows.length,
    ended: endedCount,
  };
}

/** Dashboard: the caller's bids across auctions. */
export async function listMyBids(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT b.id, b.auction_id, a.domain_name, a.status AS auction_status, a.ends_at,
            a.current_highest_bid, a.current_highest_bidder_id, b.amount, b.currency, b.status, b.created_at,
            (a.current_highest_bidder_id = $1) AS is_winning
       FROM domain_bids b
       JOIN domain_auctions a ON a.id = b.auction_id
      WHERE b.user_id = $1 AND b.status <> 'void'
      ORDER BY b.created_at DESC
      LIMIT 100`,
    [userId]
  );
  return rows;
}

export async function listMyWonAuctions(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT a.id, a.domain_name, a.status, a.current_highest_bid, a.currency, a.ends_at,
            (SELECT count(*)::int FROM domain_bids b WHERE b.auction_id=a.id) AS bid_count,
            EXISTS (SELECT 1 FROM domain_transactions t WHERE t.auction_id=a.id AND t.transaction_type='auction_payment' AND t.status='paid') AS payment_completed
       FROM domain_auctions a
      WHERE a.current_highest_bidder_id = $1 AND a.status IN ('ended','completed')
      ORDER BY a.ends_at DESC`,
    [userId]
  );
  return rows;
}

export async function listMyLostAuctions(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT a.id, a.domain_name, a.status, a.current_highest_bid, a.currency, a.ends_at
       FROM domain_auctions a
      WHERE a.current_highest_bidder_id <> $1
        AND a.status IN ('ended','completed')
        AND EXISTS (SELECT 1 FROM domain_bids b WHERE b.auction_id=a.id AND b.user_id=$1 AND b.status <> 'void')
      ORDER BY a.ends_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * Winner payment: creates the auction-payment order + invoice for a won auction. Only the
 * recorded winner may pay, and only once.
 */
export async function createAuctionPaymentOrder(
  db: Queryable,
  userId: string,
  auctionId: string,
  genId: () => string = randomUUID
): Promise<{ orderId: string; invoiceId: string; invoiceNumber: string; amount: string; currency: string }> {
  const { rows: auctionRows } = await db.query<{
    id: string; domain_name: string; status: string; current_highest_bid: string | null;
    current_highest_bidder_id: string | null; currency: string;
  }>(
    `SELECT id, domain_name, status, current_highest_bid, current_highest_bidder_id, currency
       FROM domain_auctions WHERE id=$1 FOR UPDATE`,
    [auctionId]
  );
  const auction = auctionRows[0];
  if (!auction) throw new NotFoundError('No auction was found with that id');
  if (auction.current_highest_bidder_id !== userId) {
    throw new NotFoundError('No auction was found with that id');
  }
  if (auction.status !== 'ended') {
    throw new ConflictError('This auction payment is not available yet');
  }
  if (!auction.current_highest_bid) {
    throw new ConflictError('This auction has no winning bid to pay');
  }

  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM domain_transactions WHERE auction_id=$1 AND transaction_type='auction_payment' AND status IN ('pending','paid','processing','authorized') LIMIT 1`,
    [auctionId]
  );
  if (existing[0]) throw new ConflictError('A payment for this auction already exists');

  const winningBid = auction.current_highest_bid;
  const orderId = genId();
  const result = await withTransaction(db, async (tx) => {
    const { order } = await createOrder(tx, {
      id: orderId,
      userId,
      currency: auction.currency,
      subtotalAmount: winningBid,
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: winningBid,
      items: [
        {
          id: genId(),
          productId: null,
          planId: null,
          productNameSnapshot: 'Domain Auctions',
          planNameSnapshot: `Auction win — ${auction.domain_name}`,
          billingPeriod: 'one_time',
          quantity: 1,
          unitPriceAmount: winningBid,
          currency: auction.currency,
          lineTotalAmount: winningBid,
          metadata: { kind: 'domain_auction_payment', auctionId, domainName: auction.domain_name },
        },
      ],
    });
    const invoice = await issueInvoiceForOrder(tx, order, genId);
    await recordDomainTransaction(tx, {
      userId,
      transactionType: 'auction_payment',
      status: 'pending',
      amount: winningBid,
      currency: auction.currency,
      orderId: order.id,
      invoiceId: invoice.id,
      auctionId,
      metadata: { domainName: auction.domain_name },
    });
    return { order, invoice };
  });

  return {
    orderId: result.order.id,
    invoiceId: result.invoice.id,
    invoiceNumber: result.invoice.invoice_number,
    amount: result.order.total_amount,
    currency: result.order.currency,
  };
}

/** Webhook-settlement hook: a paid auction marks the auction completed. */
export async function markAuctionPaymentVerified(tx: Queryable, auctionId: string): Promise<void> {
  const { rows: completedRows } = await tx.query(
    `UPDATE domain_auctions SET status='completed', completed_at=now(), updated_at=now()
      WHERE id=$1 AND status='ended'
      RETURNING id`,
    [auctionId]
  );
  if (completedRows.length === 0) return;
  const { rows: auctionRows } = await tx.query<{ domain_name: string; current_highest_bidder_id: string | null }>(
    `SELECT domain_name, current_highest_bidder_id FROM domain_auctions WHERE id=$1`,
    [auctionId]
  );
  const auction = auctionRows[0];
  if (!auction) return;

  const { rows: txn } = await tx.query<{ id: string }>(
    `SELECT id FROM domain_transactions WHERE auction_id=$1 AND transaction_type='auction_payment' LIMIT 1`,
    [auctionId]
  );
  if (txn[0]) await setDomainTransactionStatus(tx, txn[0].id, 'paid');

  if (auction.current_highest_bidder_id) {
    const { createNotification } = await import('../services/notification-service');
    await createNotification(tx, {
      userId: auction.current_highest_bidder_id,
      type: 'DOMAIN_AUCTION_PAYMENT_CONFIRMED',
      title: 'Auction payment confirmed',
      message: `Your payment for ${auction.domain_name} has been confirmed. Our team will contact you to complete the domain transfer.`,
      resourceType: 'domain_auction',
      resourceId: auctionId,
    }).catch(() => undefined);
  }
}

// -------------------------------------------------------------------------------------------
// Admin auction management
// -------------------------------------------------------------------------------------------

export interface CreateAuctionInput {
  domainName: string;
  minimumBid: string;
  bidIncrement: string;
  startsAt: string;
  endsAt: string;
  currency?: string;
  sellerId?: string | null;
}

export async function adminCreateAuction(db: Queryable, actorId: string, input: CreateAuctionInput): Promise<AuctionDto> {
  const normalized = normalizeDomainName(input.domainName);
  if (!isValidDomainName(normalized)) throw new ValidationError('Enter a valid domain name for the auction');

  const minimumBidCents = toCents(input.minimumBid);
  const incrementCents = toCents(input.bidIncrement);
  if (minimumBidCents <= 0) throw new ValidationError('Minimum bid must be positive');
  if (incrementCents <= 0) throw new ValidationError('Bid increment must be positive');

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const minDurationMs = AUCTION_MIN_DURATION_HOURS * 60 * 60 * 1000;
  const maxDurationMs = AUCTION_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new ValidationError('Start and end times must be valid dates');
  }
  if (endsAt.getTime() - startsAt.getTime() < minDurationMs) {
    throw new ValidationError(`Auctions must run for at least ${AUCTION_MIN_DURATION_HOURS} hour(s)`);
  }
  if (endsAt.getTime() - startsAt.getTime() > maxDurationMs) {
    throw new ValidationError(`Auctions cannot run longer than ${AUCTION_MAX_DURATION_DAYS} days`);
  }

  const { rows: conflicting } = await db.query(
    `SELECT id FROM domain_auctions WHERE lower(domain_name)=lower($1) AND status IN ('scheduled','live','ending_soon') LIMIT 1`,
    [normalized]
  );
  if (conflicting[0]) throw new ConflictError('An active auction already exists for that domain');

  const currency = (input.currency ?? DEFAULT_CURRENCY).toUpperCase();
  if (currency !== DEFAULT_CURRENCY) throw new ValidationError(`Auctions must be listed in ${DEFAULT_CURRENCY}`);

  const { rows } = await db.query<AuctionRow>(
    `INSERT INTO domain_auctions
       (id, seller_id, domain_name, status, currency, minimum_bid, bid_increment, starts_at, ends_at, created_by)
     VALUES ($1,$2,$3,'scheduled',$4,$5,$6,$7,$8,$9) RETURNING *`,
    [randomUUID(), input.sellerId ?? null, normalized, currency, fromCents(minimumBidCents), fromCents(incrementCents), startsAt.toISOString(), endsAt.toISOString(), actorId]
  );
  const created = rows[0];
  if (!created) throw new Error('Failed to create auction');
  return mapAuctionRow(created);
}

export async function adminUpdateAuctionStatus(
  db: Queryable,
  auctionId: string,
  action: 'pause' | 'resume' | 'cancel' | 'complete'
): Promise<AuctionDto> {
  const transitions: Record<typeof action, { from: string[]; to: string }> = {
    pause: { from: ['live', 'ending_soon'], to: 'scheduled' },
    resume: { from: ['scheduled'], to: 'live' },
    cancel: { from: ['scheduled', 'live', 'ending_soon', 'ended'], to: 'cancelled' },
    complete: { from: ['ended'], to: 'completed' },
  };
  const rule = transitions[action];

  const result = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<AuctionRow>(`SELECT * FROM domain_auctions WHERE id=$1 FOR UPDATE`, [auctionId]);
    const auction = rows[0];
    if (!auction) throw new NotFoundError('No auction was found with that id');
    if (!rule.from.includes(auction.status)) {
      throw new ConflictError(`Cannot ${action} an auction with status "${auction.status}"`);
    }
    const { rows: updated } = await tx.query<AuctionRow>(
      `UPDATE domain_auctions
          SET status=$2,
              cancelled_at = CASE WHEN $2='cancelled' THEN now() ELSE cancelled_at END,
              completed_at = CASE WHEN $2='completed' THEN now() ELSE completed_at END,
              updated_at=now()
        WHERE id=$1 RETURNING *`,
      [auctionId, rule.to]
    );

    if (action === 'cancel' && auction.current_highest_bidder_id) {
      const { createNotification } = await import('../services/notification-service');
      await createNotification(tx, {
        userId: auction.current_highest_bidder_id,
        type: 'DOMAIN_AUCTION_CANCELLED',
        title: 'Auction cancelled',
        message: `The auction for ${auction.domain_name} was cancelled by the marketplace. No payment is due.`,
        resourceType: 'domain_auction',
        resourceId: auctionId,
      }).catch(() => undefined);
    }
    return updated[0];
  });
  if (!result) throw new Error('Failed to update auction');
  return mapAuctionRow(result);
}

export async function adminUpdateAuction(
  db: Queryable,
  auctionId: string,
  patch: { minimumBid?: string; bidIncrement?: string; startsAt?: string; endsAt?: string }
): Promise<AuctionDto> {
  const result = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<AuctionRow>(`SELECT * FROM domain_auctions WHERE id=$1 FOR UPDATE`, [auctionId]);
    const auction = rows[0];
    if (!auction) throw new NotFoundError('No auction was found with that id');
    if (auction.bid_count > 0) {
      throw new ConflictError('An auction with placed bids can no longer be edited (cancel it instead)');
    }
    const minimumBid = patch.minimumBid ?? auction.minimum_bid;
    const bidIncrement = patch.bidIncrement ?? auction.bid_increment;
    const startsAt = patch.startsAt ?? auction.starts_at;
    const endsAt = patch.endsAt ?? auction.ends_at;
    if (toCents(minimumBid) <= 0 || toCents(bidIncrement) <= 0) {
      throw new ValidationError('Minimum bid and increment must be positive');
    }
    const { rows: updated } = await tx.query<AuctionRow>(
      `UPDATE domain_auctions SET minimum_bid=$2, bid_increment=$3, starts_at=$4, ends_at=$5, updated_at=now()
        WHERE id=$1 RETURNING *`,
      [auctionId, minimumBid, bidIncrement, startsAt, endsAt]
    );
    return updated[0];
  });
  if (!result) throw new Error('Failed to update auction');
  return mapAuctionRow(result);
}

/** Admin: participants of an auction (resolved server-side, staff-only view). */
export async function adminListAuctionParticipants(db: Queryable, auctionId: string) {
  const { rows } = await db.query(
    `SELECT b.id, b.user_id, u.email, u.full_name, b.amount, b.currency, b.status, b.created_at
       FROM domain_bids b
       JOIN users u ON u.id = b.user_id
      WHERE b.auction_id=$1
      ORDER BY b.amount DESC`,
    [auctionId]
  );
  return rows;
}
