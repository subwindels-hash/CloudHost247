/**
 * Service lines in the unified CloudHost247 cart.
 *
 * `cart_items` (0015) holds catalogue plan lines and is left exactly as it was. This module owns
 * the second line kind — a domain registration draft or a packaged platform-service tier — that
 * hangs off the *same* cart row and is merged into the *same* order by the same checkout path.
 *
 * Like the catalogue lines, nothing here stores a price. A stored line is a reference plus display
 * metadata; `src/commerce/service-pricing.ts` is the only thing that turns it into an amount.
 */
import type { Queryable } from '../db/types';

export interface CartServiceItemRow {
  id: string;
  cart_id: string;
  service_kind: string;
  service_ref: string;
  service_name: string;
  billing_period: string;
  quantity: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CartServiceItemWithOwner extends CartServiceItemRow {
  cart_user_id: string;
}

export async function listServiceItemsForCart(db: Queryable, cartId: string): Promise<CartServiceItemRow[]> {
  const { rows } = await db.query<CartServiceItemRow>(
    `SELECT * FROM cart_service_items WHERE cart_id = $1 ORDER BY created_at ASC`,
    [cartId]
  );
  return rows;
}

export async function findServiceItemWithOwner(
  db: Queryable,
  itemId: string
): Promise<CartServiceItemWithOwner | null> {
  const { rows } = await db.query<CartServiceItemWithOwner>(
    `SELECT csi.*, c.user_id AS cart_user_id
       FROM cart_service_items csi
       JOIN carts c ON c.id = csi.cart_id
      WHERE csi.id = $1 LIMIT 1`,
    [itemId]
  );
  return rows[0] ?? null;
}

export async function findServiceItemByRef(
  db: Queryable,
  cartId: string,
  serviceKind: string,
  serviceRef: string
): Promise<CartServiceItemRow | null> {
  const { rows } = await db.query<CartServiceItemRow>(
    `SELECT * FROM cart_service_items
      WHERE cart_id = $1 AND service_kind = $2 AND service_ref = $3 LIMIT 1`,
    [cartId, serviceKind, serviceRef]
  );
  return rows[0] ?? null;
}

/**
 * Adds (or re-adds) a service line. An existing line for the same (kind, reference) is refreshed
 * rather than duplicated, so a customer clicking "add to cart" twice ends up with one line — the
 * same rule `cart_items` applies to a repeated plan.
 */
export async function upsertServiceItem(
  db: Queryable,
  input: {
    id: string;
    cartId: string;
    serviceKind: string;
    serviceRef: string;
    serviceName: string;
    billingPeriod: string;
    quantity: number;
    metadata: Record<string, unknown>;
  }
): Promise<CartServiceItemRow> {
  const { rows } = await db.query<CartServiceItemRow>(
    `INSERT INTO cart_service_items
       (id, cart_id, service_kind, service_ref, service_name, billing_period, quantity, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (cart_id, service_kind, service_ref, billing_period)
     DO UPDATE SET service_name = EXCLUDED.service_name,
                   quantity = EXCLUDED.quantity,
                   metadata = EXCLUDED.metadata,
                   updated_at = now()
     RETURNING *`,
    [
      input.id,
      input.cartId,
      input.serviceKind,
      input.serviceRef,
      input.serviceName,
      input.billingPeriod,
      input.quantity,
      JSON.stringify(input.metadata),
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('upsertServiceItem: upsert returned no row');
  return row;
}

export async function setServiceItemQuantity(db: Queryable, id: string, quantity: number): Promise<void> {
  await db.query(`UPDATE cart_service_items SET quantity = $2, updated_at = now() WHERE id = $1`, [id, quantity]);
}

export async function removeServiceItem(db: Queryable, id: string): Promise<void> {
  await db.query(`DELETE FROM cart_service_items WHERE id = $1`, [id]);
}

export async function removeServiceItemByRef(
  db: Queryable,
  cartId: string,
  serviceKind: string,
  serviceRef: string
): Promise<void> {
  await db.query(
    `DELETE FROM cart_service_items WHERE cart_id = $1 AND service_kind = $2 AND service_ref = $3`,
    [cartId, serviceKind, serviceRef]
  );
}

export async function clearServiceItems(db: Queryable, cartId: string): Promise<void> {
  await db.query(`DELETE FROM cart_service_items WHERE cart_id = $1`, [cartId]);
}
