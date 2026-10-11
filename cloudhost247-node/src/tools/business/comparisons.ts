/**
 * Business Tools — Comparisons (4).
 *
 *   1. Accounting Tool Comparison     accounting-tool-comparison
 *   2. Expense Tool Comparison        expense-tool-comparison
 *   3. HMO Comparison (Nigeria)       hmo-comparison-nigeria
 *   4. PFA Comparison (Nigeria)       pfa-comparison-nigeria
 *
 * A comparison is only useful if the reader can see what it was scored on and disagree with it, so
 * all four tools share one engine — `rankByWeightedScore` — that takes explicit per-criterion
 * scores and explicit weights, and returns a ranking together with the arithmetic behind it. No
 * score is hidden inside a sort function.
 *
 * What each dataset asserts, and what it does not:
 *
 *  • Accounting and expense: the capability facts are structural and checkable against each
 *    vendor's own published documentation — deployment model, whether an open API exists, whether
 *    the product computes Nigerian PAYE or PenCom pension natively (none of them do). Scores are
 *    derived from those facts by `scoreFromFact`, not assigned by opinion.
 *
 *  • HMO and PFA: the directory facts are the regulator identifiers (NHIA accreditation ID,
 *    PenCom PFA code) and the provider's own published market positioning. The *scores* are
 *    explicitly labelled CloudHost247 planning guidance, they are editable in the form, and the
 *    tool says in as many places as it can that they are not regulator ratings and not
 *    endorsements. Licensing and performance must be verified with NHIA and PenCom respectively.
 */

import {
  formatAmount,
  formatInteger,
  formatMoney,
  formatPercent,
  round,
  tidyDocument,
  titleCase,
  toCsv,
  toLines,
  toList,
  toNumber,
  toText,
} from './format';
import { computePension } from './calculators';
import { failure, fieldFailure } from './validate';
import type {
  BusinessToolInput,
  BusinessToolOutcome,
  JurisdictionNote,
  ResultDocument,
  ResultMetric,
  ResultTable,
} from './types';

/* ================================================================== */
/* Engine                                                              */
/* ================================================================== */

export interface ComparisonCriterion {
  key: string;
  label: string;
  /** What the criterion measures, so a reader can disagree with the score rather than inherit it. */
  description: string;
  /** Default weight; the form lets the visitor change every one of them. */
  weight: number;
}

export interface ComparisonOption {
  id: string;
  name: string;
  /** Regulator or catalogue identifier, where one exists. */
  reference?: string;
  referenceLabel?: string;
  website?: string;
  /** Published market positioning — the vendor's own framing, not a rating. */
  bestFor: string;
  /** Structural, checkable facts shown in the comparison matrix. */
  facts: Record<string, string>;
  /** 0–5 per criterion, or null where nothing has been assessed. */
  scores: Record<string, number | null>;
  note?: string;
}

export interface ComparisonDataset {
  slug: string;
  title: string;
  criteria: ComparisonCriterion[];
  options: ComparisonOption[];
  factColumns: string[];
  note: JurisdictionNote;
}

export interface RankedOption {
  option: ComparisonOption;
  /** Weighted score normalised to 0–100 across the criteria that were actually assessed. */
  score: number | null;
  assessedCriteria: number;
  unassessedCriteria: number;
  contributions: Array<{ criterion: string; score: number | null; weight: number; contribution: number | null }>;
  rank: number | null;
}

/**
 * Weighted-score ranking.
 *
 * Unassessed criteria are excluded from both the numerator and the denominator rather than being
 * read as zero. Scoring a provider 0 for something nobody checked is the most common way a
 * comparison sheet produces a confident, wrong winner, and it is invisible in the output unless
 * the tool reports how much of the picture was actually assessed.
 */
export function rankByWeightedScore(
  options: readonly ComparisonOption[],
  criteria: readonly ComparisonCriterion[],
  weights: Record<string, number>
): RankedOption[] {
  const ranked: RankedOption[] = options.map((option): RankedOption => {
    const contributions = criteria.map((criterion) => {
      const raw = option.scores[criterion.key];
      const override = weights[criterion.key];
      const weight = override === undefined ? criterion.weight : override;
      const score = raw === null || raw === undefined || !Number.isFinite(raw) ? null : Math.max(0, Math.min(5, raw));
      return {
        criterion: criterion.label,
        score,
        weight: round(weight, 2),
        contribution: score === null ? null : round(score * weight, 4),
      };
    });

    const assessed = contributions.filter((entry) => entry.score !== null);
    if (assessed.length === 0) {
      return { option, score: null, assessedCriteria: 0, unassessedCriteria: contributions.length, contributions, rank: null };
    }
    const weightedSum = assessed.reduce((total, entry) => total + (entry.contribution ?? 0), 0);
    const weightTotal = assessed.reduce((total, entry) => total + entry.weight, 0);
    // Normalised to 0–100: 5 out of 5 on every assessed criterion is 100.
    const score = weightTotal > 0 ? round((weightedSum / (weightTotal * 5)) * 100, 2) : null;
    return {
      option,
      score,
      assessedCriteria: assessed.length,
      unassessedCriteria: contributions.length - assessed.length,
      contributions,
      rank: null,
    };
  });

  const scored = ranked.filter((entry) => entry.score !== null);
  scored.sort((a, b) => {
    const delta = (b.score ?? 0) - (a.score ?? 0);
    if (delta !== 0) return delta;
    // Ties broken by name so the ordering is stable and does not depend on dataset order.
    return a.option.name.localeCompare(b.option.name);
  });
  scored.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  // Return the list in rank order so a caller reading `ranked[0]` gets the leader rather than
  // whichever option happened to be declared first in the dataset. Unscored options go last.
  return ranked.slice().sort((a, b) => {
    const rankDelta = (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
    if (rankDelta !== 0) return rankDelta;
    return a.option.name.localeCompare(b.option.name);
  });
}

/** Map a structural capability fact to a 0–5 score. */
export function scoreFromFact(fact: string): number {
  const normalized = fact.trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'native' || normalized === 'included' || normalized === 'full') return 5;
  if (normalized === 'partial' || normalized === 'limited' || normalized === 'via partner' || normalized === 'add-on') return 3;
  if (normalized === 'no' || normalized === 'not available' || normalized === 'none') return 0;
  if (normalized === 'planned') return 1;
  return 0;
}

/** Parse `Criterion, Weight` lines into a weight map, ignoring unknown criteria. */
export function parseWeights(
  raw: unknown,
  criteria: readonly ComparisonCriterion[]
): { weights: Record<string, number>; unknown: string[]; errors: string[] } {
  const weights: Record<string, number> = {};
  const unknown: string[] = [];
  const errors: string[] = [];
  const lines = toLines(raw);

  if (lines.length === 0) {
    for (const criterion of criteria) weights[criterion.key] = criterion.weight;
    return { weights, unknown, errors };
  }

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (text === undefined) continue;
    const parts = text.split(/[|,;]/).map((part) => part.trim());
    if (parts.length < 2) {
      errors.push(`Weight line ${index + 1} ("${text}") needs a criterion and a weight separated by a comma.`);
      continue;
    }
    const label = (parts[0] ?? '').toLowerCase();
    const weight = toNumber(parts[parts.length - 1]);
    const criterion = criteria.find((entry) => entry.key === label || entry.label.toLowerCase() === label);
    if (!criterion) {
      unknown.push(parts[0] ?? '');
      continue;
    }
    if (weight === null) {
      errors.push(`Weight line ${index + 1}: "${parts[parts.length - 1] ?? ''}" is not a number.`);
      continue;
    }
    if (weight < 0 || weight > 10) {
      errors.push(`Weight line ${index + 1}: "${criterion.label}" must be weighted between 0 and 10.`);
      continue;
    }
    weights[criterion.key] = weight;
  }

  // Any criterion the visitor did not mention keeps its default weight, so a partial list still works.
  for (const criterion of criteria) {
    if (weights[criterion.key] === undefined) weights[criterion.key] = criterion.weight;
  }
  return { weights, unknown, errors };
}

/** Parse `Option | score | score | …` lines, overriding the shipped default scores. */
export function parseScoreOverrides(
  raw: unknown,
  criteria: readonly ComparisonCriterion[],
  options: readonly ComparisonOption[]
): { overrides: Record<string, Record<string, number | null>>; errors: string[] } {
  const overrides: Record<string, Record<string, number | null>> = {};
  const errors: string[] = [];
  const lines = toLines(raw);

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (text === undefined) continue;
    const cells = text.split('|').map((cell) => cell.trim());
    const name = (cells[0] ?? '').toLowerCase();
    const option = options.find((entry) => entry.id === name || entry.name.toLowerCase() === name);
    if (!option) {
      errors.push(`Score line ${index + 1}: "${cells[0] ?? ''}" is not one of the compared options.`);
      continue;
    }
    const values: Record<string, number | null> = {};
    for (let column = 0; column < criteria.length; column += 1) {
      const criterion = criteria[column];
      if (!criterion) continue;
      const cell = cells[column + 1];
      if (cell === undefined || cell === '') {
        values[criterion.key] = null;
        continue;
      }
      if (cell.toLowerCase() === 'n/a' || cell.toLowerCase() === 'unknown') {
        values[criterion.key] = null;
        continue;
      }
      const score = toNumber(cell);
      if (score === null) {
        errors.push(`Score line ${index + 1}, "${criterion.label}": "${cell}" is not a number.`);
        continue;
      }
      if (score < 0 || score > 5) {
        errors.push(`Score line ${index + 1}, "${criterion.label}": ${score} is outside the 0–5 scale.`);
        continue;
      }
      values[criterion.key] = score;
    }
    overrides[option.id] = values;
  }
  return { overrides, errors };
}

/** Build the shared result: ranking table, per-criterion breakdown, matrix and CSV export. */
function comparisonResult(
  dataset: ComparisonDataset,
  ranked: readonly RankedOption[],
  weights: Record<string, number>,
  selected: readonly ComparisonOption[],
  extra: {
    metrics?: ResultMetric[];
    tables?: ResultTable[];
    explanation?: string[];
    warnings?: string[];
    documents?: ResultDocument[];
  } = {}
): BusinessToolOutcome {
  const scored = ranked.filter((entry) => entry.score !== null && entry.rank !== null);
  const leader = scored.length > 0 ? scored[0] : null;
  const unassessedTotal = selected.reduce((total, option) => {
    const entry = ranked.find((ranked) => ranked.option.id === option.id);
    return total + (entry ? entry.unassessedCriteria : 0);
  }, 0);

  const weightSum = dataset.criteria.reduce((total, criterion) => total + (weights[criterion.key] ?? criterion.weight), 0);

  const rankingTable: ResultTable = {
    title: 'Weighted ranking',
    columns: ['Rank', 'Option', 'Score (0–100)', 'Criteria assessed', 'Best for'],
    rows: ranked
      .slice()
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.option.name.localeCompare(b.option.name))
      .map((entry) => ({
        label: entry.option.name,
        cells: [
          entry.rank === null ? '—' : String(entry.rank),
          entry.score === null ? 'Not scored' : entry.score.toFixed(2),
          `${entry.assessedCriteria} of ${dataset.criteria.length}`,
          entry.option.bestFor,
        ],
        emphasis: entry.rank === 1 ? ('total' as const) : undefined,
        hint: entry.option.reference
          ? `${dataset.options[0]?.referenceLabel ?? 'Reference'} ${entry.option.reference}`
          : undefined,
      })),
    caption:
      'Score = Σ(criterion score × weight) ÷ (5 × Σ weight), over the criteria that were actually assessed. ' +
      'A criterion nobody scored is excluded from the average rather than counted as zero.',
  };

  const breakdownTable: ResultTable = {
    title: 'Score breakdown by criterion',
    columns: ['Criterion', 'Weight', ...selected.map((option) => option.name)],
    rows: dataset.criteria.map((criterion) => ({
      label: criterion.label,
      cells: [
        String(round(weights[criterion.key] ?? criterion.weight, 2)),
        ...selected.map((option) => {
          const value = option.scores[criterion.key];
          return value === null || value === undefined ? 'n/a' : value.toFixed(1);
        }),
      ],
      hint: criterion.description,
    })),
  };

  const matrixTable: ResultTable = {
    title: 'Capability and directory facts',
    columns: ['Option', ...dataset.factColumns],
    rows: selected.map((option) => ({
      label: option.name,
      cells: dataset.factColumns.map((column) => option.facts[column] ?? '—'),
      hint: option.note,
    })),
    caption: 'Structural facts, not ratings. Verify each against the vendor or regulator before you rely on it.',
  };

  const tables: ResultTable[] = [rankingTable, breakdownTable, matrixTable, ...(extra.tables ?? [])];

  const explanation = [
    `${selected.length} option${selected.length === 1 ? '' : 's'} compared across ${dataset.criteria.length} criteria; total weight ${round(weightSum, 2)}.`,
    leader
      ? `Highest weighted score: ${leader.option.name} at ${(leader.score ?? 0).toFixed(2)} of 100, on ${leader.assessedCriteria} assessed criteria.`
      : 'No option has been scored on any criterion yet, so there is no ranking to show.',
    ...dataset.criteria.map(
      (criterion) => `${criterion.label} — weight ${round(weights[criterion.key] ?? criterion.weight, 2)}: ${criterion.description}`
    ),
    ...(extra.explanation ?? []),
  ];

  const warnings = [
    ...(unassessedTotal > 0
      ? [`${unassessedTotal} option/criterion pair${unassessedTotal === 1 ? '' : 's'} were left unassessed and are excluded from the averages. A ranking built on a partial picture can invert if the missing scores go the other way.`]
      : []),
    ...(extra.warnings ?? []),
  ];

  const csv = toCsv(
    ['Rank', 'Option', 'Reference', 'Score (0-100)', 'Criteria assessed', ...dataset.criteria.map((criterion) => criterion.label), ...dataset.factColumns],
    ranked
      .slice()
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.option.name.localeCompare(b.option.name))
      .map((entry) => [
        entry.rank === null ? '' : String(entry.rank),
        entry.option.name,
        entry.option.reference ?? '',
        entry.score === null ? '' : entry.score.toFixed(2),
        `${entry.assessedCriteria}/${dataset.criteria.length}`,
        ...dataset.criteria.map((criterion) => {
          const value = entry.option.scores[criterion.key];
          return value === null || value === undefined ? '' : value.toFixed(1);
        }),
        ...dataset.factColumns.map((column) => entry.option.facts[column] ?? ''),
      ] as unknown[])
  );

  const metrics: ResultMetric[] = extra.metrics ?? [
    {
      label: 'Leading option',
      value: leader ? leader.option.name : 'Nothing scored yet',
      emphasis: 'primary',
      hint: leader ? `${(leader.score ?? 0).toFixed(2)} of 100 on ${leader.assessedCriteria} criteria` : undefined,
    },
    { label: 'Options compared', value: formatInteger(selected.length), emphasis: 'secondary' },
    { label: 'Criteria', value: formatInteger(dataset.criteria.length), emphasis: 'secondary' },
    {
      label: 'Unassessed cells',
      value: formatInteger(unassessedTotal),
      emphasis: unassessedTotal > 0 ? 'primary' : 'muted',
      hint: 'Excluded from the averages, not counted as zero',
    },
  ];

  return {
    ok: true,
    result: {
      metrics,
      tables,
      explanation,
      warnings,
      jurisdiction: dataset.note,
      document: extra.documents?.[0] ?? {
        format: 'csv',
        filename: `${dataset.slug}-comparison.csv`,
        label: 'Comparison matrix (CSV)',
        content: csv,
      },
      extraDocuments: extra.documents && extra.documents.length > 1 ? extra.documents.slice(1) : undefined,
    },
  };
}

/** Shared plumbing for all four comparison tools: select, weight, override, rank. */
function runComparison(dataset: ComparisonDataset, values: BusinessToolInput): BusinessToolOutcome {
  const selectedText = toText(values['options']).trim();
  let selected = dataset.options;
  if (selectedText !== '' && selectedText.toLowerCase() !== 'all') {
    const wanted = toList(selectedText).map((name) => name.toLowerCase());
    selected = dataset.options.filter(
      (option) => wanted.includes(option.id) || wanted.includes(option.name.toLowerCase())
    );
    if (selected.length === 0) {
      const available = dataset.options.map((option) => option.name).join(', ');
      return {
        ok: false,
        error: failure(
          `None of "${selectedText}" matched an option in this comparison. Use the exact names from the list — ${available} — or "all".`
        ),
      };
    }
  }

  const weightsParsed = parseWeights(values['weights'], dataset.criteria);
  const scoresParsed = parseScoreOverrides(values['scores'], dataset.criteria, selected);
  const errors = [...weightsParsed.errors, ...scoresParsed.errors];
  if (errors.length > 0) {
    return {
      ok: false,
      error: failure(errors[0] ?? 'Fix the comparison inputs.', errors.map((message) => ({ key: message.startsWith('Weight') ? 'weights' : 'scores', message }))),
    };
  }

  // Apply overrides on top of the shipped scores so the visitor can replace guidance with their own.
  const withOverrides = selected.map((option) => {
    const override = scoresParsed.overrides[option.id];
    if (!override) return option;
    return { ...option, scores: { ...option.scores, ...override } };
  });

  const ranked = rankByWeightedScore(withOverrides, dataset.criteria, weightsParsed.weights);

  const warnings: string[] = [];
  if (weightsParsed.unknown.length > 0) {
    warnings.push(`These criteria were named in the weights box but do not exist here, so they were ignored: ${weightsParsed.unknown.join(', ')}.`);
  }
  if (Object.keys(scoresParsed.overrides).length > 0) {
    warnings.push(`You overrode the default scores for ${Object.keys(scoresParsed.overrides).length} option${Object.keys(scoresParsed.overrides).length === 1 ? '' : 's'}. The ranking reflects your figures, not the published defaults.`);
  }
  const zeroWeights = dataset.criteria.filter((criterion) => (weightsParsed.weights[criterion.key] ?? criterion.weight) === 0);
  if (zeroWeights.length > 0) {
    warnings.push(`${zeroWeights.length} criterion/criteria are weighted at zero and so do not affect the ranking at all: ${zeroWeights.map((criterion) => criterion.label).join(', ')}.`);
  }

  return comparisonResult(dataset, ranked, weightsParsed.weights, withOverrides, { warnings });
}

/* ================================================================== */
/* 1. Accounting Tool Comparison                                       */
/* ================================================================== */

const ACCOUNTING_FACT_COLUMNS = [
  'Deployment',
  'Pricing model',
  'Open API',
  'Multi-currency',
  'Native Nigerian PAYE',
  'PenCom pension',
  'NHF / NHIS',
  'Employee disbursement',
  'Runs on infrastructure you control',
] as const;

function accountingOption(
  id: string,
  name: string,
  bestFor: string,
  facts: {
    deployment: string;
    pricing: string;
    api: string;
    multiCurrency: string;
    selfHost: string;
  },
  note: string
): ComparisonOption {
  const factRecord: Record<string, string> = {
    'Deployment': facts.deployment,
    'Pricing model': facts.pricing,
    'Open API': facts.api,
    'Multi-currency': facts.multiCurrency,
    // No general-purpose accounting system computes Nigerian statutory payroll natively; that is
    // the finding this comparison exists to make visible, so it is asserted rather than scored.
    'Native Nigerian PAYE': 'No',
    'PenCom pension': 'No',
    'NHF / NHIS': 'No',
    'Employee disbursement': 'No',
    'Runs on infrastructure you control': facts.selfHost,
  };
  return {
    id,
    name,
    bestFor,
    website: undefined,
    facts: factRecord,
    scores: {
      'general-ledger': scoreFromFact('native'),
      'invoicing': scoreFromFact('native'),
      'bank-reconciliation': scoreFromFact('native'),
      'multi-currency': scoreFromFact(facts.multiCurrency),
      'open-api': scoreFromFact(facts.api),
      'nigerian-paye': scoreFromFact('no'),
      'nigerian-pension': scoreFromFact('no'),
      'statutory-filings': scoreFromFact('no'),
      'employee-disbursement': scoreFromFact('no'),
      'self-hosting': scoreFromFact(facts.selfHost),
    },
    note,
  };
}

export const ACCOUNTING_COMPARISON: ComparisonDataset = {
  slug: 'accounting-tool-comparison',
  title: 'Accounting Tool Comparison',
  factColumns: ACCOUNTING_FACT_COLUMNS as unknown as string[],
  criteria: [
    { key: 'general-ledger', label: 'General ledger & chart of accounts', description: 'Double-entry ledger with a configurable chart of accounts.', weight: 5 },
    { key: 'invoicing', label: 'Invoicing & receivables', description: 'Raise invoices, track receivables and age debt.', weight: 4 },
    { key: 'bank-reconciliation', label: 'Bank feeds & reconciliation', description: 'Import bank transactions and reconcile them against the ledger.', weight: 4 },
    { key: 'multi-currency', label: 'Multi-currency, including NGN', description: 'Hold and report in more than one currency, with revaluation.', weight: 3 },
    { key: 'open-api', label: 'Open API / developer access', description: 'A documented API for posting journals and reading balances.', weight: 4 },
    { key: 'nigerian-paye', label: 'Native Nigerian PAYE computation', description: 'Computes Nigerian employment income tax from its own payroll module.', weight: 5 },
    { key: 'nigerian-pension', label: 'Native PenCom pension computation', description: 'Computes the 8% / 10% split and produces a PFA remittance schedule.', weight: 5 },
    { key: 'statutory-filings', label: 'NHF / NHIS computation & filing', description: 'Computes housing fund and health scheme contributions.', weight: 3 },
    { key: 'employee-disbursement', label: 'Employee payment disbursement', description: 'Pays employees directly, in Naira, from the product.', weight: 3 },
    { key: 'self-hosting', label: 'Runs on infrastructure you control', description: 'Can be deployed on your own server rather than only as a hosted service.', weight: 2 },
  ],
  options: [
    accountingOption('quickbooks-online', 'QuickBooks Online', 'Startups and SMEs already in the Intuit ecosystem', { deployment: 'Cloud (SaaS)', pricing: 'Per-company subscription', api: 'Yes', multiCurrency: 'Yes', selfHost: 'No' }, 'Broad third-party app marketplace; payroll add-ons are country-specific and do not include Nigerian statutory payroll.'),
    accountingOption('zoho-books', 'Zoho Books', 'SMEs using the wider Zoho suite', { deployment: 'Cloud (SaaS)', pricing: 'Per-organisation subscription', api: 'Yes', multiCurrency: 'Yes', selfHost: 'No' }, 'Strong value within the Zoho ecosystem; Zoho Payroll covers other jurisdictions, not Nigerian PAYE.'),
    accountingOption('sage', 'Sage Accounting / Sage 50', 'Established SMEs with an existing Sage installation', { deployment: 'Cloud and desktop', pricing: 'Subscription, or perpetual licence for Sage 50', api: 'Yes', multiCurrency: 'Yes', selfHost: 'Partial' }, 'Sage 50 installs on your own machine, which is the closest any option here gets to self-hosting.'),
    accountingOption('netsuite', 'Oracle NetSuite', 'Mid-market and group entities needing consolidation', { deployment: 'Cloud (SaaS)', pricing: 'Subscription plus per-module and per-user fees', api: 'Yes', multiCurrency: 'Yes', selfHost: 'No' }, 'Enterprise-grade consolidation and multi-entity reporting; the highest total cost of ownership in this set.'),
    accountingOption('odoo-accounting', 'Odoo Accounting', 'Organisations that want one modular platform they can host themselves', { deployment: 'Cloud or self-hosted', pricing: 'Subscription; Community edition is open source', api: 'Yes', multiCurrency: 'Yes', selfHost: 'Yes' }, 'The Community edition can be deployed on infrastructure you control, which matters where data residency is a requirement.'),
    accountingOption('xero', 'Xero', 'Small businesses and their accountants', { deployment: 'Cloud (SaaS)', pricing: 'Per-organisation subscription', api: 'Yes', multiCurrency: 'Yes', selfHost: 'No' }, 'Accountant-friendly with a large app marketplace; payroll products are jurisdiction-specific and exclude Nigeria.'),
  ],
  note: {
    jurisdiction: 'Nigeria (federal) payroll requirements; products are global',
    source:
      'Capability facts compiled from each vendor\u2019s own published product documentation and pricing pages. The finding that no general-purpose accounting system computes Nigerian PAYE, PenCom pension or NHF/NHIS natively reflects the published Nigerian payroll module availability of each product.',
    effectiveDate: '2026-10-10',
    estimate: true,
    disclaimer:
      'Product capabilities change and vendors publish different feature sets per region and per pricing tier. Every fact here was checked against published material on 2026-10-10 and should be re-verified with the vendor before purchase. This is not an endorsement of any product, and CloudHost247 has no commercial relationship with any vendor listed.',
  },
};

export function computeAccountingComparison(values: BusinessToolInput): BusinessToolOutcome {
  return runComparison(ACCOUNTING_COMPARISON, values);
}

/* ================================================================== */
/* 2. Expense Tool Comparison                                          */
/* ================================================================== */

const EXPENSE_FACT_COLUMNS = [
  'Receipt capture (OCR)',
  'Issues corporate cards',
  'Cards available in Nigeria',
  'Approval workflows',
  'Policy rules engine',
  'Multi-currency',
  'Accounting sync',
  'Mobile offline capture',
  'Naira (NGN) support',
] as const;

function expenseOption(
  id: string,
  name: string,
  bestFor: string,
  facts: Record<string, string>,
  note: string
): ComparisonOption {
  return {
    id,
    name,
    bestFor,
    facts,
    scores: {
      'receipt-ocr': scoreFromFact(facts['Receipt capture (OCR)'] ?? 'no'),
      'corporate-cards': scoreFromFact(facts['Issues corporate cards'] ?? 'no'),
      'card-availability-nigeria': scoreFromFact(facts['Cards available in Nigeria'] ?? 'no'),
      'approval-workflows': scoreFromFact(facts['Approval workflows'] ?? 'no'),
      'policy-engine': scoreFromFact(facts['Policy rules engine'] ?? 'no'),
      'multi-currency': scoreFromFact(facts['Multi-currency'] ?? 'no'),
      'accounting-sync': scoreFromFact(facts['Accounting sync'] ?? 'no'),
      'mobile-offline': scoreFromFact(facts['Mobile offline capture'] ?? 'no'),
      'naira-support': scoreFromFact(facts['Naira (NGN) support'] ?? 'no'),
    },
    note,
  };
}

export const EXPENSE_COMPARISON: ComparisonDataset = {
  slug: 'expense-tool-comparison',
  title: 'Expense Tool Comparison',
  factColumns: EXPENSE_FACT_COLUMNS as unknown as string[],
  criteria: [
    { key: 'receipt-ocr', label: 'Receipt capture with OCR', description: 'Photograph a receipt and have the amount, date and vendor extracted automatically.', weight: 5 },
    { key: 'corporate-cards', label: 'Issues corporate cards', description: 'Provides spend cards so expenses are captured at the point of payment rather than reimbursed later.', weight: 4 },
    { key: 'card-availability-nigeria', label: 'Cards available to a Nigerian entity', description: 'Whether the card programme can actually be issued to a company registered in Nigeria.', weight: 5 },
    { key: 'approval-workflows', label: 'Approval workflows', description: 'Configurable multi-level approval with delegation and thresholds.', weight: 4 },
    { key: 'policy-engine', label: 'Policy rules engine', description: 'Encodes spend limits and category rules so violations are flagged before approval.', weight: 4 },
    { key: 'multi-currency', label: 'Multi-currency handling', description: 'Captures the transaction currency and reports in the ledger currency with a rate.', weight: 4 },
    { key: 'accounting-sync', label: 'Accounting sync', description: 'Posts approved expense journals to your accounting system.', weight: 5 },
    { key: 'mobile-offline', label: 'Mobile offline capture', description: 'Captures receipts where connectivity is intermittent and syncs later.', weight: 3 },
    { key: 'naira-support', label: 'Naira (NGN) support', description: 'Handles NGN as a transaction and reporting currency.', weight: 5 },
  ],
  options: [
    expenseOption('zoho-expense', 'Zoho Expense', 'SMEs already running Zoho Books', {
      'Receipt capture (OCR)': 'Yes', 'Issues corporate cards': 'No', 'Cards available in Nigeria': 'No',
      'Approval workflows': 'Yes', 'Policy rules engine': 'Yes', 'Multi-currency': 'Yes',
      'Accounting sync': 'Native', 'Mobile offline capture': 'Yes', 'Naira (NGN) support': 'Yes',
    }, 'Reimbursement-led rather than card-led; pairs directly with Zoho Books.'),
    expenseOption('sap-concur', 'SAP Concur', 'Large enterprises with an SAP estate', {
      'Receipt capture (OCR)': 'Yes', 'Issues corporate cards': 'Via partner', 'Cards available in Nigeria': 'Partial',
      'Approval workflows': 'Yes', 'Policy rules engine': 'Yes', 'Multi-currency': 'Yes',
      'Accounting sync': 'Yes', 'Mobile offline capture': 'Yes', 'Naira (NGN) support': 'Yes',
    }, 'The most configurable policy engine in this set, and the most expensive to implement.'),
    expenseOption('expensify', 'Expensify', 'Distributed teams that want fast reimbursement', {
      'Receipt capture (OCR)': 'Yes', 'Issues corporate cards': 'Yes', 'Cards available in Nigeria': 'No',
      'Approval workflows': 'Yes', 'Policy rules engine': 'Yes', 'Multi-currency': 'Yes',
      'Accounting sync': 'Yes', 'Mobile offline capture': 'Yes', 'Naira (NGN) support': 'Partial',
    }, 'Strong OCR and reimbursement flow; the Expensify Card is issued in a limited set of markets.'),
    expenseOption('odoo-expenses', 'Odoo Expenses', 'Organisations standardising on Odoo', {
      'Receipt capture (OCR)': 'Yes', 'Issues corporate cards': 'No', 'Cards available in Nigeria': 'No',
      'Approval workflows': 'Yes', 'Policy rules engine': 'Partial', 'Multi-currency': 'Yes',
      'Accounting sync': 'Native', 'Mobile offline capture': 'Partial', 'Naira (NGN) support': 'Yes',
    }, 'Native to Odoo Accounting, so approved expenses post to the ledger without an integration; can be self-hosted.'),
    expenseOption('ramp', 'Ramp', 'US-entity card-first spend control', {
      'Receipt capture (OCR)': 'Yes', 'Issues corporate cards': 'Yes', 'Cards available in Nigeria': 'No',
      'Approval workflows': 'Yes', 'Policy rules engine': 'Yes', 'Multi-currency': 'Partial',
      'Accounting sync': 'Yes', 'Mobile offline capture': 'Yes', 'Naira (NGN) support': 'No',
    }, 'Card issuance and spend controls are the product; availability is tied to US entity and banking requirements.'),
    expenseOption('pleo', 'Pleo', 'European and UK card-first spend control', {
      'Receipt capture (OCR)': 'Yes', 'Issues corporate cards': 'Yes', 'Cards available in Nigeria': 'No',
      'Approval workflows': 'Yes', 'Policy rules engine': 'Yes', 'Multi-currency': 'Yes',
      'Accounting sync': 'Yes', 'Mobile offline capture': 'Yes', 'Naira (NGN) support': 'No',
    }, 'Cards issued to entities in Pleo\u2019s supported European and UK markets.'),
    expenseOption('spendesk', 'Spendesk', 'European mid-market combining cards and reimbursements', {
      'Receipt capture (OCR)': 'Yes', 'Issues corporate cards': 'Yes', 'Cards available in Nigeria': 'No',
      'Approval workflows': 'Yes', 'Policy rules engine': 'Yes', 'Multi-currency': 'Yes',
      'Accounting sync': 'Yes', 'Mobile offline capture': 'Yes', 'Naira (NGN) support': 'No',
    }, 'Combines virtual and physical cards with a reimbursement flow; supported markets are European.'),
    expenseOption('sage-expenses', 'Sage Business Cloud expenses', 'SMEs already on Sage', {
      'Receipt capture (OCR)': 'Partial', 'Issues corporate cards': 'No', 'Cards available in Nigeria': 'No',
      'Approval workflows': 'Yes', 'Policy rules engine': 'Partial', 'Multi-currency': 'Yes',
      'Accounting sync': 'Native', 'Mobile offline capture': 'Partial', 'Naira (NGN) support': 'Yes',
    }, 'Tightest fit where Sage is already the ledger; a lighter policy engine than the dedicated tools.'),
  ],
  note: {
    jurisdiction: 'Products are global; the Nigerian-entity criteria reflect availability to a company registered in Nigeria',
    source:
      'Capability facts compiled from each vendor\u2019s own published product and supported-market documentation. "Cards available in Nigeria" reflects whether the vendor publishes Nigeria as a supported card-issuing market.',
    effectiveDate: '2026-10-10',
    estimate: true,
    disclaimer:
      'Supported markets and feature availability change frequently and often depend on your contracting entity, pricing tier and banking partner. Every fact here was checked against published material on 2026-10-10 and must be re-verified with the vendor. This is not an endorsement, and CloudHost247 has no commercial relationship with any vendor listed.',
  },
};

export function computeExpenseComparison(values: BusinessToolInput): BusinessToolOutcome {
  return runComparison(EXPENSE_COMPARISON, values);
}

/* ================================================================== */
/* 3. HMO Comparison (Nigeria)                                         */
/* ================================================================== */

export const HMO_PLAN_TIERS: ReadonlyArray<{
  id: string;
  label: string;
  bestFor: string;
  minAnnualPerEmployee: number;
  maxAnnualPerEmployee: number;
  includes: string[];
}> = [
  {
    id: 'basic', label: 'Basic', bestFor: 'SMEs and startups',
    minAnnualPerEmployee: 30_000, maxAnnualPerEmployee: 80_000,
    includes: ['GP consultations', 'Basic diagnostic tests', 'Essential drugs', 'General ward admission', 'A limited provider network'],
  },
  {
    id: 'standard', label: 'Standard', bestFor: 'Growing businesses',
    minAnnualPerEmployee: 80_000, maxAnnualPerEmployee: 180_000,
    includes: ['Outpatient and inpatient care', 'Surgery', 'Specialist consultations', 'A wider hospital network'],
  },
  {
    id: 'comprehensive', label: 'Comprehensive', bestFor: 'Mid-sized companies',
    minAnnualPerEmployee: 180_000, maxAnnualPerEmployee: 400_000,
    includes: ['Higher admission limits', 'Maternity', 'Dental', 'Optical', 'Broader provider access'],
  },
  {
    id: 'executive', label: 'Executive / Premium', bestFor: 'Executives and enterprises',
    minAnnualPerEmployee: 400_000, maxAnnualPerEmployee: 1_000_000,
    includes: ['Premium hospitals', 'Private rooms', 'Wellness programmes', 'Enhanced care limits'],
  },
];

/** Typical benefit inclusion by tier. Indicative — actual contracts differ. */
export const HMO_BENEFIT_MATRIX: ReadonlyArray<{ feature: string; basic: string; standard: string; comprehensive: string; executive: string }> = [
  { feature: 'GP consultations', basic: 'Included', standard: 'Included', comprehensive: 'Included', executive: 'Included' },
  { feature: 'Specialist care', basic: 'Limited', standard: 'Included', comprehensive: 'Included', executive: 'Included' },
  { feature: 'Hospital network', basic: 'Basic', standard: 'Wider', comprehensive: 'Extensive', executive: 'Premium' },
  { feature: 'Surgery cover', basic: 'Basic', standard: 'Included', comprehensive: 'Higher limits', executive: 'Highest limits' },
  { feature: 'Maternity', basic: 'Not typical', standard: 'Limited', comprehensive: 'Included', executive: 'Included' },
  { feature: 'Dental', basic: 'Not typical', standard: 'Basic', comprehensive: 'Included', executive: 'Premium' },
  { feature: 'Optical', basic: 'Not typical', standard: 'Basic', comprehensive: 'Included', executive: 'Premium' },
  { feature: 'Annual health check', basic: 'Not typical', standard: 'Optional', comprehensive: 'Included', executive: 'Included' },
  { feature: 'Private room', basic: 'Not typical', standard: 'Limited', comprehensive: 'Available', executive: 'Included' },
  { feature: 'International emergency support', basic: 'Not typical', standard: 'Not typical', comprehensive: 'Optional', executive: 'Included' },
];

const HMO_FACT_COLUMNS = [
  'NHIA accreditation ID',
  'Corporate plans',
  'Family cover',
  'Digital self-service',
  'Telemedicine',
  'Typical segment',
] as const;

function hmoOption(
  id: string,
  name: string,
  nhiaId: string,
  bestFor: string,
  segment: string,
  scores: Record<string, number>
): ComparisonOption {
  return {
    id,
    name,
    reference: nhiaId,
    referenceLabel: 'NHIA ID',
    bestFor,
    facts: {
      'NHIA accreditation ID': nhiaId,
      'Corporate plans': 'Yes',
      'Family cover': 'Yes',
      'Digital self-service': 'Yes',
      'Telemedicine': 'Yes',
      'Typical segment': segment,
    },
    scores,
    note: 'Accreditation can change. Verify the current status on the NHIA HMO register before contracting.',
  };
}

export const HMO_COMPARISON: ComparisonDataset = {
  slug: 'hmo-comparison-nigeria',
  title: 'HMO Comparison (Nigeria)',
  factColumns: HMO_FACT_COLUMNS as unknown as string[],
  criteria: [
    { key: 'corporate-plans', label: 'Corporate plan range', description: 'Breadth of employer group plans, from a small team to a large organisation.', weight: 4 },
    { key: 'provider-network', label: 'Provider network breadth', description: 'How many hospitals and clinics are on the panel, and whether your employees\u2019 preferred ones are.', weight: 5 },
    { key: 'digital-self-service', label: 'Digital self-service', description: 'Member portal or app for enrolment, pre-authorisation and claims status.', weight: 4 },
    { key: 'telemedicine', label: 'Telemedicine', description: 'Remote consultation included rather than charged separately.', weight: 3 },
    { key: 'claims-turnaround', label: 'Claims and authorisation speed', description: 'How quickly treatment authorisations and provider settlements are handled.', weight: 5 },
    { key: 'employer-account-management', label: 'Dedicated employer account management', description: 'A named corporate account manager and structured reporting for the employer.', weight: 4 },
  ],
  options: [
    hmoOption('axa-mansard-health', 'AXA Mansard Health Limited', '59', 'SMEs and enterprises', 'National, multi-segment', { 'corporate-plans': 5, 'provider-network': 5, 'digital-self-service': 5, 'telemedicine': 4, 'claims-turnaround': 4, 'employer-account-management': 5 }),
    hmoOption('avon-healthcare', 'Avon Healthcare Limited', '63', 'SMEs and startups', 'Digital-first', { 'corporate-plans': 4, 'provider-network': 3, 'digital-self-service': 5, 'telemedicine': 5, 'claims-turnaround': 4, 'employer-account-management': 3 }),
    hmoOption('hygeia', 'Hygeia HMO Limited', '1', 'Large organisations', 'National, established', { 'corporate-plans': 5, 'provider-network': 5, 'digital-self-service': 4, 'telemedicine': 3, 'claims-turnaround': 4, 'employer-account-management': 5 }),
    hmoOption('reliance-hmo', 'Reliance HMO Limited', '92', 'Technology companies and SMEs', 'Mobile-first', { 'corporate-plans': 4, 'provider-network': 3, 'digital-self-service': 5, 'telemedicine': 5, 'claims-turnaround': 4, 'employer-account-management': 3 }),
    hmoOption('aiico-multishield', 'AIICO Multishield Nigeria Limited', '6', 'Corporate organisations', 'Corporate', { 'corporate-plans': 5, 'provider-network': 4, 'digital-self-service': 3, 'telemedicine': 3, 'claims-turnaround': 4, 'employer-account-management': 4 }),
    hmoOption('clearline', 'Clearline International Limited', '3', 'Businesses and families', 'National', { 'corporate-plans': 4, 'provider-network': 5, 'digital-self-service': 3, 'telemedicine': 3, 'claims-turnaround': 3, 'employer-account-management': 4 }),
    hmoOption('ihms', 'International Health Management Services', '11', 'Large employers', 'Corporate, nationwide', { 'corporate-plans': 5, 'provider-network': 5, 'digital-self-service': 3, 'telemedicine': 3, 'claims-turnaround': 4, 'employer-account-management': 5 }),
    hmoOption('mediplan', 'Mediplan Healthcare Limited', '5', 'Small and medium-sized businesses', 'SME', { 'corporate-plans': 4, 'provider-network': 4, 'digital-self-service': 3, 'telemedicine': 3, 'claims-turnaround': 3, 'employer-account-management': 3 }),
    hmoOption('am-healthcare-trust', 'A&M Healthcare Trust Limited', '102', 'Review available individual and corporate plans', 'General', { 'corporate-plans': 3, 'provider-network': 3, 'digital-self-service': 3, 'telemedicine': 3, 'claims-turnaround': 3, 'employer-account-management': 3 }),
    hmoOption('alleanza', 'Alleanza Health Management Limited', '111', 'Review available individual and corporate plans', 'General', { 'corporate-plans': 3, 'provider-network': 3, 'digital-self-service': 3, 'telemedicine': 3, 'claims-turnaround': 3, 'employer-account-management': 3 }),
  ],
  note: {
    jurisdiction: 'Nigeria (federal)',
    source:
      'Directory of providers and accreditation identifiers taken from the National Health Insurance Authority (NHIA) HMO register at nhia.gov.ng/hmo. Plan-tier price ranges are published planning estimates for the Nigerian group-health market.',
    effectiveDate: '2026-10-10',
    estimate: true,
    disclaimer:
      'Accreditation can be granted, suspended or withdrawn at any time — confirm a provider\u2019s current status on the NHIA register before contracting. The criterion scores are CloudHost247 planning guidance derived from each provider\u2019s published market positioning; they are not NHIA ratings, not quality measurements and not endorsements. Price ranges are planning estimates, not quotations: actual premiums depend on workforce demographics, group size, hospital selection and negotiated benefits. Obtain at least three written quotes.',
  },
};

export function computeHmoComparison(values: BusinessToolInput): BusinessToolOutcome {
  const employees = toNumber(values['employees']) ?? 25;
  const tierId = toText(values['planTier']) || 'standard';
  const tier = HMO_PLAN_TIERS.find((entry) => entry.id === tierId);

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (employees < 1 || !Number.isInteger(employees)) {
    fieldErrors.push({ key: 'employees', message: 'Employee count must be a whole number of 1 or more.' });
  }
  if (employees > 100_000) {
    fieldErrors.push({ key: 'employees', message: 'Employee count must be 100,000 or fewer.' });
  }
  if (!tier) {
    fieldErrors.push({ key: 'planTier', message: `Unknown plan tier "${tierId}". Use basic, standard, comprehensive or executive.` });
  }
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the budget estimator inputs before comparing.') };
  }

  const chosenTier = tier as (typeof HMO_PLAN_TIERS)[number];
  const headcount = employees as number;
  const minBudget = chosenTier.minAnnualPerEmployee * headcount;
  const maxBudget = chosenTier.maxAnnualPerEmployee * headcount;
  const monthlyEquivalentMin = round(minBudget / 12, 2);
  const monthlyEquivalentMax = round(maxBudget / 12, 2);

  const band = headcount <= 20 ? '1–20 employees' : headcount <= 100 ? '20–100 employees' : '100+ employees';

  const base = runComparison(HMO_COMPARISON, values);
  if (!base.ok) return base;

  const metrics: ResultMetric[] = [
    {
      label: 'Indicative annual budget',
      value: `${formatMoney(minBudget, 'NGN', 0)} – ${formatMoney(maxBudget, 'NGN', 0)}`,
      emphasis: 'primary',
      hint: `${formatInteger(headcount)} employee${headcount === 1 ? '' : 's'} on the ${chosenTier.label} tier`,
    },
    {
      label: 'Per employee per year',
      value: `${formatMoney(chosenTier.minAnnualPerEmployee, 'NGN', 0)} – ${formatMoney(chosenTier.maxAnnualPerEmployee, 'NGN', 0)}`,
      emphasis: 'secondary',
      hint: `Planning range for ${chosenTier.label}; best for ${chosenTier.bestFor.toLowerCase()}`,
    },
    {
      label: 'Monthly equivalent',
      value: `${formatMoney(monthlyEquivalentMin, 'NGN', 0)} – ${formatMoney(monthlyEquivalentMax, 'NGN', 0)}`,
      emphasis: 'secondary',
      hint: 'Annual budget ÷ 12',
    },
    { label: 'Workforce band', value: band, emphasis: 'muted', hint: `${formatInteger(HMO_COMPARISON.options.length)} accredited providers listed here` },
  ];

  const tables: ResultTable[] = [
    {
      title: 'Indicative plan tiers (annual, per employee)',
      columns: ['Tier', 'Range (₦)', 'Best for', 'Typically includes'],
      rows: HMO_PLAN_TIERS.map((entry) => ({
        label: entry.label,
        cells: [
          `${formatAmount(entry.minAnnualPerEmployee, 0)} – ${formatAmount(entry.maxAnnualPerEmployee, 0)}`,
          entry.bestFor,
          entry.includes.join('; '),
        ],
        emphasis: entry.id === chosenTier.id ? ('total' as const) : undefined,
      })),
      caption: 'Planning estimates for the Nigerian group-health market, not quotations. Demographics, group size and hospital selection move the actual premium.',
    },
    {
      title: 'What typically changes between tiers',
      columns: ['Benefit', 'Basic', 'Standard', 'Comprehensive', 'Executive'],
      rows: HMO_BENEFIT_MATRIX.map((row) => ({
        label: row.feature,
        cells: [row.basic, row.standard, row.comprehensive, row.executive],
      })),
      caption: 'Actual inclusions, waiting periods and limits differ by HMO and by contract. This shows the usual shape of the market, not what any provider has promised you.',
    },
    {
      title: 'Questions to ask each HMO before signing',
      columns: ['#', 'Question'],
      rows: [
        'Is my employees\u2019 preferred hospital on this plan\u2019s network?',
        'Are specialist consultations and diagnostics covered, and at what limits?',
        'Is maternity included, and what waiting period and limits apply?',
        'What are the annual and per-procedure benefit limits?',
        'How are pre-existing and chronic conditions handled?',
        'How quickly are treatment authorisations issued?',
        'Are telemedicine and emergency support included or charged separately?',
        'Can employees select different primary hospitals?',
        'Is there a dedicated corporate account manager?',
        'How are complaints and escalations resolved, and what are the measured timescales?',
      ].map((question, index) => ({ label: String(index + 1), cells: [question] })),
    },
  ];

  return {
    ...base,
    result: {
      ...base.result,
      metrics,
      tables: [...tables, ...(base.result.tables ?? [])],
      explanation: [
        `Budget estimate: ${formatInteger(headcount)} employee${headcount === 1 ? '' : 's'} × ${formatMoney(chosenTier.minAnnualPerEmployee, 'NGN', 0)}–${formatMoney(chosenTier.maxAnnualPerEmployee, 'NGN', 0)} = ${formatMoney(minBudget, 'NGN', 0)}–${formatMoney(maxBudget, 'NGN', 0)} per year.`,
        'Under Nigeria\u2019s contributory model an employer normally funds a group health plan for staff; the NHIS employee contribution modelled in the PAYE calculator is separate from a private HMO premium and both may apply.',
        ...(base.result.explanation ?? []),
      ],
      warnings: [
        'Budget ranges are planning estimates. They are not quotations and must not be used as a budget commitment without written quotes from at least three providers.',
        ...(base.result.warnings ?? []),
      ],
    },
  };
}

/* ================================================================== */
/* 4. PFA Comparison (Nigeria)                                         */
/* ================================================================== */

const PFA_FACT_COLUMNS = ['PenCom PFA code', 'Licensed by', 'Employer schedules', 'Digital portal', 'Typical segment'] as const;

function pfaOption(
  id: string,
  name: string,
  code: string,
  bestFor: string,
  segment: string,
  scores: Record<string, number>
): ComparisonOption {
  return {
    id,
    name,
    reference: code,
    referenceLabel: 'PFA code',
    bestFor,
    facts: {
      'PenCom PFA code': code,
      'Licensed by': 'PenCom',
      'Employer schedules': 'Yes',
      'Digital portal': 'Yes',
      'Typical segment': segment,
    },
    scores,
    note: 'Licensing status and fund performance must be verified with PenCom. Codes are from the published PenCom register.',
  };
}

export const PFA_COMPARISON: ComparisonDataset = {
  slug: 'pfa-comparison-nigeria',
  title: 'PFA Comparison (Nigeria)',
  factColumns: PFA_FACT_COLUMNS as unknown as string[],
  criteria: [
    { key: 'rsa-registration', label: 'RSA registration and onboarding', description: 'How straightforward it is for employees to open or regularise a Retirement Savings Account.', weight: 5 },
    { key: 'digital-portal', label: 'Mobile app and portal', description: 'Balance, statements, profile updates and service requests available online.', weight: 4 },
    { key: 'employer-support', label: 'Employer schedule support', description: 'Help with contribution schedules, reconciliation and multi-PFA routing for a group.', weight: 5 },
    { key: 'customer-service', label: 'Customer service responsiveness', description: 'How quickly contribution and benefit queries are resolved.', weight: 4 },
    { key: 'fund-performance', label: 'Fund performance consistency', description: 'Consistent long-term results across the relevant RSA fund categories. Verify current figures with PenCom.', weight: 5 },
    { key: 'branch-network', label: 'Branch network', description: 'Physical service locations, which still matter for documentation and complex requests.', weight: 3 },
    { key: 'rsa-transfer', label: 'RSA transfer process', description: 'How easily an RSA holder can move to another PFA through the RSA Transfer System.', weight: 3 },
    { key: 'self-service', label: 'Self-service features', description: 'Online management of biodata, beneficiaries and contact details.', weight: 3 },
  ],
  options: [
    pfaOption('access-arm', 'Access ARM Pensions', '024', 'Large employers and individuals', 'National, multi-segment', { 'rsa-registration': 5, 'digital-portal': 5, 'employer-support': 5, 'customer-service': 5, 'fund-performance': 4, 'branch-network': 5, 'rsa-transfer': 4, 'self-service': 5 }),
    pfaOption('stanbic-ibtc', 'Stanbic IBTC Pension Managers', '021', 'Corporate organisations', 'Corporate', { 'rsa-registration': 5, 'digital-portal': 5, 'employer-support': 5, 'customer-service': 4, 'fund-performance': 4, 'branch-network': 5, 'rsa-transfer': 4, 'self-service': 4 }),
    pfaOption('premium-pension', 'Premium Pension', '022', 'Federal government and private sector', 'Public and private', { 'rsa-registration': 4, 'digital-portal': 4, 'employer-support': 5, 'customer-service': 4, 'fund-performance': 4, 'branch-network': 4, 'rsa-transfer': 4, 'self-service': 4 }),
    pfaOption('fcmb-pensions', 'FCMB Pensions', '030', 'SMEs and retail customers', 'SME and retail', { 'rsa-registration': 4, 'digital-portal': 4, 'employer-support': 4, 'customer-service': 4, 'fund-performance': 3, 'branch-network': 4, 'rsa-transfer': 4, 'self-service': 4 }),
    pfaOption('leadway-pfa', 'Leadway PFA', '023', 'SMEs and corporate teams', 'SME and corporate', { 'rsa-registration': 4, 'digital-portal': 4, 'employer-support': 4, 'customer-service': 4, 'fund-performance': 3, 'branch-network': 3, 'rsa-transfer': 4, 'self-service': 4 }),
    pfaOption('gt-pension-managers', 'Guaranty Trust Pension Managers', '040', 'GTBank customers and digital users', 'Digital', { 'rsa-registration': 4, 'digital-portal': 5, 'employer-support': 4, 'customer-service': 4, 'fund-performance': 3, 'branch-network': 4, 'rsa-transfer': 4, 'self-service': 4 }),
    pfaOption('fidelity-pension', 'Fidelity Pension Managers', '043', 'Individuals and SMEs', 'Retail and SME', { 'rsa-registration': 4, 'digital-portal': 4, 'employer-support': 3, 'customer-service': 4, 'fund-performance': 3, 'branch-network': 3, 'rsa-transfer': 4, 'self-service': 4 }),
    pfaOption('trustfund', 'Trustfund Pensions', '028', 'Public and private sector employees', 'Public and private', { 'rsa-registration': 4, 'digital-portal': 3, 'employer-support': 4, 'customer-service': 4, 'fund-performance': 3, 'branch-network': 3, 'rsa-transfer': 4, 'self-service': 3 }),
    pfaOption('crusader-sterling', 'Crusader Sterling Pensions', '032', 'Small and medium-sized businesses', 'SME', { 'rsa-registration': 4, 'digital-portal': 3, 'employer-support': 4, 'customer-service': 4, 'fund-performance': 3, 'branch-network': 3, 'rsa-transfer': 4, 'self-service': 3 }),
    pfaOption('cardinalstone', 'CardinalStone Pensions', '046', 'Investment-focused clients', 'Investment-led', { 'rsa-registration': 4, 'digital-portal': 4, 'employer-support': 3, 'customer-service': 4, 'fund-performance': 4, 'branch-network': 2, 'rsa-transfer': 4, 'self-service': 4 }),
    pfaOption('norrenberger', 'Norrenberger Pensions', '036', 'Modern digital users', 'Digital', { 'rsa-registration': 4, 'digital-portal': 4, 'employer-support': 3, 'customer-service': 4, 'fund-performance': 3, 'branch-network': 2, 'rsa-transfer': 4, 'self-service': 4 }),
    pfaOption('citizens-pensions', 'Citizens Pensions', '050', 'Retail customers', 'Retail', { 'rsa-registration': 4, 'digital-portal': 4, 'employer-support': 3, 'customer-service': 3, 'fund-performance': 3, 'branch-network': 3, 'rsa-transfer': 4, 'self-service': 4 }),
    pfaOption('nlpc-pfa', 'NLPC Pension Fund Administrators', '031', 'Small and medium-sized businesses', 'SME', { 'rsa-registration': 3, 'digital-portal': 3, 'employer-support': 4, 'customer-service': 4, 'fund-performance': 3, 'branch-network': 3, 'rsa-transfer': 3, 'self-service': 3 }),
    pfaOption('nupemco', 'NUPEMCO', '049', 'Nigerian university employees', 'Specialised (universities)', { 'rsa-registration': 4, 'digital-portal': 3, 'employer-support': 4, 'customer-service': 4, 'fund-performance': 3, 'branch-network': 2, 'rsa-transfer': 3, 'self-service': 3 }),
    pfaOption('parthian', 'Parthian Pensions', '051', 'Customers considering a newer market entrant', 'Newer entrant', { 'rsa-registration': 4, 'digital-portal': 4, 'employer-support': 3, 'customer-service': 3, 'fund-performance': 3, 'branch-network': 2, 'rsa-transfer': 4, 'self-service': 4 }),
  ],
  note: {
    jurisdiction: 'Nigeria (federal)',
    source:
      'Provider names and PFA codes taken from the National Pension Commission (PenCom) register of licensed Pension Fund Administrators. Contribution rules from the Pension Reform Act 2014.',
    effectiveDate: '2026-10-10',
    estimate: true,
    disclaimer:
      'The register changes as licences are granted, merged or withdrawn — ARM Pensions and Access Pensions now operate as Access ARM Pensions Limited, shown here as one administrator. Verify current licensing and published fund performance with PenCom. The criterion scores are CloudHost247 planning guidance derived from each administrator\u2019s published market positioning; they are not PenCom ratings, not performance measurements and not endorsements. Under the Contributory Pension Scheme the employee chooses the PFA, not the employer.',
  },
};

export interface RemittanceRow {
  employeeName: string;
  rsaPin: string;
  pfaName: string;
  pfaCode: string;
  pensionableEarnings: number;
  employeeContribution: number;
  employerContribution: number;
  totalRemittance: number;
}

/**
 * Build a multi-PFA remittance schedule from `Name | RSA PIN | PFA | Basic | Housing | Transport` lines.
 *
 * This is the payroll artefact the comparison actually feeds: an employer whose staff chose
 * different administrators still has to produce one accurate schedule per PFA per month.
 */
export function buildRemittanceSchedule(
  raw: unknown,
  employeePct: number,
  employerPct: number,
  options: readonly ComparisonOption[]
): { ok: true; rows: RemittanceRow[]; byPfa: Array<{ pfaName: string; pfaCode: string; employees: number; employeeTotal: number; employerTotal: number; grandTotal: number }> } | { ok: false; error: string } {
  const lines = toLines(raw);
  if (lines.length === 0) return { ok: true, rows: [], byPfa: [] };

  const rows: RemittanceRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (text === undefined) continue;
    const cells = text.split('|').map((cell) => cell.trim());
    if (cells.length < 5) {
      return { ok: false, error: `Remittance line ${index + 1} needs 5 or 6 fields: Name | RSA PIN | PFA | Basic | Housing | Transport. Transport may be omitted if it is zero.` };
    }
    const employeeName = cells[0] ?? '';
    const rsaPin = cells[1] ?? '';
    const pfaText = cells[2] ?? '';
    const basic = toNumber(cells[3]);
    const housing = toNumber(cells[4]);
    const transport = cells.length > 5 ? toNumber(cells[5]) : 0;

    if (employeeName === '') return { ok: false, error: `Remittance line ${index + 1} has no employee name.` };
    if (rsaPin === '') return { ok: false, error: `Remittance line ${index + 1}: ${employeeName} has no RSA PIN. Contributions cannot be routed without one.` };
    if (basic === null) return { ok: false, error: `Remittance line ${index + 1}: "${cells[3] ?? ''}" is not a valid basic salary for ${employeeName}.` };
    if (housing === null) return { ok: false, error: `Remittance line ${index + 1}: "${cells[4] ?? ''}" is not a valid housing allowance for ${employeeName}.` };
    if (transport === null) return { ok: false, error: `Remittance line ${index + 1}: "${cells[5] ?? ''}" is not a valid transport allowance for ${employeeName}.` };

    const pfa = options.find(
      (entry) => entry.name.toLowerCase() === pfaText.toLowerCase() || entry.id === pfaText.toLowerCase() || entry.reference === pfaText
    );
    if (!pfa) {
      return {
        ok: false,
        error: `Remittance line ${index + 1}: "${pfaText}" is not a PFA in this directory. Use one of: ${options.map((entry) => entry.name).join(', ')}.`,
      };
    }

    const breakdown = computePension(basic, housing, transport, employeePct, employerPct, 'monthly');
    rows.push({
      employeeName,
      rsaPin,
      pfaName: pfa.name,
      pfaCode: pfa.reference ?? '',
      pensionableEarnings: breakdown.pensionableBase,
      employeeContribution: breakdown.employeeContribution,
      employerContribution: breakdown.employerContribution,
      totalRemittance: breakdown.totalContribution,
    });
  }

  const grouped: Record<string, { pfaName: string; pfaCode: string; employees: number; employeeTotal: number; employerTotal: number; grandTotal: number }> = {};
  for (const row of rows) {
    const key = row.pfaCode || row.pfaName;
    const bucket = grouped[key];
    if (bucket) {
      bucket.employees += 1;
      bucket.employeeTotal = round(bucket.employeeTotal + row.employeeContribution, 2);
      bucket.employerTotal = round(bucket.employerTotal + row.employerContribution, 2);
      bucket.grandTotal = round(bucket.grandTotal + row.totalRemittance, 2);
    } else {
      grouped[key] = {
        pfaName: row.pfaName,
        pfaCode: row.pfaCode,
        employees: 1,
        employeeTotal: row.employeeContribution,
        employerTotal: row.employerContribution,
        grandTotal: row.totalRemittance,
      };
    }
  }

  return {
    ok: true,
    rows,
    byPfa: Object.keys(grouped)
      .sort()
      .map((key) => grouped[key])
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  };
}

export function computePfaComparison(values: BusinessToolInput): BusinessToolOutcome {
  const employeePct = toNumber(values['employeeContributionPct']) ?? 8;
  const employerPct = toNumber(values['employerContributionPct']) ?? 10;

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (employeePct < 0 || employeePct > 50) fieldErrors.push({ key: 'employeeContributionPct', message: 'Employee contribution must be between 0% and 50%.' });
  if (employerPct < 10 || employerPct > 50) {
    fieldErrors.push({ key: 'employerContributionPct', message: `Employer contribution must be at least the PenCom statutory minimum of 10% (entered ${employerPct}%).` });
  }

  const scheduleRaw = toText(values['remittanceSchedule']).trim();
  type Schedule = ReturnType<typeof buildRemittanceSchedule>;
  const emptySchedule: Extract<Schedule, { ok: true }> = { ok: true, rows: [], byPfa: [] };
  const schedule: Schedule = scheduleRaw === ''
    ? emptySchedule
    : buildRemittanceSchedule(scheduleRaw, employeePct, employerPct, PFA_COMPARISON.options);
  if (!schedule.ok) fieldErrors.push({ key: 'remittanceSchedule', message: schedule.error });

  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the remittance schedule inputs before comparing.') };
  }

  const base = runComparison(PFA_COMPARISON, values);
  if (!base.ok) return base;

  const rows: RemittanceRow[] = schedule.ok ? schedule.rows : [];
  const byPfa = schedule.ok ? schedule.byPfa : [];
  const totalEmployee = round(rows.reduce((total, row) => total + row.employeeContribution, 0), 2);
  const totalEmployer = round(rows.reduce((total, row) => total + row.employerContribution, 0), 2);
  const grandTotal = round(rows.reduce((total, row) => total + row.totalRemittance, 0), 2);

  const metrics: ResultMetric[] = [
    { label: 'Licensed PFAs listed', value: formatInteger(PFA_COMPARISON.options.length), emphasis: 'primary', hint: 'From the published PenCom register' },
    { label: 'Criteria compared', value: formatInteger(PFA_COMPARISON.criteria.length), emphasis: 'secondary' },
    rows.length > 0
      ? { label: 'Remittance schedule', value: `${formatInteger(rows.length)} employee${rows.length === 1 ? '' : 's'} across ${formatInteger(byPfa.length)} PFA${byPfa.length === 1 ? '' : 's'}`, emphasis: 'primary' }
      : { label: 'Remittance schedule', value: 'Not built', emphasis: 'muted', hint: 'Add employee lines to generate a multi-PFA schedule' },
    rows.length > 0
      ? { label: 'Total monthly remittance', value: formatMoney(grandTotal), emphasis: 'primary', hint: `${formatMoney(totalEmployee)} employee + ${formatMoney(totalEmployer)} employer` }
      : { label: 'Total monthly remittance', value: '—', emphasis: 'muted' },
  ];

  const tables: ResultTable[] = [];
  if (rows.length > 0) {
    tables.push({
      title: 'Remittance schedule by PFA',
      columns: ['PFA', 'Code', 'Employees', 'Employee share (₦)', 'Employer share (₦)', 'Total (₦)'],
      rows: [
        ...byPfa.map((group) => ({
          label: group.pfaName,
          cells: [
            group.pfaCode,
            formatInteger(group.employees),
            formatAmount(group.employeeTotal),
            formatAmount(group.employerTotal),
            formatAmount(group.grandTotal),
          ],
        })),
        {
          label: 'All PFAs',
          cells: ['—', formatInteger(rows.length), formatAmount(totalEmployee), formatAmount(totalEmployer), formatAmount(grandTotal)],
          emphasis: 'total' as const,
        },
      ],
      caption: `Computed at ${formatPercent(employeePct)} employee and ${formatPercent(employerPct)} employer of basic + housing + transport, per the Pension Reform Act 2014.`,
    });
    tables.push({
      title: rows.length > 20 ? `Employee detail (first 20 of ${formatInteger(rows.length)})` : 'Employee detail',
      columns: ['Employee', 'RSA PIN', 'PFA', 'Pensionable (₦)', 'Employee (₦)', 'Employer (₦)', 'Total (₦)'],
      rows: rows.slice(0, 20).map((row) => ({
        label: row.employeeName,
        cells: [
          row.rsaPin,
          `${row.pfaName} (${row.pfaCode})`,
          formatAmount(row.pensionableEarnings),
          formatAmount(row.employeeContribution),
          formatAmount(row.employerContribution),
          formatAmount(row.totalRemittance),
        ],
      })),
    });
  }

  tables.push({
    title: 'What to compare before choosing a PFA',
    columns: ['Factor', 'Why it matters'],
    rows: PFA_COMPARISON.criteria.map((criterion) => ({ label: criterion.label, cells: [criterion.description] })),
  });

  const documents: ResultDocument[] = [];
  if (rows.length > 0) {
    documents.push({
      format: 'csv',
      filename: 'pfa-remittance-schedule.csv',
      label: 'Remittance schedule (CSV)',
      content: toCsv(
        ['Employee', 'RSA PIN', 'PFA', 'PFA code', 'Pensionable earnings (₦)', 'Employee contribution (₦)', 'Employer contribution (₦)', 'Total remittance (₦)'],
        rows.map((row) => [
          row.employeeName,
          row.rsaPin,
          row.pfaName,
          row.pfaCode,
          row.pensionableEarnings.toFixed(2),
          row.employeeContribution.toFixed(2),
          row.employerContribution.toFixed(2),
          row.totalRemittance.toFixed(2),
        ] as unknown[])
      ),
    });
  }
  documents.push({
    format: 'csv',
    filename: 'pfa-comparison-matrix.csv',
    label: 'Comparison matrix (CSV)',
    content: toCsv(
      ['PFA', 'PenCom code', 'Best for', ...PFA_COMPARISON.criteria.map((criterion) => criterion.label), ...PFA_COMPARISON.factColumns],
      PFA_COMPARISON.options.map((option) => [
        option.name,
        option.reference ?? '',
        option.bestFor,
        ...PFA_COMPARISON.criteria.map((criterion) => {
          const value = option.scores[criterion.key];
          return value === null || value === undefined ? '' : value.toFixed(1);
        }),
        ...PFA_COMPARISON.factColumns.map((column) => option.facts[column] ?? ''),
      ] as unknown[])
    ),
  });

  return {
    ...base,
    result: {
      ...base.result,
      metrics,
      tables: [...(base.result.tables ?? []), ...tables],
      document: documents[documents.length - 1],
      extraDocuments: documents.slice(0, -1),
      explanation: [
        'Under the Contributory Pension Scheme the employee chooses the PFA. An employer may facilitate registration but the Retirement Savings Account belongs to the employee, so a schedule routinely spans several administrators.',
        'An RSA holder can move administrator through the RSA Transfer System; PenCom\u2019s current transfer rules govern, and the receiving PFA confirms the process.',
        rows.length > 0
          ? `Remittance schedule built for ${formatInteger(rows.length)} employee${rows.length === 1 ? '' : 's'} across ${formatInteger(byPfa.length)} PFA${byPfa.length === 1 ? '' : 's'}: ${formatMoney(totalEmployee)} employee share plus ${formatMoney(totalEmployer)} employer share = ${formatMoney(grandTotal)} per month.`
          : 'No remittance schedule was supplied. Add lines in the form to produce one grouped by PFA.',
        ...(base.result.explanation ?? []),
      ],
      warnings: [
        'Fund performance scores here are planning guidance, not measured returns. PenCom publishes fund performance data — use it, and use current figures, before making a choice on that criterion.',
        ...(base.result.warnings ?? []),
      ],
    },
  };
}

/* ================================================================== */
/* Dataset lookup                                                      */
/* ================================================================== */

export const COMPARISON_DATASETS: Record<string, ComparisonDataset> = {
  'accounting-tool-comparison': ACCOUNTING_COMPARISON,
  'expense-tool-comparison': EXPENSE_COMPARISON,
  'hmo-comparison-nigeria': HMO_COMPARISON,
  'pfa-comparison-nigeria': PFA_COMPARISON,
};

/** The default weights block, pre-filled into the form so the visitor edits rather than authors. */
export function defaultWeightsTemplate(dataset: ComparisonDataset): string {
  return dataset.criteria.map((criterion) => `${criterion.label}, ${criterion.weight}`).join('\n');
}

/** The default scores block, pre-filled so the ranking is meaningful on first load. */
export function defaultScoresTemplate(dataset: ComparisonDataset): string {
  return dataset.options
    .map((option) => [option.name, ...dataset.criteria.map((criterion) => {
      const value = option.scores[criterion.key];
      return value === null || value === undefined ? '' : value.toFixed(1);
    })].join(' | '))
    .join('\n');
}

export { tidyDocument, titleCase };
