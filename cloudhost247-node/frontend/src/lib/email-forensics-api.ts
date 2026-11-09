/**
 * Email Trace & Forensics Analyzer API client.
 *
 * Every call goes through apiFetch, which attaches the stored bearer token and centralises error
 * handling (including clearing a revoked session on 401). Relative URLs only — the SPA is served
 * from the same origin as the API.
 *
 * Nothing here computes a forensic conclusion: every label, confidence level and limitation comes
 * from the server, so the UI cannot drift into claiming more than the headers support.
 */

import { apiFetch } from './api';
import { query } from './email-trace-api';

/** ---- Request types ------------------------------------------------------------ */

export interface AnalyzeHeadersInput {
  rawHeaders: string;
}

export interface AnalyzeFileInput {
  file: File;
}

export interface HistoryParams {
  /** index signature permits passing whole param objects into the shared query serializer. */
  [key: string]: string | number | undefined;
  status?: 'pending' | 'complete' | 'failed';
  limit?: number;
  offset?: number;
}

export interface ReportFormat {
  format: 'json' | 'pdf';
}

/** ---- Response types (mirror the server contract) ------------------------------- */

export interface IpCandidate {
  ipAddress: string;
  ipVersion: 'ipv4' | 'ipv6';
  sourceHeader: string;
  hopNumber: number | null;
  addressClass: string;
  trustClassification: string;
  confidenceLevel: string;
  rawValue: string;
}

export interface RouteHop {
  hopNumber: number;
  hostname: string | null;
  ipAddress: string | null;
  receivedTimestamp: string | null;
  tlsInformation: string | null;
  headerSource: string;
  trustClassification: string;
  anomalyFlags: string[];
}

export interface AuthResult {
  authenticationType: string;
  reportedResult: string | null;
  independentlyVerified: boolean;
  explanation: string | null;
}

export interface DnsDiagnostics {
  mx: { records: string[]; source: string } | null;
  spf: { record: string | null; source: string } | null;
  dkim: {
    selector: string | null;
    domain: string | null;
    record: string | null;
    source: string;
  } | null;
  dmarc: { record: string | null; source: string } | null;
  ptr: { ip: string | null; hostname: string | null; source: string } | null;
}

export interface ForensicAssessment {
  missingInformation: string[];
  unverifiedHeaders: string[];
  routingAnomalies: Array<{ hop: number; flag: string; description: string }>;
  authenticationConcerns: string[];
  technicalLimitations: string[];
}

export interface IpIntelligence {
  provider: string | null;
  databaseName: string | null;
  version: string | null;
  lastUpdatedAt: string | null;
  note: string;
}

export interface EmailForensicsResult {
  analysisId: string;
  analysisReference: string;
  status: string;
  emailOverview: {
    sender: string | null;
    recipient: string | null;
    subject: string | null;
    messageId: string | null;
    date: string | null;
    sendingDomain: string | null;
  };
  sourceIpAnalysis: {
    candidates: IpCandidate[];
    originIpAvailable: boolean;
    originIpMessage: string;
  };
  emailRoute: {
    hops: RouteHop[];
    chronological: boolean;
  };
  authentication: AuthResult[];
  dnsDiagnostics: DnsDiagnostics;
  forensicAssessment: ForensicAssessment;
  ipIntelligence: IpIntelligence;
  createdAt: string;
}

export interface AnalysisSummary {
  id: string;
  analysisReference: string;
  originalFilename: string | null;
  subject: string | null;
  sender: string | null;
  senderDomain: string | null;
  recipient: string | null;
  receivedAt: string | null;
  status: string;
  createdAt: string;
  expiresAt: string;
}

export interface HistoryResponse {
  analyses: AnalysisSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface DatabaseVersion {
  provider: string;
  name: string;
  version: string | null;
  lastUpdatedAt: string | null;
  status: string;
}

export interface DatabaseStatusResponse {
  versions: DatabaseVersion[];
  note: string;
}

/** ---- Admin types -------------------------------------------------------------- */

export interface AdminStats {
  total: number;
  byStatus: Record<string, number>;
  failedCount: number;
  failed: Array<{
    id: string;
    userId: string;
    createdAt: string;
    status: string;
  }>;
  note: string;
}

export interface DatabaseUpdateResponse {
  status: string;
  provider: string;
  version: string;
  lastUpdatedAt: string;
  note: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  analysisId: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogsResponse {
  auditLogs: AuditLog[];
  limit: number;
  offset: number;
}

/** ---- Customer API ------------------------------------------------------------- */

export function analyzeHeaders(input: AnalyzeHeadersInput) {
  return apiFetch<EmailForensicsResult>('/api/v1/email-forensics/analyze', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Upload an .eml / .txt file. The body is a raw upload with the file bytes; the filename is
 * sent via the X-Filename header so the server can validate the extension without needing a
 * multipart parser.
 */
export function analyzeFile(input: AnalyzeFileInput) {
  return apiFetch<EmailForensicsResult>('/api/v1/email-forensics/analyze-file', {
    method: 'POST',
    headers: {
      'X-Filename': input.file.name,
    },
    body: input.file,
  });
}

export function fetchHistory(params: HistoryParams = {}) {
  return apiFetch<HistoryResponse>(`/api/v1/email-forensics/history${query(params)}`);
}

export interface AnalysisDetail {
  id: string;
  analysisReference: string;
  originalFilename: string | null;
  subject: string | null;
  sender: string | null;
  senderDomain: string | null;
  recipient: string | null;
  receivedAt: string | null;
  status: string;
  createdAt: string;
  expiresAt: string;
  sourceIpCandidates: IpCandidate[];
  routeHops: RouteHop[];
  authentication: AuthResult[];
}

export function fetchAnalysis(id: string) {
  return apiFetch<AnalysisDetail>(`/api/v1/email-forensics/history/${encodeURIComponent(id)}`);
}

/** Transform the flat stored detail into the EmailForensicsResult shape used by the UI. */
export function detailToResult(detail: AnalysisDetail): EmailForensicsResult {
  return {
    analysisId: detail.analysisReference,
    analysisReference: detail.analysisReference,
    status: detail.status,
    emailOverview: {
      sender: detail.sender,
      recipient: detail.recipient,
      subject: detail.subject,
      messageId: null,
      date: detail.receivedAt,
      sendingDomain: detail.senderDomain,
    },
    sourceIpAnalysis: {
      candidates: detail.sourceIpCandidates,
      originIpAvailable: detail.sourceIpCandidates.some(
        (c) => c.addressClass === 'public' && c.confidenceLevel !== 'none'
      ),
      originIpMessage:
        detail.sourceIpCandidates.some(
          (c) => c.addressClass === 'public' && c.confidenceLevel !== 'none'
        )
          ? 'Public IP candidate(s) found in the supplied headers.'
          : 'Original sender IP not available in the supplied headers.',
    },
    emailRoute: { hops: detail.routeHops, chronological: true },
    authentication: detail.authentication,
    dnsDiagnostics: { mx: null, spf: null, dkim: null, dmarc: null, ptr: null },
    forensicAssessment: {
      missingInformation: [], unverifiedHeaders: [], routingAnomalies: [],
      authenticationConcerns: [], technicalLimitations: [],
    },
    ipIntelligence: {
      provider: null, databaseName: null, version: null, lastUpdatedAt: null,
      note: 'IP intelligence data was not stored with this analysis.',
    },
    createdAt: detail.createdAt,
  };
}

export function deleteAnalysis(id: string) {
  return apiFetch<void>(`/api/v1/email-forensics/history/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function fetchReport(id: string, format: 'json' | 'pdf') {
  return fetch(
    `/api/v1/email-forensics/report/${encodeURIComponent(id)}?format=${format}`,
    {
      headers: {
        Authorization: `Bearer ${JSON.parse(localStorage.getItem('ch247_token') ?? 'null')}`,
      },
    }
  ).then(async (res) => {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Report download failed (HTTP ${res.status}): ${text}`);
    }
    return res.blob();
  });
}

export function fetchDatabaseStatus() {
  return apiFetch<DatabaseStatusResponse>('/api/v1/email-forensics/database-status');
}

/** ---- Admin API -------------------------------------------------------------- */

export function fetchAdminStats() {
  return apiFetch<AdminStats>('/api/v1/admin/email-forensics/stats');
}

export function fetchAdminDatabaseVersions() {
  return apiFetch<{ versions: DatabaseVersion[] }>('/api/v1/admin/email-forensics/database-versions');
}

export function updateDatabaseVersion(input: {
  provider: string;
  sourceUrl?: string;
  version?: string;
}) {
  return apiFetch<DatabaseUpdateResponse>('/api/v1/admin/email-forensics/database-update', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchAdminAuditLogs(params: { limit?: number; offset?: number } = {}) {
  return apiFetch<AuditLogsResponse>(`/api/v1/admin/email-forensics/audit-logs${query(params)}`);
}

export function toggleFeature(disabled: boolean) {
  return apiFetch<{ status: string; disabled: boolean; note: string }>(
    '/api/v1/admin/email-forensics/disable',
    { method: 'POST', body: JSON.stringify({ disabled }) }
  );
}
