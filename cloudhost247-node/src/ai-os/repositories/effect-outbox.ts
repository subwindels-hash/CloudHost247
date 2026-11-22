/**
 * External-effect outbox (Phase 2 gate item 2): a durable intent before the effect, an atomic
 * claim paired with the approval execution claim, and the observed outcome recorded where the
 * approval is finalized. Pre-0117 approvals have no intent row — their lifecycle is unchanged
 * and outcome updates simply find nothing to close. Nothing here ever replays an effect:
 * stranding is detection only; no resolution or replay route is provided.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';

export function approvalEffectKey(approvalId: string): string {
  return `approval_execution:${approvalId}`;
}

export type EffectIntentStatus = 'pending' | 'dispatched' | 'succeeded' | 'failed' | 'needs_review';

export interface EffectIntentRow {
  id: string;
  effect_key: string;
  kind: string;
  approval_id: string | null;
  status: EffectIntentStatus;
  attempts: number;
  dispatched_at: string | null;
  outcome_at: string | null;
  outcome_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Must be called inside the approval-decision transaction; collisions fail closed. */
export async function recordEffectIntent(
  tx: Queryable,
  input: { effectKey: string; kind: 'approval_execution'; approvalId: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO ai_effect_outbox (id, effect_key, kind, approval_id, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [randomUUID(), input.effectKey, input.kind, input.approvalId],
  );
}

/** Single-winner intent claim — paired atomically with the approval execution claim (0108). */
export async function claimEffectIntent(tx: Queryable, effectKey: string): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE ai_effect_outbox
        SET status = 'dispatched', attempts = attempts + 1, dispatched_at = now(), updated_at = now()
      WHERE effect_key = $1 AND status = 'pending'
      RETURNING id`,
    [effectKey],
  );
  return !!rows[0];
}

/** Close a claimed intent with its observed outcome. No row (pre-0117) is fine. */
export async function recordEffectOutcome(
  tx: Queryable,
  effectKey: string,
  status: 'succeeded' | 'failed',
  error: string | null,
): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE ai_effect_outbox
        SET status = $2, outcome_at = now(), outcome_error = $3, updated_at = now()
      WHERE effect_key = $1 AND status = 'dispatched' RETURNING id`,
    [effectKey, status, error],
  );
  if (!rows[0]) {
    const existing = await tx.query<{ id: string }>(`SELECT id FROM ai_effect_outbox WHERE effect_key = $1`, [effectKey]);
    if (existing.rows[0]) throw new Error('Effect intent outcome claim was lost; reconciliation required');
  }
}

export interface StrandedEffectRow {
  id: string;
  kind: string;
  approval_id: string | null;
  status: EffectIntentStatus;
  attempts: number;
  dispatched_at: string | null;
  created_at: string;
  age_seconds: number;
}

/**
 * Bounded visibility of stranded intents: decided but never started (pending) or started with
 * no recorded outcome (dispatched), both past the detection window. Never claims or changes
 * a row. `needs_review`, `succeeded` and `failed` are resolved and excluded.
 */
export async function listStrandedEffects(
  db: Queryable,
  opts: { olderThanMinutes?: number; limit?: number } = {},
): Promise<StrandedEffectRow[]> {
  const olderThanMinutes = opts.olderThanMinutes ?? 5;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const { rows } = await db.query<StrandedEffectRow>(
    `SELECT id, kind, approval_id, status, attempts, dispatched_at, created_at,
            EXTRACT(EPOCH FROM (now() - COALESCE(dispatched_at, created_at)))::int AS age_seconds
       FROM ai_effect_outbox
      WHERE ((status = 'pending' AND created_at <= now() - make_interval(mins => $1))
          OR (status = 'dispatched' AND dispatched_at <= now() - make_interval(mins => $1)))
      ORDER BY COALESCE(dispatched_at, created_at) ASC
      LIMIT $2`,
    [olderThanMinutes, limit],
  );
  return rows;
}

/** Sweep detection only — counts, no state change, same doctrine as suspected-interrupted tasks. */
export async function countStrandedEffects(
  db: Queryable,
  olderThanMinutes = 5,
): Promise<{ pending: number; dispatched: number }> {
  const { rows } = await db.query<{ status: EffectIntentStatus; count: number }>(
    `SELECT status, count(*)::int AS count
       FROM ai_effect_outbox
      WHERE ((status = 'pending' AND created_at <= now() - make_interval(mins => $1))
          OR (status = 'dispatched' AND dispatched_at <= now() - make_interval(mins => $1)))
      GROUP BY status`,
    [olderThanMinutes],
  );
  const pending = rows.find((r) => r.status === 'pending')?.count ?? 0;
  const dispatched = rows.find((r) => r.status === 'dispatched')?.count ?? 0;
  return { pending, dispatched };
}

export async function getEffectIntent(db: Queryable, id: string): Promise<EffectIntentRow | null> {
  const { rows } = await db.query<EffectIntentRow>(`SELECT * FROM ai_effect_outbox WHERE id = $1`, [id]);
  return rows[0] ?? null;
}
