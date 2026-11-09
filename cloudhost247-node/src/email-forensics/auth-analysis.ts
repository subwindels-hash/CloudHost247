/**
 * Email authentication analysis for the forensics analyzer.
 *
 * Analyses SPF, DKIM and DMARC evidence available in the supplied headers, and (optionally)
 * independently checks DNS records. Every result distinguishes:
 *   - results reported by the receiving mail server (from Authentication-Results / Received-SPF)
 *   - results independently verified by CloudHost247 (via local DNS lookups)
 *   - results that could not be checked
 *
 * Never claims a DKIM signature is cryptographically verified merely because a DKIM-Signature
 * header exists. Never claims an email is safe because SPF/DKIM/DMARC pass.
 */

import type { AuthResult, AuthReportedResult } from './types';

/** SPF result vocabulary as reported by a receiving server. */
export const SPF_RESULTS = ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror'] as const;

/** Parse the reported SPF result from an Authentication-Results or Received-SPF header value. */
export function parseReportedSpf(authResults: string | null, receivedSpf: string | null): {
  reportedResult: AuthReportedResult | null;
  sendingDomain: string | null;
  explanation: string | null;
} {
  const source = authResults ?? receivedSpf ?? '';
  if (!source) {
    return { reportedResult: null, sendingDomain: null, explanation: 'No SPF information present in the headers' };
  }

  const lower = source.toLowerCase();

  // Look for "spf=result" in Authentication-Results.
  const spfMatch = lower.match(/\bspf=([a-z]+)(?:\s|$|;)/);
  const smtpMailFrom = lower.match(/\bsmtp\.mailfrom=([^\s;)]+)/i);
  const receivedSpfResult = lower.match(/\bspf=\s*([a-z]+)/i);

  const result = spfMatch ? spfMatch[1] ?? null : receivedSpfResult ? receivedSpfResult[1] ?? null : null;
  const reported = normalizeSpfResult(result);

  let explanation: string | null;
  if (!result) {
    explanation = 'SPF header present but no parseable result';
  } else if (reported === 'pass') {
    explanation = `SPF pass reported by the receiving server (smtp.mailfrom=${smtpMailFrom ? smtpMailFrom[1] : 'not recorded'})`;
  } else if (reported === 'fail') {
    explanation = 'SPF fail reported by the receiving server';
  } else if (reported === 'softfail') {
    explanation = 'SPF softfail reported by the receiving server';
  } else if (reported === 'neutral') {
    explanation = 'SPF neutral reported by the receiving server';
  } else if (reported === 'none') {
    explanation = 'SPF none reported — no SPF policy applies to the sending domain';
  } else if (reported === 'temperror') {
    explanation = 'SPF temperror — a transient DNS error occurred while checking SPF';
  } else if (reported === 'permerror') {
    explanation = 'SPF permerror — a permanent error occurred while checking SPF';
  } else {
    explanation = `SPF result "${result}" reported by the receiving server`;
  }

  return { reportedResult: reported, sendingDomain: smtpMailFrom ? smtpMailFrom[1] ?? null : null, explanation };
}

/** Normalize a raw SPF token into the reported vocabulary, or null. */
function normalizeSpfResult(raw: string | null): AuthReportedResult | null {
  if (!raw) return null;
  const r = raw.toLowerCase();
  if (SPF_RESULTS.includes(r as any)) return r as AuthReportedResult;
  return null;
}

/** Parse the reported DKIM result from Authentication-Results. */
export function parseReportedDkim(authResults: string | null, dkimSignature: string | null): {
  reportedResult: AuthReportedResult | null;
  signingDomain: string | null;
  selector: string | null;
  explanation: string | null;
} {
  const source = authResults ?? '';
  const hasSignature = typeof dkimSignature === 'string' && dkimSignature.trim().length > 0;

  if (!source) {
    // No Authentication-Results header: we only know whether a signature header exists.
    if (hasSignature) {
      return {
        reportedResult: 'present_not_verified',
        signingDomain: null,
        selector: null,
        explanation: 'DKIM-Signature header is present, but the receiving server reported no DKIM result — the signature has not been cryptographically verified by CloudHost247',
      };
    }
    return {
      reportedResult: 'missing',
      signingDomain: null,
      selector: null,
      explanation: 'No DKIM-Signature header and no DKIM authentication result present',
    };
  }

  const lower = source.toLowerCase();
  const dkimMatch = lower.match(/\bdkim=([a-z]+)(?:\s|$|;)/);
  const headerD = lower.match(/\bheader\.d=([^\s;)]+)/i);
  const headerS = lower.match(/\bheader\.s=([^\s;)]+)/i);

  const result = dkimMatch ? dkimMatch[1] ?? null : null;
  const reported = normalizeDkimResult(result);

  let explanation: string | null;
  if (!result) {
    explanation = 'DKIM header present but no parseable result';
  } else if (reported === 'pass') {
    explanation = 'DKIM pass reported by the receiving server — signature validated against the signing domain';
  } else if (reported === 'fail') {
    explanation = 'DKIM fail reported by the receiving server — signature validation failed';
  } else if (reported === 'neutral') {
    explanation = 'DKIM neutral reported by the receiving server';
  } else if (reported === 'none') {
    explanation = 'DKIM none — no DKIM signature applies';
  } else if (reported === 'temperror') {
    explanation = 'DKIM temperror — transient error during DKIM verification';
  } else if (reported === 'permerror') {
    explanation = 'DKIM permerror — permanent error during DKIM verification';
  } else {
    explanation = `DKIM result "${result}" reported by the receiving server`;
  }

  return {
    reportedResult: reported,
    signingDomain: headerD ? headerD[1] ?? null : null,
    selector: headerS ? headerS[1] ?? null : null,
    explanation,
  };
}

/** Normalize a raw DKIM token into the reported vocabulary, or null. */
function normalizeDkimResult(raw: string | null): AuthReportedResult | null {
  if (!raw) return null;
  const r = raw.toLowerCase();
  const allowed: AuthReportedResult[] = ['pass', 'fail', 'neutral', 'none', 'temperror', 'permerror', 'missing'];
  return allowed.includes(r as any) ? (r as AuthReportedResult) : null;
}

/** Parse the reported DMARC result from Authentication-Results. */
export function parseReportedDmarc(authResults: string | null): {
  reportedResult: AuthReportedResult | null;
  explanation: string | null;
} {
  const source = authResults ?? '';
  if (!source) {
    return { reportedResult: null, explanation: 'No DMARC information present in the headers' };
  }

  const lower = source.toLowerCase();
  const dmarcMatch = lower.match(/\bdmarc=([a-z]+)(?:\s|$|;)/);
  const result = dmarcMatch ? dmarcMatch[1] ?? null : null;
  const reported = normalizeDmarcResult(result);

  let explanation: string | null;
  if (!result) {
    explanation = 'DMARC header present but no parseable result';
  } else if (reported === 'pass') {
    explanation = 'DMARC pass reported by the receiving server';
  } else if (reported === 'fail') {
    explanation = 'DMARC fail reported by the receiving server';
  } else if (reported === 'none') {
    explanation = 'DMARC none — no DMARC policy applies';
  } else if (reported === 'temperror') {
    explanation = 'DMARC temperror — transient error during DMARC evaluation';
  } else if (reported === 'permerror') {
    explanation = 'DMARC permerror — permanent error during DMARC evaluation';
  } else {
    explanation = `DMARC result "${result}" reported by the receiving server`;
  }

  return { reportedResult: reported, explanation };
}

/** Normalize a raw DMARC token into the reported vocabulary, or null. */
function normalizeDmarcResult(raw: string | null): AuthReportedResult | null {
  if (!raw) return null;
  const r = raw.toLowerCase();
  const allowed: AuthReportedResult[] = ['pass', 'fail', 'none', 'temperror', 'permerror', 'missing'];
  return allowed.includes(r as any) ? (r as AuthReportedResult) : null;
}

/** Build the full auth result array from parsed email headers. All results are "reported" —
 *  independently_verified is false until the DNS diagnostics layer overrides it. */
export function buildAuthResults(parsed: {
  authenticationResults: string | null;
  receivedSpf: string | null;
  dkimSignature: string | null;
  from: string | null;
  replyTo: string | null;
  messageId: string | null;
}): AuthResult[] {
  const results: AuthResult[] = [];

  const spf = parseReportedSpf(parsed.authenticationResults, parsed.receivedSpf);
  results.push({
    authenticationType: 'spf',
    reportedResult: spf.reportedResult,
    independentlyVerified: false,
    explanation: spf.explanation,
  });

  const dkim = parseReportedDkim(parsed.authenticationResults, parsed.dkimSignature);
  results.push({
    authenticationType: 'dkim',
    reportedResult: dkim.reportedResult,
    independentlyVerified: false,
    explanation: dkim.explanation,
  });

  const dmarc = parseReportedDmarc(parsed.authenticationResults);
  results.push({
    authenticationType: 'dmarc',
    reportedResult: dmarc.reportedResult,
    independentlyVerified: false,
    explanation: dmarc.explanation,
  });

  // Return-Path vs From consistency.
  const returnPath = parsed.from; // From header used as the visible sender
  results.push({
    authenticationType: 'return_path',
    reportedResult: returnPath ? 'pass' : 'none',
    independentlyVerified: false,
    explanation: returnPath
      ? 'Return-Path/From field present in the headers'
      : 'No Return-Path or From field present to check consistency',
  });

  // From / Reply-To mismatch.
  const replyToMismatch = parsed.replyTo && parsed.from && parsed.replyTo !== parsed.from;
  results.push({
    authenticationType: 'reply_to',
    reportedResult: replyToMismatch ? 'fail' : parsed.replyTo ? 'pass' : 'none',
    independentlyVerified: false,
    explanation: replyToMismatch
      ? 'From and Reply-To addresses differ — review before trusting the visible sender'
      : parsed.replyTo
        ? 'From and Reply-To are consistent'
        : 'No Reply-To header present',
  });

  // Message-ID domain presence.
  results.push({
    authenticationType: 'message_id',
    reportedResult: parsed.messageId ? 'pass' : 'none',
    independentlyVerified: false,
    explanation: parsed.messageId
      ? 'Message-ID header present'
      : 'No Message-ID header present',
  });

  return results;
}
