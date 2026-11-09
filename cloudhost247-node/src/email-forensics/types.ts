/**
 * Email Trace & Forensics Analyzer — shared vocabulary.
 *
 * Nothing in this file performs I/O. Every rule here is testable from fixtures without a mail
 * server or a network connection, which is exactly how the unit tests exercise it.
 *
 * Evidence vocabulary (session 15 of the spec): every result distinguishes
 *   - extracted evidence        (found in the supplied headers)
 *   - independently verified    (checked by CloudHost247, e.g. a DNS query)
 *   - approximate               (local IP intelligence, clearly labelled approximate)
 *   - unverified                (upstream header the analyzer cannot vouch for)
 *   - unavailable               (not present in what the user supplied)
 *
 * The analyzer never guesses: anything the evidence does not settle is "none"/"unavailable",
 * never fabricated.
 */

/** Confidence level assigned to each IP candidate. */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'none'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Address class after IPv4/IPv6 classification. */
export const ADDRESS_CLASSES = [
  'private',
  'reserved',
  'loopback',
  'multicast',
  'public',
  'unavailable',
] as const;
export type AddressClass = (typeof ADDRESS_CLASSES)[number];

/** Trust classification of where an IP candidate came from. */
export const TRUST_CLASSIFICATIONS = [
  'trusted_receiving_server',
  'unverified_upstream',
  'private_internal',
  'public_candidate',
  'hidden_unavailable',
] as const;
export type TrustClassification = (typeof TRUST_CLASSIFICATIONS)[number];

/** Trust classification of a route hop. */
export const HOP_TRUST_CLASSES = [
  'verified_receiving_server',
  'unverified_upstream',
  'private_network_hop',
  'public_network_hop',
  'origin_ip_unavailable',
] as const;
export type HopTrustClass = (typeof HOP_TRUST_CLASSES)[number];

/** Analysis lifecycle status. */
export const ANALYSIS_STATUSES = ['pending', 'complete', 'failed'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** Authentication types the analyzer reports on. */
export const AUTH_TYPES = [
  'spf',
  'dkim',
  'dmarc',
  'return_path',
  'reply_to',
  'message_id',
  'tls',
] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

/** Reported result vocabulary for auth checks. */
export const AUTH_REPORTED_RESULTS = [
  'pass',
  'fail',
  'softfail',
  'neutral',
  'none',
  'temperror',
  'permerror',
  'present_not_verified',
  'missing',
  'malformed',
  'unavailable',
] as const;
export type AuthReportedResult = (typeof AUTH_REPORTED_RESULTS)[number];

/** Anomaly flags raised during route reconstruction. */
export const ANOMALY_FLAGS = [
  'missing_timestamp',
  'duplicate_hop',
  'unusual_routing',
  'contradictory_timestamp',
  'unverified_upstream_header',
  'malformed_header_value',
] as const;
export type AnomalyFlag = (typeof ANOMALY_FLAGS)[number];

/** Evidence tag: how strongly a piece of information is backed. */
export const EVIDENCE_TAGS = [
  'extracted_evidence',
  'independently_verified',
  'approximate',
  'unverified',
  'unavailable',
] as const;
export type EvidenceTag = (typeof EVIDENCE_TAGS)[number];

/** One IP candidate found in the headers. */
export interface IpCandidate {
  ipAddress: string;
  ipVersion: 'ipv4' | 'ipv6';
  sourceHeader: string;          // exact header name, e.g. "Received" or "X-Originating-IP"
  hopNumber: number | null;      // position in the Received chain (1 = closest to receiver)
  addressClass: AddressClass;
  trustClassification: TrustClassification;
  confidenceLevel: ConfidenceLevel;
  rawValue: string;              // the exact header fragment it came from (for forensic review)
}

/** One reconstructed route hop. */
export interface RouteHop {
  hopNumber: number;
  hostname: string | null;
  ipAddress: string | null;
  receivedTimestamp: string | null; // ISO, or null when missing
  tlsInformation: string | null;
  headerSource: string;          // the Received header text this hop was built from
  trustClassification: HopTrustClass;
  anomalyFlags: AnomalyFlag[];
}

/** One authentication result. */
export interface AuthResult {
  authenticationType: AuthType;
  reportedResult: AuthReportedResult | null;
  independentlyVerified: boolean;
  explanation: string | null;
}

/** The full analysis result returned by the service. */
export interface EmailForensicsResult {
  analysisId: string;
  analysisReference: string;
  status: AnalysisStatus;

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
    originIpMessage: string; // "Original sender IP not available in the supplied headers." when missing
  };

  emailRoute: {
    hops: RouteHop[];
    chronological: boolean; // true when timestamps allowed chronological ordering
  };

  authentication: AuthResult[];

  dnsDiagnostics: {
    mx: { records: string[]; source: 'extracted' | 'dns' | 'unavailable' } | null;
    spf: { record: string | null; source: 'extracted' | 'dns' | 'unavailable' } | null;
    dkim: { selector: string | null; domain: string | null; record: string | null; source: 'extracted' | 'dns' | 'unavailable' } | null;
    dmarc: { record: string | null; source: 'extracted' | 'dns' | 'unavailable' } | null;
    ptr: { ip: string | null; hostname: string | null; source: 'dns' | 'unavailable' } | null;
  };

  forensicAssessment: {
    missingInformation: string[];
    unverifiedHeaders: string[];
    routingAnomalies: Array<{ hop: number; flag: AnomalyFlag; description: string }>;
    authenticationConcerns: string[];
    technicalLimitations: string[];
  };

  ipIntelligence: {
    provider: string | null;
    databaseName: string | null;
    version: string | null;
    lastUpdatedAt: string | null;
    note: string;
  };

  createdAt: string;
}

/** Row shape inserted into email_forensic_ip_candidates. */
export interface IpCandidateInsert {
  analysisId: string;
  ipAddress: string;
  ipVersion: 'ipv4' | 'ipv6';
  sourceHeader: string;
  hopNumber: number | null;
  addressClass: AddressClass;
  trustClassification: TrustClassification;
  confidenceLevel: ConfidenceLevel;
}

/** Row shape inserted into email_forensic_route_hops. */
export interface RouteHopInsert {
  analysisId: string;
  hopNumber: number;
  hostname: string | null;
  ipAddress: string | null;
  receivedTimestamp: Date | null;
  tlsInformation: string | null;
  headerSource: string;
  trustClassification: HopTrustClass;
  anomalyFlag: AnomalyFlag | null;
}

/** Row shape inserted into email_forensic_auth_results. */
export interface AuthResultInsert {
  analysisId: string;
  authenticationType: AuthType;
  reportedResult: AuthReportedResult | null;
  independentlyVerified: boolean;
  explanation: string | null;
}

/** Local IP intelligence lookup result (adapter contract). */
export interface IpIntelligenceLookup {
  ip: string;
  ipVersion: 'ipv4' | 'ipv6';
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  isp: string | null;
  asn: string | null;
  organisation: string | null;
  hosting: boolean | null; // true when the dataset classifies it as hosting/cloud/datacentre
  addressClass: AddressClass;
  source: 'local_database' | 'computed';
}

/** Local IP intelligence database version record. */
export interface DatabaseVersion {
  databaseProvider: string;
  databaseName: string;
  version: string | null;
  lastUpdatedAt: string | null;
  status: string;
}

/** A parsed raw email — header-derived fields only, no body. */
export interface ParsedEmail {
  headers: Record<string, string[]>;        // header name -> values (preserves duplicates)
  folded: boolean;                          // true when any folded header was present
  received: string[];                       // all Received headers (raw)
  returnPath: string | null;
  from: string | null;
  sender: string | null;
  replyTo: string | null;
  to: string | null;
  date: string | null;
  subject: string | null;
  messageId: string | null;
  authenticationResults: string | null;
  receivedSpf: string | null;
  dkimSignature: string | null;
  mimeVersion: string | null;
  contentType: string | null;
  xOriginatingIp: string | null;
  xHeaders: Record<string, string[]>;       // other X-* headers
}

/** Input to the analyzer service. */
export interface AnalyzeInput {
  rawHeaders: string | null;     // pasted headers
  originalFilename: string | null; // for .eml uploads
  userId: string;
}
