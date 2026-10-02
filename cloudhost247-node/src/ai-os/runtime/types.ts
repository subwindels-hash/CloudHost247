/** Shared runtime types — separated so executor and handlers import one-way only. */
import type { Queryable } from '../../db/types';
import type { AgentRow, EvidenceRef, RunPhase, TaskRow } from '../types';

export interface FindingInput {
  findingType: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  summary: string;
  evidence: EvidenceRef[];
  subjectType?: string | null;
  subjectId?: string | null;
  recommendation?: string | null;
  dedupeOpen?: boolean;
}

export interface ToolCallOutcome {
  status: 'executed' | 'pending_approval' | 'denied' | 'failed';
  approvalId?: string;
  data?: unknown;
  evidence?: EvidenceRef[];
  errorCode?: string;
  message?: string;
}

export interface AgentRunContext {
  db: Queryable;
  agent: AgentRow;
  task: TaskRow;
  runId: string;
  /** The ONLY way a handler performs an action — gated by registry permissions, risk policy
   *  and the approval engine. */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
  emitFinding(input: FindingInput): Promise<{ id: string; created: boolean }>;
  step(phase: RunPhase, detail: Record<string, unknown>): Promise<void>;
  putMemory(key: string, value: unknown, scope?: 'short' | 'customer' | 'operational' | 'organizational' | 'executive', expiresAt?: string | null): Promise<void>;
  getMemory<T = unknown>(key: string, scope?: 'short' | 'customer' | 'operational' | 'organizational' | 'executive'): Promise<{ value: T } | null>;
  /** Present for customer-workspace runs: tools are hard-scoped to this customer. */
  customerScopeUserId?: string | null;
  actorUserId?: string | null;
  /**
   * Runs another agent under ITS OWN identity/permissions as a child task (Executive Board
   * coordination — spec §27: no agent fabricates another agent's conclusion; the seat's digest
   * is produced by the seat itself and merely aggregated). Depth-limited to prevent recursion.
   */
  runChildAgent(taskType: string, input: Record<string, unknown>, opts?: { agentSlug: string; idempotencyKey?: string | null }): Promise<{ status: string; summary: string | null; result: Record<string, unknown> | null; agentSlug: string }>;
}

export interface HandlerResult {
  summary: string;
  result?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}

export type AgentHandler = (ctx: AgentRunContext, input: Record<string, unknown>) => Promise<HandlerResult>;
