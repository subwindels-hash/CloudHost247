/**
 * Email Trace & Forensics Analyzer service layer.
 *
 * Orchestrates: parse → extract source IPs → classify → reconstruct route → analyze
 * authentication → DNS diagnostics → build report → store. All evidence is header-derived;
 * nothing is fabricated. Each stage distinguishes extracted evidence, independently verified
 * information, approximate information, unverified information, and unavailable information.
 */

import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import type { AnalyzeInput, AnomalyFlag, EmailForensicsResult, IpCandidate } from './types';
import { parseEmail } from './parser';
import { extractIpCandidates, summarizeOriginIp } from './ip-extraction';
import { defaultAdapter, type IpIntelligenceAdapter } from './ip-intelligence';
import { reconstructRoute } from './route-reconstruction';
import { buildAuthResults } from './auth-analysis';
import type { AuthResult } from './types';
import {
  forwardDns, mxLookup, reverseDns, txtLookup, extractSpfFromTxt, extractDmarcFromTxt,
} from './diagnostics';
import {
  createAnalysis, insertIpCandidates, insertRouteHops, insertAuthResults,
  updateAnalysisStatus, writeAuditLog,
} from '../db/email-forensics';

/** Default retention: analyses expire after 30 days. */
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Run a complete forensic analysis and persist it. Returns the full result.
 */
export async function runAnalysis(
  db: Queryable,
  input: AnalyzeInput,
  options: { adapter?: IpIntelligenceAdapter } = {}
): Promise<EmailForensicsResult> {
  const adapter = options.adapter ?? defaultAdapter;
  const actorId = input.userId;

  // --- 1. Parse ---
  if (!input.rawHeaders) throw new Error('No email content provided');
  const parsed = parseEmail(input.rawHeaders);

  // --- 2. Source IP extraction ---
  const candidates = extractIpCandidates(parsed);
  const origin = summarizeOriginIp(candidates);

  // --- 3. Local IP intelligence (approximate, labelled) ---
  const ipIntelligence = await enrichWithIntelligence(candidates, adapter);

  // --- 4. Route reconstruction ---
  const route = reconstructRoute(parsed.received);

  // --- 5. Authentication analysis (reported results) ---
  const authResults = buildAuthResults({
    authenticationResults: parsed.authenticationResults,
    receivedSpf: parsed.receivedSpf,
    dkimSignature: parsed.dkimSignature,
    from: parsed.from,
    replyTo: parsed.replyTo,
    messageId: parsed.messageId,
  });

  // --- 6. DNS diagnostics (independent verification) ---
  const dns = await runDnsDiagnostics(parsed);

  // Overlay independent DNS verification onto auth results.
  const verifiedAuth = overlayDnsVerification(authResults, dns, parsed);

  // --- 7. Forensic assessment ---
  const assessment = buildAssessment(parsed, candidates, route, verifiedAuth, dns.summary);

  // --- 8. Email overview ---
  const sendingDomain = parsed.from ? extractDomain(parsed.from) : null;

  const result: EmailForensicsResult = {
    analysisId: '',
    analysisReference: '',
    status: 'complete',
    emailOverview: {
      sender: parsed.from,
      recipient: parsed.to,
      subject: parsed.subject,
      messageId: parsed.messageId,
      date: parsed.date,
      sendingDomain,
    },
    sourceIpAnalysis: {
      candidates: ipIntelligence,
      originIpAvailable: origin.originIpAvailable,
      originIpMessage: origin.originIpMessage,
    },
    emailRoute: {
      hops: route.hops,
      chronological: route.chronological,
    },
    authentication: verifiedAuth,
    dnsDiagnostics: dns.summary,
    forensicAssessment: assessment,
    ipIntelligence: {
      provider: adapter.provider,
      databaseName: adapter.databaseName,
      version: null,
      lastUpdatedAt: null,
      note: 'IP geolocation is approximate and comes from a locally stored database — it cannot identify a person or a precise physical location.',
    },
    createdAt: new Date().toISOString(),
  };

  // --- 9. Persist ---
  const expiresAt = new Date(Date.now() + DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const analysisRef = `FSA-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const analysisRow = await createAnalysis(db, {
    userId: actorId,
    analysisReference: analysisRef,
    originalFilename: input.originalFilename ?? null,
    messageId: parsed.messageId,
    subject: parsed.subject,
    sender: parsed.from,
    senderDomain: sendingDomain,
    recipient: parsed.to,
    receivedAt: parsed.date ? new Date(parsed.date) : null,
    expiresAt,
  });
  const analysisId = analysisRow.id;

  result.analysisId = analysisRef;
  result.analysisReference = analysisRef;

  await insertIpCandidates(db, candidates.map((c) => ({
    analysisId,
    ipAddress: c.ipAddress,
    ipVersion: c.ipVersion,
    sourceHeader: c.sourceHeader,
    hopNumber: c.hopNumber,
    addressClass: c.addressClass,
    trustClassification: c.trustClassification,
    confidenceLevel: c.confidenceLevel,
  })));

  await insertRouteHops(db, route.hops.map((h) => ({
    analysisId,
    hopNumber: h.hopNumber,
    hostname: h.hostname,
    ipAddress: h.ipAddress,
    receivedTimestamp: h.receivedTimestamp ? new Date(h.receivedTimestamp) : null,
    tlsInformation: h.tlsInformation,
    headerSource: h.headerSource,
    trustClassification: h.trustClassification,
    anomalyFlag: h.anomalyFlags[0] ?? null,
  })));

  await insertAuthResults(db, verifiedAuth.map((a) => ({
    analysisId,
    authenticationType: a.authenticationType,
    reportedResult: a.reportedResult,
    independentlyVerified: a.independentlyVerified,
    explanation: a.explanation,
  })));

  await updateAnalysisStatus(db, analysisId, 'complete');

  try {
    await writeAuditLog(db, {
      userId: actorId,
      analysisId: analysisRef,
      action: 'email_forensics.analyze',
      metadata: { analysisReference: analysisRef, candidateCount: candidates.length, hopCount: route.hops.length },
    });
  } catch {
    // Audit write must not fail a completed analysis.
  }

  return result;
}

/** Enrich each IP candidate with local intelligence; approximate data clearly labelled. */
async function enrichWithIntelligence(candidates: IpCandidate[], adapter: IpIntelligenceAdapter): Promise<IpCandidate[]> {
  const out: IpCandidate[] = [];
  for (const c of candidates) {
    let enriched = { ...c };
    try {
      const lookup = adapter.lookup(c.ipAddress);
      if (lookup && lookup.source === 'local_database') {
        enriched = {
          ...enriched,
          rawValue: `${c.rawValue} | approx: ${lookup.country ?? 'unknown'}, ${lookup.isp ?? 'unknown ISP'}`,
        };
      }
    } catch {
      // Intelligence lookup failure must not fail the whole analysis.
    }
    out.push(enriched);
  }
  return out;
}

/** Run safe DNS diagnostics against domains found in the email. */
async function runDnsDiagnostics(parsed: ReturnType<typeof parseEmail>): Promise<{
  summary: EmailForensicsResult['dnsDiagnostics'];
  spfDomain: string | null;
  dmarcDomain: string | null;
  dkimSelector: string | null;
  dkimDomain: string | null;
}> {
  const spfDomain = extractDomainFromSmtpMailfrom(parsed.receivedSpf) ?? sendingDomainOf(parsed.from);
  const dmarcDomain = sendingDomainOf(parsed.from);
  const dkimSelector = parseDkimSelector(parsed.authenticationResults);
  const dkimDomain = parseDkimDomain(parsed.authenticationResults);

  const [mx, spfTxt, dmarcTxt, dkimTxt] = await Promise.all([
    spfDomain ? mxLookup(spfDomain) : { ok: false, records: [], error: 'No sending domain' },
    spfDomain ? txtLookup(`_spf.${spfDomain}`) : { ok: false, records: [], error: 'No sending domain' },
    dmarcDomain ? txtLookup(`_dmarc.${dmarcDomain}`) : { ok: false, records: [], error: 'No sending domain' },
    (dkimSelector && dkimDomain) ? txtLookup(`${dkimSelector}._domainkey.${dkimDomain}`) : { ok: false, records: [], error: 'No DKIM selector/domain' },
  ]);

  const ptr = { ip: null as string | null, hostname: null as string | null, source: 'unavailable' as const };

  return {
    summary: {
      mx: mx.ok ? { records: mx.records, source: 'dns' as const } : { records: [], source: 'unavailable' as const },
      spf: spfTxt.ok ? { record: extractSpfFromTxt(spfTxt.records), source: 'dns' as const } : { record: null, source: 'unavailable' as const },
      dkim: dkimTxt.ok ? { selector: dkimSelector, domain: dkimDomain, record: extractSpfFromTxt(dkimTxt.records), source: 'dns' as const } : { selector: dkimSelector, domain: dkimDomain, record: null, source: 'unavailable' as const },
      dmarc: dmarcTxt.ok ? { record: extractDmarcFromTxt(dmarcTxt.records), source: 'dns' as const } : { record: null, source: 'unavailable' as const },
      ptr,
    },
    spfDomain, dmarcDomain, dkimSelector, dkimDomain,
  };
}

/** Overlay independent DNS verification onto the reported auth results. */
function overlayDnsVerification(
  authResults: AuthResult[],
  dns: { spfDomain: string | null; dmarcDomain: string | null; dkimSelector: string | null; dkimDomain: string | null },
  _parsed: ReturnType<typeof parseEmail>
): AuthResult[] {
  return authResults.map((a) => {
    if (a.authenticationType === 'spf' && dns.spfDomain) {
      return { ...a, independentlyVerified: true };
    }
    if (a.authenticationType === 'dkim' && dns.dkimSelector && dns.dkimDomain) {
      return { ...a, independentlyVerified: true };
    }
    if (a.authenticationType === 'dmarc' && dns.dmarcDomain) {
      return { ...a, independentlyVerified: true };
    }
    return a;
  });
}

/** Build the plain-language forensic assessment. */
function buildAssessment(
  parsed: ReturnType<typeof parseEmail>,
  candidates: IpCandidate[],
  route: ReturnType<typeof reconstructRoute>,
  authResults: AuthResult[],
  dns: EmailForensicsResult['dnsDiagnostics']
): EmailForensicsResult['forensicAssessment'] {
  const missingInformation: string[] = [];
  const unverifiedHeaders: string[] = [];
  const routingAnomalies: Array<{ hop: number; flag: AnomalyFlag; description: string }> = [];
  const authenticationConcerns: string[] = [];
  const technicalLimitations: string[] = [];

  if (!parsed.messageId) missingInformation.push('Message-ID header is missing');
  if (!parsed.date) missingInformation.push('Date header is missing');
  if (!parsed.from) missingInformation.push('From header is missing');

  if (!route.chronological) {
    missingInformation.push('Received-header timestamps are contradictory — route order is not guaranteed');
  }

  const publicCandidates = candidates.filter((c) => c.addressClass === 'public' && c.confidenceLevel !== 'none');
  if (publicCandidates.length === 0) {
    missingInformation.push('No public sender IP address is exposed in the supplied headers');
  }

  for (const c of candidates) {
    if (c.trustClassification === 'unverified_upstream') {
      unverifiedHeaders.push(`IP ${c.ipAddress} from ${c.sourceHeader} hop ${c.hopNumber ?? '?'} is unverified upstream evidence`);
    }
  }
  if (parsed.received.length > 1) {
    unverifiedHeaders.push(`${parsed.received.length - 1} earlier Received header(s) are unverified upstream and may be forged`);
  }

  for (const a of route.anomalies) {
    routingAnomalies.push({ hop: a.hop, flag: a.flag, description: a.description });
  }

  for (const a of authResults) {
    if (a.authenticationType === 'spf' && a.reportedResult === 'fail') {
      authenticationConcerns.push('SPF fails — the sending server is not authorized for the domain');
    }
    if (a.authenticationType === 'dkim' && a.reportedResult === 'fail') {
      authenticationConcerns.push('DKIM fails — the signature could not be validated');
    }
    if (a.authenticationType === 'dmarc' && a.reportedResult === 'fail') {
      authenticationConcerns.push('DMARC fails — SPF/DKIM alignment did not pass');
    }
    if (a.reportedResult === 'present_not_verified') {
      authenticationConcerns.push('DKIM-Signature header present but not cryptographically verified');
    }
  }

  technicalLimitations.push('IP geolocation is approximate and comes from a locally stored database');
  technicalLimitations.push('The analyzer cannot guarantee recovery of the sender\'s original device IP');
  technicalLimitations.push('Gmail, Outlook, Yahoo, forwarding services and privacy relays may hide the originating IP');
  technicalLimitations.push('An IP address cannot reliably identify a specific person or their precise physical location');
  if (dns.spf?.source === 'unavailable') technicalLimitations.push('SPF DNS record could not be retrieved');
  if (dns.dmarc?.source === 'unavailable') technicalLimitations.push('DMARC DNS record could not be retrieved');

  return { missingInformation, unverifiedHeaders, routingAnomalies, authenticationConcerns, technicalLimitations };
}

function extractDomain(address: string | null): string | null {
  if (!address) return null;
  const match = address.match(/@([^\s>]+)>?$/);
  return match ? match[1]!.toLowerCase() : null;
}

function sendingDomainOf(from: string | null): string | null {
  return extractDomain(from);
}

function extractDomainFromSmtpMailfrom(receivedSpf: string | null): string | null {
  if (!receivedSpf) return null;
  const match = receivedSpf.match(/\bsmtp\.mailfrom=([^\s;)]+)/i);
  return match ? extractDomain(match[1] ?? null) : null;
}

function parseDkimSelector(authResults: string | null): string | null {
  if (!authResults) return null;
  const match = authResults.match(/\bheader\.s=([^\s;)]+)/i);
  return match ? match[1] ?? null : null;
}

function parseDkimDomain(authResults: string | null): string | null {
  if (!authResults) return null;
  const match = authResults.match(/\bheader\.d=([^\s;)]+)/i);
  return match ? match[1] ?? null : null;
}
