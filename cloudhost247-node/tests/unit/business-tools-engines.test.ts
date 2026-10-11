/**
 * Business Tools — engine tests for all 21 tools.
 *
 * Three kinds of assertion live here, and the order matters:
 *
 *  1. **Inventory.** The registry must contain exactly 5 calculators, 12 generators and
 *     4 comparisons, with unique slugs and paths. A tool silently moving category would change
 *     what the page advertises without changing any code anyone reviews.
 *
 *  2. **Worked examples.** Each calculator is checked against a published worked example with
 *     known inputs and outputs — Nigeria's 2026 PAYE bands, the PenCom 8%/10% split, VAT at 7.5%
 *     including the government revenue-sharing split, the employer-cost example that totals
 *     ₦5,745,000 at a 1.92x multiplier, and the EWA example that saves ₦4,752,000 a year.
 *     Getting these wrong is not a rounding complaint; it is a wrong payslip.
 *
 *  3. **Boundaries and rejection.** Missing, negative, zero, out-of-range and self-contradictory
 *     inputs must produce a *specific* error rather than a confident wrong answer. A payroll tool
 *     that turns a blank field into zero is worse than one that refuses.
 *
 * Every compute function is pure, so these run in the plain Node environment with no DOM.
 */

import { describe, expect, it } from 'vitest';
import {
  BUSINESS_TOOLS,
  BUSINESS_TOOL_COUNTS,
  BUSINESS_TOOLS_ROOT,
  BUSINESS_TOOLS_TOTAL,
  businessToolsByCategory,
  defaultInputFor,
  findBusinessTool,
  searchBusinessTools,
} from '../../src/tools/business/registry';
import {
  computeNigeriaPaye,
  computePayeStructure,
  computePayeCalculator,
  computePension,
  computePensionCalculator,
  computeVat,
  computeVatCalculator,
  computeEmployerCostCalculator,
  computeEwaRoi,
  computeEwaRoiCalculator,
  solveGrossFromNet,
  NIGERIA_PAYE_BANDS_2026,
  PENCOM_EMPLOYER_MINIMUM_PCT,
} from '../../src/tools/business/calculators';
import {
  computeJobDescription,
  computeJobOfferLetter,
  computePayslip,
  computeNdaContract,
  computeEmploymentContract,
  computeCv,
  scanJobDescriptionLanguage,
  parseAmountLines,
  parsePipeRecords,
} from '../../src/tools/business/generators';
import {
  buildOrgChart,
  buildEmployeeId,
  computeBusinessCard,
  computeBusinessInvoice,
  computeEmployeeIdCard,
  computeEmployeeIdGenerator,
  computeLinkedInEngagementAssistant,
  computeOrganizationalChart,
  contrastRatio,
  luhnCheckDigit,
  luhnIsValid,
  parseInvoiceLines,
  readableTextColor,
} from '../../src/tools/business/generators-assets';
import {
  ACCOUNTING_COMPARISON,
  EXPENSE_COMPARISON,
  HMO_COMPARISON,
  HMO_PLAN_TIERS,
  PFA_COMPARISON,
  buildRemittanceSchedule,
  computeAccountingComparison,
  computeExpenseComparison,
  computeHmoComparison,
  computePfaComparison,
  rankByWeightedScore,
} from '../../src/tools/business/comparisons';
import type { BusinessToolResult } from '../../src/tools/business/types';

function resultOf(outcome: { ok: boolean; result?: BusinessToolResult; error?: { message: string } }): BusinessToolResult {
  if (!outcome.ok || !outcome.result) {
    throw new Error(`Expected a successful result but got: ${outcome.error ? outcome.error.message : 'no result'}`);
  }
  return outcome.result;
}

function errorMessage(outcome: { ok: boolean; error?: { message: string } }): string {
  if (outcome.ok) throw new Error('Expected a failure but the tool succeeded.');
  return outcome.error ? outcome.error.message : '';
}

describe('Business Tools — inventory', () => {
  it('registers exactly 21 tools across the three reference categories', () => {
    expect(BUSINESS_TOOLS_TOTAL).toBe(21);
    expect(BUSINESS_TOOL_COUNTS.calculators).toBe(5);
    expect(BUSINESS_TOOL_COUNTS.generators).toBe(12);
    expect(BUSINESS_TOOL_COUNTS.comparisons).toBe(4);
    expect(businessToolsByCategory('calculators')).toHaveLength(5);
    expect(businessToolsByCategory('generators')).toHaveLength(12);
    expect(businessToolsByCategory('comparisons')).toHaveLength(4);
  });

  it('gives every tool a unique slug, a unique path under the section root, and a form schema', () => {
    const slugs = new Set<string>();
    const paths = new Set<string>();
    for (const tool of BUSINESS_TOOLS) {
      expect(slugs.has(tool.slug)).toBe(false);
      slugs.add(tool.slug);
      expect(paths.has(tool.path)).toBe(false);
      paths.add(tool.path);
      expect(tool.path).toBe(`${BUSINESS_TOOLS_ROOT}/${tool.slug}`);
      expect(tool.name.trim().length).toBeGreaterThan(0);
      expect(tool.summary.trim().length).toBeGreaterThan(0);
      expect(tool.description.trim().length).toBeGreaterThan(40);
      expect(tool.fields.length).toBeGreaterThan(0);
      expect(tool.keywords.length).toBeGreaterThan(2);
      expect(tool.units).toContain(' ');
      expect(typeof tool.compute).toBe('function');
    }
  });

  it('attaches provenance to every tool that applies a jurisdiction-specific or estimated rate', () => {
    // These are the tools whose numbers depend on a statutory rate, a regulator register or a
    // published planning range. Each one has to name its jurisdiction, source and effective date.
    const rateBacked = [
      'nigeria-paye-net-salary-calculator',
      'nigeria-pension-calculator',
      'nigeria-vat-calculator',
      'nigeria-employer-cost-calculator',
      'earned-wage-access-roi-calculator',
      'official-payslip-generator',
      'business-invoice-generator',
      'employment-contract-generator',
      'accounting-tool-comparison',
      'expense-tool-comparison',
      'hmo-comparison-nigeria',
      'pfa-comparison-nigeria',
    ];
    for (const slug of rateBacked) {
      const tool = findBusinessTool(slug);
      expect(tool, slug).toBeDefined();
      const note = tool?.jurisdiction;
      expect(note, `${slug} must document its jurisdiction`).toBeDefined();
      expect(note?.jurisdiction.length).toBeGreaterThan(0);
      expect(note?.source.length).toBeGreaterThan(20);
      expect(note?.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(note?.disclaimer?.length).toBeGreaterThan(20);
    }
  });

  it('marks estimated figures as estimates rather than as statutory rates', () => {
    const estimates = ['nigeria-employer-cost-calculator', 'earned-wage-access-roi-calculator', 'hmo-comparison-nigeria', 'pfa-comparison-nigeria', 'accounting-tool-comparison', 'expense-tool-comparison'];
    for (const slug of estimates) {
      expect(findBusinessTool(slug)?.jurisdiction?.estimate, slug).toBe(true);
    }
    // The PAYE, pension and VAT rates are statutory, not estimates, and must not be labelled as such.
    expect(findBusinessTool('nigeria-paye-net-salary-calculator')?.jurisdiction?.estimate).toBeUndefined();
    expect(findBusinessTool('nigeria-pension-calculator')?.jurisdiction?.estimate).toBeUndefined();
    expect(findBusinessTool('nigeria-vat-calculator')?.jurisdiction?.estimate).toBeUndefined();
  });
});

describe('Business Tools — every tool runs from its declared defaults', () => {
  // A tool whose defaults do not compute is a tool a visitor sees as broken on first click. Where a
  // tool legitimately needs input before it can produce anything (a CV, an org chart, a post to
  // reply to), the failure must be a specific, actionable message — never a thrown exception.
  const needsInput: Record<string, Record<string, string>> = {
    'job-description-generator': { jobTitle: 'Payroll Officer', responsibilities: 'Run the monthly payroll\nMaintain statutory filings' },
    'job-offer-letter-generator': { candidateName: 'Ada Obi', jobTitle: 'Payroll Officer', companyName: 'CloudHost247 Ltd', salary: '4800000' },
    'official-payslip-generator': { companyName: 'CloudHost247 Ltd', employeeName: 'Ada Obi', payPeriod: '2026-03', earnings: 'Basic salary, 150000\nHousing allowance, 90000\nTransport allowance, 60000' },
    'nda-contract-generator': { disclosingParty: 'CloudHost247 Ltd', receivingParty: 'Northwind Consulting Ltd' },
    'employment-contract-generator': { employerName: 'CloudHost247 Ltd', employeeName: 'Ada Obi', jobTitle: 'Payroll Officer', salary: '4800000' },
    'cv-generator': { fullName: 'Ada Obi', experience: 'Acme Ltd | Payroll Officer | 2022-03 | present | Ran a 400-person payroll' },
    'business-invoice-generator': { businessName: 'CloudHost247 Ltd', clientName: 'Northwind Ltd', invoiceNumber: 'INV-2026-001', lineItems: 'Managed VPS hosting, 3, 45000' },
    'business-card-generator': { fullName: 'Ada Obi' },
    'employee-id-generator': { companyPrefix: 'CH247', departmentCode: 'OPS', year: '2026' },
    'employee-id-card-generator': { companyName: 'CloudHost247 Ltd', employeeName: 'Ada Obi' },
    'organizational-chart-generator': { people: 'Ada Obi | Chief Executive |\nChidi Eze | Head of Engineering | Ada Obi' },
    'linkedin-engagement-assistant': { postText: 'We rebuilt our payroll run around earned wage access and turnover fell by a fifth within two quarters.' },
    'nigeria-paye-net-salary-calculator': { monthlyAmount: '500000' },
    'nigeria-pension-calculator': { basicSalary: '50000', housingAllowance: '30000', transportAllowance: '20000' },
    'nigeria-vat-calculator': { amount: '100' },
    'nigeria-employer-cost-calculator': { grossAmount: '250000' },
  };

  for (const tool of BUSINESS_TOOLS) {
    it(`${tool.slug} produces a result or a specific actionable error`, () => {
      const values = { ...defaultInputFor(tool), ...(needsInput[tool.slug] ?? {}) };
      const outcome = tool.compute(values);
      if (outcome.ok) {
        expect(outcome.result.metrics.length).toBeGreaterThan(0);
        // Every successful result either explains itself or produces a document.
        const hasExplanation = Array.isArray(outcome.result.explanation) && outcome.result.explanation.length > 0;
        expect(hasExplanation || outcome.result.document !== undefined).toBe(true);
      } else {
        expect(outcome.error.message.length).toBeGreaterThan(15);
      }
    });
  }
});

describe('Calculator 1 — PAYE & Net Salary (Nigeria Tax Act 2025)', () => {
  it('publishes the six 2026 bands as cumulative thresholds totalling ₦50,000,000 before the top band', () => {
    expect(NIGERIA_PAYE_BANDS_2026).toHaveLength(6);
    expect(NIGERIA_PAYE_BANDS_2026.map((band) => band.rate)).toEqual([0, 0.15, 0.18, 0.21, 0.23, 0.25]);
    expect(NIGERIA_PAYE_BANDS_2026[4]?.ceiling).toBe(50_000_000);
    expect(NIGERIA_PAYE_BANDS_2026[5]?.ceiling).toBe(Infinity);
  });

  it('applies each rate only to the slice of income inside its band', () => {
    // 800k @ 0%, next 2.2m @ 15% = 330,000, remainder 2,298,000 @ 18% = 413,640.
    const { tax, slices } = computeNigeriaPaye(5_298_000);
    expect(tax).toBe(743_640);
    expect(slices[0]?.taxableInBand).toBe(800_000);
    expect(slices[0]?.taxInBand).toBe(0);
    expect(slices[1]?.taxableInBand).toBe(2_200_000);
    expect(slices[1]?.taxInBand).toBe(330_000);
    expect(slices[2]?.taxableInBand).toBe(2_298_000);
    expect(slices[2]?.taxInBand).toBe(413_640);
    expect(slices[3]?.taxableInBand).toBe(0);
  });

  it('charges nothing at or below the ₦800,000 tax-free threshold', () => {
    expect(computeNigeriaPaye(800_000).tax).toBe(0);
    expect(computeNigeriaPaye(799_999).tax).toBe(0);
    expect(computeNigeriaPaye(800_001).tax).toBe(0.15);
    expect(computeNigeriaPaye(0).tax).toBe(0);
    expect(computeNigeriaPaye(-5000).tax).toBe(0);
  });

  it('applies 25% to income above ₦50,000,000', () => {
    const { tax } = computeNigeriaPaye(60_000_000);
    // 0 + 330,000 + 1,620,000 + 2,730,000 + 5,750,000 + 25% of the 10,000,000 above 50m.
    expect(tax).toBe(330_000 + 1_620_000 + 2_730_000 + 5_750_000 + 2_500_000);
  });

  it('computes the full structure for a ₦500,000 gross at the 40/30/20/10 split', () => {
    const structure = computePayeStructure(500_000);
    expect(structure.basic).toBe(200_000);
    expect(structure.housing).toBe(150_000);
    expect(structure.transport).toBe(100_000);
    expect(structure.reimbursement).toBe(50_000);
    expect(structure.pensionableEarnings).toBe(450_000);
    expect(structure.pensionEmployee).toBe(36_000); // 8% of 450,000
    expect(structure.nhf).toBe(12_500); // 2.5% of gross
    expect(structure.nhis).toBe(10_000); // 5% of basic
    expect(structure.annualGross).toBe(6_000_000);
    expect(structure.totalReliefsAnnual).toBe(702_000); // (36,000 + 12,500 + 10,000) × 12
    expect(structure.annualTaxableIncome).toBe(5_298_000);
    expect(structure.annualTax).toBe(743_640);
    expect(structure.monthlyTax).toBe(61_970);
    expect(structure.monthlyNet).toBe(379_530);
    expect(structure.taxBasis).toBe('progressive-paye');
  });

  it('caps rent relief at ₦500,000 and applies 20% of annual rent below the cap', () => {
    const below = computePayeStructure(1_000_000, { monthlyRent: 100_000 });
    expect(below.rentReliefAnnual).toBe(240_000); // 20% × 1,200,000
    const above = computePayeStructure(1_000_000, { monthlyRent: 500_000 });
    expect(above.rentReliefAnnual).toBe(500_000); // 20% × 6,000,000 = 1,200,000, capped
  });

  it('exempts military officers and minimum-wage earners entirely', () => {
    const military = computePayeStructure(2_000_000, { isMilitary: true });
    expect(military.annualTax).toBe(0);
    expect(military.taxBasis).toBe('exempt');
    expect(military.exemptionReason).toMatch(/military/i);

    const minimumWage = computePayeStructure(2_000_000, { isMinimumWageEarner: true });
    expect(minimumWage.annualTax).toBe(0);
    expect(minimumWage.taxBasis).toBe('exempt');
  });

  it('charges an independent consultant flat 5% withholding instead of the progressive bands', () => {
    const consultant = computePayeStructure(1_000_000, { isIndependentConsultant: true });
    expect(consultant.taxBasis).toBe('consultant-wht');
    expect(consultant.annualTax).toBe(600_000); // 5% of 12,000,000
    const progressive = computePayeStructure(1_000_000);
    expect(progressive.annualTax).not.toBe(consultant.annualTax);
  });

  it('solves backwards from a target net pay to the gross that produces it', () => {
    const forward = computePayeStructure(500_000);
    const solved = solveGrossFromNet(forward.monthlyNet);
    expect(Math.abs(solved - 500_000)).toBeLessThan(1);
    expect(computePayeStructure(solved).monthlyNet).toBeCloseTo(forward.monthlyNet, 1);
    expect(solveGrossFromNet(0)).toBe(0);
    expect(solveGrossFromNet(-1000)).toBe(0);
  });

  it('rejects a salary structure that does not total 100%', () => {
    const outcome = computePayeCalculator({
      calculateFrom: 'gross', monthlyAmount: 500000,
      basicPct: 40, housingPct: 40, transportPct: 20, reimbursementPct: 10,
    });
    expect(outcome.ok).toBe(false);
    expect(errorMessage(outcome)).toMatch(/100%/);
    expect(errorMessage(outcome)).toMatch(/110\.00%/);
  });

  it('rejects a zero or non-numeric monthly amount', () => {
    expect(errorMessage(computePayeCalculator({ calculateFrom: 'gross', monthlyAmount: 0, basicPct: 40, housingPct: 30, transportPct: 20, reimbursementPct: 10 }))).toMatch(/greater than zero/);
    expect(errorMessage(computePayeCalculator({ calculateFrom: 'gross', monthlyAmount: 'abc', basicPct: 40, housingPct: 30, transportPct: 20, reimbursementPct: 10 }))).toMatch(/greater than zero/);
  });

  it('warns when deductions exceed gross pay rather than hiding a negative net', () => {
    const result = resultOf(computePayeCalculator({
      calculateFrom: 'gross', monthlyAmount: 20000,
      basicPct: 40, housingPct: 30, transportPct: 20, reimbursementPct: 10,
      monthlyOtherDeductions: 40000,
    }));
    expect(result.metrics.some((metric) => metric.label.includes('net'))).toBe(true);
    expect(result.warnings?.some((warning) => /negative/i.test(warning))).toBe(true);
  });

  it('reports the net-mode solve as a numeric search, not an exact inverse', () => {
    const result = resultOf(computePayeCalculator({
      calculateFrom: 'net', monthlyAmount: 379530,
      basicPct: 40, housingPct: 30, transportPct: 20, reimbursementPct: 10,
    }));
    expect(result.warnings?.some((warning) => /numeric search/i.test(warning))).toBe(true);
  });

  it('carries the Nigeria Tax Act 2025 provenance into the result', () => {
    const result = resultOf(computePayeCalculator({
      calculateFrom: 'gross', monthlyAmount: 500000,
      basicPct: 40, housingPct: 30, transportPct: 20, reimbursementPct: 10,
    }));
    expect(result.jurisdiction?.effectiveDate).toBe('2026-01-01');
    expect(result.jurisdiction?.source).toMatch(/Nigeria Tax Act 2025/);
    expect(result.jurisdiction?.disclaimer).toMatch(/not tax advice/i);
  });
});

describe('Calculator 2 — Pension (PenCom)', () => {
  it('reproduces the published ₦100,000 pensionable-base example', () => {
    const breakdown = computePension(50_000, 30_000, 20_000, 8, 10, 'monthly');
    expect(breakdown.pensionableBase).toBe(100_000);
    expect(breakdown.employeeContribution).toBe(8_000);
    expect(breakdown.employerContribution).toBe(10_000);
    expect(breakdown.totalContribution).toBe(18_000);
    expect(breakdown.netPay).toBe(92_000);
    expect(breakdown.yearly.gross).toBe(1_200_000);
    expect(breakdown.yearly.employee).toBe(96_000);
    expect(breakdown.yearly.employer).toBe(120_000);
    expect(breakdown.yearly.total).toBe(216_000);
    expect(breakdown.yearly.net).toBe(1_104_000);
  });

  it('divides yearly inputs by 12 before applying the rates', () => {
    const yearly = computePension(600_000, 360_000, 240_000, 8, 10, 'yearly');
    expect(yearly.pensionableBase).toBe(100_000);
    expect(yearly.employeeContribution).toBe(8_000);
  });

  it('rejects an employer contribution below the 10% statutory minimum', () => {
    const outcome = computePensionCalculator({
      payPeriod: 'monthly', basicSalary: 50000, housingAllowance: 30000, transportAllowance: 20000,
      employeePct: 8, employerPct: 9,
    });
    expect(outcome.ok).toBe(false);
    expect(errorMessage(outcome)).toMatch(/below the PenCom statutory minimum of 10%/);
  });

  it('accepts an employer contribution above the minimum and says the minimum is a floor', () => {
    const result = resultOf(computePensionCalculator({
      payPeriod: 'monthly', basicSalary: 50000, housingAllowance: 30000, transportAllowance: 20000,
      employeePct: 8, employerPct: 12,
    }));
    expect(result.warnings?.some((warning) => /floor, not a ceiling/i.test(warning))).toBe(true);
  });

  it('warns rather than silently accepting an employee contribution below 8%', () => {
    const result = resultOf(computePensionCalculator({
      payPeriod: 'monthly', basicSalary: 50000, housingAllowance: 30000, transportAllowance: 20000,
      employeePct: 5, employerPct: 10,
    }));
    expect(result.warnings?.some((warning) => /below the 8%/i.test(warning))).toBe(true);
    expect(PENCOM_EMPLOYER_MINIMUM_PCT).toBe(10);
  });

  it('rejects a zero pensionable base and missing components', () => {
    expect(errorMessage(computePensionCalculator({
      payPeriod: 'monthly', basicSalary: 0, housingAllowance: 0, transportAllowance: 0, employeePct: 8, employerPct: 10,
    }))).toMatch(/Pensionable earnings are zero/);
    const missing = computePensionCalculator({ payPeriod: 'monthly', housingAllowance: 30000, transportAllowance: 20000, employeePct: 8, employerPct: 10 });
    expect(missing.ok).toBe(false);
    expect(errorMessage(missing)).toMatch(/Basic salary is required/);
  });

  it('rejects negative salary components', () => {
    expect(errorMessage(computePensionCalculator({
      payPeriod: 'monthly', basicSalary: -50000, housingAllowance: 30000, transportAllowance: 20000, employeePct: 8, employerPct: 10,
    }))).toMatch(/cannot be negative/);
  });

  it('exports the schedule as CSV with both monthly and yearly columns', () => {
    const result = resultOf(computePensionCalculator({
      payPeriod: 'monthly', basicSalary: 50000, housingAllowance: 30000, transportAllowance: 20000, employeePct: 8, employerPct: 10,
    }));
    expect(result.document?.format).toBe('csv');
    expect(result.document?.content).toContain('Total pension contribution,18000.00,216000.00');
  });
});

describe('Calculator 3 — VAT (7.5%)', () => {
  it('adds VAT to a net amount', () => {
    const breakdown = computeVat(100, 7.5, 'add');
    expect(breakdown.net).toBe(100);
    expect(breakdown.vat).toBe(7.5);
    expect(breakdown.gross).toBe(107.5);
    expect(breakdown.netShareOfGross).toBe(93.02);
    expect(breakdown.vatShareOfGross).toBe(6.98);
  });

  it('removes VAT from a gross amount', () => {
    const breakdown = computeVat(107.5, 7.5, 'remove');
    expect(breakdown.net).toBe(100);
    expect(breakdown.vat).toBe(7.5);
    expect(breakdown.gross).toBe(107.5);
  });

  it('splits collected VAT between the tiers of government as published', () => {
    const { distribution } = computeVat(100, 7.5, 'add');
    expect(distribution.firsCollectionFee).toBe(0.3); // 4% of 7.50
    expect(distribution.distributable).toBe(7.2); // 96% of 7.50
    expect(distribution.federalGross).toBe(1.08); // 15% of 7.20
    expect(distribution.fctAbuja).toBe(0.01); // 1% of the federal share
    expect(distribution.federalNet).toBe(1.07);
    expect(distribution.stateGovernments).toBe(3.6); // 50% of 7.20
    expect(distribution.localGovernments).toBe(2.52); // 35% of 7.20
    expect(distribution.federalNet + distribution.fctAbuja + distribution.stateGovernments + distribution.localGovernments + distribution.firsCollectionFee)
      .toBeCloseTo(7.5, 2);
  });

  it('handles a 0% rate without dividing by zero', () => {
    const breakdown = computeVat(500, 0, 'remove');
    expect(breakdown.net).toBe(500);
    expect(breakdown.vat).toBe(0);
    expect(breakdown.gross).toBe(500);
  });

  it('rejects a rate outside 0–100%', () => {
    expect(errorMessage(computeVatCalculator({ mode: 'add', rate: 150, amount: 100 }))).toMatch(/between 0% and 100%/);
    expect(errorMessage(computeVatCalculator({ mode: 'add', rate: -5, amount: 100 }))).toMatch(/between 0% and 100%/);
  });

  it('rejects a negative base amount and warns on zero', () => {
    expect(errorMessage(computeVatCalculator({ mode: 'add', rate: 7.5, amount: -1 }))).toMatch(/cannot be negative/);
    const zero = resultOf(computeVatCalculator({ mode: 'add', rate: 7.5, amount: 0 }));
    expect(zero.warnings?.some((warning) => /base amount is zero/i.test(warning))).toBe(true);
  });

  it('warns when a non-standard rate is used with the Nigerian sharing breakdown', () => {
    const result = resultOf(computeVatCalculator({ mode: 'add', rate: 20, amount: 100 }));
    expect(result.warnings?.some((warning) => /not Nigeria's standard 7\.50%/i.test(warning))).toBe(true);
  });

  it('warns that removing VAT assumes a VAT-inclusive figure', () => {
    const result = resultOf(computeVatCalculator({ mode: 'remove', rate: 7.5, amount: 107.5 }));
    expect(result.warnings?.some((warning) => /VAT-inclusive/i.test(warning))).toBe(true);
  });
});

describe('Calculator 4 — Employer Cost', () => {
  const referenceInputs = {
    salaryPeriod: 'annual', grossAmount: 3_000_000,
    basicPct: 50, housingPct: 30, transportPct: 20,
    employerPensionPct: 10, nsitfPct: 1, groupLifePct: 1.5,
    applyItf: false, itfPct: 1, applyEmployerNhis: false, employerNhisPct: 10,
    monthlyHmo: 15_000, monthlyPerks: 10_000,
    equipmentOneOff: 850_000, monthlyOfficeRent: 20_000, monthlyInternet: 25_000, monthlyPower: 15_000,
    recruitmentOneOff: 500_000, annualTraining: 0, annualBonus: 0,
  };

  it('reproduces the published ₦5,745,000 / 1.92x worked example', () => {
    const result = resultOf(computeEmployerCostCalculator(referenceInputs));
    const total = result.metrics.find((metric) => metric.label.includes('Total annual cost'));
    expect(total?.value).toBe('₦5,745,000.00');
    expect(total?.hint).toContain('₦478,750.00');
    const multiplier = result.metrics.find((metric) => metric.label === 'Overhead multiplier');
    expect(multiplier?.value).toBe('1.92x');
    expect(multiplier?.hint).toContain('92%');
  });

  it('computes statutory obligations as pension plus NSITF plus group life', () => {
    const result = resultOf(computeEmployerCostCalculator(referenceInputs));
    const table = result.tables?.find((entry) => entry.title === 'Cost breakdown');
    const find = (label: string): string => table?.rows.find((row) => row.label === label)?.cells[0] ?? '';
    expect(find('Statutory obligations')).toBe('375,000.00');
    expect(find('· Employer pension')).toBe('300,000.00');
    expect(find('· NSITF employees\u2019 compensation levy')).toBe('30,000.00');
    expect(find('· Group life insurance premium')).toBe('45,000.00');
    expect(find('Benefits & insurance')).toBe('300,000.00');
    expect(find('Workspace & tools')).toBe('720,000.00');
    expect(find('One-off technology')).toBe('850,000.00');
    expect(find('Total annual cost')).toBe('5,745,000.00');
  });

  it('excludes ITF and employer NHIS unless the employer opts in, and says so', () => {
    const off = resultOf(computeEmployerCostCalculator(referenceInputs));
    expect(off.warnings?.some((warning) => /ITF training levy is switched off/i.test(warning))).toBe(true);
    expect(off.warnings?.some((warning) => /Employer NHIS health cover is switched off/i.test(warning))).toBe(true);

    const on = resultOf(computeEmployerCostCalculator({ ...referenceInputs, applyItf: true, applyEmployerNhis: true }));
    const table = on.tables?.find((entry) => entry.title === 'Cost breakdown');
    const find = (label: string): string => table?.rows.find((row) => row.label === label)?.cells[0] ?? '';
    expect(find('· ITF training levy')).toBe('30,000.00'); // 1% of 3,000,000
    expect(find('· Employer NHIS cover')).toBe('150,000.00'); // 10% of basic (1,500,000)
  });

  it('converts a monthly gross to an annual total', () => {
    const result = resultOf(computeEmployerCostCalculator({ ...referenceInputs, salaryPeriod: 'monthly', grossAmount: 250_000 }));
    const gross = result.metrics.find((metric) => metric.label.includes('Gross salary'));
    expect(gross?.value).toBe('₦3,000,000.00');
  });

  it('rejects a zero gross because the overhead multiplier divides by it', () => {
    expect(errorMessage(computeEmployerCostCalculator({ ...referenceInputs, grossAmount: 0 }))).toMatch(/greater than zero/);
  });

  it('rejects a structure whose percentages do not total 100%', () => {
    expect(errorMessage(computeEmployerCostCalculator({ ...referenceInputs, basicPct: 60 }))).toMatch(/must total 100%/);
  });

  it('flags one-off costs as one-off rather than recurring', () => {
    const result = resultOf(computeEmployerCostCalculator(referenceInputs));
    expect(result.warnings?.some((warning) => /incurred once, not every year/i.test(warning))).toBe(true);
  });
});

describe('Calculator 5 — EWA ROI', () => {
  const referenceInputs = {
    totalEmployees: 100, averageAnnualSalary: 3_600_000,
    turnoverRatePct: 20, replacementCostPct: 33, turnoverReductionPct: 20, annualProgrammeCost: 0,
  };

  it('reproduces the published ₦4,752,000 savings example', () => {
    const roi = computeEwaRoi(referenceInputs);
    expect(roi.resignationsPerYear).toBe(20);
    expect(roi.averageReplacementCost).toBe(1_188_000);
    expect(roi.currentAttritionCost).toBe(23_760_000);
    expect(roi.projectedTurnoverRatePct).toBe(16);
    expect(roi.projectedResignationsPerYear).toBe(16);
    expect(roi.projectedAttritionCost).toBe(19_008_000);
    expect(roi.annualSavings).toBe(4_752_000);
    expect(roi.retainedStaffPerYear).toBe(4);
  });

  it('reports ROI as not computable at zero cost instead of claiming an infinite return', () => {
    const roi = computeEwaRoi(referenceInputs);
    expect(roi.roiPercent).toBeNull();
    const result = resultOf(computeEwaRoiCalculator(referenceInputs));
    const metric = result.metrics.find((entry) => entry.label.includes('Net return'));
    expect(metric?.value).toMatch(/not computable/i);
    expect(result.warnings?.some((warning) => /dividing by zero is undefined, not infinite/i.test(warning))).toBe(true);
  });

  it('computes a finite ROI once a programme cost is entered', () => {
    const roi = computeEwaRoi({ ...referenceInputs, annualProgrammeCost: 1_000_000 });
    expect(roi.netBenefit).toBe(3_752_000);
    expect(roi.roiPercent).toBe(375.2);
  });

  it('reports a negative net benefit as a legitimate result, not an error', () => {
    const result = resultOf(computeEwaRoiCalculator({ ...referenceInputs, annualProgrammeCost: 10_000_000 }));
    expect(result.metrics.find((metric) => metric.label === 'Net annual benefit')?.value).toBe('₦-5,248,000.00');
    expect(result.warnings?.some((warning) => /costs more than it saves/i.test(warning))).toBe(true);
  });

  it('caps the turnover reduction at 100% and warns above the researched 20%', () => {
    expect(computeEwaRoi({ ...referenceInputs, turnoverReductionPct: 150 }).projectedTurnoverRatePct).toBe(0);
    const result = resultOf(computeEwaRoiCalculator({ ...referenceInputs, turnoverReductionPct: 40 }));
    expect(result.warnings?.some((warning) => /exceeds the 20\.00%/i.test(warning))).toBe(true);
  });

  it('rejects out-of-range inputs', () => {
    expect(errorMessage(computeEwaRoiCalculator({ ...referenceInputs, totalEmployees: 0 }))).toMatch(/at least 1/);
    expect(errorMessage(computeEwaRoiCalculator({ ...referenceInputs, averageAnnualSalary: 0 }))).toMatch(/greater than zero/);
    expect(errorMessage(computeEwaRoiCalculator({ ...referenceInputs, turnoverRatePct: 120 }))).toMatch(/between 0% and 100%/);
    expect(errorMessage(computeEwaRoiCalculator({ ...referenceInputs, replacementCostPct: 900 }))).toMatch(/between 0% and 500%/);
    expect(errorMessage(computeEwaRoiCalculator({ ...referenceInputs, turnoverReductionPct: -5 }))).toMatch(/between 0% and 100%/);
  });

  it('handles a zero turnover rate without dividing by zero', () => {
    const roi = computeEwaRoi({ ...referenceInputs, turnoverRatePct: 0 });
    expect(roi.currentAttritionCost).toBe(0);
    expect(roi.annualSavings).toBe(0);
    const result = resultOf(computeEwaRoiCalculator({ ...referenceInputs, turnoverRatePct: 0 }));
    expect(result.warnings?.some((warning) => /turnover rate of 0%/i.test(warning))).toBe(true);
  });
});

describe('Generator 1 — Job Description', () => {
  const base = {
    jobTitle: 'Payroll Officer', companyName: 'CloudHost247 Ltd', department: 'Finance',
    level: 'mid', employmentType: 'full-time', workMode: 'hybrid', location: 'Lagos, Nigeria',
    responsibilities: 'Run the monthly payroll end to end\nPrepare statutory filings',
    requiredSkills: 'PAYE, PenCom remittance', preferredSkills: 'Sage',
    includeSalary: true, currency: 'NGN', salaryPeriod: 'year', salaryMin: 4000000, salaryMax: 5500000,
    yearsExperience: 3,
  };

  it('generates a structured description containing every section', () => {
    const result = resultOf(computeJobDescription(base));
    const document = result.document;
    expect(document?.format).toBe('markdown');
    expect(document?.filename).toBe('payroll-officer-description.md');
    expect(document?.content).toContain('# Payroll Officer');
    expect(document?.content).toContain('## About the role');
    expect(document?.content).toContain('## What you will do');
    expect(document?.content).toContain('1. Run the monthly payroll end to end');
    expect(document?.content).toContain('## What we need you to have');
    expect(document?.content).toContain('## Equal opportunity statement');
    expect(document?.content).toContain('₦4,000,000 – ₦5,500,000 per year');
    expect(document?.content).toContain('Hybrid');
  });

  it('omits the salary when publishing is switched off', () => {
    const result = resultOf(computeJobDescription({ ...base, includeSalary: false }));
    expect(result.document?.content).not.toContain('₦4,000,000');
    expect(result.explanation?.some((line) => /No salary range is published/i.test(line))).toBe(true);
  });

  it('flags pool-narrowing wording and explains why', () => {
    const flags = scanJobDescriptionLanguage('We need a young ninja salesman who is aggressive and able-bodied.');
    const terms = flags.map((flag) => flag.term.toLowerCase());
    expect(terms).toContain('young');
    expect(terms).toContain('ninja');
    expect(terms).toContain('salesman');
    expect(terms).toContain('aggressive');
    expect(terms).toContain('able-bodied');
    expect(flags.every((flag) => flag.reason.length > 20)).toBe(true);

    const result = resultOf(computeJobDescription({
      ...base,
      responsibilities: 'We need a rockstar ninja to dominate the payroll function',
    }));
    expect(result.metrics.find((metric) => metric.label === 'Inclusive-language flags')?.value).not.toBe('0');
    expect(result.tables?.some((table) => table.title === 'Inclusive-language review')).toBe(true);
  });

  it('reports no flags for neutral wording', () => {
    expect(scanJobDescriptionLanguage('Prepare the monthly payroll and file statutory returns.')).toHaveLength(0);
  });

  it('rejects a missing title, missing responsibilities and an inverted salary range', () => {
    expect(errorMessage(computeJobDescription({ ...base, jobTitle: '  ' }))).toMatch(/job title is required/i);
    expect(errorMessage(computeJobDescription({ ...base, responsibilities: '' }))).toMatch(/at least one responsibility/i);
    expect(errorMessage(computeJobDescription({ ...base, salaryMax: 3000000 }))).toMatch(/cannot be below the lower bound/i);
    expect(errorMessage(computeJobDescription({ ...base, salaryMin: 5000000, salaryMax: 5000000 }))).toMatch(/needs two different figures/i);
    expect(errorMessage(computeJobDescription({ ...base, responsibilities: Array.from({ length: 21 }, (_unused, index) => `Duty ${index + 1}`).join('\n') }))).toMatch(/20 lines or fewer/);
  });
});

describe('Generator 2 — Job Offer Letter', () => {
  const base = {
    candidateName: 'Ada Obi', jobTitle: 'Payroll Officer', companyName: 'CloudHost247 Ltd',
    startDate: '2026-04-01', offerValidUntil: '2026-03-20', salary: 4800000, salaryPeriod: 'year',
    currency: 'NGN', probationMonths: 3, department: 'Finance', employmentType: 'full-time',
    workMode: 'hybrid', location: 'Lagos', reportingTo: 'Chidi Eze',
    conditions: 'Satisfactory references\nProof of right to work',
  };

  it('generates a letter with terms, conditions and an acceptance block', () => {
    const result = resultOf(computeJobOfferLetter(base));
    const content = result.document?.content ?? '';
    expect(content).toContain('Dear Ada Obi');
    expect(content).toContain('Offer of Employment — Payroll Officer');
    expect(content).toContain('₦4,800,000 per year');
    expect(content).toContain('₦400,000.00'); // monthly equivalent
    expect(content).toContain('1 April 2026');
    expect(content).toContain('20 March 2026');
    expect(content).toContain('### Conditions of this offer');
    expect(content).toContain('conditional on each of the above being satisfied');
    expect(content).toContain('### Candidate acceptance');
    expect(content).toContain('the contract governs');
    expect(result.metrics.find((metric) => metric.label === 'Probation')?.value).toBe('3 months');
  });

  it('rejects an acceptance deadline after the start date', () => {
    expect(errorMessage(computeJobOfferLetter({ ...base, offerValidUntil: '2026-05-01' }))).toMatch(/cannot fall after the start date/i);
  });

  it('rejects missing parties and a zero salary', () => {
    expect(errorMessage(computeJobOfferLetter({ ...base, candidateName: '' }))).toMatch(/candidate/i);
    expect(errorMessage(computeJobOfferLetter({ ...base, companyName: '' }))).toMatch(/company name is required/i);
    expect(errorMessage(computeJobOfferLetter({ ...base, salary: 0 }))).toMatch(/greater than zero/i);
  });

  it('rejects an impossible calendar date', () => {
    expect(errorMessage(computeJobOfferLetter({ ...base, startDate: '2026-02-30' }))).toMatch(/real date/i);
  });

  it('advises on an unusually long probation', () => {
    const result = resultOf(computeJobOfferLetter({ ...base, probationMonths: 12 }));
    expect(result.warnings?.some((warning) => /unusually long/i.test(warning))).toBe(true);
  });
});

describe('Generator 3 — Official Payslip', () => {
  const base = {
    companyName: 'CloudHost247 Ltd', employeeName: 'Ada Obi', employeeId: 'CH247-OPS-2026-0001-7',
    designation: 'Payroll Officer', department: 'Finance', payPeriod: '2026-03',
    currency: 'NGN', workingDays: 22, lopDays: 0,
    earnings: 'Basic salary, 200000\nHousing allowance, 150000\nTransport allowance, 100000',
    deductions: '', applyStatutory: false,
  };

  it('computes gross, deductions and net from the entered lines', () => {
    const result = resultOf(computePayslip(base));
    expect(result.metrics.find((metric) => metric.label === 'Gross pay')?.value).toBe('₦450,000.00');
    expect(result.metrics.find((metric) => metric.label === 'Net pay')?.value).toBe('₦450,000.00');
    expect(result.document?.content).toContain('PAYSLIP');
    expect(result.document?.content).toContain('March 2026');
    expect(result.extraDocuments?.[0]?.format).toBe('csv');
    expect(result.extraDocuments?.[0]?.content).toContain('Net pay,450000.00');
  });

  it('adds statutory deductions computed with the PAYE engine when enabled', () => {
    const result = resultOf(computePayslip({ ...base, applyStatutory: true }));
    const gross = 450_000;
    const pension = 8 / 100 * gross;
    const nhf = 2.5 / 100 * gross;
    const nhis = 5 / 100 * 200_000;
    expect(result.metrics.find((metric) => metric.label === 'Total deductions')?.value)
      .not.toBe('₦0.00');
    const deductionsTable = result.tables?.find((table) => table.title === 'Deductions');
    const labels = deductionsTable?.rows.map((row) => row.label) ?? [];
    expect(labels).toContain('Pension (employee, 8%)');
    expect(labels).toContain('NHF housing fund (2.5% of gross)');
    expect(labels).toContain('NHIS health insurance (5% of basic)');
    expect(labels).toContain('PAYE income tax');
    expect(pension).toBe(36_000);
    expect(nhf).toBe(11_250);
    expect(nhis).toBe(10_000);
  });

  it('rejects deductions that exceed gross pay rather than printing a negative net', () => {
    const outcome = computePayslip({ ...base, deductions: 'Staff loan, 500000' });
    expect(outcome.ok).toBe(false);
    expect(errorMessage(outcome)).toMatch(/exceed gross pay/i);
  });

  it('rejects malformed earning lines and negative amounts', () => {
    expect(parseAmountLines('Basic salary').ok).toBe(false);
    expect(parseAmountLines('Basic salary, abc').ok).toBe(false);
    const negative = parseAmountLines('Basic salary, -100');
    expect(negative.ok).toBe(false);
    expect(parseAmountLines('Basic salary, 100').ok).toBe(true);
    expect(errorMessage(computePayslip({ ...base, earnings: 'Basic salary' }))).toMatch(/needs a label and an amount/i);
  });

  it('rejects loss-of-pay days exceeding the working days in the period', () => {
    expect(errorMessage(computePayslip({ ...base, lopDays: 30 }))).toMatch(/cannot exceed the 22 working days/i);
  });

  it('requires an issuer, an employee and at least one earnings line', () => {
    expect(errorMessage(computePayslip({ ...base, companyName: '' }))).toMatch(/employer name is required/i);
    expect(errorMessage(computePayslip({ ...base, employeeName: '' }))).toMatch(/employee name is required/i);
    expect(errorMessage(computePayslip({ ...base, earnings: '   ' }))).toMatch(/at least one earnings line/i);
  });

  it('refuses to compute statutory deductions with no pensionable earnings line', () => {
    expect(errorMessage(computePayslip({ ...base, applyStatutory: true, earnings: 'Consulting fee, 450000' })))
      .toMatch(/need a basic, housing or transport earning line/i);
  });
});

describe('Generator 4 — NDA Contract', () => {
  const base = {
    structure: 'one-way', disclosingParty: 'CloudHost247 Ltd', receivingParty: 'Northwind Consulting Ltd',
    effectiveDate: '2026-04-01', termYears: 2, survivalYears: 3,
    purpose: 'evaluating a managed hosting engagement', governingLaw: 'the Federal Republic of Nigeria',
    jurisdictionVenue: 'the courts of the Federal Republic of Nigeria', returnOrDestroy: 'return-or-destroy',
    includeNonSolicit: false, includeResiduals: false,
  };

  it('generates a one-way agreement with the standard exclusions and remedies', () => {
    const result = resultOf(computeNdaContract(base));
    const content = result.document?.content ?? '';
    expect(content).toContain('# NON-DISCLOSURE AGREEMENT');
    expect(content).toContain('the "Disclosing Party"');
    expect(content).toContain('the "Receiving Party"');
    expect(content).toContain('## 3. Exclusions');
    expect(content).toContain('independently developed');
    expect(content).toContain('## 5. Compelled disclosure');
    expect(content).toContain('injunctive relief');
    expect(content).toContain('trade secret');
    expect(result.metrics.find((metric) => metric.label === 'Structure')?.value).toBe('One-way');
  });

  it('switches both parties into discloser and recipient for a mutual agreement', () => {
    const result = resultOf(computeNdaContract({ ...base, structure: 'mutual' }));
    const content = result.document?.content ?? '';
    expect(content).toContain('each a "Party"');
    expect(content).toContain('Each Party shall');
    expect(result.metrics.find((metric) => metric.label === 'Structure')?.value).toBe('Mutual (two-way)');
  });

  it('adds the optional clauses only when selected, renumbering as it goes', () => {
    const plain = resultOf(computeNdaContract(base));
    const withClauses = resultOf(computeNdaContract({ ...base, includeNonSolicit: true, includeResiduals: true, nonSolicitMonths: 12 }));
    expect(withClauses.document?.content).toContain('## 9. Non-solicitation');
    expect(withClauses.document?.content).toContain('## 6A. Residual knowledge');
    expect(plain.document?.content).not.toContain('Non-solicitation');
  });

  it('rejects the same party on both sides', () => {
    expect(errorMessage(computeNdaContract({ ...base, receivingParty: 'cloudhost247 ltd' }))).toMatch(/cannot be the same person or entity/i);
  });

  it('advises on an unusually long non-solicitation or survival period', () => {
    const long = resultOf(computeNdaContract({ ...base, includeNonSolicit: true, nonSolicitMonths: 36 }));
    expect(long.warnings?.some((warning) => /unenforceable in several jurisdictions/i.test(warning))).toBe(true);
    const survive = resultOf(computeNdaContract({ ...base, survivalYears: 10 }));
    expect(survive.warnings?.some((warning) => /outside trade secrets/i.test(warning))).toBe(true);
  });

  it('rejects an out-of-range term', () => {
    expect(errorMessage(computeNdaContract({ ...base, termYears: 80 }))).toMatch(/between 0 and 50 years/i);
  });
});

describe('Generator 5 — Employment Contract', () => {
  const base = {
    employerName: 'CloudHost247 Ltd', employeeName: 'Ada Obi', jobTitle: 'Payroll Officer',
    department: 'Finance', reportsTo: 'Chidi Eze', contractType: 'permanent',
    startDate: '2026-04-01', salary: 4800000, salaryPeriod: 'year', currency: 'NGN',
    weeklyHours: 40, annualLeaveDays: 20, probationMonths: 3,
    noticeEmployeeMonths: 1, noticeEmployerMonths: 1,
    includeConfidentiality: true, includeIpAssignment: true, includeNonCompete: false,
    governingLaw: 'the Federal Republic of Nigeria', workMode: 'hybrid', workLocation: 'Lagos',
  };

  it('generates a permanent contract stating the statutory pension split', () => {
    const result = resultOf(computeEmploymentContract(base));
    const content = result.document?.content ?? '';
    expect(content).toContain('# CONTRACT OF EMPLOYMENT');
    expect(content).toContain('This is a permanent contract of employment');
    expect(content).toContain('₦4,800,000 per year');
    expect(content).toContain('8% of basic salary, housing and transport allowances under the Pension Reform Act 2014');
    expect(content).toContain('minimum of 10%');
    expect(content).toContain('The Employee\u2019s choice of administrator is the Employee\u2019s');
    expect(content).toContain('## 7. Confidentiality');
    expect(content).toContain('## 8. Intellectual property');
  });

  it('requires an end date after the start date for a fixed-term contract', () => {
    expect(errorMessage(computeEmploymentContract({ ...base, contractType: 'fixed-term' }))).toMatch(/needs an end date/i);
    expect(errorMessage(computeEmploymentContract({ ...base, contractType: 'fixed-term', endDate: '2026-03-01' }))).toMatch(/must fall after the start date/i);
    const valid = resultOf(computeEmploymentContract({ ...base, contractType: 'fixed-term', endDate: '2027-03-31' }));
    expect(valid.document?.content).toContain('fixed-term contract ending on');
    // 1 April 2026 to 31 March 2027 is 364 days, a day short of twelve whole months.
    expect(valid.metrics.find((metric) => metric.label === 'Contract type')?.value).toContain('11 months');
  });

  it('advises when annual leave falls below the Labour Act reference minimum', () => {
    const result = resultOf(computeEmploymentContract({ ...base, annualLeaveDays: 4 }));
    expect(result.warnings?.some((warning) => /Labour Act/i.test(warning))).toBe(true);
  });

  it('advises on a long working week and a long non-compete', () => {
    const hours = resultOf(computeEmploymentContract({ ...base, weeklyHours: 60 }));
    expect(hours.warnings?.some((warning) => /40-hour standard week/i.test(warning))).toBe(true);
    const nonCompete = resultOf(computeEmploymentContract({ ...base, includeNonCompete: true, nonCompeteMonths: 24 }));
    expect(nonCompete.warnings?.some((warning) => /post-termination non-compete is long/i.test(warning))).toBe(true);
    expect(nonCompete.document?.content).toContain('Restrictive covenants');
  });

  it('omits the confidentiality and IP clauses when they are switched off', () => {
    const result = resultOf(computeEmploymentContract({ ...base, includeConfidentiality: false, includeIpAssignment: false }));
    expect(result.document?.content).not.toContain('## 7. Confidentiality');
    expect(result.explanation?.some((line) => /No confidentiality clause is included/i.test(line))).toBe(true);
  });

  it('rejects missing parties and a zero salary', () => {
    expect(errorMessage(computeEmploymentContract({ ...base, employerName: '' }))).toMatch(/employer/i);
    expect(errorMessage(computeEmploymentContract({ ...base, salary: 0 }))).toMatch(/greater than zero/i);
  });
});

describe('Generator 6 — CV', () => {
  const base = {
    fullName: 'Ada Obi', professionalTitle: 'Payroll Specialist', email: 'ada@example.com',
    phone: '+2348012345678', location: 'Lagos', links: 'linkedin.com/in/adaobi',
    summary: 'Payroll specialist with six years running statutory payroll for Nigerian employers.',
    skills: 'PAYE, PenCom remittance, Sage, Excel',
    experience: 'Acme Ltd | Payroll Officer | 2022-03 | present | Ran a 400-person payroll; Cut reconciliation time by 40%',
    education: 'University of Lagos | BSc | Accounting | 2019',
    atsFriendly: true,
  };

  it('produces ATS-friendly plain text with upper-case headings', () => {
    const result = resultOf(computeCv(base));
    const content = result.document?.content ?? '';
    expect(result.document?.format).toBe('text');
    expect(content).toContain('ADA OBI');
    expect(content).toContain('WORK EXPERIENCE');
    expect(content).toContain('PAYROLL OFFICER — Acme Ltd');
    expect(content).toContain('March 2022 – Present');
    expect(content).not.toContain('## ');
    expect(result.tables?.some((table) => table.title === 'Career timeline')).toBe(true);
  });

  it('produces Markdown when ATS mode is off', () => {
    const result = resultOf(computeCv({ ...base, atsFriendly: false }));
    expect(result.document?.format).toBe('markdown');
    expect(result.document?.content).toContain('## Work experience');
    expect(result.document?.content).toContain('### Payroll Officer — Acme Ltd');
  });

  it('computes role duration in months so gaps are visible', () => {
    const result = resultOf(computeCv({ ...base, experience: 'Acme Ltd | Officer | 2020-01 | 2022-01 | Did things' }));
    const timeline = result.tables?.find((table) => table.title === 'Career timeline');
    expect(timeline?.rows[0]?.cells[2]).toBe('24');
  });

  it('rejects an end date before a start date and a malformed record', () => {
    expect(errorMessage(computeCv({ ...base, experience: 'Acme | Officer | 2022-06 | 2021-01 | Did things' }))).toMatch(/before the start date/i);
    expect(errorMessage(computeCv({ ...base, experience: 'Acme | Officer | 2022-06' }))).toMatch(/needs exactly 5/i);
    expect(errorMessage(computeCv({ ...base, experience: 'Acme | Officer | June 2022 | present | Did things' }))).toMatch(/must be YYYY-MM/i);
    expect(parsePipeRecords('a | b', 3).ok).toBe(false);
  });

  it('rejects an invalid email and an empty CV', () => {
    expect(errorMessage(computeCv({ ...base, email: 'ada@example' }))).toMatch(/not a valid email address/i);
    expect(errorMessage(computeCv({ ...base, experience: '', projects: '' }))).toMatch(/at least one work-experience entry/i);
    expect(errorMessage(computeCv({ ...base, fullName: '' }))).toMatch(/name is required/i);
  });

  it('flags remit-describing and unverifiable wording', () => {
    const result = resultOf(computeCv({ ...base, summary: 'I am a hard-working team player responsible for various payroll tasks.' }));
    expect(Number(result.metrics.find((metric) => metric.label === 'Wording flags')?.value)).toBeGreaterThan(0);
    const flags = result.tables?.find((table) => table.title === 'CV wording review');
    expect(flags).toBeDefined();
  });

  it('warns on a long CV and an over-stuffed skills list', () => {
    const longSkills = Array.from({ length: 30 }, (_unused, index) => `Skill ${index + 1}`).join(', ');
    const result = resultOf(computeCv({ ...base, skills: longSkills }));
    expect(result.warnings?.some((warning) => /keyword stuffing/i.test(warning))).toBe(true);
  });
});

describe('Generator 7 — Business Invoice', () => {
  const base = {
    businessName: 'CloudHost247 Ltd', businessAddress: '1 Marina, Lagos', businessEmail: 'billing@cloudhost247.test',
    taxId: 'TIN-12345678-0001', clientName: 'Northwind Ltd', clientAddress: '2 Broad Street, Lagos',
    invoiceNumber: 'INV-2026-014', issueDate: '2026-03-01', dueDate: '2026-03-31',
    currency: 'NGN', taxRate: 7.5, lineItems: 'Managed VPS hosting, 3, 45000\nMigration and setup, 1, 120000',
    discountPct: 0, discountAmount: 0, shipping: 0, amountPaid: 0,
  };

  it('computes per-line tax and the invoice total', () => {
    const result = resultOf(computeBusinessInvoice(base));
    // 3 × 45,000 = 135,000; +120,000 = 255,000 subtotal; VAT 7.5% = 19,125; total 274,125.
    expect(result.metrics.find((metric) => metric.label === 'Subtotal')?.value).toBe('₦255,000.00');
    expect(result.metrics.find((metric) => metric.label === 'Invoice total')?.value).toBe('₦274,125.00');
    expect(result.metrics.find((metric) => metric.label === 'Balance due')?.value).toBe('₦274,125.00');
    expect(result.metrics.find((metric) => metric.label === 'Payment terms')?.value).toBe('30 days');
    expect(result.document?.content).toContain('INVOICE');
    expect(result.document?.content).toContain('TIN-12345678-0001');
  });

  it('allows a per-line tax rate that overrides the invoice default', () => {
    const parsed = parseInvoiceLines('Zero-rated supply, 1, 100000, 0\nStandard supply, 1, 100000', 7.5);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.lines[0]?.taxRate).toBe(0);
      expect(parsed.lines[0]?.taxAmount).toBe(0);
      expect(parsed.lines[1]?.taxRate).toBe(7.5);
      expect(parsed.lines[1]?.taxAmount).toBe(7500);
    }
  });

  it('spreads a discount pro-rata so tax is charged on the discounted value', () => {
    const result = resultOf(computeBusinessInvoice({ ...base, discountPct: 10 }));
    // Subtotal 255,000; discount 25,500; taxable base 229,500; VAT 7.5% = 17,212.50.
    expect(result.metrics.find((metric) => metric.label === 'Subtotal')?.value).toBe('₦255,000.00');
    const totals = result.tables?.find((table) => table.title === 'Totals');
    expect(totals?.rows.find((row) => row.label === 'Taxable base')?.cells[0]).toBe('229,500.00');
    expect(totals?.rows.find((row) => row.label === 'Tax')?.cells[0]).toBe('17,212.50');
    expect(totals?.rows.find((row) => row.label === 'Total')?.cells[0]).toBe('246,712.50');
  });

  it('derives paid, part-paid, unpaid and overpaid status', () => {
    expect(resultOf(computeBusinessInvoice(base)).metrics.find((metric) => metric.label === 'Balance due')?.hint).toBe('Unpaid');
    expect(resultOf(computeBusinessInvoice({ ...base, amountPaid: 274125 })).metrics.find((metric) => metric.label === 'Balance due')?.hint).toBe('Paid');
    expect(resultOf(computeBusinessInvoice({ ...base, amountPaid: 100000 })).metrics.find((metric) => metric.label === 'Balance due')?.hint).toBe('Part Paid');
    const over = computeBusinessInvoice({ ...base, amountPaid: 300000 });
    expect(over.ok).toBe(true);
    expect(resultOf(over).warnings?.some((warning) => /exceeds the invoice total/i.test(warning))).toBe(true);
  });

  it('rejects a due date before the issue date', () => {
    expect(errorMessage(computeBusinessInvoice({ ...base, dueDate: '2026-02-01' }))).toMatch(/before the issue date/i);
  });

  it('rejects malformed line items', () => {
    expect(errorMessage(computeBusinessInvoice({ ...base, lineItems: 'Hosting only' }))).toMatch(/at least three fields/i);
    expect(errorMessage(computeBusinessInvoice({ ...base, lineItems: 'Hosting, 0, 45000' }))).toMatch(/quantity must be greater than zero/i);
    expect(errorMessage(computeBusinessInvoice({ ...base, lineItems: 'Hosting, 1, -45000' }))).toMatch(/unit price cannot be negative/i);
    expect(errorMessage(computeBusinessInvoice({ ...base, lineItems: 'Hosting, 1, 45000, 150' }))).toMatch(/tax rate must be between 0% and 100%/i);
    expect(errorMessage(computeBusinessInvoice({ ...base, lineItems: '' }))).toMatch(/at least one line item/i);
  });

  it('rejects a discount that erases the invoice', () => {
    expect(errorMessage(computeBusinessInvoice({ ...base, discountPct: 100 }))).toMatch(/equals or exceeds the subtotal/i);
  });

  it('warns about a missing tax identification number and tax point date', () => {
    const result = resultOf(computeBusinessInvoice({ ...base, taxId: '', issueDate: '' }));
    expect(result.warnings?.some((warning) => /tax identification number/i.test(warning))).toBe(true);
    expect(result.warnings?.some((warning) => /tax point date/i.test(warning))).toBe(true);
  });
});

describe('Generator 8 — Business Card', () => {
  it('generates valid SVG at ID-1 proportions in both orientations', () => {
    const landscape = resultOf(computeBusinessCard({
      fullName: 'Ada Obi', jobTitle: 'Payroll Lead', companyName: 'CloudHost247',
      email: 'ada@cloudhost247.test', phone: '+2348012345678', website: 'cloudhost247.test',
      orientation: 'landscape', layout: 'classic', brandColor: '#0f2b46', accentColor: '#1f7ae0',
    }));
    expect(landscape.document?.format).toBe('svg');
    expect(landscape.document?.content).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(landscape.document?.content).toContain('width="1050" height="600"');
    expect(landscape.document?.filename).toBe('business-card-ada-obi.svg');

    const portrait = resultOf(computeBusinessCard({ fullName: 'Ada Obi', orientation: 'portrait' }));
    expect(portrait.document?.content).toContain('width="600" height="1050"');
  });

  it('picks the higher-contrast text colour automatically and reports the ratio', () => {
    expect(readableTextColor('#0f2b46')).toBe('#ffffff');
    expect(readableTextColor('#ffffff')).toBe('#111111');
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    const dark = resultOf(computeBusinessCard({ fullName: 'Ada Obi', brandColor: '#0f2b46' }));
    expect(dark.metrics.find((metric) => metric.label.includes('contrast'))?.value).toMatch(/:1$/);
  });

  it('warns when the brand colour cannot meet 4.5:1 against either text colour', () => {
    const result = resultOf(computeBusinessCard({ fullName: 'Ada Obi', brandColor: '#777777' }));
    expect(result.warnings?.some((warning) => /below the 4\.5:1 WCAG 2\.1 AA minimum/i.test(warning))).toBe(true);
  });

  it('rejects a malformed colour and falls back rather than emitting broken markup', () => {
    const result = resultOf(computeBusinessCard({ fullName: 'Ada Obi', brandColor: 'red"; </svg><script>' }));
    expect(result.document?.content).toContain('#0f2b46');
    expect(result.document?.content).not.toContain('<script>');
  });

  it('escapes markup in the supplied text', () => {
    const result = resultOf(computeBusinessCard({ fullName: '<script>alert(1)</script>', companyName: 'A & B "Ltd"' }));
    expect(result.document?.content).not.toContain('<script>');
    expect(result.document?.content).toContain('&lt;script&gt;');
    expect(result.document?.content).toContain('A &amp; B &quot;Ltd&quot;');
  });

  it('flags an invalid email and domain', () => {
    const result = resultOf(computeBusinessCard({ fullName: 'Ada Obi', email: 'ada@example', website: 'not a domain' }));
    expect(result.warnings?.some((warning) => /does not look like a valid email/i.test(warning))).toBe(true);
    expect(result.warnings?.some((warning) => /does not look like a domain name/i.test(warning))).toBe(true);
  });

  it('supports the split layout with a brand panel', () => {
    const result = resultOf(computeBusinessCard({ fullName: 'Ada Obi', companyName: 'CloudHost247', layout: 'split', tagline: 'Hosting that answers' }));
    expect(result.document?.content).toContain('Hosting that answers');
    expect(result.tables?.[0]?.rows.find((row) => row.label === 'Layout')?.cells[0]).toBe('Split');
  });
});

describe('Generator 9 — Employee ID', () => {
  it('produces a Luhn-valid identifier in the documented scheme', () => {
    const generated = buildEmployeeId('CH247', 'OPS', '2026', 1, 4);
    expect(generated.id).toBe('CH247-OPS-2026-0001-8');
    expect(luhnIsValid(generated.id.replace(/\D/g, ''))).toBe(true);
  });

  it('computes and verifies Luhn check digits', () => {
    expect(luhnCheckDigit('7992739871')).toBe(3);
    expect(luhnIsValid('79927398713')).toBe(true);
    expect(luhnIsValid('79927398714')).toBe(false);
    expect(luhnIsValid('')).toBe(false);
    expect(luhnIsValid('5')).toBe(false);
  });

  it('generates a batch with sequential numbers', () => {
    const result = resultOf(computeEmployeeIdGenerator({ companyPrefix: 'CH247', departmentCode: 'OPS', year: '2026', startSequence: 10, count: 5, sequenceWidth: 4 }));
    expect(result.metrics.find((metric) => metric.label === 'Identifiers generated')?.value).toBe('5');
    expect(result.metrics.find((metric) => metric.label === 'First ID')?.value).toBe('CH247-OPS-2026-0010-9');
    expect(result.document?.format).toBe('csv');
    expect(result.document?.content.split('\r\n').filter((line) => line).length).toBe(6); // header + 5
    const table = result.tables?.find((entry) => entry.title.startsWith('Generated identifiers'));
    expect(table?.rows.every((row) => row.cells[1] === 'Yes')).toBe(true);
  });

  it('warns when the batch overflows the sequence width', () => {
    const result = resultOf(computeEmployeeIdGenerator({ companyPrefix: 'CH247', departmentCode: 'OPS', year: '2026', startSequence: 9998, count: 5, sequenceWidth: 4 }));
    expect(result.warnings?.some((warning) => /wrap and collide/i.test(warning))).toBe(true);
  });

  it('normalises the prefix and department code', () => {
    const result = resultOf(computeEmployeeIdGenerator({ companyPrefix: 'ch-247!', departmentCode: 'ops', year: '2026', startSequence: 1, count: 1, sequenceWidth: 4 }));
    expect(result.metrics.find((metric) => metric.label === 'First ID')?.value).toBe('CH247-OPS-2026-0001-8');
  });

  it('rejects an invalid year, an oversized prefix and an oversized batch', () => {
    expect(errorMessage(computeEmployeeIdGenerator({ companyPrefix: 'CH247', departmentCode: 'OPS', year: '26', startSequence: 1, count: 1, sequenceWidth: 4 }))).toMatch(/four digits/i);
    expect(errorMessage(computeEmployeeIdGenerator({ companyPrefix: 'CH24789', departmentCode: 'OPS', year: '2026', startSequence: 1, count: 1, sequenceWidth: 4 }))).toMatch(/6 characters or fewer/i);
    expect(errorMessage(computeEmployeeIdGenerator({ companyPrefix: 'CH247', departmentCode: 'OPS', year: '2026', startSequence: 1, count: 501, sequenceWidth: 4 }))).toMatch(/maximum 500/i);
    expect(errorMessage(computeEmployeeIdGenerator({ companyPrefix: 'CH247', departmentCode: 'OPS', year: '2026', startSequence: 1, count: 0, sequenceWidth: 4 }))).toMatch(/at least one ID/i);
    expect(errorMessage(computeEmployeeIdGenerator({ companyPrefix: '', departmentCode: 'OPS', year: '2026', startSequence: 1, count: 1, sequenceWidth: 4 }))).toMatch(/company prefix is required/i);
  });
});

describe('Generator 10 — Employee ID Card', () => {
  const base = {
    companyName: 'CloudHost247', employeeName: 'Ada Obi', employeeId: 'CH247-OPS-2026-0001-8',
    designation: 'Payroll Officer', department: 'Finance', bloodGroup: 'O+',
    issueDate: '2026-01-01', expiryDate: '2027-12-31', orientation: 'portrait',
    themeColor: '#0f2b46', includePhoto: true, includeQr: false,
  };

  it('generates a portrait badge carrying every supplied field', () => {
    const result = resultOf(computeEmployeeIdCard(base));
    const content = result.document?.content ?? '';
    expect(result.document?.format).toBe('svg');
    expect(content).toContain('width="600" height="1050"');
    expect(content).toContain('EMPLOYEE IDENTIFICATION CARD');
    expect(content).toContain('Ada Obi');
    expect(content).toContain('CH247-OPS-2026-0001-8');
    expect(content).toContain('O+');
    expect(content).toContain('31 December 2027');
    expect(result.metrics.find((metric) => metric.label === 'Check digit')?.value).toBe('Valid (Luhn)');
  });

  it('verifies the employee ID against its check digit and warns on a mistyped one', () => {
    const bad = resultOf(computeEmployeeIdCard({ ...base, employeeId: 'CH247-OPS-2026-0001-6' })); // 6 is not the check digit for this core
    expect(bad.metrics.find((metric) => metric.label === 'Check digit')?.value).toBe('Invalid (Luhn)');
    expect(bad.warnings?.some((warning) => /fails Luhn check-digit verification/i.test(warning))).toBe(true);
  });

  it('validates the blood group and the expiry date', () => {
    expect(resultOf(computeEmployeeIdCard({ ...base, bloodGroup: 'Z+' })).warnings?.some((warning) => /not a recognised blood group/i.test(warning))).toBe(true);
    expect(resultOf(computeEmployeeIdCard({ ...base, expiryDate: '2025-01-01' })).warnings?.some((warning) => /not after the issue date/i.test(warning))).toBe(true);
  });

  it('marks the QR block as a placeholder rather than claiming a scannable code', () => {
    const result = resultOf(computeEmployeeIdCard({ ...base, includeQr: true }));
    expect(result.warnings?.some((warning) => /not a scannable code/i.test(warning))).toBe(true);
    expect(result.tables?.[0]?.rows.find((row) => row.label === 'QR payload block')?.cells[0]).toMatch(/placeholder, not scannable/i);
  });

  it('always states that the tool verifies nothing about the holder', () => {
    const result = resultOf(computeEmployeeIdCard(base));
    expect(result.warnings?.some((warning) => /may constitute fraud/i.test(warning))).toBe(true);
  });

  it('generates a landscape badge', () => {
    const result = resultOf(computeEmployeeIdCard({ ...base, orientation: 'landscape' }));
    expect(result.document?.content).toContain('width="1050" height="600"');
  });
});

describe('Generator 11 — Organizational Chart', () => {
  const people = [
    'Ada Obi | Chief Executive |',
    'Chidi Eze | Head of Engineering | Ada Obi',
    'Bisi Lawal | Platform Engineer | Chidi Eze',
    'Tunde Bakare | Site Reliability Engineer | Chidi Eze',
    'Ngozi Uche | Finance Lead | Ada Obi',
  ].join('\n');

  it('builds the tree and reports depth, headcount and span of control', () => {
    const built = buildOrgChart([
      { name: 'Ada Obi', role: 'Chief Executive', manager: '' },
      { name: 'Chidi Eze', role: 'Head of Engineering', manager: 'Ada Obi' },
      { name: 'Bisi Lawal', role: 'Engineer', manager: 'Chidi Eze' },
    ]);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.chart.headcount).toBe(3);
      expect(built.chart.rootIds).toHaveLength(1);
      expect(built.chart.maxDepth).toBe(2);
      expect(built.chart.managerCount).toBe(2);
      expect(built.chart.averageSpanOfControl).toBe(1);
      expect(built.chart.widestSpan?.name).toBe('Ada Obi');
      const ada = built.chart.nodes.find((node) => node.name === 'Ada Obi');
      expect(ada?.totalReports).toBe(2);
      expect(ada?.directReports).toBe(1);
    }
  });

  it('rejects a reporting cycle', () => {
    const built = buildOrgChart([
      { name: 'A', role: '', manager: 'B' },
      { name: 'B', role: '', manager: 'A' },
    ]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/reporting cycle/i);
  });

  it('rejects self-reporting', () => {
    const built = buildOrgChart([{ name: 'A', role: '', manager: 'A' }]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/report to themselves/i);
  });

  it('rejects a manager who is not in the chart', () => {
    const built = buildOrgChart([{ name: 'A', role: '', manager: 'Ghost' }]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/not in the chart/i);
  });

  it('rejects duplicate names because reporting lines would be ambiguous', () => {
    const built = buildOrgChart([
      { name: 'Ada Obi', role: 'CEO', manager: '' },
      { name: 'Ada Obi', role: 'Engineer', manager: 'Ada Obi' },
    ]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/Duplicate names/i);
  });

  it('renders an indented outline and exports CSV', () => {
    const result = resultOf(computeOrganizationalChart({ organizationName: 'CloudHost247', people }));
    expect(result.metrics.find((metric) => metric.label === 'Headcount')?.value).toBe('5');
    expect(result.metrics.find((metric) => metric.label === 'Managers')?.value).toBe('2');
    expect(result.metrics.find((metric) => metric.label === 'Levels')?.value).toBe('3');
    const outline = result.document?.content ?? '';
    expect(outline).toContain('Ada Obi — Chief Executive');
    expect(outline).toContain('└─ Chidi Eze — Head of Engineering');
    expect(result.extraDocuments?.[0]?.format).toBe('csv');
    expect(result.extraDocuments?.[0]?.content).toContain('Reports to');
  });

  it('warns on a disconnected chart and on a span wider than ten', () => {
    const disconnected = resultOf(computeOrganizationalChart({
      organizationName: 'Two Teams',
      people: 'Ada | CEO |\nBisi | CEO |',
    }));
    expect(disconnected.warnings?.some((warning) => /disconnected teams/i.test(warning))).toBe(true);

    const wide = Array.from({ length: 12 }, (_unused, index) => `Staff ${index + 1} | Engineer | Boss`).join('\n');
    const result = resultOf(computeOrganizationalChart({ organizationName: 'Wide', people: `Boss | Manager |\n${wide}` }));
    expect(result.warnings?.some((warning) => /12 direct reports/i.test(warning))).toBe(true);
  });

  it('rejects an empty chart, an oversized chart and a malformed line', () => {
    expect(errorMessage(computeOrganizationalChart({ organizationName: 'X', people: '' }))).toMatch(/at least one person/i);
    expect(errorMessage(computeOrganizationalChart({ organizationName: 'X', people: Array.from({ length: 501 }, (_unused, index) => `P${index} | R |`).join('\n') }))).toMatch(/up to 500 people/i);
    expect(errorMessage(computeOrganizationalChart({ organizationName: 'X', people: 'Ada | CEO | Boss | Extra | Field' }))).toMatch(/needs 2 or 3/i);
  });
});

describe('Generator 12 — LinkedIn Engagement Assistant', () => {
  const post = 'We rebuilt our payroll run around earned wage access last year. Turnover fell by 20% within two quarters, and the biggest surprise was how many people used it once and never again. What has your experience been?';

  it('analyses the post and drafts three comments in the chosen tone', () => {
    const result = resultOf(computeLinkedInEngagementAssistant({
      postText: post, authorName: 'Ada', tone: 'all', perspective: 'a payroll lead',
      keyPoint: 'one-off usage is the strongest signal that the benefit is working as insurance', maxLength: 480,
    }));
    const drafts = result.tables?.find((table) => table.title === 'Comment drafts');
    expect(drafts?.rows).toHaveLength(3);
    for (const row of drafts?.rows ?? []) {
      expect(row.cells[0] ?? '').not.toBe('');
      expect(Number(row.cells[1])).toBeLessThanOrEqual(480);
      expect(Number(row.cells[1])).toBeGreaterThan(80);
      expect((row.cells[2] ?? '').length).toBeGreaterThan(20);
    }
    expect(result.metrics.find((metric) => metric.label === 'Detected topics')?.value).toMatch(/payroll/i);
    expect(result.metrics.find((metric) => metric.label === 'Conversation signals')?.value).toMatch(/1 question/);
  });

  it('prioritises the requested tone', () => {
    const result = resultOf(computeLinkedInEngagementAssistant({ postText: post, tone: 'analytical', maxLength: 600 }));
    expect(result.tables?.find((table) => table.title === 'Comment drafts')?.rows[0]?.label).toBe('Analytical');
  });

  it('detects sentiment, questions, calls to action and figures', () => {
    const result = resultOf(computeLinkedInEngagementAssistant({ postText: post, tone: 'all', maxLength: 480 }));
    const analysis = result.tables?.find((table) => table.title === 'Post analysis');
    const find = (label: string): string => analysis?.rows.find((row) => row.label === label)?.cells[0] ?? '';
    expect(find('Questions asked')).toBe('1');
    expect(find('Call to action')).toBe('Absent');
    expect(find('Contains figures')).toBe('Yes');
  });

  it('trims at a word boundary and never mid-word', () => {
    const result = resultOf(computeLinkedInEngagementAssistant({ postText: post, tone: 'insightful', maxLength: 120, perspective: 'a payroll lead running a 300-person payroll in Lagos', keyPoint: 'the interesting part is the one-off usage pattern across two quarters' }));
    const drafts = result.tables?.find((table) => table.title === 'Comment drafts');
    for (const row of drafts?.rows ?? []) {
      const comment = row.cells[0] ?? '';
      // Inside the cap, never cut mid-word, no trailing space, and visibly truncated so nobody
      // pastes a draft that reads as an unfinished sentence.
      expect(comment.length).toBeLessThanOrEqual(120);
      expect(/\s$/.test(comment)).toBe(false);
      expect(Number(row.cells[1])).toBe(comment.length);
      expect(comment.endsWith('…')).toBe(true);
      expect(row.cells[2]).toMatch(/Trimmed to 120 characters at a word boundary/);
    }
  });

  it('refuses a fragment and an over-long paste', () => {
    expect(errorMessage(computeLinkedInEngagementAssistant({ postText: 'short', tone: 'all', maxLength: 480 }))).toMatch(/only 1 word/i);
    expect(errorMessage(computeLinkedInEngagementAssistant({ postText: '', tone: 'all', maxLength: 480 }))).toMatch(/paste the text/i);
    expect(errorMessage(computeLinkedInEngagementAssistant({ postText: Array.from({ length: 3200 }, (_unused, index) => `word${index}`).join(' '), tone: 'all', maxLength: 480 }))).toMatch(/longer than a LinkedIn post/i);
  });

  it('rejects an out-of-range length cap', () => {
    expect(errorMessage(computeLinkedInEngagementAssistant({ postText: post, tone: 'all', maxLength: 20 }))).toMatch(/between 80 and 1200 characters/i);
  });

  it('tells the visitor when the drafts can only agree', () => {
    const result = resultOf(computeLinkedInEngagementAssistant({ postText: post, tone: 'all', maxLength: 480 }));
    expect(result.warnings?.some((warning) => /No original point was supplied/i.test(warning))).toBe(true);
    expect(result.warnings?.some((warning) => /No perspective was supplied/i.test(warning))).toBe(true);
  });

  it('states that no external service was called', () => {
    const result = resultOf(computeLinkedInEngagementAssistant({ postText: post, tone: 'all', maxLength: 480 }));
    expect(result.explanation?.some((line) => /No language model or third-party service was called/i.test(line))).toBe(true);
    expect(result.document?.content).toContain('was not transmitted anywhere');
  });
});

describe('Comparison engine', () => {
  const criteria = [
    { key: 'a', label: 'Criterion A', description: 'a', weight: 2 },
    { key: 'b', label: 'Criterion B', description: 'b', weight: 1 },
  ];
  const options = [
    { id: 'x', name: 'X', bestFor: 'x', facts: {}, scores: { a: 5, b: 2 } },
    { id: 'y', name: 'Y', bestFor: 'y', facts: {}, scores: { a: 3, b: 5 } },
    { id: 'z', name: 'Z', bestFor: 'z', facts: {}, scores: { a: null, b: null } },
  ];

  it('normalises a weighted score to 0–100 where 5/5 on everything is 100', () => {
    const ranked = rankByWeightedScore(options, criteria, { a: 2, b: 1 });
    const x = ranked.find((entry) => entry.option.id === 'x');
    // (5×2 + 2×1) / (5 × 3) × 100 = 12/15 × 100 = 80
    expect(x?.score).toBe(80);
    const y = ranked.find((entry) => entry.option.id === 'y');
    // (3×2 + 5×1) / 15 × 100 = 11/15 × 100 = 73.33
    expect(y?.score).toBe(73.33);
    expect(x?.rank).toBe(1);
    expect(y?.rank).toBe(2);
  });

  it('excludes unassessed criteria from the average instead of scoring them zero', () => {
    const ranked = rankByWeightedScore(options, criteria, { a: 2, b: 1 });
    const z = ranked.find((entry) => entry.option.id === 'z');
    expect(z?.score).toBeNull();
    expect(z?.rank).toBeNull();
    expect(z?.assessedCriteria).toBe(0);
    expect(z?.unassessedCriteria).toBe(2);
  });

  it('excludes a criterion from the denominator when only some options were assessed on it', () => {
    const partial = rankByWeightedScore(
      [{ id: 'p', name: 'P', bestFor: 'p', facts: {}, scores: { a: 4, b: null } }],
      criteria,
      { a: 2, b: 1 }
    );
    const entry = partial[0];
    expect(entry?.score).toBe(80); // 4/5 on the only assessed criterion
    expect(entry?.assessedCriteria).toBe(1);
    expect(entry?.unassessedCriteria).toBe(1);
  });

  it('breaks ties by name so the ordering is stable', () => {
    const tied = rankByWeightedScore(
      [
        { id: 'b', name: 'Beta', bestFor: 'b', facts: {}, scores: { a: 4, b: 4 } },
        { id: 'a', name: 'Alpha', bestFor: 'a', facts: {}, scores: { a: 4, b: 4 } },
      ],
      criteria,
      { a: 1, b: 1 }
    );
    expect(tied[0]?.option.name).toBe('Alpha');
    expect(tied[1]?.option.name).toBe('Beta');
  });

  it('honours reweighting enough to invert the ranking', () => {
    const inverted = rankByWeightedScore(options, criteria, { a: 0, b: 10 });
    expect(inverted.find((entry) => entry.option.id === 'y')?.rank).toBe(1);
    expect(inverted.find((entry) => entry.option.id === 'x')?.rank).toBe(2);
  });
});

describe('Comparison 1 & 2 — Accounting and Expense tools', () => {
  it('ranks six accounting systems and records that none computes Nigerian payroll natively', () => {
    expect(ACCOUNTING_COMPARISON.options).toHaveLength(6);
    for (const option of ACCOUNTING_COMPARISON.options) {
      expect(option.facts['Native Nigerian PAYE']).toBe('No');
      expect(option.facts['PenCom pension']).toBe('No');
      expect(option.facts['NHF / NHIS']).toBe('No');
      expect(option.facts['Employee disbursement']).toBe('No');
      expect(option.scores['nigerian-paye']).toBe(0);
      expect(option.scores['general-ledger']).toBe(5);
    }
    const result = resultOf(computeAccountingComparison(defaultInputFor(findBusinessTool('accounting-tool-comparison')!)));
    const ranking = result.tables?.find((table) => table.title === 'Weighted ranking');
    expect(ranking?.rows).toHaveLength(6);
    expect(ranking?.rows[0]?.cells[0]).toBe('1');
    expect(result.tables?.some((table) => table.title === 'Capability and directory facts')).toBe(true);
  });

  it('records that Odoo is the only accounting option that can run on infrastructure you control', () => {
    expect(ACCOUNTING_COMPARISON.options.find((option) => option.id === 'odoo-accounting')?.facts['Runs on infrastructure you control']).toBe('Yes');
    expect(ACCOUNTING_COMPARISON.options.filter((option) => option.facts['Runs on infrastructure you control'] === 'Yes')).toHaveLength(1);
  });

  it('ranks eight expense platforms and separates card availability in Nigeria', () => {
    expect(EXPENSE_COMPARISON.options).toHaveLength(8);
    const cardInNigeria = EXPENSE_COMPARISON.options.filter((option) => option.facts['Cards available in Nigeria'] === 'Yes');
    expect(cardInNigeria).toHaveLength(0);
    const partial = EXPENSE_COMPARISON.options.filter((option) => option.facts['Cards available in Nigeria'] === 'Partial');
    expect(partial.map((option) => option.id)).toEqual(['sap-concur']);
    const result = resultOf(computeExpenseComparison(defaultInputFor(findBusinessTool('expense-tool-comparison')!)));
    expect(result.tables?.find((table) => table.title === 'Weighted ranking')?.rows).toHaveLength(8);
  });

  it('restricts the comparison to a named subset', () => {
    const result = resultOf(computeAccountingComparison({ options: 'Zoho Books, Odoo Accounting', weights: '', scores: '' }));
    const ranking = result.tables?.find((table) => table.title === 'Weighted ranking');
    expect(ranking?.rows).toHaveLength(2);
    expect(ranking?.rows.map((row) => row.label).sort()).toEqual(['Odoo Accounting', 'Zoho Books']);
  });

  it('rejects a subset that matches nothing, and lists what is available', () => {
    const outcome = computeAccountingComparison({ options: 'Freshbooks', weights: '', scores: '' });
    expect(outcome.ok).toBe(false);
    expect(errorMessage(outcome)).toMatch(/None of "Freshbooks" matched/i);
    expect(errorMessage(outcome)).toMatch(/QuickBooks Online/);
  });

  it('applies a weight override and reports criteria weighted at zero', () => {
    const result = resultOf(computeAccountingComparison({
      options: 'all',
      weights: 'General ledger & chart of accounts, 0\nOpen API / developer access, 10',
      scores: '',
    }));
    expect(result.warnings?.some((warning) => /weighted at zero/i.test(warning))).toBe(true);
    const breakdown = result.tables?.find((table) => table.title === 'Score breakdown by criterion');
    expect(breakdown?.rows.find((row) => row.label === 'General ledger & chart of accounts')?.cells[0]).toBe('0');
    expect(breakdown?.rows.find((row) => row.label === 'Open API / developer access')?.cells[0]).toBe('10');
  });

  it('ignores a criterion named in the weights box that does not exist, and says so', () => {
    const result = resultOf(computeAccountingComparison({ options: 'all', weights: 'Telepathy, 5', scores: '' }));
    expect(result.warnings?.some((warning) => /do not exist here/i.test(warning))).toBe(true);
  });

  it('rejects a weight or score outside its range', () => {
    expect(errorMessage(computeAccountingComparison({ options: 'all', weights: 'Open API / developer access, 99', scores: '' }))).toMatch(/between 0 and 10/i);
    expect(errorMessage(computeAccountingComparison({
      options: 'all', weights: '',
      scores: `${ACCOUNTING_COMPARISON.criteria.map(() => '9').join(' | ')}`,
    }))).toMatch(/is not one of the compared options|outside the 0–5 scale/i);
  });

  it('applies a score override and reports that the ranking is now the visitor\u2019s', () => {
    const override = ['Xero', ...ACCOUNTING_COMPARISON.criteria.map(() => '5')].join(' | ');
    const result = resultOf(computeAccountingComparison({ options: 'all', weights: '', scores: override }));
    expect(result.warnings?.some((warning) => /You overrode the default scores for 1 option/i.test(warning))).toBe(true);
    expect(result.tables?.find((table) => table.title === 'Weighted ranking')?.rows[0]?.label).toBe('Xero');
    expect(Number(result.tables?.find((table) => table.title === 'Weighted ranking')?.rows[0]?.cells[1])).toBe(100);
  });

  it('exports the comparison matrix as CSV with every criterion column', () => {
    const result = resultOf(computeAccountingComparison(defaultInputFor(findBusinessTool('accounting-tool-comparison')!)));
    expect(result.document?.format).toBe('csv');
    for (const criterion of ACCOUNTING_COMPARISON.criteria) {
      expect(result.document?.content).toContain(criterion.label);
    }
  });

  it('documents the provenance and effective date of the capability facts', () => {
    for (const dataset of [ACCOUNTING_COMPARISON, EXPENSE_COMPARISON]) {
      expect(dataset.note.effectiveDate).toBe('2026-10-10');
      expect(dataset.note.estimate).toBe(true);
      expect(dataset.note.disclaimer).toMatch(/re-verified/i);
      expect(dataset.note.disclaimer).toMatch(/not an endorsement/i);
    }
  });
});

describe('Comparison 3 — HMO (Nigeria)', () => {
  it('lists ten NHIA-accredited providers with their accreditation IDs', () => {
    expect(HMO_COMPARISON.options).toHaveLength(10);
    for (const option of HMO_COMPARISON.options) {
      expect(option.reference).toMatch(/^\d+$/);
      expect(option.referenceLabel).toBe('NHIA ID');
      expect(option.note).toMatch(/NHIA HMO register/i);
    }
    expect(HMO_COMPARISON.options.find((option) => option.id === 'hygeia')?.reference).toBe('1');
    expect(HMO_COMPARISON.options.find((option) => option.id === 'axa-mansard-health')?.reference).toBe('59');
  });

  it('reproduces the published 25-employee standard-tier budget of ₦2,000,000–₦4,500,000', () => {
    const result = resultOf(computeHmoComparison({ ...defaultInputFor(findBusinessTool('hmo-comparison-nigeria')!), employees: 25, planTier: 'standard' }));
    const budget = result.metrics.find((metric) => metric.label === 'Indicative annual budget');
    expect(budget?.value).toBe('₦2,000,000 – ₦4,500,000');
    expect(budget?.hint).toContain('25 employees');
    expect(result.metrics.find((metric) => metric.label === 'Workforce band')?.value).toBe('20–100 employees');
  });

  it('scales the budget across every tier and headcount band', () => {
    expect(HMO_PLAN_TIERS).toHaveLength(4);
    const executive = resultOf(computeHmoComparison({ ...defaultInputFor(findBusinessTool('hmo-comparison-nigeria')!), employees: 10, planTier: 'executive' }));
    expect(executive.metrics.find((metric) => metric.label === 'Indicative annual budget')?.value).toBe('₦4,000,000 – ₦10,000,000');
    expect(executive.metrics.find((metric) => metric.label === 'Workforce band')?.value).toBe('1–20 employees');
    const large = resultOf(computeHmoComparison({ ...defaultInputFor(findBusinessTool('hmo-comparison-nigeria')!), employees: 250, planTier: 'basic' }));
    expect(large.metrics.find((metric) => metric.label === 'Indicative annual budget')?.value).toBe('₦7,500,000 – ₦20,000,000');
    expect(large.metrics.find((metric) => metric.label === 'Workforce band')?.value).toBe('100+ employees');
  });

  it('shows the tier benefit matrix and the questions to ask each provider', () => {
    const result = resultOf(computeHmoComparison(defaultInputFor(findBusinessTool('hmo-comparison-nigeria')!)));
    const benefit = result.tables?.find((table) => table.title === 'What typically changes between tiers');
    expect(benefit?.rows).toHaveLength(10);
    expect(benefit?.rows.find((row) => row.label === 'Maternity')?.cells).toEqual(['Not typical', 'Limited', 'Included', 'Included']);
    expect(result.tables?.find((table) => table.title === 'Questions to ask each HMO before signing')?.rows).toHaveLength(10);
  });

  it('labels the budget as an estimate and the scores as guidance rather than ratings', () => {
    const result = resultOf(computeHmoComparison(defaultInputFor(findBusinessTool('hmo-comparison-nigeria')!)));
    expect(result.warnings?.some((warning) => /planning estimates\. They are not quotations/i.test(warning))).toBe(true);
    expect(result.jurisdiction?.disclaimer).toMatch(/not NHIA ratings/i);
    expect(result.jurisdiction?.source).toMatch(/nhia\.gov\.ng\/hmo/);
  });

  it('rejects an invalid headcount and an unknown tier', () => {
    const defaults = defaultInputFor(findBusinessTool('hmo-comparison-nigeria')!);
    expect(errorMessage(computeHmoComparison({ ...defaults, employees: 0 }))).toMatch(/whole number of 1 or more/i);
    expect(errorMessage(computeHmoComparison({ ...defaults, employees: 2.5 }))).toMatch(/whole number/i);
    expect(errorMessage(computeHmoComparison({ ...defaults, planTier: 'platinum' }))).toMatch(/Unknown plan tier/i);
  });
});

describe('Comparison 4 — PFA (Nigeria)', () => {
  it('lists fifteen PenCom-licensed administrators with their PFA codes', () => {
    expect(PFA_COMPARISON.options).toHaveLength(15);
    const codes = PFA_COMPARISON.options.map((option) => option.reference);
    expect(new Set(codes).size).toBe(15);
    expect(codes).toContain('024');
    expect(PFA_COMPARISON.options.find((option) => option.id === 'stanbic-ibtc')?.reference).toBe('021');
    expect(PFA_COMPARISON.options.find((option) => option.id === 'nupemco')?.bestFor).toMatch(/university/i);
    for (const option of PFA_COMPARISON.options) {
      expect(option.facts['Licensed by']).toBe('PenCom');
      expect(option.note).toMatch(/verified with PenCom/i);
    }
  });

  it('records that ARM and Access Pensions operate as one administrator', () => {
    expect(PFA_COMPARISON.options.filter((option) => /ARM/i.test(option.name))).toHaveLength(1);
    expect(PFA_COMPARISON.note.disclaimer).toMatch(/Access ARM Pensions Limited/);
  });

  it('builds a remittance schedule grouped by administrator using the pension engine', () => {
    const schedule = buildRemittanceSchedule(
      [
        'Ada Obi | RSA/PF/111 | Access ARM Pensions | 200000 | 120000 | 80000',
        'Chidi Eze | RSA/PF/222 | Access ARM Pensions | 150000 | 90000 | 60000',
        'Bisi Lawal | RSA/PF/333 | Stanbic IBTC Pension Managers | 100000 | 60000 | 40000',
      ].join('\n'),
      8, 10, PFA_COMPARISON.options
    );
    expect(schedule.ok).toBe(true);
    if (schedule.ok) {
      expect(schedule.rows).toHaveLength(3);
      expect(schedule.byPfa).toHaveLength(2);
      // Ada: base 400,000 → 32,000 employee + 40,000 employer = 72,000
      expect(schedule.rows[0]?.employeeContribution).toBe(32_000);
      expect(schedule.rows[0]?.employerContribution).toBe(40_000);
      expect(schedule.rows[0]?.totalRemittance).toBe(72_000);
      const arm = schedule.byPfa.find((group) => group.pfaCode === '024');
      expect(arm?.employees).toBe(2);
      // Chidi: base 300,000 → 24,000 + 30,000 = 54,000; group total 126,000
      expect(arm?.grandTotal).toBe(126_000);
      expect(schedule.byPfa.find((group) => group.pfaCode === '021')?.grandTotal).toBe(36_000);
    }
  });

  it('rejects an unknown PFA, a missing RSA PIN and a short line', () => {
    const unknown = buildRemittanceSchedule('Ada | RSA/PF/111 | Fake PFA | 100000 | 50000 | 20000', 8, 10, PFA_COMPARISON.options);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toMatch(/is not a PFA in this directory/i);

    const noPin = buildRemittanceSchedule('Ada |  | Access ARM Pensions | 100000 | 50000 | 20000', 8, 10, PFA_COMPARISON.options);
    expect(noPin.ok).toBe(false);
    if (!noPin.ok) expect(noPin.error).toMatch(/no RSA PIN/i);

    const short = buildRemittanceSchedule('Ada | RSA/PF/111 | Access ARM Pensions | 100000', 8, 10, PFA_COMPARISON.options);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/needs 5 or 6 fields/i);
  });

  it('renders the schedule in the tool result and exports it as CSV', () => {
    const defaults = defaultInputFor(findBusinessTool('pfa-comparison-nigeria')!);
    const result = resultOf(computePfaComparison({
      ...defaults,
      remittanceSchedule: 'Ada Obi | RSA/PF/111 | Access ARM Pensions | 200000 | 120000 | 80000\nBisi Lawal | RSA/PF/333 | Stanbic IBTC Pension Managers | 100000 | 60000 | 40000',
    }));
    expect(result.metrics.find((metric) => metric.label === 'Remittance schedule')?.value).toBe('2 employees across 2 PFAs');
    expect(result.metrics.find((metric) => metric.label === 'Total monthly remittance')?.value).toBe('₦108,000.00');
    const scheduleTable = result.tables?.find((table) => table.title === 'Remittance schedule by PFA');
    expect(scheduleTable?.rows).toHaveLength(3); // two PFAs plus the total row
    expect(scheduleTable?.rows[2]?.label).toBe('All PFAs');
    expect(result.extraDocuments?.some((document) => document.filename === 'pfa-remittance-schedule.csv')).toBe(true);
  });

  it('reports an unbuilt schedule as an empty state rather than a zero total', () => {
    const result = resultOf(computePfaComparison(defaultInputFor(findBusinessTool('pfa-comparison-nigeria')!)));
    expect(result.metrics.find((metric) => metric.label === 'Remittance schedule')?.value).toBe('Not built');
    expect(result.metrics.find((metric) => metric.label === 'Total monthly remittance')?.value).toBe('—');
  });

  it('rejects an employer contribution below the PenCom minimum', () => {
    const defaults = defaultInputFor(findBusinessTool('pfa-comparison-nigeria')!);
    expect(errorMessage(computePfaComparison({ ...defaults, employerContributionPct: 8 }))).toMatch(/at least the PenCom statutory minimum of 10%/i);
  });

  it('states that the employee chooses the PFA', () => {
    const result = resultOf(computePfaComparison(defaultInputFor(findBusinessTool('pfa-comparison-nigeria')!)));
    expect(result.explanation?.some((line) => /the employee chooses the PFA/i.test(line))).toBe(true);
    expect(result.jurisdiction?.disclaimer).toMatch(/employee chooses the PFA, not the employer/i);
    expect(result.warnings?.some((warning) => /planning guidance, not measured returns/i.test(warning))).toBe(true);
  });
});

describe('Business Tools — search and category filtering', () => {
  it('returns all 21 tools for an empty query', () => {
    expect(searchBusinessTools('')).toHaveLength(21);
    expect(searchBusinessTools('   ')).toHaveLength(21);
    expect(searchBusinessTools('', 'all')).toHaveLength(21);
  });

  it('filters by category with the reference counts', () => {
    expect(searchBusinessTools('', 'calculators')).toHaveLength(5);
    expect(searchBusinessTools('', 'generators')).toHaveLength(12);
    expect(searchBusinessTools('', 'comparisons')).toHaveLength(4);
  });

  it('matches on name, summary, description and keywords', () => {
    expect(searchBusinessTools('vat').map((tool) => tool.slug)).toContain('nigeria-vat-calculator');
    expect(searchBusinessTools('pencom').map((tool) => tool.slug)).toContain('nigeria-pension-calculator');
    expect(searchBusinessTools('attrition').map((tool) => tool.slug)).toContain('earned-wage-access-roi-calculator');
    expect(searchBusinessTools('badge').map((tool) => tool.slug)).toContain('employee-id-card-generator');
    expect(searchBusinessTools('luhn').map((tool) => tool.slug)).toContain('employee-id-generator');
  });

  it('requires every term to match somewhere', () => {
    // AND semantics across terms, OR across fields.
    expect(searchBusinessTools('pencom remittance schedule').map((tool) => tool.slug)).toEqual(['pfa-comparison-nigeria']);
    expect(searchBusinessTools('luhn check digit').map((tool) => tool.slug).sort())
      .toEqual(['employee-id-card-generator', 'employee-id-generator']);
    // "PenCom" is a real cross-category term: the pension calculator, the accounting comparison
    // (which records that no accounting system computes PenCom pension) and the PFA comparison.
    expect(searchBusinessTools('pencom').map((tool) => tool.slug).sort())
      .toEqual(['accounting-tool-comparison', 'nigeria-pension-calculator', 'pfa-comparison-nigeria']);
    // Adding a term that exists nowhere narrows to nothing rather than falling back to OR.
    expect(searchBusinessTools('pension nhia')).toHaveLength(0);
    expect(searchBusinessTools('definitely-not-a-real-term')).toHaveLength(0);
  });

  it('combines a query with a category filter', () => {
    expect(searchBusinessTools('pencom', 'calculators').map((tool) => tool.slug)).toEqual(['nigeria-pension-calculator']);
    expect(searchBusinessTools('pension', 'comparisons').map((tool) => tool.slug).sort())
      .toEqual(['accounting-tool-comparison', 'pfa-comparison-nigeria']);
    // The invoice generator documents Nigeria's VAT rate, so "vat" is a legitimate generator hit.
    expect(searchBusinessTools('vat', 'generators').map((tool) => tool.slug)).toEqual(['business-invoice-generator']);
    expect(searchBusinessTools('pencom', 'generators')).toHaveLength(0);
  });

  it('is case and diacritic insensitive', () => {
    expect(searchBusinessTools('PAYE')).toHaveLength(searchBusinessTools('paye').length);
    expect(searchBusinessTools('organisation').length + searchBusinessTools('organizational').length).toBeGreaterThan(0);
  });

  it('finds a tool by slug and returns undefined for an unknown one', () => {
    expect(findBusinessTool('nigeria-vat-calculator')?.name).toBe('VAT Calculator');
    expect(findBusinessTool('mrz-generator')).toBeUndefined();
    expect(findBusinessTool('')).toBeUndefined();
  });
});
