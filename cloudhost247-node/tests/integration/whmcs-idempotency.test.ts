import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import {
  beginOperation,
  completeOperation,
  failOperation,
  getOperation,
  mayRetry,
} from '../../src/whmcs/idempotency';
import { WhmcsError } from '../../src/whmcs/errors';

/**
 * Exercises the idempotency ledger against a real (embedded) PostgreSQL engine, because the
 * guarantee depends on SQL semantics — a UNIQUE constraint and a conditional UPDATE — not on
 * application logic that could be bypassed by a second process.
 */

describe('WHMCS idempotency ledger', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  it('claims a key once and counts the duplicate attempt', async () => {
    const first = await beginOperation(db, {
      operationKey: 'order:client-1:hosting-vps:monthly:abc123',
      action: 'AddOrder',
      requestId: 'req-1',
    });
    expect(first.created).toBe(true);
    expect(first.record.state).toBe('pending');

    const second = await beginOperation(db, {
      operationKey: 'order:client-1:hosting-vps:monthly:abc123',
      action: 'AddOrder',
      requestId: 'req-2',
    });
    expect(second.created).toBe(false);
    expect(second.record.requestId).toBe('req-1');
    expect(second.record.attempts).toBe(2);
  });

  it('records a confirmed success and never lets a duplicate rewrite it', async () => {
    const key = 'order:client-2:hosting-vps:monthly:def456';
    await beginOperation(db, { operationKey: key, action: 'AddOrder', requestId: 'req-a' });
    const completed = await completeOperation(db, {
      operationKey: key,
      whmcsRef: 'order-4242',
      response: { orderid: 4242 },
    });
    expect(completed.state).toBe('succeeded');
    expect(completed.whmcsRef).toBe('order-4242');

    const replay = await completeOperation(db, {
      operationKey: key,
      whmcsRef: 'order-9999',
      response: { orderid: 9999 },
    });
    expect(replay.state).toBe('succeeded');
    expect(replay.whmcsRef).toBe('order-4242');
    expect(replay.response).toEqual({ orderid: 4242 });
    expect(mayRetry(replay)).toBe(false);
  });

  it('marks an explicit rejection retryable and a success not', async () => {
    const key = 'payment:invoice-900:stripe:ghi789';
    await beginOperation(db, { operationKey: key, action: 'AddInvoicePayment', requestId: 'req-b' });
    const failed = await failOperation(db, { operationKey: key, errorCode: 'WHMCS_API_ERROR' });
    expect(failed.state).toBe('failed');
    expect(failed.errorCode).toBe('WHMCS_API_ERROR');
    expect(mayRetry(failed)).toBe(true);

    await completeOperation(db, { operationKey: key, whmcsRef: 'txn-1' });
    const after = await getOperation(db, key);
    expect(after?.state).toBe('succeeded');
    expect(mayRetry(after!)).toBe(false);
  });

  it('leaves an ambiguous attempt pending, which is the state that forbids a blind retry', async () => {
    const key = 'order:client-3:hosting-vps:monthly:jkl012';
    await beginOperation(db, { operationKey: key, action: 'AddOrder', requestId: 'req-c' });
    const record = await getOperation(db, key);
    expect(record?.state).toBe('pending');
    expect(mayRetry(record!)).toBe(false);
  });

  it('rejects a key that is not derived from stable inputs', async () => {
    await expect(
      beginOperation(db, { operationKey: 'x', action: 'AddOrder', requestId: 'req-d' }),
    ).rejects.toBeInstanceOf(WhmcsError);
  });

  it('stores no request body or credential in the ledger', async () => {
    const key = 'order:client-4:hosting-vps:monthly:mno345';
    await beginOperation(db, { operationKey: key, action: 'AddOrder', requestId: 'req-e' });
    const rows = await db.query<{ response_json: unknown }>(
      'SELECT response_json FROM whmcs_operations WHERE operation_key = $1',
      [key],
    );
    expect(rows.rows[0]?.response_json).toBeNull();
  });
});
