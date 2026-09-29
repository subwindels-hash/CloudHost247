import { MAX_CART_ITEM_QUANTITY } from '../config/billing';
import type { Queryable } from './types';

export interface CartRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CartItemRow {
  id: string;
  cart_id: string;
  plan_id: string;
  billing_period: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

/** A cart line joined with everything needed to display and price it. `unit_price_amount`/
 * `currency` are `null` when no *published* price currently exists for this exact
 * (plan, billing_period, currency) combination — e.g. staff unpublished/removed it after the
 * customer added it to their cart. This must always be surfaced honestly (a "price no longer
 * available, please remove this item" state), never silently substituted with a stale or
 * approximate number — see src/services/commerce-service.ts. */
export interface CartItemDetailRow extends CartItemRow {
  product_id: string;
  product_name: string;
  product_slug: string;
  product_status: string;
  plan_name: string;
  plan_slug: string;
  plan_status: string;
  unit_price_amount: string | null;
  currency: string | null;
}

/** Idempotent, race-safe "get my cart, creating it on first use" — a single atomic upsert against
 * the unique (user_id) index, rather than a separate SELECT-then-INSERT that could race two
 * concurrent first-add-to-cart requests from the same user. */
export async function getOrCreateCartForUser(pool: Queryable, userId: string, newId: string): Promise<CartRow> {
  const { rows } = await pool.query<CartRow>(
    `INSERT INTO carts (id, user_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = carts.updated_at
     RETURNING *`,
    [newId, userId]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to get or create cart');
  return row;
}

export async function findCartById(pool: Queryable, id: string): Promise<CartRow | null> {
  const { rows } = await pool.query<CartRow>('SELECT * FROM carts WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

/** Every cart line, joined with its plan/product (for display) and its current *published* price
 * in `currency` for its exact `billing_period` (never any other currency, never a draft price). */
export async function listCartItemsWithDetails(pool: Queryable, cartId: string, currency: string): Promise<CartItemDetailRow[]> {
  const { rows } = await pool.query<CartItemDetailRow>(
    `SELECT
        ci.id, ci.cart_id, ci.plan_id, ci.billing_period, ci.quantity, ci.created_at, ci.updated_at,
        p.id AS product_id, p.name AS product_name, p.slug AS product_slug, p.status AS product_status,
        pl.name AS plan_name, pl.slug AS plan_slug, pl.status AS plan_status,
        pp.amount AS unit_price_amount, pp.currency AS currency
     FROM cart_items ci
     JOIN product_plans pl ON pl.id = ci.plan_id
     JOIN products p ON p.id = pl.product_id
     LEFT JOIN plan_pricing pp
       ON pp.plan_id = ci.plan_id
      AND pp.billing_period = ci.billing_period
      AND pp.currency = $2
      AND pp.effective_status = 'published'
     WHERE ci.cart_id = $1
     ORDER BY ci.created_at ASC`,
    [cartId, currency]
  );
  return rows;
}

export async function findCartItemById(pool: Queryable, id: string): Promise<CartItemRow | null> {
  const { rows } = await pool.query<CartItemRow>('SELECT * FROM cart_items WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

/** Looks up the single cart line for an exact (cart, plan, billing period) — the same tuple the
 * unique index in 0015_create_cart_items.sql covers, so this returns at most one row. Used only to
 * build an accurate error message on the already-rejected over-cap add path
 * (src/services/commerce-service.ts#addItemToCart); it is never part of a decision, which the
 * database makes atomically in `addCartItem`. */
export async function findCartItemForPlanPeriod(
  pool: Queryable,
  cartId: string,
  planId: string,
  billingPeriod: string
): Promise<CartItemRow | null> {
  const { rows } = await pool.query<CartItemRow>(
    'SELECT * FROM cart_items WHERE cart_id = $1 AND plan_id = $2 AND billing_period = $3 LIMIT 1',
    [cartId, planId, billingPeriod]
  );
  return rows[0] ?? null;
}

export interface CartItemWithOwnerRow extends CartItemRow {
  cart_user_id: string;
}

/** Fetches a cart line together with the id of the customer who owns its parent cart, in one
 * query — used to enforce ownership on quantity-update/remove routes (src/routes/commerce.ts)
 * without a separate round trip that would leave a TOCTOU gap between "check ownership" and
 * "act on it". */
export async function findCartItemWithOwner(pool: Queryable, id: string): Promise<CartItemWithOwnerRow | null> {
  const { rows } = await pool.query<CartItemWithOwnerRow>(
    `SELECT ci.*, c.user_id AS cart_user_id
     FROM cart_items ci
     JOIN carts c ON c.id = ci.cart_id
     WHERE ci.id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

/** Adds `quantity` more of (planId, billingPeriod) to the cart — upserts against the unique
 * (cart_id, plan_id, billing_period) index, so adding an item already in the cart increases its
 * quantity rather than creating a duplicate line.
 *
 * Returns `null` — rather than throwing — when the *cumulative* quantity would exceed
 * `MAX_CART_ITEM_QUANTITY`. The `WHERE` guard on the `DO UPDATE` is what enforces that, and it is
 * deliberately part of the same single statement as the upsert: evaluating "how many are already
 * in the cart?" in a separate `SELECT` first would leave a TOCTOU gap where two concurrent
 * add-to-cart requests for the same line could each pass the check and then jointly exceed the
 * cap. When the guard blocks the update, Postgres simply updates no row and `RETURNING` yields
 * nothing, which the service layer (src/services/commerce-service.ts#addItemToCart) turns into an
 * honest 400. Without the guard the additive `quantity` would violate
 * `cart_items_quantity_positive_check` and surface as an unhandled 500.
 *
 * The database CHECK constraint remains the real backstop — this guard exists so a legitimate
 * customer action produces a clear, actionable error instead of an internal-server-error. */
export async function addCartItem(
  pool: Queryable,
  input: { id: string; cartId: string; planId: string; billingPeriod: string; quantity: number }
): Promise<CartItemRow | null> {
  const { rows } = await pool.query<CartItemRow>(
    `INSERT INTO cart_items (id, cart_id, plan_id, billing_period, quantity)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cart_id, plan_id, billing_period)
     DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now()
     WHERE cart_items.quantity + EXCLUDED.quantity <= $6
     RETURNING *`,
    [input.id, input.cartId, input.planId, input.billingPeriod, input.quantity, MAX_CART_ITEM_QUANTITY]
  );
  return rows[0] ?? null;
}

/** Sets a line's quantity to an absolute value (not additive — see addCartItem for "add more"). */
export async function setCartItemQuantity(pool: Queryable, id: string, quantity: number): Promise<CartItemRow | null> {
  const { rows } = await pool.query<CartItemRow>(
    `UPDATE cart_items SET quantity = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [quantity, id]
  );
  return rows[0] ?? null;
}

export async function removeCartItem(pool: Queryable, id: string): Promise<void> {
  await pool.query('DELETE FROM cart_items WHERE id = $1', [id]);
}

/** Empties a cart (used right after its contents become a real order — see
 * src/services/commerce-service.ts#checkoutCart, always called inside the same transaction as the
 * order write so a checkout can never leave the cart non-empty while the order also exists, or
 * vice versa). */
export async function clearCart(pool: Queryable, cartId: string): Promise<void> {
  await pool.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
}
