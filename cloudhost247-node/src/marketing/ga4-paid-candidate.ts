import type { Queryable } from '../db/types';
import { toCents, multiplyCents, sumCents } from '../lib/money';
import { ga4Schema } from './ga4-config';
import { analyticsConsentGranted } from './ga4-checkout-context';
import type { ConsentRow } from './consent-service';

// These are coarse, reviewed service identities, not plan codes, domains or customer identifiers.
const CATALOG = new Set(['web-hosting','vps-hosting','dedicated-server','cpanel-hosting','business-hosting','wordpress-hosting','reseller-hosting','windows-hosting','email-hosting','ssl-certificate','public-cloud','private-cloud']);
const PLATFORM = new Set(['website_builder','ai_builder','online_store','marketing','inbox','logo_maker']);
interface PaidRow {
  payment_status: string; payment_provider: string | null; confirmed_by: string | null; completed_at: string | Date | null;
  payment_currency: string; invoice_currency: string; order_currency: string;
  payment_amount: string; invoice_total: string; order_total: string; invoice_subtotal: string; order_subtotal: string;
  invoice_tax: string; order_tax: string; invoice_discount: string; order_discount: string;
  invoice_status: string; order_payment_status: string; order_status: string;
  payment_user: string; invoice_user: string; order_user: string;
  order_id: string; config_revision: number; current_revision: number; config_enabled: boolean;
  website_domain: string; configuration: unknown; consent: ConsentRow;
}
interface ItemRow { product_slug: string | null; metadata: Record<string, unknown> | null; quantity: number; unit_price_amount: string; line_total_amount: string; currency: string }
export interface Ga4PaidCandidate {
  currency: string; value: number;
  items: Array<{ item_id: string; price: number; quantity: number }>;
}

/**
 * Read-only building block, not a GA event, receipt, public API or delivery authority. It does not
 * issue an identity or deduplicate. A future sender must independently serialize and recheck
 * consent/configuration/paid state at dispatch and establish a shared Node/WHMCS transaction ID.
 * Only staff-confirmed manual payments are currently eligible: sandbox and unreviewed gateway
 * modes (including gateways which might be configured for test traffic) fail closed.
 */
export async function findGa4PaidCandidate(db: Queryable, paymentId: string): Promise<Ga4PaidCandidate | null> {
  const row = (await db.query<PaidRow>(`SELECT p.status AS payment_status,p.provider AS payment_provider,p.confirmed_by_user_id AS confirmed_by,p.completed_at,
    p.currency AS payment_currency,i.currency AS invoice_currency,o.currency AS order_currency,
    p.amount AS payment_amount,i.total_amount AS invoice_total,o.total_amount AS order_total,
    i.subtotal_amount AS invoice_subtotal,o.subtotal_amount AS order_subtotal,
    i.tax_amount AS invoice_tax,o.tax_amount AS order_tax,i.discount_amount AS invoice_discount,o.discount_amount AS order_discount,
    i.status AS invoice_status,o.payment_status AS order_payment_status,o.status AS order_status,
    p.user_id AS payment_user,i.user_id AS invoice_user,o.user_id AS order_user,o.id AS order_id,
    c.config_revision,g.revision AS current_revision,g.enabled AS config_enabled,g.website_domain,g.configuration,
    json_build_object('decided',s.decided,'policy_version',s.policy_version,'preferences',s.preferences,'expires_at',s.expires_at) AS consent
    FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN orders o ON o.id=i.order_id
    JOIN ga4_checkout_contexts c ON c.order_id=o.id JOIN marketing_consent_sessions s ON s.id=c.consent_session_id
    JOIN marketing_integrations g ON g.provider_key='google_analytics' WHERE p.id=$1`, [paymentId])).rows[0];
  if (!row) return null;
  const config = ga4Schema.safeParse(row.configuration);
  if (!config.success || !row.config_enabled || !config.data.enabled || !config.data.measurementId ||
      !row.website_domain || config.data.websiteDomain !== row.website_domain || row.config_revision !== row.current_revision ||
      !analyticsConsentGranted(row.consent)) return null;
  if (row.payment_provider !== 'manual' || !row.confirmed_by || row.payment_status !== 'successful' || !row.completed_at ||
      !Number.isFinite(new Date(row.completed_at).getTime()) || row.invoice_status !== 'paid' || row.order_payment_status !== 'paid' ||
      row.order_status === 'cancelled' || row.order_status === 'failed' || row.payment_user !== row.invoice_user || row.invoice_user !== row.order_user ||
      !/^[A-Z]{3}$/.test(row.payment_currency) || row.payment_currency !== row.invoice_currency || row.invoice_currency !== row.order_currency) return null;
  try {
    // Discounts/taxes require an allocation design; never quietly misstate GA's item-based value.
    if ([row.invoice_tax,row.order_tax,row.invoice_discount,row.order_discount].some(x => toCents(x) !== 0)) return null;
    const total = toCents(row.payment_amount);
    if (total <= 0 || [row.invoice_total,row.order_total,row.invoice_subtotal,row.order_subtotal].some(x => toCents(x) !== total)) return null;
    const lines = (await db.query<ItemRow>(`SELECT p.slug AS product_slug,oi.metadata,oi.quantity,oi.unit_price_amount,oi.line_total_amount,oi.currency
      FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=$1 ORDER BY oi.created_at,oi.id LIMIT 201`, [row.order_id])).rows;
    if (!lines.length || lines.length > 200) return null;
    const items: Ga4PaidCandidate['items'] = [];
    const amounts: number[] = [];
    for (const line of lines) {
      const metadata = line.metadata ?? {};
      let id: string | null = null;
      if (metadata.kind === 'platform_plan' && typeof metadata.serviceKind === 'string' && PLATFORM.has(metadata.serviceKind)) id = `platform:${metadata.serviceKind}`;
      else if (metadata.kind == null && line.product_slug && CATALOG.has(line.product_slug)) id = line.product_slug;
      if (!id || line.currency !== row.payment_currency || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) return null;
      const unit = toCents(line.unit_price_amount);
      const lineAmount = multiplyCents(unit, line.quantity);
      if (lineAmount !== toCents(line.line_total_amount)) return null;
      amounts.push(lineAmount); items.push({ item_id: id, price: unit / 100, quantity: line.quantity });
    }
    if (sumCents(amounts) !== total) return null;
    return { currency: row.payment_currency, value: total / 100, items };
  } catch { return null; }
}
