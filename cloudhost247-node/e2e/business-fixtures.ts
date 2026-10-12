/**
 * Sample inputs that satisfy every REQUIRED field of each SalarioPay-reference tool, as a careful
 * visitor would type them. Optional fields keep their declared defaults.
 *
 * Keys match the field keys in src/tools/business/registry.ts. A required field missing from this
 * map makes the test fail on the page's own validation message, so a gap is never hidden.
 */
export type FixtureValue = string | number | boolean;

export const BUSINESS_FIXTURES: Record<string, Record<string, FixtureValue>> = {
  // Calculators
  'nigeria-paye-net-salary-calculator': { monthlyAmount: 500000 },
  'nigeria-pension-calculator': { basicSalary: 200000, housingAllowance: 100000, transportAllowance: 50000 },
  'nigeria-vat-calculator': { amount: 100000 },
  'nigeria-employer-cost-calculator': { grossAmount: 500000 },
  'earned-wage-access-roi-calculator': {},

  // Generators
  'job-description-generator': {
    jobTitle: 'Payroll Officer',
    companyName: 'Acme Ltd',
    responsibilities: 'Own the monthly payroll run end to end\nMaintain the general ledger reconciliation',
    salaryMin: 400000,
    salaryMax: 600000,
  },
  'job-offer-letter-generator': {
    companyName: 'Acme Ltd',
    candidateName: 'Ada Okafor',
    jobTitle: 'Payroll Officer',
    salary: 600000,
  },
  'official-payslip-generator': {
    companyName: 'Acme Ltd',
    employeeName: 'Ada Okafor',
    payPeriod: '2026-09',
    earnings: 'Basic salary, 150000\nHousing allowance, 90000\nTransport allowance, 60000',
  },
  'nda-contract-generator': {
    disclosingParty: 'Acme Ltd',
    receivingParty: 'Globex Nigeria Ltd',
  },
  'employment-contract-generator': {
    employerName: 'Acme Ltd',
    employeeName: 'Ada Okafor',
    jobTitle: 'Payroll Officer',
    salary: 600000,
  },
  'cv-generator': {
    fullName: 'Ada Okafor',
    experience: 'Acme Ltd | Payroll Officer | 2022-03 | present | Ran a monthly payroll for 400 staff',
    education: 'University of Lagos | BSc | Accounting | 2019',
  },
  'business-invoice-generator': {
    businessName: 'Acme Ltd',
    clientName: 'Globex Nigeria Ltd',
    invoiceNumber: 'INV-2026-001',
    lineItems: 'Managed VPS hosting, 3, 45000\nMigration and setup, 1, 120000, 0',
  },
  'business-card-generator': { fullName: 'Ada Okafor' },
  'employee-id-generator': {
    companyPrefix: 'CH247',
    departmentCode: 'OPS',
    year: '2026',
  },
  'organizational-chart-generator': {
    people: 'Ada Obi | Chief Executive |\nChidi Eze | Head of Engineering | Ada Obi\nBisi Lawal | Platform Engineer | Chidi Eze',
  },
  'linkedin-engagement-assistant': {
    postText: 'Payroll deadlines are easier to hit when every input is reconciled before the run starts.',
  },

  // Comparisons: the shipped default weights and scores are used unless overridden.
  'accounting-tool-comparison': {},
  'expense-tool-comparison': {},
  'hmo-comparison-nigeria': {},
  'pfa-comparison-nigeria': {},
};
