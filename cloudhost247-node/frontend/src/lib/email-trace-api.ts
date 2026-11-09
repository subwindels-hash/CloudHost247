import { apiFetch } from './api';

/**
 * Email Trace Centre API client.
 *
 * The status vocabulary and the evidence note come from the server, not from this file: if the
 * backend's wording changes (for example to be more precise about what "delivered" means), the UI
 * changes with it. Nothing here computes a delivery status locally.
 */
export type DeliveryStatus =
  | 'ACCEPTED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'DEFERRED'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'REJECTED'
  | 'FAILED'
  | 'UNKNOWN';

export interface TraceEvent {
  id: string;
  traceId: string;
  eventType: string;
  status: DeliveryStatus;
  statusLabel: string;
  statusExplanation: string;
  sender: string;
  recipient: string;
  senderDomain: string;
  recipientDomain: string;
  smtpResponseCode: number | null;
  smtpResponseText: string | null;
  remoteHostname: string | null;
  occurredAt: string;
  serverId: string;
  /** Admin list only — attribution ids, never another tenant's name or email. */
  customerId?: string | null;
  hostingAccountId?: string | null;
  /** Admin list only — pinned against the retention sweep for an investigation. */
  retentionHold?: boolean;
}

export interface TraceListResponse {
  events: TraceEvent[];
  total: number;
  limit: number;
  offset: number;
  evidenceNote: string;
}

export interface TraceDetail {
  traceId: string;
  latestStatus: DeliveryStatus;
  statusDetail: { label: string; explanation: string; evidence: string };
  sender: string;
  recipient: string;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  events: TraceEvent[];
  evidenceNote: string;
}

export interface TraceSummary {
  total: number;
  byStatus: Record<DeliveryStatus, number>;
  from: string | null;
  to: string | null;
  evidenceNote: string;
  window?: string;
}

export interface TraceQueue {
  servers: Array<{
    serverId: string;
    queueCount: number;
    oldestSeconds: number | null;
    deferred: number;
    observedAt: string;
    note: string;
  }>;
  note: string;
}

export interface TraceHealth {
  sources: Array<{
    serverId: string;
    status: string;
    collectionEnabled: boolean;
    collectionMethod: string;
    checkpointOffset: number | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    capability: Record<string, unknown>;
  }>;
  summary: { ok: number; degraded: number; error: number; disabled: number };
  note: string;
}

export interface TraceCollectionRun {
  id: string;
  serverId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  recordsSeen: number;
  recordsCollected: number;
  recordsRejected: number;
  queueCount: number | null;
  errorClass: string | null;
  errorMessage: string | null;
}

export interface TraceSource {
  id: string;
  serverId: string;
  providerType: string;
  collectionMethod: string;
  collectionEnabled: boolean;
  status: string;
  capability: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  retentionDaysOverride: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export interface TraceStatusVocabulary {
  statuses: Array<{ status: DeliveryStatus; label: string; explanation: string; evidence: string }>;
  evidenceNote: string;
}

export function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : '';
}

export type DiagnosticStatus = 'PASS' | 'WARNING' | 'ERROR' | 'NOT_FOUND' | 'NOT_CHECKED' | 'UNKNOWN';

export interface DomainDiagnosticCheck {
  id: 'spf' | 'dkim' | 'dmarc' | 'mx' | 'ptr' | 'smtp_banner';
  label: string;
  status: DiagnosticStatus;
  summary: string;
  detail: string[];
  unavailable: boolean;
}

export interface DomainDiagnostics {
  domain: string;
  checks: DomainDiagnosticCheck[];
  notes: string[];
  caveat: string;
}

export function fetchTraceStatuses() {
  return apiFetch<TraceStatusVocabulary>('/api/v1/email-trace/statuses');
}

export function fetchTraceEvents(
  params: { status?: string; domain?: string; messageId?: string; limit?: number; offset?: number } = {},
  options: { admin?: boolean } = {}
) {
  const base = options.admin ? '/api/v1/admin/email-trace' : '/api/v1/email-trace';
  return apiFetch<TraceListResponse>(`${base}${query(params)}`);
}

export function fetchTraceDetail(traceId: string, options: { admin?: boolean } = {}) {
  const base = options.admin ? '/api/v1/admin/email-trace' : '/api/v1/email-trace';
  return apiFetch<TraceDetail>(`${base}/${encodeURIComponent(traceId)}`);
}

export function fetchTraceSummary(window: '24h' | '7d' | '30d' | '90d', options: { admin?: boolean } = {}) {
  const base = options.admin ? '/api/v1/admin/email-trace/summary' : '/api/v1/email-trace/summary';
  return apiFetch<TraceSummary>(`${base}?window=${window}`);
}

export function fetchTraceQueue(options: { admin?: boolean } = {}) {
  const base = options.admin ? '/api/v1/admin/email-trace/queue' : '/api/v1/email-trace/queue';
  return apiFetch<TraceQueue>(base);
}

export function fetchTraceHealth(options: { admin?: boolean } = {}) {
  const base = options.admin ? '/api/v1/admin/email-trace/sources' : '/api/v1/email-trace/health';
  return apiFetch<{ sources: TraceHealth['sources']; note: string; health?: unknown; summary?: unknown }>(base);
}

export function fetchTraceSources() {
  return apiFetch<{ sources: TraceSource[]; health: TraceHealth['sources']; note: string }>(
    '/api/v1/admin/email-trace/sources'
  );
}

export function updateTraceSource(
  sourceId: string,
  patch: { collectionEnabled?: boolean; retentionDaysOverride?: number | null }
) {
  return apiFetch<{ source: TraceSource }>(`/api/v1/admin/email-trace/sources/${sourceId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Domain diagnostics (SPF/DKIM/DMARC/MX/PTR and the opt-in SMTP banner).
 *
 * One endpoint rather than five tool calls: the server owns domain ownership checks and maps every
 * outcome into one vocabulary, including "this check could not run".
 */
export function fetchDomainDiagnostics(domainId: string, options: { banner?: boolean } = {}) {
  const search = options.banner ? '?banner=true' : '';
  return apiFetch<DomainDiagnostics>(
    `/api/v1/email-trace/domains/${encodeURIComponent(domainId)}/diagnostics${search}`
  );
}

export function setTraceEventHold(eventId: string, retentionHold: boolean) {
  return apiFetch<{ event: { id: string; traceId: string; retentionHold: boolean; eventTimestamp: string } }>(
    `/api/v1/admin/email-trace/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify({ retentionHold }) }
  );
}

export function fetchCollectionRuns(params: { sourceId?: string; status?: string; limit?: number; offset?: number } = {}) {
  return apiFetch<{ runs: TraceCollectionRun[]; total: number }>(
    `/api/v1/admin/email-trace/collection-runs${query(params)}`
  );
}

export function triggerCollection(payload: { serverId?: string; all?: boolean }) {
  return apiFetch<{
    collected: number;
    results: Array<{
      serverId: string;
      runId: string | null;
      status: string;
      reason: string | null;
      seen: number;
      collected: number;
      duplicates: number;
      rejected: number;
      unattributed: number;
      capability: { summary: string; mainlog: string; queue: string; limitations: string[] } | null;
    }>;
  }>('/api/v1/admin/email-trace/collect', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
