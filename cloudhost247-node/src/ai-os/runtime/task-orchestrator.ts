/**
 * Shared internal task preparation for authorized AI-OS entry points. Every input must
 * declare its server-side entry point; `assertEntryPointContract` fails closed when the
 * declared scope is inconsistent with that entry point, and `assertAgentGrant` admission-checks
 * the agent before a NEW row is created (reuse only reports recorded state — the executor and
 * callers recheck grants before acting on it). This is not an HTTP authorization boundary:
 * callers must still authenticate and derive their scope before invoking it. The executor
 * independently enforces registry grants, customer scope and tool approvals.
 */
import type { Queryable } from '../../db/types';
import { createTask, type CreateTaskInput } from '../repositories/tasks-repo';
import type { TaskRow } from '../types';
import { assertAgentGrant, assertEntryPointContract } from './orchestration-contract';

export class TaskIdentityConflict extends Error {
  constructor() {
    super('Existing task does not match the requested task identity');
    this.name = 'TaskIdentityConflict';
  }
}

/**
 * A reused key only identifies the same logical request if every persisted scope, routing,
 * entry point and input field agrees — including which entry point created the row (a key
 * reused across entry points is a conflict, not a match). Context is compared as JSONB so key
 * order is irrelevant. In particular, a changed workflow definition must not turn an earlier
 * success into proof a different step succeeded. This check is not a substitute for
 * authenticating the caller or fencing external side effects.
 */
async function reuseMatchesStored(db: Queryable, task: TaskRow, input: CreateTaskInput): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM ai_tasks WHERE id = $1
       AND agent_id = $2 AND task_type = $3
       AND subject_type IS NOT DISTINCT FROM $4::text AND subject_id IS NOT DISTINCT FROM $5::uuid
       AND context = $6::jsonb AND priority = $7 AND requested_by IS NOT DISTINCT FROM $8::uuid
       AND requested_by_type = $9 AND customer_id IS NOT DISTINCT FROM $10::uuid
       AND idempotency_key = $11 AND entry_point IS NOT DISTINCT FROM $12`,
    [task.id, input.agentId, input.taskType, input.subjectType ?? null, input.subjectId ?? null,
      JSON.stringify(input.context ?? {}), input.priority ?? 'normal', input.requestedBy ?? null,
      input.requestedByType, input.customerId ?? null, input.idempotencyKey ?? null, input.entryPoint],
  );
  return !!rows[0];
}

export async function prepareOrchestratedTask(db: Queryable, input: CreateTaskInput) {
  assertEntryPointContract(input);
  // Existing key wins over grant admission: a reuse reports recorded state and must still fail
  // with the precise identity mismatch (changed scope/type/entry point), while a missing key
  // means we are about to INSERT and the agent grant must hold.
  if (input.idempotencyKey) {
    const { rows } = await db.query<TaskRow>(`SELECT * FROM ai_tasks WHERE idempotency_key = $1`, [input.idempotencyKey]);
    if (rows[0]) {
      if (!await reuseMatchesStored(db, rows[0], input)) throw new TaskIdentityConflict();
      return { task: rows[0], created: false };
    }
  }
  await assertAgentGrant(db, input.agentId, input.taskType);
  const result = await createTask(db, input);
  if (result.created) return result;
  // A concurrent insert won the key between the pre-check and the insert: same identity rules.
  if (!await reuseMatchesStored(db, result.task, input)) throw new TaskIdentityConflict();
  return result;
}
