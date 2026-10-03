/**
 * Tools Center — result explanations (spec §79).
 *
 * There is no LLM in the loop and no network call: the explanation is assembled from the fields the
 * tool actually produced (its summary/status, the recommendations and warnings it already carries,
 * the failing checks it recorded) and rendered as plain language. If a result does not carry enough
 * evidence, the explanation says exactly that instead of inventing a diagnosis.
 *
 * This is a deliberate design decision: an explanation that could contradict the measured data would
 * undermine every other tool in the centre.
 */
import { catalogEntry } from '../catalog';

export interface ToolExplanation {
  headline: string;
  whatThisMeans: string[];
  whatToCheckNext: string[];
  limitations: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  derivedFrom: string[];
  note: string;
}

interface Narrative {
  summary: string | null;
  status: string | null;
  counts: string | null;
  recommendations: string[];
  warnings: string[];
  notes: string[];
  problems: Array<{ severity: string; text: string }>;
  extraFacts: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringsOf(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (isRecord(entry)) {
        const candidate = entry.message ?? entry.detail ?? entry.text ?? entry.summary ?? entry.title ?? entry.explanation;
        if (typeof candidate === 'string') return candidate;
      }
      return null;
    })
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, limit);
}

function collect(data: unknown): Narrative {
  const narrative: Narrative = {
    summary: null,
    status: null,
    counts: null,
    recommendations: [],
    warnings: [],
    notes: [],
    problems: [],
    extraFacts: [],
  };
  if (!isRecord(data)) return narrative;

  const record = data as Record<string, unknown>;
  if (typeof record.summary === 'string') narrative.summary = record.summary;
  if (typeof record.statusDetail === 'string' && !narrative.summary) narrative.summary = record.statusDetail;
  if (typeof record.status === 'string') narrative.status = record.status;
  else if (isRecord(record.verdict) && typeof (record.verdict as Record<string, unknown>).status === 'string') {
    narrative.status = String((record.verdict as Record<string, unknown>).status);
  } else if (typeof record.verdict === 'string') narrative.status = record.verdict;

  if (isRecord(record.counts)) {
    narrative.counts = Object.entries(record.counts as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'number' && value > 0)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ');
  }

  narrative.recommendations = [...stringsOf(record.recommendations), ...stringsOf(record.nextSteps)];
  narrative.warnings = [...stringsOf(record.warnings), ...stringsOf(record.warning)];
  narrative.notes = stringsOf(record.notes, 8);

  for (const key of ['problems', 'issues', 'findings', 'checks', 'sections']) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const severity = typeof entry.severity === 'string' ? entry.severity : typeof entry.status === 'string' ? entry.status : 'info';
      const text = entry.message ?? entry.detail ?? entry.detailText ?? entry.title ?? entry.summary;
      if (typeof text === 'string' && text.trim().length > 0) narrative.problems.push({ severity, text: text.trim() });
    }
  }
  if (narrative.problems.length === 0) {
    for (const text of stringsOf(record.problems)) narrative.problems.push({ severity: 'info', text });
  }

  for (const key of ['expiry', 'assessment', 'capability', 'registry', 'hostingContext', 'verdict']) {
    const value = record[key];
    if (!isRecord(value)) continue;
    for (const [innerKey, innerValue] of Object.entries(value)) {
      if (typeof innerValue === 'string' && innerValue.trim().length > 0 && !narrative.extraFacts.includes(innerValue)) {
        narrative.extraFacts.push(`${key}.${innerKey}: ${innerValue}`);
      } else if (isRecord(innerValue) && typeof innerValue.detail === 'string') {
        narrative.extraFacts.push(`${key}.${innerKey}: ${innerValue.detail}`);
      }
    }
  }
  narrative.extraFacts = narrative.extraFacts.slice(0, 8);
  return narrative;
}

const STATUS_SENTENCES: Record<string, string> = {
  OK: 'The check ran and found nothing wrong.',
  PASS: 'Every part of this check passed.',
  VALID: 'The certificate is valid and was verified by the platform.',
  WARNING: 'The check completed and found something that needs attention but is not broken right now.',
  VALID_WITH_WARNINGS: 'The check completed with warnings — read them before concluding anything is broken.',
  VALID_WITH_NOTES: 'The check completed with notes worth reading.',
  ERROR: 'The check could not be completed against the target, or the target answered in a way that indicates a real problem.',
  FAIL: 'The check failed for a concrete reason recorded in the evidence.',
  BROKEN: 'The resource answered with an error, so the link or record is not working.',
  LISTED: 'The target appears on at least one blacklist that answered this query.',
  NOT_LISTED: 'No queried blacklist listed this address.',
  EXPIRED: 'This has expired — the service it protects will not work until it is renewed.',
  CHANGED: 'The monitored value changed since the last check.',
  UNKNOWN: 'The answer could not be established from the data available, so treat this as "not verified" rather than "fine".',
  NOT_CHECKED: 'This part of the check did not run, so nothing is claimed about it.',
  NOT_CONFIGURED: 'No provider is configured for this capability, so no result exists to interpret.',
  PROPAGATED: 'All resolvers that answered returned the expected value.',
  PARTIAL: 'Some resolvers return the expected value and others do not — that is what propagation in progress looks like.',
  NOT_PROPAGATED: 'The resolvers answered consistently, but not with the value you expected.',
  INCONCLUSIVE: 'Not enough resolvers answered to reach a conclusion. Try again or add more resolvers.',
  AUTHENTICATED: 'The signature verified successfully.',
  NOT_FOUND: 'No record was found where one was expected.',
  MISMATCH: 'The value present does not match the value expected.',
  MATCH: 'The observed value matches the expected value.',
};

export function explainToolResult(slug: string, data: unknown, options: { meta?: { warnings?: string[]; cached?: boolean; sources?: string[] } } = {}): ToolExplanation {
  const entry = catalogEntry(slug);
  const toolName = entry?.name ?? slug;
  const narrative = collect(data);
  const derivedFrom: string[] = [];
  if (narrative.summary) derivedFrom.push('summary');
  if (narrative.status) derivedFrom.push('status');
  if (narrative.counts) derivedFrom.push('counts');
  if (narrative.problems.length > 0) derivedFrom.push('problems/checks');
  if (narrative.recommendations.length > 0) derivedFrom.push('recommendations');
  if (narrative.warnings.length > 0) derivedFrom.push('warnings');
  if (narrative.notes.length > 0) derivedFrom.push('notes');

  const headline = narrative.summary
    ? `${toolName}: ${narrative.summary}`
    : narrative.status
      ? `${toolName}: status ${narrative.status}`
      : `${toolName} produced a result; no summary line was returned.`;

  const whatThisMeans: string[] = [];
  if (narrative.status && STATUS_SENTENCES[narrative.status.toUpperCase()]) whatThisMeans.push(STATUS_SENTENCES[narrative.status.toUpperCase()] as string);
  if (narrative.counts) whatThisMeans.push(`Counts in this result — ${narrative.counts}.`);
  const failing = narrative.problems.filter((problem) => /^(error|fail|critical|high)$/i.test(problem.severity));
  const warningProblems = narrative.problems.filter((problem) => /^(warn|warning|medium)$/i.test(problem.severity));
  if (failing.length > 0) whatThisMeans.push(`${failing.length} finding(s) are recorded as errors, for example: ${failing[0]?.text}`);
  if (warningProblems.length > 0 && failing.length === 0) whatThisMeans.push(`${warningProblems.length} finding(s) are warnings rather than failures, for example: ${warningProblems[0]?.text}`);
  if (narrative.extraFacts.length > 0) whatThisMeans.push(...narrative.extraFacts.slice(0, 3));
  if (whatThisMeans.length === 0) {
    whatThisMeans.push('This result does not carry a status or summary field, so the explanation is limited to what the raw data shows. Read the tables below rather than this paragraph.');
  }

  const whatToCheckNext: string[] = [];
  whatToCheckNext.push(...narrative.recommendations.slice(0, 5));
  if (whatToCheckNext.length === 0) {
    whatToCheckNext.push(...narrative.problems.slice(0, 4).map((problem) => problem.text));
  }
  if (whatToCheckNext.length === 0) whatToCheckNext.push('No follow-up action was recorded with this result. Re-run the tool if the underlying record has changed, or open the tool documentation for what each field means.');
  if (narrative.warnings.length > 0) whatToCheckNext.push(...narrative.warnings.slice(0, 3));

  const limitations: string[] = [];
  limitations.push(...narrative.notes.slice(0, 4));
  if (options.meta?.warnings && options.meta.warnings.length > 0) limitations.push(...options.meta.warnings);
  if (options.meta?.cached) limitations.push('This answer came from the CloudHost247 diagnostic cache, so it may not reflect a change made in the last few minutes. Re-run with refresh enabled for a live answer.');
  if (limitations.length === 0) limitations.push('Every tool in this centre reports only what a real query or connection observed; treat an absent field as "not measured" rather than "fine".');

  const confidence: ToolExplanation['confidence'] =
    narrative.status && !/UNKNOWN|NOT_CHECKED|NOT_CONFIGURED|NOT_FOUND/i.test(narrative.status) && derivedFrom.length >= 3
      ? 'HIGH'
      : narrative.status && derivedFrom.length >= 2
        ? 'MEDIUM'
        : 'LOW';

  return {
    headline,
    whatThisMeans: [...new Set(whatThisMeans)].slice(0, 6),
    whatToCheckNext: [...new Set(whatToCheckNext)].slice(0, 6),
    limitations: [...new Set(limitations)].slice(0, 6),
    confidence,
    derivedFrom,
    note: 'Generated from the fields this tool returned — no external AI service was contacted and no interpretation was invented.',
  };
}
