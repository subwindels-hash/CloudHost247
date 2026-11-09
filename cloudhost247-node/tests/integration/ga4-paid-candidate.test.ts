import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { defaultGa4 } from '../../src/marketing/ga4-config';
import { findGa4PaidCandidate } from '../../src/marketing/ga4-paid-candidate';

describe('read-only GA4 paid-order candidate, not delivery', () => {
  let db: PGlite; let user: string; let admin: string; let order: string; let invoice: string; let payment: string; let session: string;
  beforeEach(async () => {
    db = new PGlite(); await migrateUp(new PgliteClient(db), { isProduction: false });
    user = randomUUID(); admin = randomUUID(); order = randomUUID(); invoice = randomUUID(); payment = randomUUID(); session = randomUUID();
    await db.query("INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,'private@example.test','unused','Name','customer'),($2,'admin@example.test','unused','Admin','admin')", [user,admin]);
    await db.query("INSERT INTO marketing_consent_sessions(id,token_hash,decided,preferences) VALUES($1,$2,true,$3)", [session, 'a'.repeat(64), JSON.stringify({ essential: true, analytics: true, marketing: false })]);
    await db.query("UPDATE marketing_integrations SET enabled=true,website_domain='localhost',configuration=$1 WHERE provider_key='google_analytics'", [JSON.stringify({ ...defaultGa4, enabled: true, websiteDomain: 'localhost', measurementId: 'G-1234567890', streamReviewed: true, userDataReviewed: true })]);
    await db.query("INSERT INTO orders(id,user_id,currency,subtotal_amount,total_amount,status,payment_status) VALUES($1,$2,'NGN',1500.50,1500.50,'pending','paid')", [order,user]);
    await db.query("INSERT INTO invoices(id,order_id,user_id,status,currency,subtotal_amount,total_amount) VALUES($1,$2,$3,'paid','NGN',1500.50,1500.50)", [invoice,order,user]);
    await db.query("INSERT INTO payments(id,invoice_id,user_id,provider,amount,currency,status,completed_at,confirmed_by_user_id) VALUES($1,$2,$3,'manual',1500.50,'NGN','successful',now(),$4)", [payment,invoice,user,admin]);
    await db.query("INSERT INTO ga4_checkout_contexts(order_id,consent_session_id,config_revision) VALUES($1,$2,1)", [order,session]);
    await db.query("INSERT INTO order_items(id,order_id,product_name_snapshot,plan_name_snapshot,billing_period,quantity,unit_price_amount,currency,line_total_amount,metadata) VALUES($1,$2,'private@example.test','domain.example','monthly',2,750.25,'NGN',1500.50,$3)", [randomUUID(),order,JSON.stringify({ kind: 'platform_plan', serviceKind: 'website_builder', planCode: 'private-plan', domain: 'domain.example' })]);
  });
  afterEach(async () => db.close());
  const candidate = () => findGa4PaidCandidate(db,payment);
  it('returns only the authoritative actual currency and coarse line values for confirmed paid orders', async () => {
    expect(await candidate()).toEqual({ currency: 'NGN', value: 1500.5, items: [{ item_id: 'platform:website_builder', price: 750.25, quantity: 2 }] });
    expect(JSON.stringify(await candidate())).not.toMatch(/private|domain|example|@/);
    expect((await db.query("SELECT * FROM marketing_events WHERE provider_key='google_analytics'")).rows).toHaveLength(0);
  });
  it('uses the paid currency rather than a default or display currency', async () => {
    await db.query("UPDATE orders SET currency='USD' WHERE id=$1", [order]);
    await db.query("UPDATE invoices SET currency='USD' WHERE id=$1", [invoice]);
    await db.query("UPDATE payments SET currency='USD' WHERE id=$1", [payment]);
    await db.query("UPDATE order_items SET currency='USD' WHERE order_id=$1", [order]);
    expect(await candidate()).toMatchObject({ currency: 'USD', value: 1500.5 });
  });
  it('refuses an order without its own checkout consent association', async () => {
    await db.query('DELETE FROM ga4_checkout_contexts WHERE order_id=$1', [order]);
    expect(await candidate()).toBeNull();
  });
  it('rejects non-paid, sandbox, unconfirmed, missing and cancelled states', async () => {
    const mutations = [
      ["UPDATE payments SET status='pending' WHERE id=$1", "UPDATE payments SET status='successful' WHERE id=$1", payment],
      ["UPDATE payments SET provider='sandbox' WHERE id=$1", "UPDATE payments SET provider='manual' WHERE id=$1", payment],
      ["UPDATE payments SET provider='stripe' WHERE id=$1", "UPDATE payments SET provider='manual' WHERE id=$1", payment],
      ["UPDATE payments SET confirmed_by_user_id=NULL WHERE id=$1", 'UPDATE payments SET confirmed_by_user_id=$2 WHERE id=$1', payment],
      ["UPDATE payments SET completed_at=NULL WHERE id=$1", 'UPDATE payments SET completed_at=now() WHERE id=$1', payment],
      ["UPDATE invoices SET status='unpaid' WHERE id=$1", "UPDATE invoices SET status='paid' WHERE id=$1", invoice],
      ["UPDATE orders SET payment_status='unpaid' WHERE id=$1", "UPDATE orders SET payment_status='paid' WHERE id=$1", order],
      ["UPDATE orders SET status='cancelled' WHERE id=$1", "UPDATE orders SET status='pending' WHERE id=$1", order],
    ] as const;
    for (const [update, reset, id] of mutations) {
      await db.query(update,[id]); expect(await candidate(), update).toBeNull();
      await db.query(reset, reset.includes('$2') ? [id,admin] : [id]);
    }
    expect(await findGa4PaidCandidate(db,randomUUID())).toBeNull(); expect(await candidate()).not.toBeNull();
  });
  it('rechecks analytics consent and configuration, independent of marketing', async () => {
    expect(await candidate()).not.toBeNull();
    await db.query("UPDATE marketing_consent_sessions SET preferences='{\"essential\":true,\"analytics\":false,\"marketing\":true}'::jsonb WHERE id=$1", [session]); expect(await candidate()).toBeNull();
    await db.query("UPDATE marketing_consent_sessions SET preferences='{\"essential\":true,\"analytics\":true,\"marketing\":false}'::jsonb,expires_at=now()-interval '1 second' WHERE id=$1", [session]); expect(await candidate()).toBeNull();
    await db.query("UPDATE marketing_consent_sessions SET expires_at=now()+interval '1 day',policy_version=0 WHERE id=$1", [session]); expect(await candidate()).toBeNull();
    await db.query('UPDATE marketing_consent_sessions SET policy_version=1 WHERE id=$1', [session]);
    await db.query("UPDATE marketing_integrations SET revision=revision+1 WHERE provider_key='google_analytics'"); expect(await candidate()).toBeNull();
    await db.query("UPDATE marketing_integrations SET revision=revision-1,enabled=false WHERE provider_key='google_analytics'"); expect(await candidate()).toBeNull();
  });
  it('rejects inconsistent owners, currencies, amounts, item mappings, taxes and discounts rather than guessing', async () => {
    const mutations = [
      ["UPDATE orders SET user_id=$2 WHERE id=$1", 'UPDATE orders SET user_id=$2 WHERE id=$1', order],
      ["UPDATE orders SET currency='USD' WHERE id=$1", "UPDATE orders SET currency='NGN' WHERE id=$1", order],
      ['UPDATE payments SET amount=1500 WHERE id=$1', 'UPDATE payments SET amount=1500.50 WHERE id=$1', payment],
      ['UPDATE orders SET total_amount=1500 WHERE id=$1', 'UPDATE orders SET total_amount=1500.50 WHERE id=$1', order],
      ['UPDATE orders SET tax_amount=1 WHERE id=$1', 'UPDATE orders SET tax_amount=0 WHERE id=$1', order],
      ['UPDATE orders SET discount_amount=1 WHERE id=$1', 'UPDATE orders SET discount_amount=0 WHERE id=$1', order],
      ["UPDATE order_items SET currency='USD' WHERE order_id=$1", "UPDATE order_items SET currency='NGN' WHERE order_id=$1", order],
      ['UPDATE order_items SET line_total_amount=1500 WHERE order_id=$1', 'UPDATE order_items SET line_total_amount=1500.50 WHERE order_id=$1', order],
      ["UPDATE order_items SET metadata='{}'::jsonb WHERE order_id=$1", 'UPDATE order_items SET metadata=$2 WHERE order_id=$1', order],
    ] as const;
    for (const [update, reset, id] of mutations) {
      const args = update.includes('$2') ? [id,admin] : [id]; await db.query(update,args); expect(await candidate(), update).toBeNull();
      const resetArgs = reset.includes('user_id=$2') ? [id,user] : reset.includes('metadata=$2') ? [id,JSON.stringify({kind:'platform_plan',serviceKind:'website_builder'})] : [id];
      await db.query(reset,resetArgs);
    }
    expect(await candidate()).not.toBeNull();
  });
});
