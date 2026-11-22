/**
 * Central authorized orchestration contract (Phase 2 gate item 1).
 *
 * Every task entering the shared preparation path must declare the server-side entry point
 * that produced it. The contract fails closed when the declared scope (requester type, actor,
 * customer) is inconsistent with that entry point, admission-checks the agent grant (agent
 * exists, enabled, active and declares the task type) before a NEW row is created, and the
 * entry point is persisted with the task so provenance stays auditable.
 *
 * This is NOT an HTTP authentication/authorization boundary and does not replace per-route
 * `authorize()`, workflow event claims, sweep bucket locks or conversation access checks:
 * those establish WHO is acting. This module makes that scope explicit, consistent and
 * centrally enforced at the single task-creation choke point; the executor independently
 * revalidates persisted scope, and callers recheck grants when acting on a reused task.
 */
import { ConflictError } from '../../lib/errors';
import type { Queryable } from '../../db/types';
import { getAgentById } from '../repositories/registry-repo';
import type { CreateTaskInput } from '../repositories/tasks-repo';

export const ORCHESTRATION_ENTRY_POINTS = [
  'admin.task',
  'admin.copilot',
  'admin.board.briefing',
  'schedule.scan',
  'schedule.board.briefing',
  'workflow.event',
  'customer.account_assistant',
  'customer.website_launch',
  'board.child',
] as const;

export type OrchestrationEntryPoint = (typeof ORCHESTRATION_ENTRY_POINTS)[number];

export function isOrchestrationEntryPoint(value: unknown): value is OrchestrationEntryPoint {
  return typeof value === 'string' && (ORCHESTRATION_ENTRY_POINTS as readonly string[]).includes(value);
}

/**
 * A scope that does not match its declared entry point is a server-side programming error or a
 * tampered call — the message stays generic so no scope details leak to callers.
 */
export class OrchestrationContractError extends Error {
  constructor() {
    super('Orchestration scope does not match the authorized entry point');
    this.name = 'OrchestrationContractError';
  }
}

/** Agent missing, disabled, inactive or not declaring the task type — surfaced as 409. */
export class AgentGrantError extends ConflictError {
  constructor() {
    super('Agent grant unavailable for this task type');
    this.name = 'AgentGrantError';
  }
}

type Rule = (input: CreateTaskInput) => void;

const reject = (): never => { throw new OrchestrationContractError(); };

const actorRequired = (input: CreateTaskInput, type: CreateTaskInput['requestedByType']): void => {
  if (type !== 'staff' || input.requestedByType !== 'staff' || !input.requestedBy) reject();
};

const noCustomer = (input: CreateTaskInput): void => {
  if (input.customerId) reject();
};

const RULES: Record<OrchestrationEntryPoint, Rule> = {
  // Staff console: authenticated staff actor; customer scope optional (a task ABOUT a customer).
  'admin.task': (input) => { actorRequired(input, 'staff'); },
  // Fixed-identity console surfaces: staff actor, never customer-scoped.
  'admin.copilot': (input) => { actorRequired(input, 'staff'); noCustomer(input); },
  'admin.board.briefing': (input) => { actorRequired(input, 'staff'); noCustomer(input); },
  // Platform schedules: no actor, no customer scope.
  'schedule.scan': (input) => {
    if (input.requestedByType !== 'schedule' || input.requestedBy) reject();
    noCustomer(input);
  },
  'schedule.board.briefing': (input) => {
    if (input.requestedByType !== 'schedule' || input.requestedBy) reject();
    noCustomer(input);
  },
  // Event workflow steps: identity is the claim, not a person; customer scope comes from the step.
  'workflow.event': (input) => {
    if (input.requestedByType !== 'workflow' || input.requestedBy) reject();
  },
  // Customer entries: the actor IS the customer and the customer scope must be the same account.
  'customer.account_assistant': (input) => {
    if (input.requestedByType !== 'customer' || !input.requestedBy) reject();
    if (input.customerId !== input.requestedBy) reject();
  },
  'customer.website_launch': (input) => {
    if (input.requestedByType === 'customer') {
      if (!input.requestedBy || input.customerId !== input.requestedBy) reject();
    } else if (input.requestedByType === 'system') {
      // Anonymous visitor: no actor and no customer scope may be asserted.
      if (input.requestedBy || input.customerId) reject();
    } else reject();
  },
  // Board children inherit the parent task's scope: staff/scheduled board parents (no customer)
  // or a customer-scoped parent (actor and customer identical).
  'board.child': (input) => {
    if (input.requestedByType === 'board') {
      if (input.customerId) reject();
    } else if (input.requestedByType === 'customer') {
      if (!input.requestedBy || !input.customerId || input.customerId !== input.requestedBy) reject();
    } else reject();
  },
};

/**
 * Synchronous fail-closed scope check. A reused idempotency key does not excuse an invalid
 * declaration: the caller must still declare a scope its entry point is allowed to produce.
 */
export function assertEntryPointContract(input: CreateTaskInput): asserts input is CreateTaskInput & { entryPoint: OrchestrationEntryPoint } {
  if (!isOrchestrationEntryPoint(input.entryPoint)) throw new OrchestrationContractError();
  RULES[input.entryPoint](input);
}

/**
 * Admission check before a NEW task row: the agent must exist, be enabled and active, and
 * declare the requested task type. Deliberately not run when an existing key is reused — a
 * reuse only reports recorded state; the executor and callers recheck grants before acting.
 */
export async function assertAgentGrant(db: Queryable, agentId: string, taskType: string): Promise<void> {
  const agent = await getAgentById(db, agentId);
  if (
    !agent
    || !agent.enabled
    || agent.status !== 'active'
    || !Array.isArray(agent.task_types)
    || !agent.task_types.includes(taskType)
  ) throw new AgentGrantError();
}
