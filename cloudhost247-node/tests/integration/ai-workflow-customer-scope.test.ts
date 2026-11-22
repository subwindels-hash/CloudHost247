import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { seedAgentRegistry } from '../../src/ai-os/registry/seed';
import { emitEvent, processPendingEvents } from '../../src/ai-os/workflows/engine';
import { getTask, updateTaskStatus } from '../../src/ai-os/repositories/tasks-repo';
import type { Queryable } from '../../src/db/types';
import type { RunTaskFn } from '../../src/ai-os/board/board-service';

describe('customer-tagged event workflow ownership preflight', () => {
  let db: PGlite;
  let alice: string, bob: string, invoice: string, payment: string;
  let calls: string[];
  let runner: RunTaskFn;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await seedAgentRegistry(db);
    alice = randomUUID(); bob = randomUUID();
    await db.query(`INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,'hash','Alice','customer'),($3,$4,'hash','Bob','customer')`,
      [alice, `${alice}@scope.test`, bob, `${bob}@scope.test`]);
    const order = randomUUID(); invoice = randomUUID(); payment = randomUUID();
    await db.query(`INSERT INTO orders (id,user_id,currency,subtotal_amount,total_amount,status,payment_status) VALUES ($1,$2,'USD',10,10,'pending','unpaid')`, [order, alice]);
    await db.query(`INSERT INTO invoices (id,order_id,user_id,currency,subtotal_amount,total_amount,status,due_date) VALUES ($1,$2,$3,'USD',10,10,'unpaid',CURRENT_DATE - 1)`, [invoice, order, alice]);
    await db.query(`INSERT INTO payments (id,invoice_id,user_id,amount,currency,status) VALUES ($1,$2,$3,10,'USD','failed')`, [payment, invoice, alice]);
    calls = [];
    runner = async (database, id) => {
      calls.push(id);
      await updateTaskStatus(database, id, 'succeeded');
      return { task: (await getTask(database, id))!, runStatus: 'succeeded', pendingApprovals: [] };
    };
  });
  afterEach(async () => { await db.close(); });

  async function event(eventType: string, payload: Record<string, unknown>) {
    const { event } = await emitEvent(db, { eventType, source: 'admin', payload });
    await db.query(`UPDATE ai_events SET occurred_at = '1000-01-01' WHERE id = $1`, [event.id]);
    return event.id;
  }
  async function held(id: string) {
    return (await db.query<{ processed_at: unknown; dispatch_claimed_at: unknown }>(`SELECT processed_at,dispatch_claimed_at FROM ai_events WHERE id = $1`, [id])).rows[0];
  }

  it.each([
    { type: 'invoice.overdue', resource: 'invoiceId' },
    { type: 'payment.failed', resource: 'paymentId' },
  ])('allows $type only for the resource owner', async ({ type, resource }) => {
    const id = await event(type, { [resource]: resource === 'invoiceId' ? invoice : payment, customerId: alice });
    expect(await processPendingEvents(db, runner, 1)).toEqual({ processed: 1, dispatched: 1 });
    expect(calls).toHaveLength(1);
    expect((await getTask(db, calls[0]!))?.customer_id).toBe(alice);
    expect((await held(id))?.processed_at).toBeTruthy();
  });

  it.each([
    { type: 'invoice.overdue', resource: 'invoiceId' },
    { type: 'payment.failed', resource: 'paymentId' },
  ])('holds $type before dispatch on mismatched owner', async ({ type, resource }) => {
    const id = await event(type, { [resource]: resource === 'invoiceId' ? invoice : payment, customerId: bob });
    expect(await processPendingEvents(db, runner, 1)).toEqual({ processed: 0, dispatched: 1 });
    expect(calls).toHaveLength(0);
    expect(await held(id)).toMatchObject({ processed_at: null, dispatch_claimed_at: expect.anything() });
    expect((await db.query<{ error: string }>(`SELECT error FROM ai_workflow_runs WHERE event_id = $1`, [id])).rows).toEqual([{ error: 'Workflow customer scope unavailable' }]);
  });

  it('checks all workflows before dispatching an earlier untagged workflow', async () => {
    const first = randomUUID();
    await db.query(`INSERT INTO ai_workflows (id,slug,name,event_type,definition) VALUES ($1,$2,'first','invoice.overdue',$3)`,
      [first, `a-${first}`, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest' }])]);
    const id = await event('invoice.overdue', { invoiceId: invoice, customerId: bob });
    expect(await processPendingEvents(db, runner, 1)).toEqual({ processed: 0, dispatched: 1 });
    expect(calls).toHaveLength(0);
    expect((await db.query(`SELECT id FROM ai_workflow_runs WHERE event_id = $1 AND workflow_id = $2`, [id, first])).rows).toHaveLength(0);
  });

  it('holds unsupported customer-tagged event workflows instead of trusting a payload UUID', async () => {
    const type = `custom.${randomUUID()}`, workflow = randomUUID();
    await db.query(`INSERT INTO ai_workflows (id,slug,name,event_type,definition) VALUES ($1,$2,'custom',$3,$4)`, [workflow, `wf-${workflow}`, type, JSON.stringify([{ agent_slug: 'collector', task_type: 'billing.overdue_digest', customer_from: 'customerId' }])]);
    const id = await event(type, { customerId: alice });
    expect(await processPendingEvents(db, runner, 1)).toEqual({ processed: 0, dispatched: 1 });
    expect(calls).toHaveLength(0);
    expect((await held(id))?.processed_at).toBeNull();
  });

  it('holds a previously valid preflight if the authoritative owner changes before preparation', async () => {
    const id = await event('invoice.overdue', { invoiceId: invoice, customerId: bob });
    let injected = false;
    const proxy = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (!injected && sql.includes('SELECT r.user_id FROM invoices')) { injected = true; return { rows: [{ user_id: bob }] as T[] }; }
        return db.query<T>(sql, params);
      },
      transaction: <T>(fn: (tx: Queryable) => Promise<T>) => db.transaction((tx) => fn(tx)),
    };
    expect(await processPendingEvents(proxy, runner, 1)).toEqual({ processed: 0, dispatched: 0 });
    expect(injected).toBe(true);
    expect(calls).toHaveLength(0);
    expect((await held(id))?.processed_at).toBeNull();
    expect((await db.query(`SELECT id FROM ai_tasks WHERE entry_point = 'workflow.event'`)).rows).toHaveLength(0);
  });

  it('holds a tagged event if the authoritative customer is inactive', async () => {
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [alice]);
    const id = await event('invoice.overdue', { invoiceId: invoice, customerId: alice });
    await processPendingEvents(db, runner, 1);
    expect(calls).toHaveLength(0);
    expect((await held(id))?.processed_at).toBeNull();
  });
});
