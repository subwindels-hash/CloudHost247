/**
 * Business Tools — shared, isomorphic engine contracts.
 *
 * Every one of the 21 Business Tools is described twice: once as a *declarative form schema* (so
 * one generic workspace can render inputs, validation, results and exports for all of them) and
 * once as a *pure compute function* (so the same arithmetic runs in the browser, in the API and in
 * Vitest, and always returns the same numbers).
 *
 * Two deliberate constraints shape this file:
 *
 *  1. **Nothing here may touch the network, the filesystem or the clock.** Payroll and tax inputs
 *     are personal data; the privacy commitment published on these pages is that a submission is
 *     processed in memory and forgotten. A pure function makes that commitment structural rather
 *     than a promise. Determinism is also what makes the tools testable — see
 *     `tests/unit/business-tools-engines.test.ts`.
 *
 *  2. **No rule may be invented.** Where a tool encodes a statutory rate it carries a
 *     `JurisdictionNote` naming the jurisdiction, the source instrument and the effective date it
 *     was verified against. Where a figure is a planning estimate rather than a legal rate, the
 *     note says so, and the tool never presents the estimate as tax or legal advice.
 */

/** The three Business Tools categories, mirroring the reference directory's taxonomy. */
export type BusinessToolCategory = 'calculators' | 'generators' | 'comparisons';

export const BUSINESS_TOOL_CATEGORIES: readonly BusinessToolCategory[] = [
  'calculators',
  'generators',
  'comparisons',
];

export const BUSINESS_TOOL_CATEGORY_LABELS: Record<BusinessToolCategory, string> = {
  calculators: 'Calculators',
  generators: 'Generators',
  comparisons: 'Comparisons',
};

/**
 * Provenance for any jurisdiction-specific or time-sensitive rule a tool applies.
 *
 * This exists because a payroll calculator that silently ships a stale tax band is worse than no
 * calculator at all: the visitor cannot tell the number is wrong. Every rate-backed tool therefore
 * publishes where the rate came from and when it was checked.
 */
export interface JurisdictionNote {
  /** Human-readable jurisdiction, e.g. `Nigeria (federal)`. */
  jurisdiction: string;
  /** The instrument, register or publication the rule was taken from. */
  source: string;
  /** ISO date the rule/data was verified against the source. */
  effectiveDate: string;
  /** True when the figures are planning estimates rather than statutory rates. */
  estimate?: boolean;
  /** Plain-language limitation shown next to the results. */
  disclaimer?: string;
}

/* ------------------------------------------------------------------ */
/* Form schema                                                          */
/* ------------------------------------------------------------------ */

export type BusinessFieldType =
  | 'number'
  | 'integer'
  | 'percent'
  | 'money'
  | 'text'
  | 'textarea'
  | 'lines'
  | 'select'
  | 'boolean'
  | 'date'
  | 'month';

export interface BusinessFieldOption {
  value: string;
  label: string;
}

export interface BusinessField {
  key: string;
  label: string;
  type: BusinessFieldType;
  /** Required fields produce a validation error when empty; optional ones fall back to `default`. */
  required?: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Unit shown beside the input so currency and percentages are never ambiguous. */
  suffix?: string;
  prefix?: string;
  options?: BusinessFieldOption[];
  help?: string;
  placeholder?: string;
  /** Groups fields into labelled sections inside the workspace. */
  section?: string;
  /** Longer explanation rendered under the field. */
  note?: string;
  maxLength?: number;
}

/* ------------------------------------------------------------------ */
/* Results                                                              */
/* ------------------------------------------------------------------ */

export interface ResultMetric {
  label: string;
  value: string;
  /** Optional emphasis: the workspace renders `primary` as the headline figure. */
  emphasis?: 'primary' | 'secondary' | 'muted';
  hint?: string;
}

export interface ResultRow {
  label: string;
  /** One cell per column, in `ResultTable.columns` order. */
  cells: string[];
  emphasis?: 'total' | 'muted';
  hint?: string;
}

export interface ResultTable {
  title: string;
  columns: string[];
  rows: ResultRow[];
  caption?: string;
}

/** A downloadable artefact. `format` drives the MIME type and the file extension. */
export interface ResultDocument {
  format: 'text' | 'markdown' | 'csv' | 'svg' | 'json';
  filename: string;
  content: string;
  /** Short label for the preview panel, e.g. "Offer letter". */
  label: string;
}

export interface BusinessToolResult {
  /** Headline figures rendered as cards above any tables. */
  metrics: ResultMetric[];
  tables?: ResultTable[];
  /** The generated artefact, when the tool produces one. */
  document?: ResultDocument;
  /**
   * Additional artefacts for tools where two formats are genuinely useful — a payslip reads as a
   * document but imports as CSV. The workspace offers each as its own download.
   */
  extraDocuments?: ResultDocument[];
  /** Explanations of how the numbers were derived — shown, never hidden behind a tooltip. */
  explanation?: string[];
  /** Non-fatal advisories: a rate below a statutory minimum, an estimate, a boundary warning. */
  warnings?: string[];
  /** Provenance repeated next to the result so it can never be separated from the numbers. */
  jurisdiction?: JurisdictionNote;
}

/** A structured failure. Field errors point at one input; `message` covers the whole submission. */
export interface BusinessToolFailure {
  message: string;
  fieldErrors?: Array<{ key: string; message: string }>;
}

export type BusinessToolOutcome =
  | { ok: true; result: BusinessToolResult }
  | { ok: false; error: BusinessToolFailure };

/** Everything a compute function receives: raw form values, keyed by field key. */
export type BusinessToolInput = Record<string, string | number | boolean>;

export interface BusinessTool {
  slug: string;
  name: string;
  category: BusinessToolCategory;
  /** One-line card description. */
  summary: string;
  /** Longer "what this does / what it cannot tell you" copy shown on the workspace. */
  description: string;
  icon: string;
  path: string;
  keywords: string[];
  fields: BusinessField[];
  /** Units this tool reports in, stated up front so a result is never read in the wrong currency. */
  units: string;
  jurisdiction?: JurisdictionNote;
  /** Whether the workspace should offer a print action alongside copy/download. */
  printable?: boolean;
  compute: (input: BusinessToolInput) => BusinessToolOutcome;
}
