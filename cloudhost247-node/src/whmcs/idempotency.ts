/**
 * Idempotency ledger for WHMCS operations.
 *
 * The rule this enforces: **a retry is a question, not a second command.** Before a state-changing
 * WHMCS call is sent, an operation row is written with a caller-derived key. If the reply is lost
 * (timeout, connection reset, process restart during a deploy), the next attempt with the same key
 * finds the row rather than sending the request again. If the first attempt succeeded, the recorded
 * outcome is returned; if it is still `pending`, the caller must reconcile against WHMCS (look the
 * order/invoice up) before deciding to re-send.
 *
 * What this module deliberately does not do: it does not retry, does not decide the outcome, and
 * does not store the request body. The body carries the API identifier and secret, and a ledger is
 * the last place either should live.
 */

import type { Queryable } from '../db/types';
import { WhmcsOperationConflictError, WhmcsError } from './errors';

export type OperationState = 'pending' | 'succeeded' | 'failed';

export interface OperationRecord {
  operationKey: string;
  action: string;
  requestId: string;
  state: OperationState;
  whmcsRef: string | null;
  errorCode: string | null;
  attempts: number;
  response: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface BeginOperationInput {
  operationKey: string;
  action: string;
  requestId: string;
}

const KEY_PATTERN = /^[A-Za-z0-9:_.-]{8,200}$/;

export function assertOperationKey(operationKey: string): void {
  if (!KEY_PATTERN.test(operationKey)) {
    throw new WhmcsError(
      'WHMCS_OPERATION_CONFLICT',
      'operationKey must be 8-200 characters of letters, digits, colon, underscore, dot or hyphen',
      false,
      { operationKeyLength: operationKey.length },
    );
  }
}

interface RowShape {
  operation_key: string;
  action: string;
  request_id: string;
  state: string;
  whmcs_ref: string | null;
  error_code: string | null;
  attempts: number | string;
  response_json: unknown;
  created_at: string;
  updated_at: string;
}

function toRecord(row: RowShape): OperationRecord {
  return {
    operationKey: row.operation_key,
    action: row.action,
    requestId: row.request_id,
    state: row.state as OperationState,
    whmcsRef: row.whmcs_ref,
    errorCode: row.error_code,
    attempts: Number(row.attempts),
    response: row.response_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `operation_key, action, request_id, state, whmcs_ref, error_code, attempts,
  response_json, created_at::text AS created_at, updated_at::text AS updated_at`;

/**
 * Claims an operation key.
 *
 * @returns `created: true` when this caller owns the attempt; `created: false` when the operation
 *          already exists (its recorded state is returned and the caller must not re-send blindly).
 */
export async function beginOperation(
  pool: Queryable,
  input: BeginOperationInput,
): Promise<{ created: boolean; record: OperationRecord }> {
  assertOperationKey(input.operationKey);
  const inserted = await pool.query<RowShape>(
    `INSERT INTO whmcs_operations (operation_key, action, request_id, state)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (operation_key) DO NOTHING
     RETURNING ${SELECT_COLUMNS}`,
    [input.operationKey, input.action, input.requestId],
  );
  const createdRow = inserted.rows[0];
  if (createdRow) return { created: true, record: toRecord(createdRow) };

  const existing = await getOperation(pool, input.operationKey);
  if (!existing) {
    // The row existed a moment ago and has gone — treat as a hard failure rather than guessing.
    throw new WhmcsOperationConflictError(input.operationKey, 'missing');
  }
  // A duplicate attempt is counted, never "fixed" by overwriting the recorded outcome.
  const counted = await pool.query<RowShape>(
    `UPDATE whmcs_operations SET attempts = attempts + 1, updated_at = now()
      WHERE operation_key = $1
      RETURNING ${SELECT_COLUMNS}`,
    [input.operationKey],
  );
  const countedRow = counted.rows[0];
  return { created: false, record: countedRow ? toRecord(countedRow) : existing };
}

export async function getOperation(
  pool: Queryable,
  operationKey: string,
): Promise<OperationRecord | null> {
  assertOperationKey(operationKey);
  const result = await pool.query<RowShape>(
    `SELECT ${SELECT_COLUMNS} FROM whmcs_operations WHERE operation_key = $1`,
    [operationKey],
  );
  const row = result.rows[0];
  return row ? toRecord(row) : null;
}

export interface CompleteOperationInput {
  operationKey: string;
  whmcsRef?: string | null;
  response?: unknown;
}

/**
 * Records a confirmed success. Idempotent: a second call for an already-succeeded operation returns
 * the stored record unchanged, so a duplicate reply cannot rewrite history. A `failed` operation
 * *may* become `succeeded` — that is the retry-after-explicit-rejection path — but the reverse never
 * happens and `succeeded` is terminal.
 */
export async function completeOperation(
  pool: Queryable,
  input: CompleteOperationInput,
): Promise<OperationRecord> {
  assertOperationKey(input.operationKey);
  const updated = await pool.query<RowShape>(
    `UPDATE whmcs_operations
        SET state = 'succeeded',
            whmcs_ref = COALESCE($2, whmcs_ref),
            response_json = COALESCE($3::jsonb, response_json),
            error_code = NULL,
            updated_at = now()
      WHERE operation_key = $1 AND state <> 'succeeded'
      RETURNING ${SELECT_COLUMNS}`,
    [input.operationKey, input.whmcsRef ?? null, input.response === undefined ? null : JSON.stringify(input.response)],
  );
  const row = updated.rows[0];
  if (row) return toRecord(row);
  const existing = await getOperation(pool, input.operationKey);
  if (!existing) throw new WhmcsOperationConflictError(input.operationKey, 'missing');
  return existing;
}

/** Records a failure that is known to be a failure (a rejected request, not an ambiguous timeout). */
export async function failOperation(
  pool: Queryable,
  input: { operationKey: string; errorCode: string },
): Promise<OperationRecord> {
  assertOperationKey(input.operationKey);
  const updated = await pool.query<RowShape>(
    `UPDATE whmcs_operations
        SET state = 'failed', error_code = $2, updated_at = now()
      WHERE operation_key = $1 AND state <> 'succeeded'
      RETURNING ${SELECT_COLUMNS}`,
    [input.operationKey, input.errorCode.slice(0, 80)],
  );
  const row = updated.rows[0];
  if (row) return toRecord(row);
  const existing = await getOperation(pool, input.operationKey);
  if (!existing) throw new WhmcsOperationConflictError(input.operationKey, 'missing');
  return existing;
}

/**
 * Whether a caller may safely re-send. Only a *failed* operation (an explicit rejection from WHMCS)
 * may be retried with the same key; `pending` means "unknown outcome — reconcile first", and
 * `succeeded` means "already done".
 */
export function mayRetry(record: OperationRecord): boolean {
  return record.state === 'failed';
}
