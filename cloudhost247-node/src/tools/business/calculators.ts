/**
 * Business Tools — Calculators (5).
 *
 *   1. PAYE & Net Salary Calculator      nigeria-paye-net-salary-calculator
 *   2. Pension Calculator                nigeria-pension-calculator
 *   3. VAT Calculator                    nigeria-vat-calculator
 *   4. Employer Cost Calculator          nigeria-employer-cost-calculator
 *   5. EWA ROI Calculator                earned-wage-access-roi-calculator
 *
 * Every rate below is attached to a `JurisdictionNote` naming the instrument it came from and the
 * date it was verified. None of these functions invent a rule, and none of them present an estimate
 * as tax advice — the disclaimer travels with the result so it cannot be separated from the number.
 *
 * Verified against the published formulae and worked examples of the reference directory on
 * 2026-10-10; the Employer Cost and EWA ROI engines reproduce those worked examples exactly
 * (₦5,745,000 total annual cost at a 1.92x multiplier, and ₦4,752,000 projected annual savings),
 * which is what `tests/unit/business-tools-engines.test.ts` asserts.
 */

import {
  formatAmount,
  formatHeadcount,
  formatInteger,
  formatMoney,
  formatMultiplier,
  formatPercent,
  round,
  toBoolean,
  toNumber,
  toText,
} from './format';
import { failure, fieldFailure } from './validate';
import type {
  BusinessToolInput,
  BusinessToolOutcome,
  BusinessToolResult,
  JurisdictionNote,
  ResultMetric,
  ResultRow,
  ResultTable,
} from './types';

/* ================================================================== */
/* Shared statutory data                                               */
/* ================================================================== */

/**
 * Nigeria personal income tax bands for employment income.
 *
 * Source: Nigeria Tax Act 2025 (Tax Reform Bills passed 13 March 2025, signed 26 June 2025),
 * effective 1 January 2026. The bands are cumulative annual thresholds; each band's `rate` applies
 * only to the slice of taxable income falling inside it.
 *
 *   First  ₦800,000          →  0%
 *   Next   ₦2,200,000        → 15%   (cumulative ₦3,000,000)
 *   Next   ₦9,000,000        → 18%   (cumulative ₦12,000,000)
 *   Next   ₦13,000,000       → 21%   (cumulative ₦25,000,000)
 *   Next   ₦25,000,000       → 23%   (cumulative ₦50,000,000)
 *   Above  ₦50,000,000       → 25%
 */
export interface PayeBand {
  /** Cumulative annual ceiling of this band; `Infinity` for the top band. */
  ceiling: number;
  rate: number;
  /** Published label, e.g. "First ₦800,000". */
  label: string;
}

export const NIGERIA_PAYE_BANDS_2026: readonly PayeBand[] = [
  { ceiling: 800_000, rate: 0, label: 'First ₦800,000' },
  { ceiling: 3_000_000, rate: 0.15, label: 'Next ₦2,200,000' },
  { ceiling: 12_000_000, rate: 0.18, label: 'Next ₦9,000,000' },
  { ceiling: 25_000_000, rate: 0.21, label: 'Next ₦13,000,000' },
  { ceiling: 50_000_000, rate: 0.23, label: 'Next ₦25,000,000' },
  { ceiling: Infinity, rate: 0.25, label: 'Above ₦50,000,000' },
];

export const NIGERIA_TAX_NOTE_2026: JurisdictionNote = {
  jurisdiction: 'Nigeria (federal)',
  source:
    'Nigeria Tax Act 2025 — passed by the National Assembly 13 March 2025, signed into law 26 June 2025',
  effectiveDate: '2026-01-01',
  disclaimer:
    'Estimate only. This calculator applies the published Nigeria Tax Act 2025 bands and reliefs to the figures you enter. It is not tax advice and does not account for state-specific administration, filing obligations, or reliefs you may be entitled to but have not entered. Confirm any figure with a licensed tax practitioner or the relevant revenue authority before filing.',
};

export const NIGERIA_PENSION_NOTE: JurisdictionNote = {
  jurisdiction: 'Nigeria (federal)',
  source:
    'Pension Reform Act 2014 / National Pension Commission (PenCom) contribution guidelines — employee 8%, employer minimum 10% of basic salary plus housing and transport allowances',
  effectiveDate: '2026-10-10',
  disclaimer:
    'Estimate only. Contribution percentages are configurable here because an employer may contribute above the statutory minimum; the tool refuses a percentage below it. It does not verify that a PFA is licensed or that an RSA PIN is valid.',
};

export const NIGERIA_VAT_NOTE: JurisdictionNote = {
  jurisdiction: 'Nigeria (federal)',
  source:
    'Finance Act 2019 — standard VAT rate of 7.5%, effective 1 February 2020, administered by the Federal Inland Revenue Service (FIRS). Revenue sharing: FIRS retains 4% as collection cost; of the remaining 96%, the Federal Government takes 15%, the 36 State Governments 50% and the 774 Local Governments 35%; the Federal Government passes 1% of its own share to the FCT Abuja Administration.',
  effectiveDate: '2020-02-01',
  disclaimer:
    'Estimate only. The rate is configurable because exempt, zero-rated and non-vatable supplies exist and because other jurisdictions use different rates. The revenue-sharing breakdown describes how collected VAT is distributed between tiers of government; it is not a filing instruction and does not determine what you personally remit.',
};

export const NIGERIA_EMPLOYER_COST_NOTE: JurisdictionNote = {
  jurisdiction: 'Nigeria (federal)',
  source:
    'Pension Reform Act 2014 (employer minimum 10% of basic + housing + transport, employers with 15+ staff); Employees\u2019 Compensation Act (NSITF levy, 1% of gross earnings); Pension Act group life insurance (mandatory for employers with 3+ workers, cover of at least 3x annual emoluments); Industrial Training Fund Act (1% of payroll, companies with 5+ staff or turnover above ₦50M)',
  effectiveDate: '2026-10-10',
  estimate: true,
  disclaimer:
    'Planning estimate, not a payroll quotation. Statutory levy percentages are configurable and two of them (ITF and employer NHIS) are off by default because they do not apply to every employer — the thresholds above decide that, and this tool does not know your headcount history or turnover. Benefits, workspace and one-off costs are entirely your own inputs. Confirm your obligations with each agency before relying on a figure here.',
};

export const EWA_ROI_NOTE: JurisdictionNote = {
  jurisdiction: 'Not jurisdiction-specific',
  source:
    'Attrition-cost model: annual attrition cost = headcount × turnover rate × (average annual salary × replacement cost ratio). The turnover reduction attributable to Earned Wage Access is an input, not a statutory figure.',
  effectiveDate: '2026-10-10',
  estimate: true,
  disclaimer:
    'Planning estimate. The retention improvement from an Earned Wage Access programme is not a regulated or guaranteed figure — it is an assumption you enter, and the reference material published alongside this model cites a reduction of up to 20%. Programme cost defaults to ₦0 because several providers charge the employee rather than the employer; if yours charges the employer, enter it, because a zero-cost assumption is what turns a finite ROI into an unbounded one.',
};

/** Rent relief: 20% of annual rent, capped at ₦500,000 (Nigeria Tax Act 2025). */
export const NIGERIA_RENT_RELIEF_RATE = 0.2;
export const NIGERIA_RENT_RELIEF_CAP = 500_000;

/* ================================================================== */
/* Shared computation                                                  */
/* ================================================================== */

export interface PayeBandSlice {
  label: string;
  rate: number;
  taxableInBand: number;
  taxInBand: number;
}

/**
 * Progressive tax over the 2026 bands, with the slice taken in each band so the result can be
 * shown as working rather than as a single opaque number.
 */
export function computeNigeriaPaye(annualTaxableIncome: number): {
  tax: number;
  slices: PayeBandSlice[];
} {
  const taxable = Math.max(0, Number.isFinite(annualTaxableIncome) ? annualTaxableIncome : 0);
  const slices: PayeBandSlice[] = [];
  let tax = 0;
  let lower = 0;

  for (const band of NIGERIA_PAYE_BANDS_2026) {
    if (lower >= taxable) {
      slices.push({ label: band.label, rate: band.rate, taxableInBand: 0, taxInBand: 0 });
      continue;
    }
    const upper = Number.isFinite(band.ceiling) ? Math.min(band.ceiling, taxable) : taxable;
    const slice = Math.max(0, upper - lower);
    const bandTax = slice * band.rate;
    tax += bandTax;
    slices.push({
      label: band.label,
      rate: band.rate,
      taxableInBand: round(slice, 2),
      taxInBand: round(bandTax, 2),
    });
    lower = Number.isFinite(band.ceiling) ? band.ceiling : taxable;
  }

  return { tax: round(tax, 2), slices };
}

/** Convenience: monthly PAYE from a monthly gross figure with no reliefs at all. */
export function monthlyPayeFromGross(monthlyGross: number): number {
  const { tax } = computeNigeriaPaye(monthlyGross * 12);
  return round(tax / 12, 2);
}

/* ------------------------------------------------------------------ */
/* 1. PAYE & Net Salary Calculator                                     */
/* ------------------------------------------------------------------ */

export interface PayeStructure {
  monthlyGross: number;
  basic: number;
  housing: number;
  transport: number;
  reimbursement: number;
  pensionableEarnings: number;
  pensionEmployee: number;
  nhf: number;
  nhis: number;
  otherDeductions: number;
  annualGross: number;
  rentReliefAnnual: number;
  mortgageInterestAnnual: number;
  lifeInsuranceAnnual: number;
  totalReliefsAnnual: number;
  annualTaxableIncome: number;
  annualTax: number;
  monthlyTax: number;
  monthlyNet: number;
  annualNet: number;
  effectiveTaxRate: number;
  totalMonthlyDeductions: number;
  taxBasis: 'progressive-paye' | 'consultant-wht' | 'exempt';
  exemptionReason?: string;
  slices: PayeBandSlice[];
}

export interface PayeOptions {
  basicPct?: number;
  housingPct?: number;
  transportPct?: number;
  reimbursementPct?: number;
  pensionEmployeePct?: number;
  nhfPct?: number;
  nhisPct?: number;
  whtRatePct?: number;
  monthlyRent?: number;
  annualMortgageInterest?: number;
  annualLifeInsurance?: number;
  monthlyOtherDeductions?: number;
  isMilitary?: boolean;
  isMinimumWageEarner?: boolean;
  isIndependentConsultant?: boolean;
}

/**
 * The full salary breakdown for one monthly gross figure.
 *
 * `nhis` is computed on basic salary, matching the published employer-side formulation
 * ("Employer NHIS Health Cover (10% of Basic)"); the employee share uses the same base.
 */
export function computePayeStructure(monthlyGross: number, options: PayeOptions = {}): PayeStructure {
  const basicPct = options.basicPct ?? 40;
  const housingPct = options.housingPct ?? 30;
  const transportPct = options.transportPct ?? 20;
  const reimbursementPct = options.reimbursementPct ?? 10;
  const pensionEmployeePct = options.pensionEmployeePct ?? 8;
  const nhfPct = options.nhfPct ?? 2.5;
  const nhisPct = options.nhisPct ?? 5;
  const whtRatePct = options.whtRatePct ?? 5;
  const monthlyRent = Math.max(0, options.monthlyRent ?? 0);
  const mortgage = Math.max(0, options.annualMortgageInterest ?? 0);
  const life = Math.max(0, options.annualLifeInsurance ?? 0);
  const other = Math.max(0, options.monthlyOtherDeductions ?? 0);

  const gross = Math.max(0, Number.isFinite(monthlyGross) ? monthlyGross : 0);
  const basic = (gross * basicPct) / 100;
  const housing = (gross * housingPct) / 100;
  const transport = (gross * transportPct) / 100;
  const reimbursement = (gross * reimbursementPct) / 100;
  const pensionable = basic + housing + transport;

  const pensionEmployee = (pensionable * pensionEmployeePct) / 100;
  const nhf = (gross * nhfPct) / 100;
  const nhis = (basic * nhisPct) / 100;

  const annualGross = gross * 12;
  const rentReliefAnnual = Math.min(
    NIGERIA_RENT_RELIEF_CAP,
    monthlyRent * 12 * NIGERIA_RENT_RELIEF_RATE
  );
  const statutoryReliefsAnnual = (pensionEmployee + nhf + nhis) * 12;
  const totalReliefsAnnual = statutoryReliefsAnnual + rentReliefAnnual + mortgage + life;
  const annualTaxableIncome = Math.max(0, annualGross - totalReliefsAnnual);

  let taxBasis: PayeStructure['taxBasis'] = 'progressive-paye';
  let exemptionReason: string | undefined;
  let annualTax: number;
  let slices: PayeBandSlice[];

  if (options.isMilitary) {
    taxBasis = 'exempt';
    exemptionReason = 'Military officer — employment income is exempt from personal income tax.';
    annualTax = 0;
    slices = [];
  } else if (options.isMinimumWageEarner) {
    taxBasis = 'exempt';
    exemptionReason = 'National minimum wage earner — exempt from personal income tax.';
    annualTax = 0;
    slices = [];
  } else if (options.isIndependentConsultant) {
    taxBasis = 'consultant-wht';
    annualTax = round((annualGross * whtRatePct) / 100, 2);
    slices = [
      {
        label: `Withholding tax at ${formatPercent(whtRatePct)} of gross`,
        rate: whtRatePct / 100,
        taxableInBand: round(annualGross, 2),
        taxInBand: annualTax,
      },
    ];
  } else {
    const computed = computeNigeriaPaye(annualTaxableIncome);
    annualTax = computed.tax;
    slices = computed.slices;
  }

  const monthlyTax = annualTax / 12;
  const monthlyNet = gross - pensionEmployee - nhf - nhis - monthlyTax - other;
  const totalMonthlyDeductions = pensionEmployee + nhf + nhis + monthlyTax + other;

  return {
    monthlyGross: round(gross, 2),
    basic: round(basic, 2),
    housing: round(housing, 2),
    transport: round(transport, 2),
    reimbursement: round(reimbursement, 2),
    pensionableEarnings: round(pensionable, 2),
    pensionEmployee: round(pensionEmployee, 2),
    nhf: round(nhf, 2),
    nhis: round(nhis, 2),
    otherDeductions: round(other, 2),
    annualGross: round(annualGross, 2),
    rentReliefAnnual: round(rentReliefAnnual, 2),
    mortgageInterestAnnual: round(mortgage, 2),
    lifeInsuranceAnnual: round(life, 2),
    totalReliefsAnnual: round(totalReliefsAnnual, 2),
    annualTaxableIncome: round(annualTaxableIncome, 2),
    annualTax,
    monthlyTax: round(monthlyTax, 2),
    monthlyNet: round(monthlyNet, 2),
    annualNet: round(monthlyNet * 12, 2),
    effectiveTaxRate: annualGross > 0 ? round((annualTax / annualGross) * 100, 2) : 0,
    totalMonthlyDeductions: round(totalMonthlyDeductions, 2),
    taxBasis,
    exemptionReason,
    slices,
  };
}

function payeOptionsFrom(values: BusinessToolInput): PayeOptions {
  const num = (key: string, fallback: number): number => {
    const parsed = toNumber(values[key]);
    return parsed === null ? fallback : parsed;
  };
  return {
    basicPct: num('basicPct', 40),
    housingPct: num('housingPct', 30),
    transportPct: num('transportPct', 20),
    reimbursementPct: num('reimbursementPct', 10),
    pensionEmployeePct: num('pensionEmployeePct', 8),
    nhfPct: num('nhfPct', 2.5),
    nhisPct: num('nhisPct', 5),
    whtRatePct: num('whtRatePct', 5),
    monthlyRent: num('monthlyRent', 0),
    annualMortgageInterest: num('annualMortgageInterest', 0),
    annualLifeInsurance: num('annualLifeInsurance', 0),
    monthlyOtherDeductions: num('monthlyOtherDeductions', 0),
    isMilitary: toBoolean(values['isMilitary']),
    isMinimumWageEarner: toBoolean(values['isMinimumWageEarner']),
    isIndependentConsultant: toBoolean(values['isIndependentConsultant']),
  };
}

/**
 * Solve for the monthly gross that produces a requested monthly net.
 *
 * Net pay is monotonically non-decreasing in gross under every branch of the model (a larger gross
 * can never reduce net), so bisection is safe and — with a fixed iteration count and no dependence
 * on floating-point convergence tests — deterministic.
 */
export function solveGrossFromNet(
  targetMonthlyNet: number,
  options: PayeOptions = {},
  iterations = 200
): number {
  if (targetMonthlyNet <= 0) return 0;
  let low = 0;
  let high = Math.max(targetMonthlyNet * 4, 1_000_000);
  // Expand the upper bound until it brackets the target, so very high net goals still resolve.
  for (let expand = 0; expand < 60; expand += 1) {
    if (computePayeStructure(high, options).monthlyNet >= targetMonthlyNet) break;
    high *= 2;
  }
  for (let step = 0; step < iterations; step += 1) {
    const mid = (low + high) / 2;
    const net = computePayeStructure(mid, options).monthlyNet;
    if (net < targetMonthlyNet) low = mid;
    else high = mid;
    if (high - low < 0.005) break;
  }
  return round((low + high) / 2, 2);
}

export function computePayeCalculator(values: BusinessToolInput): BusinessToolOutcome {
  const calculateFrom = toText(values['calculateFrom']) || 'gross';
  const options = payeOptionsFrom(values);

  const structurePct =
    (options.basicPct ?? 0) + (options.housingPct ?? 0) + (options.transportPct ?? 0) + (options.reimbursementPct ?? 0);
  if (Math.abs(structurePct - 100) > 0.01) {
    return {
      ok: false,
      error: failure(
        `The salary structure percentages must add up to exactly 100% (basic + housing + transport + reimbursement currently total ${formatPercent(structurePct)}).`,
        [{ key: 'basicPct', message: `Structure components total ${formatPercent(structurePct)}, not 100%.` }]
      ),
    };
  }

  const entered = toNumber(values['monthlyAmount']);
  if (entered === null || entered <= 0) {
    return {
      ok: false,
      error: failure('Enter a monthly amount greater than zero.', [
        { key: 'monthlyAmount', message: 'Must be a number greater than zero.' },
      ]),
    };
  }

  const solvedGross =
    calculateFrom === 'net' ? solveGrossFromNet(entered, options) : round(entered, 2);
  const structure = computePayeStructure(solvedGross, options);

  const metrics: ResultMetric[] = [
    {
      label: calculateFrom === 'net' ? 'Required monthly gross' : 'Monthly gross salary',
      value: formatMoney(structure.monthlyGross),
      emphasis: 'primary',
      hint: calculateFrom === 'net' ? 'Solved so take-home pay matches your target' : 'Before any deduction',
    },
    { label: 'Monthly PAYE', value: formatMoney(structure.monthlyTax), emphasis: 'secondary', hint: `${formatMoney(structure.annualTax)} per year` },
    { label: 'Monthly net (take-home)', value: formatMoney(structure.monthlyNet), emphasis: 'primary', hint: `${formatMoney(structure.annualNet)} per year` },
    { label: 'Effective tax rate', value: formatPercent(structure.effectiveTaxRate), hint: 'Annual tax ÷ annual gross' },
    { label: 'Total monthly deductions', value: formatMoney(structure.totalMonthlyDeductions), emphasis: 'muted' },
  ];

  const structureTable: ResultTable = {
    title: 'Salary structure',
    columns: ['Component', 'Share of gross', 'Monthly (₦)', 'Annual (₦)'],
    rows: [
      row('Basic salary', options.basicPct ?? 0, structure.basic),
      row('Housing allowance', options.housingPct ?? 0, structure.housing),
      row('Transport allowance', options.transportPct ?? 0, structure.transport),
      row('Reimbursement', options.reimbursementPct ?? 0, structure.reimbursement),
      {
        label: 'Gross salary',
        cells: ['100.00%', formatAmount(structure.monthlyGross), formatAmount(structure.annualGross)],
        emphasis: 'total',
      },
      {
        label: 'Pensionable earnings (basic + housing + transport)',
        cells: ['—', formatAmount(structure.pensionableEarnings), formatAmount(structure.pensionableEarnings * 12)],
        emphasis: 'muted',
      },
    ],
  };

  const deductionTable: ResultTable = {
    title: 'Statutory and other deductions',
    columns: ['Deduction', 'Basis', 'Monthly (₦)', 'Annual (₦)'],
    rows: [
      {
        label: 'Pension (employee)',
        cells: [`${formatPercent(options.pensionEmployeePct ?? 8)} of pensionable earnings`, formatAmount(structure.pensionEmployee), formatAmount(structure.pensionEmployee * 12)],
      },
      {
        label: 'NHF housing fund',
        cells: [`${formatPercent(options.nhfPct ?? 2.5)} of gross`, formatAmount(structure.nhf), formatAmount(structure.nhf * 12)],
        hint: 'Optional for private-sector employers; remove it by setting the rate to 0.',
      },
      {
        label: 'NHIS health insurance',
        cells: [`${formatPercent(options.nhisPct ?? 5)} of basic`, formatAmount(structure.nhis), formatAmount(structure.nhis * 12)],
      },
      {
        label: structure.taxBasis === 'consultant-wht' ? 'Withholding tax (consultant)' : 'PAYE income tax',
        cells: [
          structure.taxBasis === 'exempt'
            ? 'Exempt'
            : structure.taxBasis === 'consultant-wht'
              ? `${formatPercent(options.whtRatePct ?? 5)} of gross`
              : 'Progressive bands',
          formatAmount(structure.monthlyTax),
          formatAmount(structure.annualTax),
        ],
        emphasis: 'total',
      },
      {
        label: 'Other deductions',
        cells: ['As entered', formatAmount(structure.otherDeductions), formatAmount(structure.otherDeductions * 12)],
      },
      {
        label: 'Net pay (take-home)',
        cells: ['—', formatAmount(structure.monthlyNet), formatAmount(structure.annualNet)],
        emphasis: 'total',
      },
    ],
  };

  const reliefRows: ResultRow[] = [
    { label: 'Pension contributions', cells: [formatAmount(structure.pensionEmployee * 12)], hint: 'Employee share is not taxable income' },
    { label: 'NHF contributions', cells: [formatAmount(structure.nhf * 12)] },
    { label: 'NHIS contributions', cells: [formatAmount(structure.nhis * 12)] },
    {
      label: 'Rent relief',
      cells: [formatAmount(structure.rentReliefAnnual)],
      hint: `20% of annual rent, capped at ${formatMoney(NIGERIA_RENT_RELIEF_CAP, 'NGN', 0)}`,
    },
    { label: 'Mortgage interest on a self-occupied home', cells: [formatAmount(structure.mortgageInterestAnnual)] },
    { label: 'Life insurance premium (self or spouse)', cells: [formatAmount(structure.lifeInsuranceAnnual)] },
    { label: 'Total reliefs', cells: [formatAmount(structure.totalReliefsAnnual)], emphasis: 'total' },
    { label: 'Taxable income', cells: [formatAmount(structure.annualTaxableIncome)], emphasis: 'total', hint: 'Annual gross less total reliefs, floored at zero' },
  ];

  const tables: ResultTable[] = [structureTable, deductionTable, { title: 'Reliefs applied to annual taxable income', columns: ['Relief', 'Annual (₦)'], rows: reliefRows }];

  if (structure.slices.length > 0) {
    tables.push({
      title: structure.taxBasis === 'consultant-wht' ? 'Withholding tax computation' : 'PAYE band computation (annual)',
      columns: ['Band', 'Rate', 'Taxable in band (₦)', 'Tax in band (₦)'],
      rows: structure.slices.map((slice) => ({
        label: slice.label,
        cells: [formatPercent(slice.rate * 100), formatAmount(slice.taxableInBand), formatAmount(slice.taxInBand)],
      })),
      caption:
        structure.taxBasis === 'consultant-wht'
          ? 'Independent consultants are charged flat withholding tax in place of the progressive PAYE bands.'
          : 'Each band\u2019s rate applies only to the slice of taxable income inside it.',
    });
  }

  const explanation: string[] = [
    `Pensionable earnings = basic + housing + transport = ${formatMoney(structure.pensionableEarnings)} per month.`,
    `Employee pension = ${formatPercent(options.pensionEmployeePct ?? 8)} × pensionable earnings = ${formatMoney(structure.pensionEmployee)}.`,
    `NHF = ${formatPercent(options.nhfPct ?? 2.5)} × gross = ${formatMoney(structure.nhf)}; NHIS = ${formatPercent(options.nhisPct ?? 5)} × basic = ${formatMoney(structure.nhis)}.`,
    `Annual taxable income = ${formatMoney(structure.annualGross)} gross − ${formatMoney(structure.totalReliefsAnnual)} reliefs = ${formatMoney(structure.annualTaxableIncome)}.`,
    structure.taxBasis === 'consultant-wht'
      ? `Withholding tax = ${formatPercent(options.whtRatePct ?? 5)} × annual gross = ${formatMoney(structure.annualTax)}.`
      : `Annual tax across the bands = ${formatMoney(structure.annualTax)}; monthly = ${formatMoney(structure.monthlyTax)}.`,
    `Net pay = gross − pension − NHF − NHIS − tax − other deductions = ${formatMoney(structure.monthlyNet)} per month.`,
  ];
  if (calculateFrom === 'net') {
    explanation.unshift(
      `You asked for a take-home of ${formatMoney(entered)}, so the tool solved for the gross that produces it: ${formatMoney(structure.monthlyGross)}.`
    );
  }

  const warnings: string[] = [];
  if (structure.exemptionReason) warnings.push(structure.exemptionReason);
  if (structure.taxBasis === 'consultant-wht') {
    warnings.push(
      'Withholding tax at the consultant rate is applied instead of the progressive PAYE bands. Whether a worker is genuinely an independent consultant is a factual and legal question this tool cannot answer.'
    );
  }
  if (structure.monthlyNet < 0) {
    warnings.push(
      'Deductions exceed gross pay at these inputs, so net pay is negative. Check the other-deductions figure and the structure percentages.'
    );
  }
  if (calculateFrom === 'net') {
    warnings.push(
      'The gross-to-net solve is a numeric search on this model. It is accurate to ±₦0.01 of monthly gross but it inherits every assumption you entered.'
    );
  }

  const result: BusinessToolResult = {
    metrics,
    tables,
    explanation,
    warnings,
    jurisdiction: NIGERIA_TAX_NOTE_2026,
  };
  return { ok: true, result };
}

function row(label: string, pct: number, monthly: number): ResultRow {
  return {
    label,
    cells: [formatPercent(pct), formatAmount(monthly), formatAmount(monthly * 12)],
  };
}

/* ------------------------------------------------------------------ */
/* 2. Pension Calculator                                               */
/* ------------------------------------------------------------------ */

export const PENCOM_EMPLOYEE_MINIMUM_PCT = 8;
export const PENCOM_EMPLOYER_MINIMUM_PCT = 10;

export interface PensionBreakdown {
  pensionableBase: number;
  gross: number;
  employeeContribution: number;
  employerContribution: number;
  totalContribution: number;
  netPay: number;
  monthly: { gross: number; employee: number; employer: number; total: number; net: number };
  yearly: { gross: number; employee: number; employer: number; total: number; net: number };
  employeePct: number;
  employerPct: number;
}

export function computePension(
  basic: number,
  housing: number,
  transport: number,
  employeePct: number,
  employerPct: number,
  payPeriod: 'monthly' | 'yearly'
): PensionBreakdown {
  const safe = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
  const monthlyBasic = payPeriod === 'yearly' ? safe(basic) / 12 : safe(basic);
  const monthlyHousing = payPeriod === 'yearly' ? safe(housing) / 12 : safe(housing);
  const monthlyTransport = payPeriod === 'yearly' ? safe(transport) / 12 : safe(transport);

  const base = monthlyBasic + monthlyHousing + monthlyTransport;
  const employee = (base * safe(employeePct)) / 100;
  const employer = (base * safe(employerPct)) / 100;
  const total = employee + employer;
  const net = base - employee;

  const scale = (value: number, factor: number): number => round(value * factor, 2);

  return {
    pensionableBase: round(base, 2),
    gross: round(base, 2),
    employeeContribution: round(employee, 2),
    employerContribution: round(employer, 2),
    totalContribution: round(total, 2),
    netPay: round(net, 2),
    employeePct: safe(employeePct),
    employerPct: safe(employerPct),
    monthly: {
      gross: round(base, 2),
      employee: round(employee, 2),
      employer: round(employer, 2),
      total: round(total, 2),
      net: round(net, 2),
    },
    yearly: {
      gross: scale(base, 12),
      employee: scale(employee, 12),
      employer: scale(employer, 12),
      total: scale(total, 12),
      net: scale(net, 12),
    },
  };
}

export function computePensionCalculator(values: BusinessToolInput): BusinessToolOutcome {
  const payPeriod = toText(values['payPeriod']) === 'yearly' ? 'yearly' : 'monthly';
  const basic = toNumber(values['basicSalary']);
  const housing = toNumber(values['housingAllowance']);
  const transport = toNumber(values['transportAllowance']);
  const employeePct = toNumber(values['employeePct']);
  const employerPct = toNumber(values['employerPct']);

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (basic === null) fieldErrors.push({ key: 'basicSalary', message: 'Basic salary is required and must be a number.' });
  if (housing === null) fieldErrors.push({ key: 'housingAllowance', message: 'Housing allowance is required and must be a number.' });
  if (transport === null) fieldErrors.push({ key: 'transportAllowance', message: 'Transport allowance is required and must be a number.' });
  if (employeePct === null) fieldErrors.push({ key: 'employeePct', message: 'Employee contribution percentage is required.' });
  if (employerPct === null) fieldErrors.push({ key: 'employerPct', message: 'Employer contribution percentage is required.' });
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the highlighted pension inputs before calculating.') };
  }

  const b = basic as number;
  const h = housing as number;
  const t = transport as number;
  const ePct = employeePct as number;
  const mPct = employerPct as number;

  if (b < 0 || h < 0 || t < 0) {
    return { ok: false, error: failure('Salary components cannot be negative.') };
  }
  if (b + h + t <= 0) {
    return {
      ok: false,
      error: failure('Pensionable earnings are zero. Enter at least one of basic salary, housing or transport allowance.', [
        { key: 'basicSalary', message: 'Basic salary, housing and transport cannot all be zero.' },
      ]),
    };
  }
  if (ePct < 0 || mPct < 0) {
    return { ok: false, error: failure('Contribution percentages cannot be negative.') };
  }

  const warnings: string[] = [];
  if (mPct < PENCOM_EMPLOYER_MINIMUM_PCT) {
    return {
      ok: false,
      error: failure(
        `An employer contribution of ${formatPercent(mPct)} is below the PenCom statutory minimum of ${PENCOM_EMPLOYER_MINIMUM_PCT}%. Raise it to at least ${PENCOM_EMPLOYER_MINIMUM_PCT}% — an employer may contribute more, never less.`,
        [{ key: 'employerPct', message: `Must be at least ${PENCOM_EMPLOYER_MINIMUM_PCT}% (PenCom minimum).` }]
      ),
    };
  }
  if (ePct < PENCOM_EMPLOYEE_MINIMUM_PCT) {
    warnings.push(
      `The employee contribution of ${formatPercent(ePct)} is below the ${PENCOM_EMPLOYEE_MINIMUM_PCT}% set out in the Pension Reform Act. The calculation below uses the figure you entered; it is not a compliant remittance.`
    );
  }
  if (mPct > PENCOM_EMPLOYER_MINIMUM_PCT) {
    warnings.push(
      `Employer contribution of ${formatPercent(mPct)} is above the ${PENCOM_EMPLOYER_MINIMUM_PCT}% statutory minimum. That is permitted — the minimum is a floor, not a ceiling.`
    );
  }

  const breakdown = computePension(b, h, t, ePct, mPct, payPeriod);

  const metrics: ResultMetric[] = [
    {
      label: 'Employee contribution',
      value: formatMoney(breakdown.employeeContribution),
      emphasis: 'primary',
      hint: `${formatPercent(breakdown.employeePct)} of pensionable earnings, per month`,
    },
    {
      label: 'Employer contribution',
      value: formatMoney(breakdown.employerContribution),
      emphasis: 'primary',
      hint: `${formatPercent(breakdown.employerPct)} of pensionable earnings, per month`,
    },
    {
      label: 'Total monthly remittance',
      value: formatMoney(breakdown.totalContribution),
      emphasis: 'secondary',
      hint: `${formatMoney(breakdown.yearly.total)} per year`,
    },
    { label: 'Pensionable base', value: formatMoney(breakdown.pensionableBase), emphasis: 'muted', hint: 'Basic + housing + transport, per month' },
  ];

  const tables: ResultTable[] = [
    {
      title: 'Pension contribution schedule',
      columns: ['Description', 'Monthly (₦)', 'Yearly (₦)'],
      rows: [
        { label: 'Gross pensionable salary', cells: [formatAmount(breakdown.monthly.gross), formatAmount(breakdown.yearly.gross)] },
        { label: `Employee pension contribution (${formatPercent(breakdown.employeePct)})`, cells: [formatAmount(breakdown.monthly.employee), formatAmount(breakdown.yearly.employee)] },
        { label: `Employer pension contribution (${formatPercent(breakdown.employerPct)})`, cells: [formatAmount(breakdown.monthly.employer), formatAmount(breakdown.yearly.employer)] },
        { label: 'Total pension contribution', cells: [formatAmount(breakdown.monthly.total), formatAmount(breakdown.yearly.total)], emphasis: 'total' },
        { label: 'Net salary after employee pension', cells: [formatAmount(breakdown.monthly.net), formatAmount(breakdown.yearly.net)], emphasis: 'total', hint: 'Before PAYE, NHF and NHIS — use the PAYE calculator for those' },
      ],
    },
  ];

  return {
    ok: true,
    result: {
      metrics,
      tables,
      explanation: [
        `Pensionable base = basic + housing + transport = ${formatMoney(breakdown.pensionableBase)} per month.`,
        `Employee contribution = ${formatMoney(breakdown.pensionableBase)} × ${formatPercent(breakdown.employeePct)} = ${formatMoney(breakdown.employeeContribution)}.`,
        `Employer contribution = ${formatMoney(breakdown.pensionableBase)} × ${formatPercent(breakdown.employerPct)} = ${formatMoney(breakdown.employerContribution)}.`,
        'The employee contribution is deductible from taxable income; see the PAYE & Net Salary Calculator for the resulting tax relief.',
        payPeriod === 'yearly'
          ? 'You entered yearly figures, so they were divided by 12 before the contribution rates were applied.'
          : 'You entered monthly figures; the yearly column is each monthly figure × 12.',
      ],
      warnings,
      jurisdiction: NIGERIA_PENSION_NOTE,
      document: {
        format: 'csv',
        filename: 'pension-contribution-schedule.csv',
        label: 'Contribution schedule (CSV)',
        content:
          'Description,Monthly NGN,Yearly NGN\r\n' +
          `Gross pensionable salary,${breakdown.monthly.gross.toFixed(2)},${breakdown.yearly.gross.toFixed(2)}\r\n` +
          `Employee pension contribution (${breakdown.employeePct}%),${breakdown.monthly.employee.toFixed(2)},${breakdown.yearly.employee.toFixed(2)}\r\n` +
          `Employer pension contribution (${breakdown.employerPct}%),${breakdown.monthly.employer.toFixed(2)},${breakdown.yearly.employer.toFixed(2)}\r\n` +
          `Total pension contribution,${breakdown.monthly.total.toFixed(2)},${breakdown.yearly.total.toFixed(2)}\r\n` +
          `Net salary after employee pension,${breakdown.monthly.net.toFixed(2)},${breakdown.yearly.net.toFixed(2)}\r\n`,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* 3. VAT Calculator                                                   */
/* ------------------------------------------------------------------ */

export const NIGERIA_STANDARD_VAT_RATE = 7.5;
export const VAT_FIRS_COLLECTION_FEE = 0.04;
export const VAT_DISTRIBUTABLE_SHARE = 0.96;
export const VAT_FEDERAL_SHARE = 0.15;
export const VAT_STATE_SHARE = 0.5;
export const VAT_LOCAL_GOVERNMENT_SHARE = 0.35;
export const VAT_FCT_SHARE_OF_FEDERAL = 0.01;

export interface VatBreakdown {
  mode: 'add' | 'remove';
  rate: number;
  net: number;
  vat: number;
  gross: number;
  netShareOfGross: number;
  vatShareOfGross: number;
  distribution: {
    firsCollectionFee: number;
    distributable: number;
    federalGross: number;
    fctAbuja: number;
    federalNet: number;
    stateGovernments: number;
    localGovernments: number;
  };
}

export function computeVat(amount: number, rate: number, mode: 'add' | 'remove'): VatBreakdown {
  const safeRate = Number.isFinite(rate) ? Math.max(0, rate) : 0;
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const factor = safeRate / 100;

  const net = mode === 'add' ? safeAmount : safeAmount / (1 + factor);
  const gross = mode === 'add' ? safeAmount * (1 + factor) : safeAmount;
  const vat = gross - net;

  const firs = vat * VAT_FIRS_COLLECTION_FEE;
  const distributable = vat * VAT_DISTRIBUTABLE_SHARE;
  const federalGross = distributable * VAT_FEDERAL_SHARE;
  const fct = federalGross * VAT_FCT_SHARE_OF_FEDERAL;

  return {
    mode,
    rate: round(safeRate, 4),
    net: round(net, 2),
    vat: round(vat, 2),
    gross: round(gross, 2),
    netShareOfGross: gross > 0 ? round((net / gross) * 100, 2) : 0,
    vatShareOfGross: gross > 0 ? round((vat / gross) * 100, 2) : 0,
    distribution: {
      firsCollectionFee: round(firs, 2),
      distributable: round(distributable, 2),
      federalGross: round(federalGross, 2),
      fctAbuja: round(fct, 2),
      federalNet: round(federalGross - fct, 2),
      stateGovernments: round(distributable * VAT_STATE_SHARE, 2),
      localGovernments: round(distributable * VAT_LOCAL_GOVERNMENT_SHARE, 2),
    },
  };
}

export function computeVatCalculator(values: BusinessToolInput): BusinessToolOutcome {
  const mode = toText(values['mode']) === 'remove' ? 'remove' : 'add';
  const rate = toNumber(values['rate']);
  const amount = toNumber(values['amount']);

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (rate === null) fieldErrors.push({ key: 'rate', message: 'VAT rate is required and must be a number.' });
  if (amount === null) fieldErrors.push({ key: 'amount', message: 'Base amount is required and must be a number.' });
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Enter a VAT rate and a base amount.') };
  }

  const r = rate as number;
  const a = amount as number;
  if (r < 0 || r > 100) {
    return {
      ok: false,
      error: failure('A VAT rate must be between 0% and 100%.', [
        { key: 'rate', message: 'Must be between 0 and 100.' },
      ]),
    };
  }
  if (a < 0) {
    return {
      ok: false,
      error: failure('The base amount cannot be negative.', [{ key: 'amount', message: 'Must be zero or more.' }]),
    };
  }

  const breakdown = computeVat(a, r, mode);
  const dist = breakdown.distribution;

  const warnings: string[] = [];
  if (a === 0) {
    warnings.push('The base amount is zero, so every figure below is zero. Enter an amount to see a real computation.');
  }
  if (r !== NIGERIA_STANDARD_VAT_RATE) {
    warnings.push(
      `The rate entered (${formatPercent(r)}) is not Nigeria's standard ${formatPercent(NIGERIA_STANDARD_VAT_RATE)}. The revenue-sharing breakdown below still applies the Nigerian distribution rules, so it is only meaningful for Nigerian VAT.`
    );
  }
  if (mode === 'remove') {
    warnings.push(
      'Removing VAT assumes the amount you entered is VAT-inclusive. If it is actually VAT-exclusive, switch to "Add VAT" — the two modes answer different questions.'
    );
  }

  return {
    ok: true,
    result: {
      metrics: [
        {
          label: mode === 'add' ? 'Gross (VAT inclusive)' : 'Gross amount entered',
          value: formatMoney(breakdown.gross),
          emphasis: 'primary',
        },
        { label: 'VAT amount', value: formatMoney(breakdown.vat), emphasis: 'primary', hint: `${formatPercent(breakdown.rate)} rate` },
        { label: mode === 'add' ? 'Net (VAT exclusive)' : 'Net after removing VAT', value: formatMoney(breakdown.net), emphasis: 'secondary' },
        {
          label: 'Share of gross',
          value: `${formatPercent(breakdown.netShareOfGross)} net / ${formatPercent(breakdown.vatShareOfGross)} VAT`,
          emphasis: 'muted',
        },
      ],
      tables: [
        {
          title: mode === 'add' ? 'VAT added' : 'VAT removed',
          columns: ['Description', 'Value'],
          rows: [
            { label: 'VAT rate', cells: [formatPercent(breakdown.rate)] },
            { label: 'Product amount (net)', cells: [formatAmount(breakdown.net)], hint: `${formatPercent(breakdown.netShareOfGross)} of gross` },
            { label: 'VAT amount', cells: [formatAmount(breakdown.vat)], hint: `${formatPercent(breakdown.vatShareOfGross)} of gross` },
            { label: 'Gross amount', cells: [formatAmount(breakdown.gross)], emphasis: 'total' },
          ],
        },
        {
          title: 'VAT revenue distribution between tiers of government',
          columns: ['Recipient tier', 'Allocation rule', 'Value (₦)'],
          rows: [
            { label: 'FIRS collection fee', cells: ['4% of total VAT collected', formatAmount(dist.firsCollectionFee)] },
            { label: 'Distributable pool', cells: ['96% of total VAT collected', formatAmount(dist.distributable)], emphasis: 'muted' },
            { label: 'Federal Government (net)', cells: ['15% of the pool, less the FCT share', formatAmount(dist.federalNet)] },
            { label: 'FCT Abuja Administration', cells: ['1% of the Federal Government share', formatAmount(dist.fctAbuja)] },
            { label: '36 State Governments', cells: ['50% of the pool', formatAmount(dist.stateGovernments)] },
            { label: '774 Local Governments', cells: ['35% of the pool', formatAmount(dist.localGovernments)] },
          ],
          caption:
            'Describes how VAT collected on this transaction is shared once remitted. It is not a filing instruction and does not change what you remit.',
        },
      ],
      explanation: [
        mode === 'add'
          ? `VAT = product amount × rate ÷ 100 = ${formatMoney(a)} × ${formatPercent(r)} = ${formatMoney(breakdown.vat)}.`
          : `Net = gross ÷ (1 + rate ÷ 100) = ${formatMoney(a)} ÷ ${(1 + r / 100).toFixed(6)} = ${formatMoney(breakdown.net)}.`,
        `Gross = net + VAT = ${formatMoney(breakdown.net)} + ${formatMoney(breakdown.vat)} = ${formatMoney(breakdown.gross)}.`,
        `FIRS retains 4% of the VAT collected (${formatMoney(dist.firsCollectionFee)}); the remaining 96% (${formatMoney(dist.distributable)}) is shared 15/50/35 between the Federal, State and Local tiers.`,
      ],
      warnings,
      jurisdiction: NIGERIA_VAT_NOTE,
      document: {
        format: 'csv',
        filename: 'vat-computation.csv',
        label: 'Computation (CSV)',
        content:
          'Description,Value NGN\r\n' +
          `VAT rate (%),${breakdown.rate}\r\n` +
          `Product amount (net),${breakdown.net.toFixed(2)}\r\n` +
          `VAT amount,${breakdown.vat.toFixed(2)}\r\n` +
          `Gross amount,${breakdown.gross.toFixed(2)}\r\n` +
          `FIRS collection fee (4%),${dist.firsCollectionFee.toFixed(2)}\r\n` +
          `Federal Government net,${dist.federalNet.toFixed(2)}\r\n` +
          `FCT Abuja Administration,${dist.fctAbuja.toFixed(2)}\r\n` +
          `36 State Governments (50%),${dist.stateGovernments.toFixed(2)}\r\n` +
          `774 Local Governments (35%),${dist.localGovernments.toFixed(2)}\r\n`,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* 4. Employer Cost Calculator                                         */
/* ------------------------------------------------------------------ */

export interface EmployerCostBreakdown {
  annualGross: number;
  monthlyGross: number;
  basic: number;
  housing: number;
  transport: number;
  pensionable: number;
  employerPension: number;
  nsitf: number;
  groupLife: number;
  itf: number;
  employerNhis: number;
  statutoryTotal: number;
  hmoAnnual: number;
  perksAnnual: number;
  benefitsTotal: number;
  officeRentAnnual: number;
  internetAnnual: number;
  powerAnnual: number;
  workspaceTotal: number;
  equipmentOneOff: number;
  recruitmentOneOff: number;
  oneOffTotal: number;
  trainingAnnual: number;
  bonusAnnual: number;
  developmentTotal: number;
  overheadTotal: number;
  totalAnnualCost: number;
  totalMonthlyCost: number;
  overheadMultiplier: number;
  overheadPercentage: number;
  baseSalaryShare: number;
  overheadShare: number;
}

export function computeEmployerCost(values: BusinessToolInput): EmployerCostBreakdown {
  const num = (key: string, fallback = 0): number => {
    const parsed = toNumber(values[key]);
    const value = parsed === null ? fallback : parsed;
    return Number.isFinite(value) ? Math.max(0, value) : fallback;
  };

  const salaryPeriod = toText(values['salaryPeriod']) === 'annual' ? 'annual' : 'monthly';
  const enteredGross = num('grossAmount');
  const annualGross = salaryPeriod === 'annual' ? enteredGross : enteredGross * 12;

  const basicPct = num('basicPct', 50);
  const housingPct = num('housingPct', 30);
  const transportPct = num('transportPct', 20);

  const basic = (annualGross * basicPct) / 100;
  const housing = (annualGross * housingPct) / 100;
  const transport = (annualGross * transportPct) / 100;
  const pensionable = basic + housing + transport;

  const employerPension = (pensionable * num('employerPensionPct', 10)) / 100;
  const nsitf = (annualGross * num('nsitfPct', 1)) / 100;
  const groupLife = (annualGross * num('groupLifePct', 1.5)) / 100;
  const itf = toBoolean(values['applyItf']) ? (annualGross * num('itfPct', 1)) / 100 : 0;
  const employerNhis = toBoolean(values['applyEmployerNhis'])
    ? (basic * num('employerNhisPct', 10)) / 100
    : 0;
  const statutoryTotal = employerPension + nsitf + groupLife + itf + employerNhis;

  const hmoAnnual = num('monthlyHmo') * 12;
  const perksAnnual = num('monthlyPerks') * 12;
  const benefitsTotal = hmoAnnual + perksAnnual;

  const officeRentAnnual = num('monthlyOfficeRent') * 12;
  const internetAnnual = num('monthlyInternet') * 12;
  const powerAnnual = num('monthlyPower') * 12;
  const workspaceTotal = officeRentAnnual + internetAnnual + powerAnnual;

  const equipmentOneOff = num('equipmentOneOff');
  const recruitmentOneOff = num('recruitmentOneOff');
  const oneOffTotal = equipmentOneOff + recruitmentOneOff;

  const trainingAnnual = num('annualTraining');
  const bonusAnnual = num('annualBonus');
  const developmentTotal = trainingAnnual + bonusAnnual;

  const overheadTotal = statutoryTotal + benefitsTotal + workspaceTotal + oneOffTotal + developmentTotal;
  const totalAnnualCost = annualGross + overheadTotal;

  return {
    annualGross: round(annualGross, 2),
    monthlyGross: round(annualGross / 12, 2),
    basic: round(basic, 2),
    housing: round(housing, 2),
    transport: round(transport, 2),
    pensionable: round(pensionable, 2),
    employerPension: round(employerPension, 2),
    nsitf: round(nsitf, 2),
    groupLife: round(groupLife, 2),
    itf: round(itf, 2),
    employerNhis: round(employerNhis, 2),
    statutoryTotal: round(statutoryTotal, 2),
    hmoAnnual: round(hmoAnnual, 2),
    perksAnnual: round(perksAnnual, 2),
    benefitsTotal: round(benefitsTotal, 2),
    officeRentAnnual: round(officeRentAnnual, 2),
    internetAnnual: round(internetAnnual, 2),
    powerAnnual: round(powerAnnual, 2),
    workspaceTotal: round(workspaceTotal, 2),
    equipmentOneOff: round(equipmentOneOff, 2),
    recruitmentOneOff: round(recruitmentOneOff, 2),
    oneOffTotal: round(oneOffTotal, 2),
    trainingAnnual: round(trainingAnnual, 2),
    bonusAnnual: round(bonusAnnual, 2),
    developmentTotal: round(developmentTotal, 2),
    overheadTotal: round(overheadTotal, 2),
    totalAnnualCost: round(totalAnnualCost, 2),
    totalMonthlyCost: round(totalAnnualCost / 12, 2),
    overheadMultiplier: annualGross > 0 ? round(totalAnnualCost / annualGross, 2) : 0,
    overheadPercentage: annualGross > 0 ? round(((totalAnnualCost - annualGross) / annualGross) * 100, 0) : 0,
    baseSalaryShare: totalAnnualCost > 0 ? round((annualGross / totalAnnualCost) * 100, 0) : 0,
    overheadShare: totalAnnualCost > 0 ? round((overheadTotal / totalAnnualCost) * 100, 0) : 0,
  };
}

export function computeEmployerCostCalculator(values: BusinessToolInput): BusinessToolOutcome {
  const gross = toNumber(values['grossAmount']);
  if (gross === null) {
    return {
      ok: false,
      error: failure('Enter the gross salary for this role.', [
        { key: 'grossAmount', message: 'Gross amount is required and must be a number.' },
      ]),
    };
  }
  if (gross <= 0) {
    return {
      ok: false,
      error: failure('The gross salary must be greater than zero — the overhead multiplier divides by it.', [
        { key: 'grossAmount', message: 'Must be greater than zero.' },
      ]),
    };
  }

  const structurePct =
    (toNumber(values['basicPct']) ?? 50) + (toNumber(values['housingPct']) ?? 30) + (toNumber(values['transportPct']) ?? 20);
  if (Math.abs(structurePct - 100) > 0.01) {
    return {
      ok: false,
      error: failure(
        `Basic, housing and transport percentages must total 100% (currently ${formatPercent(structurePct)}), because pension is charged on their sum.`,
        [{ key: 'basicPct', message: `Components total ${formatPercent(structurePct)}, not 100%.` }]
      ),
    };
  }

  const cost = computeEmployerCost(values);
  const warnings: string[] = [];
  if (!toBoolean(values['applyItf'])) {
    warnings.push(
      'The ITF training levy is switched off. It applies to companies with 5 or more staff or turnover above ₦50M — switch it on if either threshold is met.'
    );
  }
  if (!toBoolean(values['applyEmployerNhis'])) {
    warnings.push(
      'Employer NHIS health cover is switched off. It is modelled here for statutory public-sector structures; private employers usually budget an HMO premium instead (section 3).'
    );
  }
  if (cost.oneOffTotal > 0) {
    warnings.push(
      `One-off costs of ${formatMoney(cost.oneOffTotal)} are included in the annual total. They are incurred once, not every year — a multi-year view divides them across the tenure you expect.`
    );
  }

  const metrics: ResultMetric[] = [
    {
      label: 'Total annual cost (true cost)',
      value: formatMoney(cost.totalAnnualCost),
      emphasis: 'primary',
      hint: `Monthly equivalent: ${formatMoney(cost.totalMonthlyCost)}/mo`,
    },
    {
      label: 'Overhead multiplier',
      value: formatMultiplier(cost.overheadMultiplier),
      emphasis: 'primary',
      hint: `This role costs the business ${formatPercent(cost.overheadPercentage, 0)} more than its raw gross salary`,
    },
    { label: 'Gross salary (annual)', value: formatMoney(cost.annualGross), emphasis: 'secondary', hint: `${formatPercent(cost.baseSalaryShare, 0)} of total cost` },
    { label: 'Total overhead (annual)', value: formatMoney(cost.overheadTotal), emphasis: 'secondary', hint: `${formatPercent(cost.overheadShare, 0)} of total cost` },
  ];

  const tables: ResultTable[] = [
    {
      title: 'Cost breakdown',
      columns: ['Group', 'Annual (₦)'],
      rows: [
        { label: 'Gross base salary', cells: [formatAmount(cost.annualGross)], emphasis: 'total' },
        { label: '· Basic component', cells: [formatAmount(cost.basic)], emphasis: 'muted' },
        { label: '· Housing allowance', cells: [formatAmount(cost.housing)], emphasis: 'muted' },
        { label: '· Transport allowance', cells: [formatAmount(cost.transport)], emphasis: 'muted' },
        { label: 'Statutory obligations', cells: [formatAmount(cost.statutoryTotal)], emphasis: 'total' },
        { label: '· Employer pension', cells: [formatAmount(cost.employerPension)], emphasis: 'muted' },
        { label: '· NSITF employees\u2019 compensation levy', cells: [formatAmount(cost.nsitf)], emphasis: 'muted' },
        { label: '· Group life insurance premium', cells: [formatAmount(cost.groupLife)], emphasis: 'muted' },
        { label: '· ITF training levy', cells: [formatAmount(cost.itf)], emphasis: 'muted', hint: cost.itf === 0 ? 'Switched off' : undefined },
        { label: '· Employer NHIS cover', cells: [formatAmount(cost.employerNhis)], emphasis: 'muted', hint: cost.employerNhis === 0 ? 'Switched off' : undefined },
        { label: 'Benefits & insurance', cells: [formatAmount(cost.benefitsTotal)], emphasis: 'total' },
        { label: '· HMO premiums', cells: [formatAmount(cost.hmoAnnual)], emphasis: 'muted' },
        { label: '· Other perks', cells: [formatAmount(cost.perksAnnual)], emphasis: 'muted' },
        { label: 'Workspace & tools', cells: [formatAmount(cost.workspaceTotal)], emphasis: 'total' },
        { label: '· Office space allotment', cells: [formatAmount(cost.officeRentAnnual)], emphasis: 'muted' },
        { label: '· Internet & data allowance', cells: [formatAmount(cost.internetAnnual)], emphasis: 'muted' },
        { label: '· Power / fuel stipend', cells: [formatAmount(cost.powerAnnual)], emphasis: 'muted' },
        { label: 'Recruiting & development', cells: [formatAmount(cost.developmentTotal + cost.recruitmentOneOff)], emphasis: 'total' },
        { label: '· Recruitment / agency commission (one-off)', cells: [formatAmount(cost.recruitmentOneOff)], emphasis: 'muted' },
        { label: '· Training & upskilling stipend', cells: [formatAmount(cost.trainingAnnual)], emphasis: 'muted' },
        { label: '· Performance bonus / 13th month', cells: [formatAmount(cost.bonusAnnual)], emphasis: 'muted' },
        { label: 'One-off technology', cells: [formatAmount(cost.equipmentOneOff)], emphasis: 'muted' },
        { label: 'Total annual cost', cells: [formatAmount(cost.totalAnnualCost)], emphasis: 'total' },
      ],
    },
  ];

  return {
    ok: true,
    result: {
      metrics,
      tables,
      explanation: [
        `Annual gross = ${formatMoney(cost.annualGross)} (${toText(values['salaryPeriod']) === 'annual' ? 'entered annually' : 'monthly figure × 12'}).`,
        `Pensionable earnings = basic + housing + transport = ${formatMoney(cost.pensionable)}; employer pension = ${formatMoney(cost.employerPension)}.`,
        `NSITF (1% of gross) = ${formatMoney(cost.nsitf)}; group life (1.5% of gross) = ${formatMoney(cost.groupLife)}.`,
        `Total overhead = statutory + benefits + workspace + one-off + development = ${formatMoney(cost.overheadTotal)}.`,
        `Overhead multiplier = ${formatMoney(cost.totalAnnualCost)} ÷ ${formatMoney(cost.annualGross)} = ${formatMultiplier(cost.overheadMultiplier)}.`,
      ],
      warnings,
      jurisdiction: NIGERIA_EMPLOYER_COST_NOTE,
      document: {
        format: 'csv',
        filename: 'employer-cost-breakdown.csv',
        label: 'Cost breakdown (CSV)',
        content:
          'Group,Item,Annual NGN\r\n' +
          `Salary,Gross base salary,${cost.annualGross.toFixed(2)}\r\n` +
          `Statutory,Employer pension,${cost.employerPension.toFixed(2)}\r\n` +
          `Statutory,NSITF levy,${cost.nsitf.toFixed(2)}\r\n` +
          `Statutory,Group life premium,${cost.groupLife.toFixed(2)}\r\n` +
          `Statutory,ITF training levy,${cost.itf.toFixed(2)}\r\n` +
          `Statutory,Employer NHIS,${cost.employerNhis.toFixed(2)}\r\n` +
          `Benefits,HMO premiums,${cost.hmoAnnual.toFixed(2)}\r\n` +
          `Benefits,Other perks,${cost.perksAnnual.toFixed(2)}\r\n` +
          `Workspace,Office space,${cost.officeRentAnnual.toFixed(2)}\r\n` +
          `Workspace,Internet and data,${cost.internetAnnual.toFixed(2)}\r\n` +
          `Workspace,Power and fuel,${cost.powerAnnual.toFixed(2)}\r\n` +
          `One-off,Equipment and workstation,${cost.equipmentOneOff.toFixed(2)}\r\n` +
          `One-off,Recruitment commission,${cost.recruitmentOneOff.toFixed(2)}\r\n` +
          `Development,Training stipend,${cost.trainingAnnual.toFixed(2)}\r\n` +
          `Development,Performance bonus,${cost.bonusAnnual.toFixed(2)}\r\n` +
          `Totals,Total overhead,${cost.overheadTotal.toFixed(2)}\r\n` +
          `Totals,Total annual cost,${cost.totalAnnualCost.toFixed(2)}\r\n` +
          `Totals,Overhead multiplier,${cost.overheadMultiplier.toFixed(2)}\r\n`,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* 5. EWA ROI Calculator                                               */
/* ------------------------------------------------------------------ */

export const EWA_DEFAULT_TURNOVER_REDUCTION_PCT = 20;

export interface EwaRoiBreakdown {
  employees: number;
  averageAnnualSalary: number;
  turnoverRatePct: number;
  replacementCostPct: number;
  turnoverReductionPct: number;
  annualProgrammeCost: number;
  resignationsPerYear: number;
  averageReplacementCost: number;
  currentAttritionCost: number;
  projectedTurnoverRatePct: number;
  projectedResignationsPerYear: number;
  projectedAttritionCost: number;
  retainedStaffPerYear: number;
  annualSavings: number;
  netBenefit: number;
  roiPercent: number | null;
  paybackMonths: number | null;
}

export function computeEwaRoi(values: BusinessToolInput): EwaRoiBreakdown {
  const num = (key: string, fallback: number): number => {
    const parsed = toNumber(values[key]);
    const value = parsed === null ? fallback : parsed;
    return Number.isFinite(value) ? Math.max(0, value) : fallback;
  };

  const employees = num('totalEmployees', 100);
  const averageAnnualSalary = num('averageAnnualSalary', 3_600_000);
  const turnoverRatePct = num('turnoverRatePct', 20);
  const replacementCostPct = num('replacementCostPct', 33);
  const turnoverReductionPct = num('turnoverReductionPct', EWA_DEFAULT_TURNOVER_REDUCTION_PCT);
  const annualProgrammeCost = num('annualProgrammeCost', 0);

  const resignations = (employees * turnoverRatePct) / 100;
  const replacementCost = (averageAnnualSalary * replacementCostPct) / 100;
  const currentCost = resignations * replacementCost;

  const cappedReduction = Math.min(100, turnoverReductionPct);
  const projectedTurnoverRatePct = turnoverRatePct * (1 - cappedReduction / 100);
  const projectedResignations = (employees * projectedTurnoverRatePct) / 100;
  const projectedCost = projectedResignations * replacementCost;

  const savings = currentCost - projectedCost;
  const netBenefit = savings - annualProgrammeCost;

  return {
    employees: round(employees, 2),
    averageAnnualSalary: round(averageAnnualSalary, 2),
    turnoverRatePct: round(turnoverRatePct, 2),
    replacementCostPct: round(replacementCostPct, 2),
    turnoverReductionPct: round(cappedReduction, 2),
    annualProgrammeCost: round(annualProgrammeCost, 2),
    resignationsPerYear: round(resignations, 2),
    averageReplacementCost: round(replacementCost, 2),
    currentAttritionCost: round(currentCost, 2),
    projectedTurnoverRatePct: round(projectedTurnoverRatePct, 2),
    projectedResignationsPerYear: round(projectedResignations, 2),
    projectedAttritionCost: round(projectedCost, 2),
    retainedStaffPerYear: round(resignations - projectedResignations, 2),
    annualSavings: round(savings, 2),
    netBenefit: round(netBenefit, 2),
    // A zero-cost programme has an undefined ratio: dividing by zero is not "infinite return",
    // it is a question the model cannot answer. Reported as null and explained in the UI.
    roiPercent: annualProgrammeCost > 0 ? round((netBenefit / annualProgrammeCost) * 100, 2) : null,
    paybackMonths: netBenefit > 0 && annualProgrammeCost > 0
      ? round((annualProgrammeCost / (netBenefit + annualProgrammeCost)) * 12, 1)
      : null,
  };
}

export function computeEwaRoiCalculator(values: BusinessToolInput): BusinessToolOutcome {
  const employees = toNumber(values['totalEmployees']);
  const salary = toNumber(values['averageAnnualSalary']);
  const turnover = toNumber(values['turnoverRatePct']);
  const replacement = toNumber(values['replacementCostPct']);
  const reduction = toNumber(values['turnoverReductionPct']);

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (employees === null) fieldErrors.push({ key: 'totalEmployees', message: 'Total employees is required.' });
  if (salary === null) fieldErrors.push({ key: 'averageAnnualSalary', message: 'Average annual salary is required.' });
  if (turnover === null) fieldErrors.push({ key: 'turnoverRatePct', message: 'Turnover rate is required.' });
  if (replacement === null) fieldErrors.push({ key: 'replacementCostPct', message: 'Replacement cost percentage is required.' });
  if (reduction === null) fieldErrors.push({ key: 'turnoverReductionPct', message: 'Expected turnover reduction is required.' });
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Complete the workforce inputs before calculating.') };
  }

  const e = employees as number;
  const s = salary as number;
  const t = turnover as number;
  const rp = replacement as number;
  const rd = reduction as number;

  if (e <= 0) {
    return { ok: false, error: failure('Headcount must be at least 1.', [{ key: 'totalEmployees', message: 'Must be 1 or more.' }]) };
  }
  if (s <= 0) {
    return { ok: false, error: failure('Average annual salary must be greater than zero.', [{ key: 'averageAnnualSalary', message: 'Must be greater than zero.' }]) };
  }
  if (t < 0 || t > 100) {
    return { ok: false, error: failure('Turnover rate must be between 0% and 100%.', [{ key: 'turnoverRatePct', message: 'Must be between 0 and 100.' }]) };
  }
  if (rp < 0 || rp > 500) {
    return {
      ok: false,
      error: failure('Replacement cost is expressed as a percentage of annual salary and must be between 0% and 500%.', [
        { key: 'replacementCostPct', message: 'Must be between 0 and 500.' },
      ]),
    };
  }
  if (rd < 0 || rd > 100) {
    return { ok: false, error: failure('Expected turnover reduction must be between 0% and 100%.', [{ key: 'turnoverReductionPct', message: 'Must be between 0 and 100.' }]) };
  }

  const roi = computeEwaRoi(values);
  const warnings: string[] = [];
  if (t === 0) {
    warnings.push('A turnover rate of 0% means no attrition cost, so the programme cannot save anything on this model.');
  }
  if (rd === 0) {
    warnings.push('A 0% expected turnover reduction produces zero savings. Enter the improvement you actually expect.');
  }
  if (roi.annualProgrammeCost === 0) {
    warnings.push(
      'Programme cost is ₦0, so a return-on-investment ratio cannot be computed — dividing by zero is undefined, not infinite. Enter the annual cost your provider charges the employer to get a finite ROI.'
    );
  } else if (roi.netBenefit <= 0) {
    warnings.push(
      `At these inputs the programme costs more than it saves (net ${formatMoney(roi.netBenefit)}). That is a legitimate result, not an error.`
    );
  }
  if (rd > EWA_DEFAULT_TURNOVER_REDUCTION_PCT) {
    warnings.push(
      `The expected turnover reduction of ${formatPercent(rd)} exceeds the ${formatPercent(EWA_DEFAULT_TURNOVER_REDUCTION_PCT)} cited by the published retention research for this model. Treat the savings as optimistic.`
    );
  }

  const metrics: ResultMetric[] = [
    {
      label: 'Projected annual savings',
      value: formatMoney(roi.annualSavings),
      emphasis: 'primary',
      hint: `Retained staff: +${formatHeadcount(roi.retainedStaffPerYear)} employees/year`,
    },
    {
      label: 'Net return on investment',
      value: roi.roiPercent === null ? 'Not computable (₦0 cost)' : formatPercent(roi.roiPercent),
      emphasis: 'primary',
      hint: roi.roiPercent === null
        ? 'Enter an annual programme cost to compute a ratio'
        : `(savings − cost) ÷ cost`,
    },
    { label: 'Net annual benefit', value: formatMoney(roi.netBenefit), emphasis: 'secondary', hint: 'Savings less programme cost' },
    { label: 'Current annual attrition cost', value: formatMoney(roi.currentAttritionCost), emphasis: 'muted' },
  ];

  const tables: ResultTable[] = [
    {
      title: 'Attrition model',
      columns: ['Measure', 'Before EWA', 'With EWA'],
      rows: [
        { label: 'Turnover rate', cells: [formatPercent(roi.turnoverRatePct), formatPercent(roi.projectedTurnoverRatePct)] },
        { label: 'Resignations per year', cells: [formatHeadcount(roi.resignationsPerYear), formatHeadcount(roi.projectedResignationsPerYear)] },
        { label: 'Average replacement cost', cells: [formatAmount(roi.averageReplacementCost), formatAmount(roi.averageReplacementCost)], hint: `${formatPercent(roi.replacementCostPct)} of average annual salary` },
        { label: 'Annual attrition cost', cells: [formatAmount(roi.currentAttritionCost), formatAmount(roi.projectedAttritionCost)], emphasis: 'total' },
        { label: 'Annual programme cost', cells: ['—', formatAmount(roi.annualProgrammeCost)] },
        { label: 'Annual savings', cells: ['—', formatAmount(roi.annualSavings)], emphasis: 'total' },
      ],
      caption: `Modelled on ${formatInteger(roi.employees)} employees at an average annual salary of ${formatMoney(roi.averageAnnualSalary)}.`,
    },
  ];

  return {
    ok: true,
    result: {
      metrics,
      tables,
      explanation: [
        `Resignations per year = ${formatInteger(roi.employees)} employees × ${formatPercent(roi.turnoverRatePct)} = ${formatHeadcount(roi.resignationsPerYear)}.`,
        `Average replacement cost = ${formatMoney(roi.averageAnnualSalary)} × ${formatPercent(roi.replacementCostPct)} = ${formatMoney(roi.averageReplacementCost)}.`,
        `Current annual attrition cost = ${formatHeadcount(roi.resignationsPerYear)} × ${formatMoney(roi.averageReplacementCost)} = ${formatMoney(roi.currentAttritionCost)}.`,
        `Projected turnover = ${formatPercent(roi.turnoverRatePct)} × (1 − ${formatPercent(roi.turnoverReductionPct)}) = ${formatPercent(roi.projectedTurnoverRatePct)}, i.e. ${formatHeadcount(roi.projectedResignationsPerYear)} resignations and ${formatMoney(roi.projectedAttritionCost)}.`,
        `Projected annual savings = ${formatMoney(roi.currentAttritionCost)} − ${formatMoney(roi.projectedAttritionCost)} = ${formatMoney(roi.annualSavings)}.`,
        roi.roiPercent === null
          ? 'ROI is undefined at a ₦0 programme cost: the ratio divides net benefit by cost, and division by zero has no value.'
          : `ROI = (${formatMoney(roi.annualSavings)} − ${formatMoney(roi.annualProgrammeCost)}) ÷ ${formatMoney(roi.annualProgrammeCost)} = ${formatPercent(roi.roiPercent)}.`,
      ],
      warnings,
      jurisdiction: EWA_ROI_NOTE,
      document: {
        format: 'csv',
        filename: 'ewa-roi-analysis.csv',
        label: 'Retention savings report (CSV)',
        content:
          'Measure,Value\r\n' +
          `Total employees,${formatInteger(roi.employees)}\r\n` +
          `Average annual salary NGN,${roi.averageAnnualSalary.toFixed(2)}\r\n` +
          `Turnover rate %,${roi.turnoverRatePct.toFixed(2)}\r\n` +
          `Replacement cost % of salary,${roi.replacementCostPct.toFixed(2)}\r\n` +
          `Expected turnover reduction %,${roi.turnoverReductionPct.toFixed(2)}\r\n` +
          `Resignations per year (before),${roi.resignationsPerYear.toFixed(2)}\r\n` +
          `Average replacement cost NGN,${roi.averageReplacementCost.toFixed(2)}\r\n` +
          `Annual attrition cost before NGN,${roi.currentAttritionCost.toFixed(2)}\r\n` +
          `Projected turnover rate %,${roi.projectedTurnoverRatePct.toFixed(2)}\r\n` +
          `Resignations per year (with EWA),${roi.projectedResignationsPerYear.toFixed(2)}\r\n` +
          `Annual attrition cost with EWA NGN,${roi.projectedAttritionCost.toFixed(2)}\r\n` +
          `Retained staff per year,${roi.retainedStaffPerYear.toFixed(2)}\r\n` +
          `Annual programme cost NGN,${roi.annualProgrammeCost.toFixed(2)}\r\n` +
          `Projected annual savings NGN,${roi.annualSavings.toFixed(2)}\r\n` +
          `Net annual benefit NGN,${roi.netBenefit.toFixed(2)}\r\n` +
          `ROI %,${roi.roiPercent === null ? 'undefined (zero cost)' : roi.roiPercent.toFixed(2)}\r\n`,
      },
    },
  };
}
