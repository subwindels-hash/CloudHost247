/**
 * The explainable risk scoring engine — pure, deterministic and reproducible.
 *
 *   score = clamp(0, 100, Σ over families of min(Σ rule weights in that family, family cap))
 *   level = thresholds applied to score (medium 25 / high 50 / critical 75 by default)
 *
 * Why family caps: several rules can describe the SAME underlying incident — a card-testing burst
 * trips PAY_FAILURE_BURST, PAY_REPEATED_FAILURES and possibly PAY_SUCCESS_AFTER_FAILURES at once.
 * Summing their weights naively would let one incident saturate the score and hide a genuinely
 * multi-vector case. Grouping correlated rules into families and capping each family's total is the
 * anti-double-counting mechanism, and it is visible in the output: every triggered rule reports the
 * `cappedWeight` actually credited to it and every family reports its raw total, its cap and what it
 * contributed.
 *
 * Within a family the cap is credited in descending weight order (ties broken by rule code, so the
 * result is total-order deterministic): the heaviest rule is credited in full, then the next, and the
 * rule that crosses the cap is credited only the remainder. That is explainable in one sentence to a
 * reviewer, which a proportional split would not be.
 *
 * Reproducibility: `ruleSetVersion` is a sha256 fingerprint of the enabled rule set with its versions
 * and weights plus the thresholds and caps in force. Two assessments carrying the same fingerprint
 * were scored by identical inputs, so a stored score can always be re-derived from stored evidence.
 *
 * No I/O, no clock, no randomness. The evaluation instant arrives as an argument.
 */
import { createHash } from 'node:crypto';
import type {
  AssessmentResult,
  ConfidenceLevel,
  DataQualityFlag,
  EvidenceRef,
  FraudCategory,
  RiskLevel,
  RuleSeverity,
  SubjectType,
  TriggeredRule,
} from '../types';
import { SCORING_VERSION } from '../types';
import { levelForScore, type FsFamilyCaps, type FsRiskThresholds } from '../utils/settings';
import { RULE_FAMILIES, type RuleFamily } from './catalogue';
import { DETECTORS, type RuleHit } from './detectors';
import { MS_PER_DAY, dedupeEvidence, type SignalBundle } from './signals';

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/** A rule as configured in the database at assessment time (never the code default). */
export interface EngineRuleConfig {
  code: string;
  name: string;
  version: number;
  enabled: boolean;
  weight: number;
  severity: RuleSeverity;
  family: RuleFamily;
  category: FraudCategory;
  parameters: Record<string, unknown>;
  recommendation: string;
  appliesTo: SubjectType[];
}

export interface PreviousAssessment {
  score: number | null;
  level: RiskLevel | null;
  assessmentId: string | null;
}

export interface EngineInput {
  bundle: SignalBundle;
  rules: readonly EngineRuleConfig[];
  thresholds: FsRiskThresholds;
  familyCaps: FsFamilyCaps;
  previous: PreviousAssessment;
  /** Evaluation instant in epoch ms. */
  nowMs: number;
  /** fraud_sentinel.lookback_days at assessment time. */
  lookbackDays: number;
}

/* -------------------------------------------------------------------------- */
/* Rule-set fingerprint                                                        */
/* -------------------------------------------------------------------------- */

/**
 * sha256 over the sorted `code@version:weight:enabled` triples plus thresholds, caps and the scoring
 * formula version — truncated to 16 hex chars for storage and display.
 */
export function computeRuleSetVersion(
  rules: readonly EngineRuleConfig[],
  thresholds: FsRiskThresholds,
  familyCaps: FsFamilyCaps,
  scoringVersion: number = SCORING_VERSION
): string {
  const rulePart = [...rules]
    .map((rule) => `${rule.code}@${rule.version}:${rule.weight}:${rule.enabled ? 1 : 0}`)
    .sort()
    .join('|');
  const thresholdPart = `t=${thresholds.medium}/${thresholds.high}/${thresholds.critical}`;
  const capPart = RULE_FAMILIES.map((family) => `${family}=${familyCaps[family]}`).join(',');
  const payload = `v${scoringVersion}|${rulePart}|${thresholdPart}|caps=${capPart}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

interface Evaluation {
  rule: EngineRuleConfig;
  hit: RuleHit;
}

const MAX_STORED_EVIDENCE = 40;
const SEVERITY_TO_LEVEL: Record<RuleSeverity, RiskLevel> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
};

/**
 * Runs every applicable rule and returns the raw (pre-cap) evaluations, in a deterministic order:
 * weight descending, then code ascending.
 */
export function evaluateRules(input: EngineInput): Evaluation[] {
  const lookbackMs = input.lookbackDays * MS_PER_DAY;
  const evaluations: Evaluation[] = [];

  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    if (!rule.appliesTo.includes(input.bundle.subjectType)) continue;
    const detector = DETECTORS[rule.code];
    // A rule with no evaluator is dead configuration, not a silent pass. It is reported as a
    // data-quality problem on the assessment rather than being ignored.
    if (!detector) continue;
    const hit = detector({
      bundle: input.bundle,
      parameters: rule.parameters ?? {},
      nowMs: input.nowMs,
      lookbackMs,
    });
    if (hit) evaluations.push({ rule, hit });
  }

  return evaluations.sort((a, b) => {
    if (b.rule.weight !== a.rule.weight) return b.rule.weight - a.rule.weight;
    return a.rule.code < b.rule.code ? -1 : a.rule.code > b.rule.code ? 1 : 0;
  });
}

/** Applies family caps and returns the triggered-rule records with their credited weights. */
export function applyFamilyCaps(
  evaluations: readonly Evaluation[],
  familyCaps: FsFamilyCaps
): { triggered: TriggeredRule[]; contributions: AssessmentResult['familyContributions'] } {
  const byFamily = new Map<string, Evaluation[]>();
  for (const evaluation of evaluations) {
    const bucket = byFamily.get(evaluation.rule.family);
    if (bucket) bucket.push(evaluation);
    else byFamily.set(evaluation.rule.family, [evaluation]);
  }

  const triggered: TriggeredRule[] = [];
  const contributions: AssessmentResult['familyContributions'] = [];

  // Iterate families in the declared order so the contribution list is stable regardless of which
  // rules happened to fire.
  for (const family of RULE_FAMILIES) {
    const familyEvaluations = byFamily.get(family);
    if (!familyEvaluations || familyEvaluations.length === 0) continue;
    const cap = familyCaps[family];
    const raw = familyEvaluations.reduce((sum, evaluation) => sum + evaluation.rule.weight, 0);
    let remaining = cap;
    let creditedTotal = 0;
    // `familyEvaluations` is already in the deterministic order established by evaluateRules().
    for (const evaluation of familyEvaluations) {
      const credited = Math.max(0, Math.min(evaluation.rule.weight, remaining));
      remaining -= credited;
      creditedTotal += credited;
      triggered.push({
        code: evaluation.rule.code,
        version: evaluation.rule.version,
        family: evaluation.rule.family,
        category: evaluation.rule.category,
        severity: evaluation.rule.severity,
        weight: evaluation.rule.weight,
        cappedWeight: credited,
        reasonCode: evaluation.hit.reasonCode,
        reason: evaluation.hit.reason,
        confidence: evaluation.hit.confidence,
        evidence: evaluation.hit.evidence,
      });
    }
    // `capped` is the sum actually credited (== cap - remaining), NOT raw - remaining: the family's
    // contribution to the score must equal the sum of its rules' cappedWeight, or the breakdown shown
    // to a reviewer would disagree with the score it explains.
    contributions.push({ family, raw, capped: creditedTotal, cap });
  }

  return { triggered, contributions };
}

/**
 * Overall confidence in the assessment.
 *
 * Derived, never asserted: it grows with the amount of distinct recorded evidence and shrinks when a
 * MATERIAL data-quality gap means the detector saw less than the whole picture. A high score on thin
 * data must not look as trustworthy as the same score on twelve corroborating rows.
 */
export function deriveConfidence(
  evidence: readonly EvidenceRef[],
  triggered: readonly TriggeredRule[],
  dataQuality: readonly DataQualityFlag[]
): ConfidenceLevel {
  const distinctEvidence = dedupeEvidence(evidence).length;
  let confidence: ConfidenceLevel;
  if (distinctEvidence >= 8 && triggered.length >= 3) confidence = 'high';
  else if (distinctEvidence >= 3 || triggered.length >= 2) confidence = 'medium';
  else confidence = 'low';

  const hasMaterialGap = dataQuality.some((flag) => flag.severity === 'material');
  if (hasMaterialGap) {
    confidence = confidence === 'high' ? 'medium' : 'low';
  }
  return confidence;
}

/** The single rule that best explains the assessment: heaviest credited weight, then code. */
export function primaryRule(triggered: readonly TriggeredRule[]): TriggeredRule | null {
  if (triggered.length === 0) return null;
  return [...triggered].sort((a, b) => {
    if (b.cappedWeight !== a.cappedWeight) return b.cappedWeight - a.cappedWeight;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  })[0] ?? null;
}

/**
 * The full assessment. This is the only function that turns evidence into a number, and it does so
 * with no side effects.
 */
export function assessSubject(input: EngineInput): AssessmentResult {
  const evaluations = evaluateRules(input);
  const { triggered, contributions } = applyFamilyCaps(evaluations, input.familyCaps);

  const rawScore = triggered.reduce((sum, rule) => sum + rule.cappedWeight, 0);
  const riskScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const riskLevel = levelForScore(riskScore, input.thresholds);

  const evidence = dedupeEvidence(triggered.flatMap((rule) => rule.evidence)).slice(0, MAX_STORED_EVIDENCE);

  // Data quality: the bundle's structural flags plus anything a rule reported, deduplicated by code.
  const dataQuality: DataQualityFlag[] = [];
  const seenFlags = new Set<string>();
  for (const flag of [...input.bundle.dataQuality, ...evaluations.flatMap((evaluation) => evaluation.hit.dataQuality ?? [])]) {
    const key = `${flag.code}|${flag.detail}`;
    if (seenFlags.has(key)) continue;
    seenFlags.add(key);
    dataQuality.push(flag);
  }
  // A rule configured in the database with no evaluator is a real defect an operator must see.
  const missingDetectors = input.rules
    .filter((rule) => rule.enabled && rule.appliesTo.includes(input.bundle.subjectType) && !DETECTORS[rule.code])
    .map((rule) => rule.code);
  if (missingDetectors.length > 0) {
    dataQuality.push({
      code: 'RULE_WITHOUT_EVALUATOR',
      severity: 'material',
      detail:
        `Enabled rule(s) ${missingDetectors.join(', ')} have no evaluator in this build, so they contributed nothing. ` +
        'This is a configuration/build defect, not a clean result — disable them or deploy the build that implements them.',
    });
  }
  if (triggered.length === 0 && input.bundle.events.length === 0) {
    dataQuality.push({
      code: 'NO_EVENTS_IN_WINDOW',
      severity: 'informational',
      detail:
        'No recorded activity for this subject inside the lookback window. A score of 0 here means "nothing recorded", ' +
        'not "verified safe" — the subject may simply be inactive or its history may predate the detection ledger.',
    });
  }

  const confidence = deriveConfidence(evidence, triggered, dataQuality);

  // Recommendations: the rule that contributed most speaks first, deduplicated, then the standing
  // advisory boundary so no consumer mistakes this output for an enforcement instruction.
  const recommendations: string[] = [];
  const seenRecommendations = new Set<string>();
  const ordered = [...triggered].sort((a, b) => {
    if (b.cappedWeight !== a.cappedWeight) return b.cappedWeight - a.cappedWeight;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
  for (const rule of ordered) {
    const source = evaluations.find((evaluation) => evaluation.rule.code === rule.code);
    const recommendation = source?.rule.recommendation?.trim();
    if (!recommendation || seenRecommendations.has(recommendation)) continue;
    seenRecommendations.add(recommendation);
    recommendations.push(`[${rule.code}] ${recommendation}`);
  }
  recommendations.push(
    '[BOUNDARY] Fraud Sentinel is advisory: it has taken no action on any payment, order, balance, entitlement or account status. ' +
      'Any enforcement goes through the existing authorized workflow with human approval and audit logging.'
  );

  return {
    subjectType: input.bundle.subjectType,
    subjectId: input.bundle.subjectId,
    customerId: input.bundle.customerId,
    riskScore,
    riskLevel,
    previousScore: input.previous.score,
    previousLevel: input.previous.level,
    triggeredRules: triggered,
    evidence,
    recommendations,
    confidence,
    dataQuality,
    ruleSetVersion: computeRuleSetVersion(input.rules, input.thresholds, input.familyCaps),
    scoringVersion: SCORING_VERSION,
    windowStartedAt: input.bundle.window.startedAt,
    windowEndedAt: input.bundle.window.endedAt,
    eventsExamined: input.bundle.events.length,
    familyContributions: contributions,
  };
}

/** The level a single rule's own severity would justify — used for critical-rule alert escalation. */
export function severityLevel(severity: RuleSeverity): RiskLevel {
  return SEVERITY_TO_LEVEL[severity];
}

/**
 * Deterministic alert title. Built only from recorded facts, so the same assessment always produces
 * the same title and two reviewers reading it see the same thing.
 */
export function buildAlertTitle(result: AssessmentResult, subjectLabel: string): string {
  const primary = primaryRule(result.triggeredRules);
  if (!primary) {
    return `${result.riskLevel.toUpperCase()} risk — ${subjectLabel}`;
  }
  const others = result.triggeredRules.length - 1;
  return `${primary.code}: ${result.riskLevel.toUpperCase()} risk (${result.riskScore}/100) on ${subjectLabel}` +
    (others > 0 ? ` +${others} other signal${others === 1 ? '' : 's'}` : '');
}

/**
 * Deterministic alert explanation: the reason strings of the rules that actually contributed, in
 * credited-weight order, plus the family-cap arithmetic so the score is auditable from the text alone.
 */
export function buildAlertExplanation(result: AssessmentResult): string {
  if (result.triggeredRules.length === 0) {
    return 'No detection rule triggered for this subject inside the lookback window.';
  }
  const ordered = [...result.triggeredRules].sort((a, b) => {
    if (b.cappedWeight !== a.cappedWeight) return b.cappedWeight - a.cappedWeight;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
  const lines = ordered.map((rule) => {
    const capped = rule.cappedWeight === rule.weight ? `+${rule.cappedWeight}` : `+${rule.cappedWeight} of ${rule.weight} (family cap)`;
    return `• ${rule.code} v${rule.version} (${rule.severity}, ${capped} pts): ${rule.reason}`;
  });
  const families = result.familyContributions
    .map((entry) => `${entry.family} ${entry.capped}/${entry.raw} (cap ${entry.cap})`)
    .join('; ');
  return [
    ...lines,
    '',
    `Family contributions — ${families}.`,
    `Total ${result.riskScore}/100 → ${result.riskLevel.toUpperCase()} (confidence ${result.confidence}).`,
    result.dataQuality.length > 0
      ? `Data-quality notes: ${result.dataQuality.map((flag) => flag.code).join(', ')}.`
      : 'No data-quality gaps were recorded for this assessment.',
    '',
    'This is an advisory assessment built from recorded evidence. No payment, order, balance, entitlement or account status was changed by it.',
  ].join('\n');
}
