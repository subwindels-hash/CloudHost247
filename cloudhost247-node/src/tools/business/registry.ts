/**
 * Business Tools — the canonical registry of all 21 tools.
 *
 *   Calculators  5   ·   Generators  12   ·   Comparisons  4
 *
 * This file is data, not pages. Every entry pairs a declarative form schema with a pure compute
 * function, which is what lets one workspace component render all 21 tools and one test file assert
 * all 21 of them. Adding a tool means adding an entry here; no new page, route handler or component
 * is required.
 *
 * The category counts are asserted by `tests/unit/business-tools-engines.test.ts` against the
 * reference taxonomy, so a tool moved between categories fails the build rather than quietly
 * changing what the page advertises.
 */

import {
  NIGERIA_EMPLOYER_COST_NOTE,
  NIGERIA_PENSION_NOTE,
  NIGERIA_TAX_NOTE_2026,
  NIGERIA_VAT_NOTE,
  EWA_ROI_NOTE,
  computeEmployerCostCalculator,
  computeEwaRoiCalculator,
  computePayeCalculator,
  computePensionCalculator,
  computeVatCalculator,
} from './calculators';
import {
  computeCv,
  computeEmploymentContract,
  computeJobDescription,
  computeJobOfferLetter,
  computeNdaContract,
  computePayslip,
} from './generators';
import {
  computeBusinessCard,
  computeBusinessInvoice,
  computeEmployeeIdCard,
  computeEmployeeIdGenerator,
  computeLinkedInEngagementAssistant,
  computeOrganizationalChart,
  INVOICE_TAX_NOTE,
} from './generators-assets';
import {
  ACCOUNTING_COMPARISON,
  EXPENSE_COMPARISON,
  HMO_COMPARISON,
  PFA_COMPARISON,
  computeAccountingComparison,
  computeExpenseComparison,
  computeHmoComparison,
  computePfaComparison,
  defaultScoresTemplate,
  defaultWeightsTemplate,
} from './comparisons';
import type {
  BusinessField,
  BusinessTool,
  BusinessToolCategory,
} from './types';

export const BUSINESS_TOOLS_ROOT = '/tools/business-tools';

const CURRENCY_OPTIONS = [
  { value: 'NGN', label: 'NGN — Nigerian naira (₦)' },
  { value: 'USD', label: 'USD — US dollar ($)' },
  { value: 'EUR', label: 'EUR — Euro (€)' },
  { value: 'GBP', label: 'GBP — Pound sterling (£)' },
];

/* ================================================================== */
/* Calculators                                                         */
/* ================================================================== */

const PAYE_FIELDS: BusinessField[] = [
  {
    key: 'calculateFrom', label: 'Calculate from', type: 'select', default: 'gross', section: 'Basis',
    options: [
      { value: 'gross', label: 'Gross pay — find the take-home' },
      { value: 'net', label: 'Net pay (take-home) — find the gross needed' },
    ],
    help: 'Solving from a net target searches for the gross that produces it under the same assumptions.',
  },
  { key: 'monthlyAmount', label: 'Monthly amount', type: 'money', required: true, min: 0, prefix: '₦', section: 'Basis', help: 'Gross salary, or the take-home you want if you selected "Net pay".' },
  { key: 'basicPct', label: 'Basic salary', type: 'percent', default: 40, min: 0, max: 100, suffix: '%', section: 'Salary structure', help: 'Share of gross. Basic + housing + transport + reimbursement must total 100%.' },
  { key: 'housingPct', label: 'Housing allowance', type: 'percent', default: 30, min: 0, max: 100, suffix: '%', section: 'Salary structure' },
  { key: 'transportPct', label: 'Transport allowance', type: 'percent', default: 20, min: 0, max: 100, suffix: '%', section: 'Salary structure' },
  { key: 'reimbursementPct', label: 'Reimbursement', type: 'percent', default: 10, min: 0, max: 100, suffix: '%', section: 'Salary structure' },
  { key: 'pensionEmployeePct', label: 'Employee pension', type: 'percent', default: 8, min: 0, max: 50, suffix: '%', section: 'Statutory rates', help: 'Charged on basic + housing + transport. The Pension Reform Act 2014 sets 8%.' },
  { key: 'nhfPct', label: 'NHF housing fund', type: 'percent', default: 2.5, min: 0, max: 50, suffix: '%', section: 'Statutory rates', help: 'Charged on gross. Set to 0 if your employer does not operate NHF — it is optional for the private sector.' },
  { key: 'nhisPct', label: 'NHIS health insurance', type: 'percent', default: 5, min: 0, max: 50, suffix: '%', section: 'Statutory rates', help: 'Employee share, charged on basic salary.' },
  { key: 'monthlyRent', label: 'Monthly rent paid', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Reliefs', help: 'Rent relief is 20% of annual rent, capped at ₦500,000.' },
  { key: 'annualMortgageInterest', label: 'Annual mortgage interest (self-occupied home)', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Reliefs' },
  { key: 'annualLifeInsurance', label: 'Annual life insurance premium (self or spouse)', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Reliefs' },
  { key: 'monthlyOtherDeductions', label: 'Other monthly deductions', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Reliefs', help: 'Deducted from net pay. Not a tax relief — it does not reduce taxable income.' },
  { key: 'isMilitary', label: 'Military officer (income tax-exempt)', type: 'boolean', default: false, section: 'Status' },
  { key: 'isMinimumWageEarner', label: 'National minimum wage earner (tax-exempt)', type: 'boolean', default: false, section: 'Status' },
  { key: 'isIndependentConsultant', label: 'Independent consultant (5% WHT instead of PAYE)', type: 'boolean', default: false, section: 'Status', help: 'Applies flat withholding tax in place of the progressive bands.' },
  { key: 'whtRatePct', label: 'Consultant withholding tax rate', type: 'percent', default: 5, min: 0, max: 100, suffix: '%', section: 'Status' },
];

const PENSION_FIELDS: BusinessField[] = [
  { key: 'payPeriod', label: 'Pay period', type: 'select', default: 'monthly', options: [{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }] },
  { key: 'basicSalary', label: 'Basic salary', type: 'money', required: true, min: 0, prefix: '₦', help: 'Pension is charged on basic plus housing plus transport.' },
  { key: 'housingAllowance', label: 'Housing allowance', type: 'money', required: true, min: 0, prefix: '₦' },
  { key: 'transportAllowance', label: 'Transport allowance', type: 'money', required: true, min: 0, prefix: '₦' },
  { key: 'employeePct', label: 'Employee contribution', type: 'percent', default: 8, min: 0, max: 50, suffix: '%', help: 'The Pension Reform Act 2014 sets 8%. Below that is flagged as non-compliant.' },
  { key: 'employerPct', label: 'Employer contribution', type: 'percent', default: 10, min: 10, max: 50, suffix: '%', help: 'PenCom minimum is 10%. An employer may contribute more, never less — a lower figure is rejected.' },
];

const VAT_FIELDS: BusinessField[] = [
  { key: 'mode', label: 'Direction', type: 'select', default: 'add', options: [{ value: 'add', label: 'Add VAT to a net amount' }, { value: 'remove', label: 'Remove VAT from a gross amount' }] },
  { key: 'rate', label: 'VAT rate', type: 'percent', default: 7.5, min: 0, max: 100, suffix: '%', help: 'Nigeria\u2019s standard rate is 7.5%. Change it for another jurisdiction or a different rate class.' },
  { key: 'amount', label: 'Base amount', type: 'money', required: true, min: 0, prefix: '₦', help: 'The net amount if you are adding VAT, or the VAT-inclusive amount if you are removing it.' },
];

const EMPLOYER_COST_FIELDS: BusinessField[] = [
  { key: 'salaryPeriod', label: 'Salary period', type: 'select', default: 'monthly', options: [{ value: 'monthly', label: 'Monthly gross salary' }, { value: 'annual', label: 'Annual gross salary' }] },
  { key: 'grossAmount', label: 'Gross amount', type: 'money', required: true, min: 0, prefix: '₦' },
  { key: 'basicPct', label: 'Basic salary', type: 'percent', default: 50, min: 0, max: 100, suffix: '%', section: 'Salary structure', help: 'Basic + housing + transport must total 100%, because employer pension is charged on their sum.' },
  { key: 'housingPct', label: 'Housing allowance', type: 'percent', default: 30, min: 0, max: 100, suffix: '%', section: 'Salary structure' },
  { key: 'transportPct', label: 'Transport allowance', type: 'percent', default: 20, min: 0, max: 100, suffix: '%', section: 'Salary structure' },
  { key: 'employerPensionPct', label: 'Employer pension', type: 'percent', default: 10, min: 0, max: 50, suffix: '%', section: 'Statutory employer contributions', help: 'Minimum 10% of basic + housing + transport for employers with 15 or more staff.' },
  { key: 'nsitfPct', label: 'NSITF employees\u2019 compensation levy', type: 'percent', default: 1, min: 0, max: 20, suffix: '%', section: 'Statutory employer contributions', help: '1% of gross earnings under the Employees\u2019 Compensation Act.' },
  { key: 'groupLifePct', label: 'Group life insurance premium', type: 'percent', default: 1.5, min: 0, max: 20, suffix: '%', section: 'Statutory employer contributions', help: 'Estimated premium. The Pension Act requires cover of at least 3x annual emoluments for employers with 3 or more workers.' },
  { key: 'applyItf', label: 'Apply the ITF training levy', type: 'boolean', default: false, section: 'Statutory employer contributions', help: 'Applies to companies with 5 or more staff or turnover above ₦50M.' },
  { key: 'itfPct', label: 'ITF training levy', type: 'percent', default: 1, min: 0, max: 20, suffix: '%', section: 'Statutory employer contributions' },
  { key: 'applyEmployerNhis', label: 'Apply employer NHIS health cover', type: 'boolean', default: false, section: 'Statutory employer contributions', help: 'Modelled for statutory public-sector structures.' },
  { key: 'employerNhisPct', label: 'Employer NHIS', type: 'percent', default: 10, min: 0, max: 50, suffix: '%', section: 'Statutory employer contributions', help: 'Charged on basic salary.' },
  { key: 'monthlyHmo', label: 'Monthly HMO medical premium (per staff)', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Health insurance and perks' },
  { key: 'monthlyPerks', label: 'Other monthly perks (gym, lunch, etc.)', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Health insurance and perks' },
  { key: 'equipmentOneOff', label: 'Equipment and workstation (one-off)', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Technology and workspace', help: 'Laptop, monitor, desk and accessories. Incurred once, not annually.' },
  { key: 'monthlyOfficeRent', label: 'Monthly office space allotment (per desk)', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Technology and workspace' },
  { key: 'monthlyInternet', label: 'Monthly internet / data allowance', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Technology and workspace' },
  { key: 'monthlyPower', label: 'Monthly power / fuel stipend', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Technology and workspace' },
  { key: 'recruitmentOneOff', label: 'Recruitment / agency commission (one-off)', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Recruiting and development' },
  { key: 'annualTraining', label: 'Annual training and upskilling stipend', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Recruiting and development' },
  { key: 'annualBonus', label: 'Expected annual bonus / 13th month', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Recruiting and development' },
];

const EWA_FIELDS: BusinessField[] = [
  { key: 'totalEmployees', label: 'Total employees', type: 'integer', default: 100, min: 1, max: 1_000_000, section: 'Workforce' },
  { key: 'averageAnnualSalary', label: 'Average annual salary per employee', type: 'money', default: 3_600_000, min: 1, prefix: '₦', section: 'Workforce' },
  { key: 'turnoverRatePct', label: 'Annual employee turnover rate', type: 'percent', default: 20, min: 0, max: 100, suffix: '%', section: 'Attrition' },
  { key: 'replacementCostPct', label: 'Cost to replace an employee', type: 'percent', default: 33, min: 0, max: 500, suffix: '%', section: 'Attrition', help: 'As a percentage of annual salary. Recruitment, onboarding, lost productivity and ramp-up.' },
  { key: 'turnoverReductionPct', label: 'Expected turnover reduction from EWA', type: 'percent', default: 20, min: 0, max: 100, suffix: '%', section: 'Programme', help: 'An assumption you enter, not a guaranteed or regulated figure. Published research for this model cites up to 20%.' },
  { key: 'annualProgrammeCost', label: 'Annual programme cost to the employer', type: 'money', default: 0, min: 0, prefix: '₦', section: 'Programme', help: 'Setup plus annual fees. At ₦0 a return-on-investment ratio cannot be computed.' },
];

/* ================================================================== */
/* Generators                                                          */
/* ================================================================== */

const JOB_DESCRIPTION_FIELDS: BusinessField[] = [
  { key: 'jobTitle', label: 'Job title', type: 'text', required: true, maxLength: 120, section: 'Role' },
  { key: 'companyName', label: 'Company name', type: 'text', maxLength: 120, section: 'Role' },
  { key: 'department', label: 'Department or team', type: 'text', maxLength: 80, section: 'Role' },
  { key: 'level', label: 'Seniority level', type: 'select', default: 'mid', section: 'Role', options: [
    { value: 'intern', label: 'Internship' }, { value: 'entry', label: 'Entry level' }, { value: 'mid', label: 'Mid level' },
    { value: 'senior', label: 'Senior' }, { value: 'lead', label: 'Lead / Principal' }, { value: 'manager', label: 'Manager' },
    { value: 'head', label: 'Head of function' }, { value: 'director', label: 'Director' },
  ] },
  { key: 'employmentType', label: 'Employment type', type: 'select', default: 'full-time', section: 'Role', options: [
    { value: 'full-time', label: 'Full-time' }, { value: 'part-time', label: 'Part-time' },
    { value: 'contract', label: 'Contract' }, { value: 'internship', label: 'Internship' }, { value: 'temporary', label: 'Temporary' },
  ] },
  { key: 'workMode', label: 'Working arrangement', type: 'select', default: 'onsite', section: 'Role', options: [
    { value: 'onsite', label: 'On-site' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'remote', label: 'Remote' },
  ] },
  { key: 'location', label: 'Location', type: 'text', maxLength: 120, section: 'Role', placeholder: 'Lagos, Nigeria' },
  { key: 'yearsExperience', label: 'Years of experience expected', type: 'number', default: 3, min: 0, max: 60, section: 'Role', help: 'Zero means the description says skills matter more than tenure.' },
  { key: 'aboutCompany', label: 'About the company', type: 'textarea', maxLength: 1200, section: 'Content', help: 'Two or three sentences. Shown as its own section.' },
  { key: 'responsibilities', label: 'Key responsibilities', type: 'lines', required: true, section: 'Content', help: 'One per line, 3–8 lines works best. Start each with a verb.', placeholder: 'Own the monthly payroll run end to end\nMaintain the general ledger reconciliation' },
  { key: 'requiredSkills', label: 'Required skills', type: 'textarea', section: 'Content', help: 'Comma separated. These are the must-haves.', placeholder: 'Payroll processing, Nigerian PAYE, Excel' },
  { key: 'preferredSkills', label: 'Preferred skills', type: 'textarea', section: 'Content', help: 'Comma separated. Nice to have, not a filter.' },
  { key: 'qualifications', label: 'Qualifications and certifications', type: 'lines', section: 'Content', help: 'One per line.' },
  { key: 'benefits', label: 'Benefits', type: 'lines', section: 'Content', help: 'One per line.' },
  { key: 'includeSalary', label: 'Publish the salary range', type: 'boolean', default: true, section: 'Compensation', help: 'Listings that publish pay attract more and better-matched applications.' },
  { key: 'currency', label: 'Currency', type: 'select', default: 'NGN', options: CURRENCY_OPTIONS, section: 'Compensation' },
  { key: 'salaryPeriod', label: 'Salary period', type: 'select', default: 'year', section: 'Compensation', options: [
    { value: 'year', label: 'Per year' }, { value: 'month', label: 'Per month' }, { value: 'hour', label: 'Per hour' },
  ] },
  { key: 'salaryMin', label: 'Lower bound', type: 'money', min: 0, section: 'Compensation' },
  { key: 'salaryMax', label: 'Upper bound', type: 'money', min: 0, section: 'Compensation' },
  { key: 'applicationInstructions', label: 'How to apply', type: 'textarea', maxLength: 600, section: 'Content' },
];

const OFFER_LETTER_FIELDS: BusinessField[] = [
  { key: 'companyName', label: 'Company legal name', type: 'text', required: true, maxLength: 160, section: 'Employer' },
  { key: 'letterDate', label: 'Letter date', type: 'date', section: 'Employer', help: 'Defaults to the start date if left blank.' },
  { key: 'signatoryName', label: 'Signatory name', type: 'text', maxLength: 120, section: 'Employer' },
  { key: 'signatoryTitle', label: 'Signatory title', type: 'text', maxLength: 120, section: 'Employer' },
  { key: 'signatoryEmail', label: 'Signatory email', type: 'text', maxLength: 160, section: 'Employer' },
  { key: 'candidateName', label: 'Candidate full name', type: 'text', required: true, maxLength: 160, section: 'Candidate' },
  { key: 'jobTitle', label: 'Job title', type: 'text', required: true, maxLength: 120, section: 'Candidate' },
  { key: 'department', label: 'Department', type: 'text', maxLength: 80, section: 'Candidate' },
  { key: 'reportingTo', label: 'Reporting to', type: 'text', maxLength: 120, section: 'Candidate' },
  { key: 'employmentType', label: 'Employment type', type: 'select', default: 'full-time', section: 'Candidate', options: [
    { value: 'full-time', label: 'Full-time' }, { value: 'part-time', label: 'Part-time' },
    { value: 'contract', label: 'Contract' }, { value: 'internship', label: 'Internship' },
  ] },
  { key: 'workMode', label: 'Working arrangement', type: 'select', default: 'onsite', section: 'Candidate', options: [
    { value: 'onsite', label: 'On-site' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'remote', label: 'Remote' },
  ] },
  { key: 'location', label: 'Work location', type: 'text', maxLength: 120, section: 'Candidate' },
  { key: 'startDate', label: 'Commencement date', type: 'date', section: 'Terms' },
  { key: 'offerValidUntil', label: 'Acceptance deadline', type: 'date', section: 'Terms', help: 'Must be on or before the commencement date.' },
  { key: 'currency', label: 'Currency', type: 'select', default: 'NGN', options: CURRENCY_OPTIONS, section: 'Terms' },
  { key: 'salaryPeriod', label: 'Salary period', type: 'select', default: 'year', section: 'Terms', options: [
    { value: 'year', label: 'Per year' }, { value: 'month', label: 'Per month' },
  ] },
  { key: 'salary', label: 'Gross salary', type: 'money', required: true, min: 0, section: 'Terms' },
  { key: 'bonus', label: 'Bonus or variable pay', type: 'text', maxLength: 200, section: 'Terms', placeholder: '10% of annual gross, discretionary' },
  { key: 'probationMonths', label: 'Probationary period (months)', type: 'integer', default: 3, min: 0, max: 24, section: 'Terms' },
  { key: 'noticePeriod', label: 'Notice period', type: 'text', maxLength: 120, section: 'Terms', placeholder: 'One month in writing' },
  { key: 'benefits', label: 'Benefits', type: 'lines', section: 'Terms', help: 'One per line.' },
  { key: 'conditions', label: 'Conditions of this offer', type: 'lines', section: 'Terms', help: 'One per line. The letter states that the offer is conditional on each being satisfied.', placeholder: 'Satisfactory references\nProof of right to work' },
];

const PAYSLIP_FIELDS: BusinessField[] = [
  { key: 'companyName', label: 'Employer name', type: 'text', required: true, maxLength: 160, section: 'Employer' },
  { key: 'companyAddress', label: 'Employer address', type: 'textarea', maxLength: 300, section: 'Employer' },
  { key: 'employeeName', label: 'Employee name', type: 'text', required: true, maxLength: 160, section: 'Employee' },
  { key: 'employeeId', label: 'Employee ID', type: 'text', maxLength: 40, section: 'Employee' },
  { key: 'designation', label: 'Designation', type: 'text', maxLength: 120, section: 'Employee' },
  { key: 'department', label: 'Department', type: 'text', maxLength: 80, section: 'Employee' },
  { key: 'payPeriod', label: 'Pay period', type: 'month', required: true, section: 'Period', help: 'YYYY-MM' },
  { key: 'paymentDate', label: 'Payment date', type: 'date', section: 'Period' },
  { key: 'workingDays', label: 'Working days in period', type: 'integer', default: 0, min: 0, max: 31, section: 'Period', help: 'Used to sanity-check loss-of-pay days. Zero means no check.' },
  { key: 'paidDays', label: 'Paid days', type: 'integer', min: 0, max: 31, section: 'Period' },
  { key: 'lopDays', label: 'Loss-of-pay days', type: 'integer', default: 0, min: 0, max: 31, section: 'Period' },
  { key: 'currency', label: 'Currency', type: 'select', default: 'NGN', options: CURRENCY_OPTIONS, section: 'Pay' },
  { key: 'earnings', label: 'Earnings', type: 'lines', required: true, section: 'Pay', help: 'One per line as "Component, Amount". The statutory block needs lines named basic, housing and transport.', placeholder: 'Basic salary, 150000\nHousing allowance, 90000\nTransport allowance, 60000' },
  { key: 'deductions', label: 'Other deductions', type: 'lines', section: 'Pay', help: 'One per line as "Component, Amount". Leave blank if you are using the statutory block.', placeholder: 'Staff loan repayment, 10000' },
  { key: 'applyStatutory', label: 'Add statutory deductions (pension, NHF, NHIS, PAYE)', type: 'boolean', default: false, section: 'Pay', help: 'Computed from your basic, housing and transport lines with the same engine as the PAYE calculator. Does not apply reliefs.' },
  { key: 'bankName', label: 'Bank name', type: 'text', maxLength: 120, section: 'Payment' },
  { key: 'bankAccount', label: 'Bank account number', type: 'text', maxLength: 40, section: 'Payment' },
];

const NDA_FIELDS: BusinessField[] = [
  { key: 'structure', label: 'Structure', type: 'select', default: 'one-way', section: 'Parties', options: [
    { value: 'one-way', label: 'One-way — one party discloses' },
    { value: 'mutual', label: 'Mutual — both parties disclose' },
  ] },
  { key: 'disclosingParty', label: 'Disclosing party (legal name)', type: 'text', required: true, maxLength: 200, section: 'Parties' },
  { key: 'disclosingAddress', label: 'Disclosing party address', type: 'textarea', maxLength: 300, section: 'Parties' },
  { key: 'receivingParty', label: 'Receiving party (legal name)', type: 'text', required: true, maxLength: 200, section: 'Parties', help: 'Must differ from the disclosing party.' },
  { key: 'receivingAddress', label: 'Receiving party address', type: 'textarea', maxLength: 300, section: 'Parties' },
  { key: 'effectiveDate', label: 'Effective date', type: 'date', section: 'Term' },
  { key: 'termYears', label: 'Agreement term (years)', type: 'integer', default: 2, min: 0, max: 50, section: 'Term', help: 'Zero means the agreement runs indefinitely until terminated on notice.' },
  { key: 'survivalYears', label: 'Confidentiality survival (years)', type: 'integer', default: 3, min: 0, max: 50, section: 'Term', help: 'Trade secrets are always protected for as long as they remain trade secrets, whatever you set here.' },
  { key: 'purpose', label: 'Purpose of the disclosure', type: 'text', maxLength: 300, section: 'Scope', placeholder: 'evaluating a potential hosting and managed-services engagement' },
  { key: 'returnOrDestroy', label: 'On termination', type: 'select', default: 'return-or-destroy', section: 'Scope', options: [
    { value: 'return-or-destroy', label: 'Discloser chooses return or destruction' },
    { value: 'destroy-only', label: 'Destruction only, with written certification' },
  ] },
  { key: 'includeNonSolicit', label: 'Include a non-solicitation clause', type: 'boolean', default: false, section: 'Additional clauses' },
  { key: 'nonSolicitMonths', label: 'Non-solicitation period (months)', type: 'integer', default: 12, min: 0, max: 60, section: 'Additional clauses' },
  { key: 'includeResiduals', label: 'Include a residual-knowledge clause', type: 'boolean', default: false, section: 'Additional clauses', help: 'Lets the recipient use unaided-memory knowledge, excluding any tangible copy.' },
  { key: 'governingLaw', label: 'Governing law', type: 'text', default: 'the Federal Republic of Nigeria', maxLength: 160, section: 'Law' },
  { key: 'jurisdictionVenue', label: 'Exclusive jurisdiction', type: 'text', default: 'the courts of the Federal Republic of Nigeria', maxLength: 200, section: 'Law' },
];

const EMPLOYMENT_CONTRACT_FIELDS: BusinessField[] = [
  { key: 'employerName', label: 'Employer legal name', type: 'text', required: true, maxLength: 200, section: 'Parties' },
  { key: 'employeeName', label: 'Employee full name', type: 'text', required: true, maxLength: 160, section: 'Parties' },
  { key: 'jobTitle', label: 'Job title', type: 'text', required: true, maxLength: 120, section: 'Role' },
  { key: 'department', label: 'Department', type: 'text', maxLength: 80, section: 'Role' },
  { key: 'reportsTo', label: 'Reports to', type: 'text', maxLength: 120, section: 'Role' },
  { key: 'duties', label: 'Principal duties', type: 'lines', section: 'Role', help: 'One per line.' },
  { key: 'contractType', label: 'Contract type', type: 'select', default: 'permanent', section: 'Term', options: [
    { value: 'permanent', label: 'Permanent' }, { value: 'fixed-term', label: 'Fixed term' },
  ] },
  { key: 'startDate', label: 'Commencement date', type: 'date', section: 'Term' },
  { key: 'endDate', label: 'End date', type: 'date', section: 'Term', help: 'Required for a fixed-term contract and must fall after the start date.' },
  { key: 'probationMonths', label: 'Probationary period (months)', type: 'integer', default: 3, min: 0, max: 24, section: 'Term' },
  { key: 'workMode', label: 'Working arrangement', type: 'select', default: 'onsite', section: 'Work', options: [
    { value: 'onsite', label: 'On-site' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'remote', label: 'Remote' },
  ] },
  { key: 'workLocation', label: 'Work location', type: 'text', maxLength: 200, section: 'Work' },
  { key: 'weeklyHours', label: 'Hours per week', type: 'number', default: 40, min: 1, max: 80, section: 'Work' },
  { key: 'currency', label: 'Currency', type: 'select', default: 'NGN', options: CURRENCY_OPTIONS, section: 'Pay' },
  { key: 'salaryPeriod', label: 'Salary period', type: 'select', default: 'year', section: 'Pay', options: [
    { value: 'year', label: 'Per year' }, { value: 'month', label: 'Per month' },
  ] },
  { key: 'salary', label: 'Gross salary', type: 'money', required: true, min: 0, section: 'Pay' },
  { key: 'allowances', label: 'Allowances and additional pay', type: 'lines', section: 'Pay', help: 'One per line, e.g. "Housing allowance: 30% of basic salary".' },
  { key: 'annualLeaveDays', label: 'Annual leave (working days)', type: 'integer', default: 20, min: 0, max: 90, section: 'Leave', help: 'Fewer than 6 days triggers an advisory referencing the Labour Act minimum.' },
  { key: 'noticeEmployeeMonths', label: 'Notice from employee (months)', type: 'integer', default: 1, min: 0, max: 24, section: 'Termination' },
  { key: 'noticeEmployerMonths', label: 'Notice from employer (months)', type: 'integer', default: 1, min: 0, max: 24, section: 'Termination' },
  { key: 'includeConfidentiality', label: 'Include a confidentiality clause', type: 'boolean', default: true, section: 'Additional clauses' },
  { key: 'includeIpAssignment', label: 'Include an intellectual-property assignment', type: 'boolean', default: true, section: 'Additional clauses' },
  { key: 'includeNonCompete', label: 'Include post-termination restrictive covenants', type: 'boolean', default: false, section: 'Additional clauses' },
  { key: 'nonCompeteMonths', label: 'Restrictive covenant period (months)', type: 'integer', default: 6, min: 0, max: 36, section: 'Additional clauses' },
  { key: 'governingLaw', label: 'Governing law', type: 'text', default: 'the Federal Republic of Nigeria', maxLength: 160, section: 'Law' },
];

const CV_FIELDS: BusinessField[] = [
  { key: 'fullName', label: 'Full name', type: 'text', required: true, maxLength: 120, section: 'Identity' },
  { key: 'professionalTitle', label: 'Professional title', type: 'text', maxLength: 120, section: 'Identity', placeholder: 'Payroll & Compliance Specialist' },
  { key: 'email', label: 'Email', type: 'text', maxLength: 160, section: 'Identity' },
  { key: 'phone', label: 'Phone', type: 'text', maxLength: 40, section: 'Identity' },
  { key: 'location', label: 'Location', type: 'text', maxLength: 120, section: 'Identity' },
  { key: 'links', label: 'Links (LinkedIn, portfolio, GitHub)', type: 'textarea', maxLength: 600, section: 'Identity', help: 'Comma separated.' },
  { key: 'summary', label: 'Professional summary', type: 'textarea', maxLength: 1200, section: 'Content', help: 'Three or four sentences. Longer summaries are skimmed or skipped.' },
  { key: 'skills', label: 'Core skills', type: 'textarea', maxLength: 1200, section: 'Content', help: 'Comma separated. More than about 25 starts to look like keyword stuffing.' },
  { key: 'experience', label: 'Work experience', type: 'lines', section: 'Content', help: 'One role per line as: Company | Role | Start (YYYY-MM) | End (YYYY-MM or "present") | Achievements separated by semicolons', placeholder: 'Acme Ltd | Payroll Officer | 2022-03 | present | Ran a 400-person monthly payroll with zero missed deadlines; Cut reconciliation time by 40%' },
  { key: 'education', label: 'Education', type: 'lines', section: 'Content', help: 'One per line as: Institution | Qualification | Field of study | Year', placeholder: 'University of Lagos | BSc | Accounting | 2019' },
  { key: 'projects', label: 'Projects', type: 'lines', section: 'Content', help: 'One per line. Useful when experience is thin.' },
  { key: 'certifications', label: 'Certifications', type: 'lines', section: 'Content', help: 'One per line.' },
  { key: 'languages', label: 'Languages', type: 'lines', section: 'Content', help: 'One per line, with proficiency.' },
  { key: 'atsFriendly', label: 'ATS-friendly plain text', type: 'boolean', default: true, section: 'Format', help: 'Upper-case headings, no Markdown and no tables — the format applicant-tracking systems parse most reliably.' },
];

const INVOICE_FIELDS: BusinessField[] = [
  { key: 'businessName', label: 'Your business name', type: 'text', required: true, maxLength: 160, section: 'From' },
  { key: 'businessAddress', label: 'Your address', type: 'textarea', maxLength: 300, section: 'From' },
  { key: 'businessEmail', label: 'Your email', type: 'text', maxLength: 160, section: 'From' },
  { key: 'businessPhone', label: 'Your phone', type: 'text', maxLength: 40, section: 'From' },
  { key: 'taxId', label: 'Your tax identification number', type: 'text', maxLength: 40, section: 'From', help: 'A VAT invoice normally has to show the supplier\u2019s registration number.' },
  { key: 'clientName', label: 'Client or customer name', type: 'text', required: true, maxLength: 160, section: 'Bill to' },
  { key: 'clientAddress', label: 'Client address', type: 'textarea', maxLength: 300, section: 'Bill to' },
  { key: 'clientEmail', label: 'Client email', type: 'text', maxLength: 160, section: 'Bill to' },
  { key: 'clientTaxId', label: 'Client tax identification number', type: 'text', maxLength: 40, section: 'Bill to' },
  { key: 'invoiceNumber', label: 'Invoice number', type: 'text', required: true, maxLength: 40, section: 'Invoice', help: 'Unique and sequential in most tax regimes.' },
  { key: 'issueDate', label: 'Issue date', type: 'date', section: 'Invoice' },
  { key: 'dueDate', label: 'Due date', type: 'date', section: 'Invoice', help: 'Must be on or after the issue date.' },
  { key: 'currency', label: 'Currency', type: 'select', default: 'NGN', options: CURRENCY_OPTIONS, section: 'Invoice' },
  { key: 'taxRate', label: 'Default tax rate', type: 'percent', default: 7.5, min: 0, max: 100, suffix: '%', section: 'Line items', help: 'Per-line rates override this. Nigeria\u2019s standard VAT rate is 7.5%.' },
  { key: 'lineItems', label: 'Line items', type: 'lines', required: true, section: 'Line items', help: 'One per line as "Description, Quantity, Unit price" and optionally ", Tax rate %".', placeholder: 'Managed VPS hosting, 3, 45000\nMigration and setup, 1, 120000, 0' },
  { key: 'discountPct', label: 'Discount (%)', type: 'percent', default: 0, min: 0, max: 100, section: 'Totals', help: 'Spread pro-rata across the lines, so tax is charged on the discounted value.' },
  { key: 'discountAmount', label: 'Discount (amount)', type: 'money', default: 0, min: 0, section: 'Totals' },
  { key: 'shipping', label: 'Shipping or delivery', type: 'money', default: 0, min: 0, section: 'Totals' },
  { key: 'amountPaid', label: 'Amount already paid', type: 'money', default: 0, min: 0, section: 'Totals', help: 'Sets the balance due and the paid / part-paid / unpaid status.' },
  { key: 'paymentTerms', label: 'Payment terms', type: 'textarea', maxLength: 400, section: 'Payment' },
  { key: 'bankDetails', label: 'Payment details', type: 'lines', section: 'Payment', help: 'One per line: bank, account name, account number.' },
  { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 600, section: 'Payment' },
];

const BUSINESS_CARD_FIELDS: BusinessField[] = [
  { key: 'fullName', label: 'Full name', type: 'text', required: true, maxLength: 60, section: 'Identity' },
  { key: 'jobTitle', label: 'Job title', type: 'text', maxLength: 60, section: 'Identity' },
  { key: 'companyName', label: 'Company name', type: 'text', maxLength: 60, section: 'Identity' },
  { key: 'tagline', label: 'Tagline', type: 'text', maxLength: 70, section: 'Identity' },
  { key: 'phone', label: 'Phone', type: 'text', maxLength: 30, section: 'Contact' },
  { key: 'email', label: 'Email', type: 'text', maxLength: 60, section: 'Contact' },
  { key: 'website', label: 'Website', type: 'text', maxLength: 60, section: 'Contact' },
  { key: 'address', label: 'Address', type: 'text', maxLength: 90, section: 'Contact' },
  { key: 'socials', label: 'Social handles', type: 'textarea', maxLength: 300, section: 'Contact', help: 'Comma separated, e.g. @cloudhost247, linkedin.com/in/…' },
  { key: 'orientation', label: 'Orientation', type: 'select', default: 'landscape', section: 'Design', options: [
    { value: 'landscape', label: 'Landscape (85.60 × 53.98 mm)' }, { value: 'portrait', label: 'Portrait (rotated)' },
  ] },
  { key: 'layout', label: 'Layout', type: 'select', default: 'classic', section: 'Design', options: [
    { value: 'classic', label: 'Classic — colour band top and bottom' },
    { value: 'split', label: 'Split — brand panel on the left' },
  ] },
  { key: 'brandColor', label: 'Brand colour', type: 'text', default: '#0f2b46', maxLength: 7, section: 'Design', help: 'Six-digit hex. Text colour is chosen automatically for contrast.' },
  { key: 'accentColor', label: 'Accent colour', type: 'text', default: '#1f7ae0', maxLength: 7, section: 'Design' },
];

const EMPLOYEE_ID_FIELDS: BusinessField[] = [
  { key: 'companyPrefix', label: 'Company prefix', type: 'text', required: true, maxLength: 6, section: 'Scheme', help: 'Alphanumeric, uppercased. Up to 6 characters so the ID stays readable on a badge.', placeholder: 'CH247' },
  { key: 'departmentCode', label: 'Department code', type: 'text', required: true, maxLength: 4, section: 'Scheme', help: 'Alphanumeric, uppercased. Up to 4 characters.', placeholder: 'OPS' },
  { key: 'year', label: 'Year', type: 'text', required: true, maxLength: 4, section: 'Scheme', help: 'Four digits, e.g. 2026.', placeholder: '2026' },
  { key: 'startSequence', label: 'Starting sequence number', type: 'integer', default: 1, min: 0, section: 'Batch' },
  { key: 'count', label: 'How many to generate', type: 'integer', default: 1, min: 1, max: 500, section: 'Batch' },
  { key: 'sequenceWidth', label: 'Sequence width (digits)', type: 'integer', default: 4, min: 1, max: 8, section: 'Batch', help: 'Zero-padded. A 4-digit sequence tops out at 9999.' },
];

const ID_CARD_FIELDS: BusinessField[] = [
  { key: 'companyName', label: 'Company name', type: 'text', required: true, maxLength: 60, section: 'Organisation' },
  { key: 'employeeName', label: 'Employee name', type: 'text', required: true, maxLength: 40, section: 'Employee' },
  { key: 'employeeId', label: 'Employee ID', type: 'text', maxLength: 40, section: 'Employee', help: 'If it was issued by the Employee ID Generator it is verified against its Luhn check digit here.' },
  { key: 'designation', label: 'Designation', type: 'text', maxLength: 40, section: 'Employee' },
  { key: 'department', label: 'Department', type: 'text', maxLength: 40, section: 'Employee' },
  { key: 'bloodGroup', label: 'Blood group', type: 'text', maxLength: 4, section: 'Employee', help: 'One of A+, A−, B+, B−, AB+, AB−, O+, O−. Anything else is flagged.' },
  { key: 'issueDate', label: 'Issue date', type: 'date', section: 'Validity' },
  { key: 'expiryDate', label: 'Expiry date', type: 'date', section: 'Validity', help: 'Must be after the issue date.' },
  { key: 'orientation', label: 'Orientation', type: 'select', default: 'portrait', section: 'Design', options: [
    { value: 'portrait', label: 'Portrait (600 × 1050 px)' }, { value: 'landscape', label: 'Landscape (1050 × 600 px)' },
  ] },
  { key: 'themeColor', label: 'Theme colour', type: 'text', default: '#0f2b46', maxLength: 7, section: 'Design', help: 'Six-digit hex. Text colour is chosen automatically for contrast.' },
  { key: 'includePhoto', label: 'Include a photo placeholder', type: 'boolean', default: true, section: 'Design' },
  { key: 'includeQr', label: 'Include a QR payload block', type: 'boolean', default: false, section: 'Design', help: 'Prints the payload text as a marked placeholder. Use the CloudHost247 QR Code Generator for a scannable code.' },
];

const ORG_CHART_FIELDS: BusinessField[] = [
  { key: 'organizationName', label: 'Organization name', type: 'text', maxLength: 160, section: 'Chart' },
  { key: 'people', label: 'People', type: 'lines', required: true, section: 'Chart', help: 'One per line as "Name | Role | Reports to". Leave "Reports to" blank for the head of the organisation. Up to 500 lines.', placeholder: 'Ada Obi | Chief Executive |\nChidi Eze | Head of Engineering | Ada Obi\nBisi Lawal | Platform Engineer | Chidi Eze' },
];

const LINKEDIN_FIELDS: BusinessField[] = [
  { key: 'postText', label: 'Selected post text', type: 'textarea', required: true, maxLength: 4000, section: 'The post', help: 'Paste the body of the post. It is analysed in your browser and is never transmitted.', placeholder: 'Paste the LinkedIn post text here…' },
  { key: 'authorName', label: 'Author name', type: 'text', maxLength: 80, section: 'The post', help: 'Used to address the comment. Leave blank for no salutation.' },
  { key: 'authorProfileUrl', label: 'Author profile URL', type: 'text', maxLength: 300, section: 'The post', help: 'Recorded for your follow-up list only; not fetched or opened.' },
  { key: 'postUrl', label: 'Post URL', type: 'text', maxLength: 300, section: 'The post', help: 'Recorded for your follow-up list only; not fetched or opened.' },
  { key: 'tone', label: 'Comment voice and tone', type: 'select', default: 'all', section: 'Your reply', options: [
    { value: 'all', label: 'Mixed — three different tones' },
    { value: 'supportive', label: 'Supportive' },
    { value: 'insightful', label: 'Insightful' },
    { value: 'curious', label: 'Curious' },
    { value: 'congratulatory', label: 'Congratulatory' },
    { value: 'analytical', label: 'Analytical' },
    { value: 'concise', label: 'Concise' },
  ] },
  { key: 'perspective', label: 'Your perspective or role', type: 'text', maxLength: 160, section: 'Your reply', help: 'e.g. "a payroll lead running a 300-person Nigerian payroll". Makes the comment clearly yours.', placeholder: 'a payroll lead running a 300-person payroll' },
  { key: 'keyPoint', label: 'A point of your own to add', type: 'textarea', maxLength: 400, section: 'Your reply', help: 'Without one, the drafts can only agree with the post.' },
  { key: 'maxLength', label: 'Maximum comment length (characters)', type: 'integer', default: 480, min: 80, max: 1200, section: 'Your reply', help: 'Trimmed at a word boundary, never mid-word.' },
  { key: 'followUps', label: 'Follow-up list', type: 'lines', section: 'Tracking', help: 'One per line. Kept in this workspace only — nothing is stored on a CloudHost247 server or sent to LinkedIn.', placeholder: 'Reply to Ada on the payroll thread\nSend the PenCom guide to Chidi' },
];

/* ================================================================== */
/* Comparisons — shared field blocks                                   */
/* ================================================================== */

function comparisonFields(
  dataset: typeof ACCOUNTING_COMPARISON,
  extra: BusinessField[] = []
): BusinessField[] {
  return [
    {
      key: 'options', label: 'Options to compare', type: 'textarea', default: 'all', section: 'Selection',
      help: `"all", or a comma-separated list of names. Available: ${dataset.options.map((option) => option.name).join(', ')}.`,
    },
    {
      key: 'weights', label: 'Criterion weights', type: 'lines', default: defaultWeightsTemplate(dataset), section: 'Weighting',
      help: 'One per line as "Criterion, Weight". Weights run 0–10; a criterion at 0 is excluded from the ranking. Any criterion you omit keeps its default weight.',
    },
    {
      key: 'scores', label: 'Score overrides', type: 'textarea', default: '', section: 'Scoring',
      help: `Optional. One line per option as "Name | ${dataset.criteria.map((criterion) => criterion.label).join(' | ')}", each scored 0–5. Blank or "n/a" means not assessed. Anything you leave out keeps the published default score.`,
      placeholder: defaultScoresTemplate(dataset).split('\n').slice(0, 2).join('\n'),
    },
    ...extra,
  ];
}

const HMO_EXTRA_FIELDS: BusinessField[] = [
  { key: 'employees', label: 'Number of employees to cover', type: 'integer', default: 25, min: 1, max: 100_000, section: 'Budget estimator' },
  { key: 'planTier', label: 'Plan tier', type: 'select', default: 'standard', section: 'Budget estimator', options: [
    { value: 'basic', label: 'Basic — ₦30,000–₦80,000 per employee per year' },
    { value: 'standard', label: 'Standard — ₦80,000–₦180,000 per employee per year' },
    { value: 'comprehensive', label: 'Comprehensive — ₦180,000–₦400,000 per employee per year' },
    { value: 'executive', label: 'Executive / Premium — ₦400,000–₦1,000,000 per employee per year' },
  ] },
];

const PFA_EXTRA_FIELDS: BusinessField[] = [
  { key: 'employeeContributionPct', label: 'Employee contribution', type: 'percent', default: 8, min: 0, max: 50, suffix: '%', section: 'Remittance schedule', help: 'The Pension Reform Act 2014 sets 8%.' },
  { key: 'employerContributionPct', label: 'Employer contribution', type: 'percent', default: 10, min: 10, max: 50, suffix: '%', section: 'Remittance schedule', help: 'PenCom minimum is 10%; a lower figure is rejected.' },
  {
    key: 'remittanceSchedule', label: 'Employees to route', type: 'lines', section: 'Remittance schedule',
    help: 'Optional. One per line as "Name | RSA PIN | PFA | Basic | Housing | Transport". Produces a schedule grouped by administrator, which is what a payroll run actually has to submit.',
    placeholder: 'Ada Obi | RSA/PF/123456789 | Access ARM Pensions | 200000 | 120000 | 80000',
  },
];

/* ================================================================== */
/* The registry                                                        */
/* ================================================================== */

const CALCULATORS: BusinessTool[] = [
  {
    slug: 'nigeria-paye-net-salary-calculator',
    name: 'PAYE & Net Salary Calculator',
    category: 'calculators',
    summary: 'Monthly employment income tax (PAYE), statutory deductions, reliefs and take-home pay under the Nigeria Tax Act 2025.',
    description:
      'Computes PAYE from the progressive bands that take effect on 1 January 2026, after the six statutory reliefs (employee pension, NHF, NHIS, mortgage interest on a self-occupied home, rent relief capped at ₦500,000, and life insurance premium). It can run in either direction: from a gross salary to the take-home, or from a target take-home back to the gross required. Military and national-minimum-wage earners are handled as exempt, and an independent consultant is charged flat 5% withholding tax instead of the progressive bands. Every rate is an input, so a figure can be checked against a payslip rather than taken on trust.',
    icon: 'chart',
    path: `${BUSINESS_TOOLS_ROOT}/nigeria-paye-net-salary-calculator`,
    keywords: ['paye', 'net salary', 'take-home', 'income tax', 'nigeria', 'tax act 2025', 'salary breakdown', 'tax relief'],
    units: 'Nigerian naira (₦) per month and per year; percentages stated explicitly',
    jurisdiction: NIGERIA_TAX_NOTE_2026,
    printable: true,
    fields: PAYE_FIELDS,
    compute: computePayeCalculator,
  },
  {
    slug: 'nigeria-pension-calculator',
    name: 'Pension Calculator',
    category: 'calculators',
    summary: 'Statutory monthly employee and employer pension contributions from the basic, housing and transport split.',
    description:
      'Computes the employee contribution (8%) and the employer contribution (minimum 10%) on the pensionable base — basic salary plus housing allowance plus transport allowance — as the Pension Reform Act 2014 and PenCom require. Both percentages are editable, and an employer figure below the 10% statutory minimum is rejected rather than silently computed, because a schedule remitted at 9% is a compliance breach and not a rounding choice. Enter monthly or yearly figures; the result always shows both columns plus a net-pay line.',
    icon: 'transfer',
    path: `${BUSINESS_TOOLS_ROOT}/nigeria-pension-calculator`,
    keywords: ['pension', 'pencom', 'rsa', 'contribution', 'retirement', 'nigeria', 'employer contribution'],
    units: 'Nigerian naira (₦) per month and per year; contribution rates in percent',
    jurisdiction: NIGERIA_PENSION_NOTE,
    printable: true,
    fields: PENSION_FIELDS,
    compute: computePensionCalculator,
  },
  {
    slug: 'nigeria-vat-calculator',
    name: 'VAT Calculator',
    category: 'calculators',
    summary: 'Add or remove value added tax at Nigeria\u2019s standard 7.5% rate, with the government revenue-sharing split.',
    description:
      'Adds VAT to a net amount or removes it from a VAT-inclusive gross, at any rate you enter (the Nigerian standard is 7.5%, in force since 1 February 2020 under the Finance Act 2019). The two modes answer different questions and the tool says which one you are in. It also breaks down how VAT collected on the transaction is distributed: FIRS retains 4% as collection cost, and the remaining 96% is shared 15% Federal, 50% State and 35% Local Government, with the Federal Government passing 1% of its own share to the FCT Abuja Administration. That breakdown explains where the money goes; it is not a filing instruction.',
    icon: 'invoice',
    path: `${BUSINESS_TOOLS_ROOT}/nigeria-vat-calculator`,
    keywords: ['vat', 'value added tax', '7.5%', 'gst', 'tax inclusive', 'tax exclusive', 'firs', 'nigeria'],
    units: 'Currency of your choice (₦ by default); rate in percent',
    jurisdiction: NIGERIA_VAT_NOTE,
    printable: true,
    fields: VAT_FIELDS,
    compute: computeVatCalculator,
  },
  {
    slug: 'nigeria-employer-cost-calculator',
    name: 'Employer Cost Calculator',
    category: 'calculators',
    summary: 'The true annual and monthly cost of employing someone, including statutory levies, benefits, workspace and one-off costs.',
    description:
      'Builds the full cost of a hire above the gross salary: employer pension (10% of basic, housing and transport), the NSITF employees\u2019 compensation levy (1% of gross), a group life insurance premium, and optionally the ITF training levy and employer NHIS cover. Then adds what employers actually budget for but leave out of a salary comparison — HMO premiums, perks, office space, internet and power allowances, one-off equipment and recruitment costs, training and a 13th-month bonus. The headline output is the overhead multiplier: how many times the raw gross salary the role really costs.',
    icon: 'building',
    path: `${BUSINESS_TOOLS_ROOT}/nigeria-employer-cost-calculator`,
    keywords: ['employer cost', 'payroll overhead', 'cost to hire', 'nsitf', 'itf', 'group life', 'hmo', 'nigeria'],
    units: 'Nigerian naira (₦) per year, with a monthly equivalent; overhead as a multiplier and a percentage',
    jurisdiction: NIGERIA_EMPLOYER_COST_NOTE,
    printable: true,
    fields: EMPLOYER_COST_FIELDS,
    compute: computeEmployerCostCalculator,
  },
  {
    slug: 'earned-wage-access-roi-calculator',
    name: 'EWA ROI Calculator',
    category: 'calculators',
    summary: 'Return on investment and annual savings from offering Earned Wage Access, modelled on replacement cost avoided.',
    description:
      'Models the retention case for on-demand pay: annual attrition cost equals headcount multiplied by turnover rate multiplied by the cost of replacing one employee, and an Earned Wage Access programme reduces the turnover rate by an expected percentage. The tool reports the resignations avoided, the projected annual saving, the net benefit after programme cost, and the return on investment. The turnover reduction is an input rather than a built-in constant, because it is not a regulated or guaranteed figure — and at a ₦0 programme cost the tool reports that an ROI ratio cannot be computed rather than claiming an infinite return.',
    icon: 'activity',
    path: `${BUSINESS_TOOLS_ROOT}/earned-wage-access-roi-calculator`,
    keywords: ['ewa', 'earned wage access', 'on-demand pay', 'roi', 'retention', 'turnover', 'attrition cost', 'replacement cost'],
    units: 'Currency of your choice (₦ by default) per year; turnover and reduction rates in percent; headcount in whole employees',
    jurisdiction: EWA_ROI_NOTE,
    printable: true,
    fields: EWA_FIELDS,
    compute: computeEwaRoiCalculator,
  },
];

const GENERATORS: BusinessTool[] = [
  {
    slug: 'job-description-generator',
    name: 'Job Description Generator',
    category: 'generators',
    summary: 'A structured, inclusive job description from the role level, department and key skills — with a language review.',
    description:
      'Assembles a complete job description: header line with level, employment type and working arrangement, role summary, numbered responsibilities, must-have and nice-to-have skills, qualifications, benefits, an equal-opportunity statement and an application route. It also reviews the finished text against published recruitment-inclusion research and flags wording that tends to narrow an applicant pool — gendered pronouns and job titles, age-coded and disability-coded phrasing, informal superlatives — explaining why each was flagged so a person can decide. The review is a drafting aid, not a legal test of compliance with any discrimination statute.',
    icon: 'file-text',
    path: `${BUSINESS_TOOLS_ROOT}/job-description-generator`,
    keywords: ['job description', 'vacancy', 'hiring', 'job advert', 'inclusive language', 'role profile'],
    units: 'Markdown document; word counts and salary in the currency you select',
    printable: true,
    fields: JOB_DESCRIPTION_FIELDS,
    compute: computeJobDescription,
  },
  {
    slug: 'job-offer-letter-generator',
    name: 'Job Offer Letter Generator',
    category: 'generators',
    summary: 'A complete offer letter with compensation, probation, conditions of offer and a candidate acceptance block.',
    description:
      'Produces an offer letter covering position and department, employment type and working arrangement, reporting line, commencement date, compensation with its monthly equivalent, bonus or variable pay, probationary period, notice period, benefits, conditions of offer, an acceptance deadline and signature blocks for both sides. Dates are validated: the acceptance deadline cannot fall after the commencement date, and a probation longer than six months raises an advisory. The letter states that the formal employment contract governs where the two differ, so it cannot contradict the contract you issue later.',
    icon: 'mail',
    path: `${BUSINESS_TOOLS_ROOT}/job-offer-letter-generator`,
    keywords: ['offer letter', 'job offer', 'employment offer', 'hiring', 'candidate', 'compensation'],
    units: 'Markdown document; compensation in the currency and period you select',
    printable: true,
    fields: OFFER_LETTER_FIELDS,
    compute: computeJobOfferLetter,
  },
  {
    slug: 'official-payslip-generator',
    name: 'Official Payslip Generator',
    category: 'generators',
    summary: 'A formatted payslip from earnings and deduction lines, with optional statutory deductions and CSV export.',
    description:
      'Builds a payslip from your earnings and deduction lines, with employer and employee details, pay period, paid and loss-of-pay days, gross pay, each deduction, net pay and optional bank details. Tick the statutory block and it computes employee pension (8%), NHF (2.5% of gross), NHIS (5% of basic) and PAYE under the Nigeria Tax Act 2025 bands from your basic, housing and transport lines — using the same engine as the PAYE calculator, so a payslip and a PAYE run on identical inputs cannot disagree. Deductions exceeding gross pay are rejected rather than printed as a negative net. Downloads as both a formatted payslip and a CSV.',
    icon: 'list',
    path: `${BUSINESS_TOOLS_ROOT}/official-payslip-generator`,
    keywords: ['payslip', 'pay stub', 'salary slip', 'payroll', 'net pay', 'deductions', 'statutory'],
    units: 'Currency of your choice (₦ by default); pay period as YYYY-MM',
    jurisdiction: NIGERIA_TAX_NOTE_2026,
    printable: true,
    fields: PAYSLIP_FIELDS,
    compute: computePayslip,
  },
  {
    slug: 'nda-contract-generator',
    name: 'NDA Contract Generator',
    category: 'generators',
    summary: 'A one-way or mutual non-disclosure agreement with term, survival, compelled disclosure and remedies.',
    description:
      'Drafts a non-disclosure agreement in either structure. It covers the purpose of disclosure, a definition of confidential information, the four standard exclusions, the recipient\u2019s obligations, compelled disclosure with prior notice, no-licence and no-warranty terms, the agreement term, a survival period with indefinite protection for trade secrets, return or destruction with written certification, optional non-solicitation and residual-knowledge clauses, injunctive remedies, and the general boilerplate (governing law, entire agreement, amendment, assignment, severability, third-party rights). Two identical parties are rejected, and an unusually long non-solicitation or survival period raises an advisory.',
    icon: 'shield',
    path: `${BUSINESS_TOOLS_ROOT}/nda-contract-generator`,
    keywords: ['nda', 'non-disclosure', 'confidentiality agreement', 'mutual nda', 'contract', 'trade secret'],
    units: 'Markdown document; term and survival periods in years',
    printable: true,
    fields: NDA_FIELDS,
    compute: computeNdaContract,
  },
  {
    slug: 'employment-contract-generator',
    name: 'Employment Contract Generator',
    category: 'generators',
    summary: 'A full contract of employment covering duties, pay, leave, pension, termination and optional restrictive covenants.',
    description:
      'Produces a contract of employment across appointment and commencement, probation, duties and reporting, place and hours of work, remuneration with the statutory pension split stated, leave, pension and benefits, optional confidentiality and intellectual-property assignment clauses, termination with notice from both sides and summary dismissal for fundamental breach, optional post-termination restrictive covenants, and the general provisions. It validates that a fixed-term contract has an end date after the start date, and raises advisories where annual leave falls below the Labour Act reference minimum, where a non-compete exceeds twelve months, or where the working week exceeds 40 hours.',
    icon: 'briefcase',
    path: `${BUSINESS_TOOLS_ROOT}/employment-contract-generator`,
    keywords: ['employment contract', 'contract of employment', 'hr', 'probation', 'notice period', 'restrictive covenant'],
    units: 'Markdown document; salary in the currency and period you select; notice and probation in months; leave in working days',
    jurisdiction: {
      jurisdiction: 'Nigeria (federal) by default; governing law is an input',
      source:
        'Pension Reform Act 2014 (8% employee / minimum 10% employer of basic, housing and transport) and the Labour Act (cap. L1 LFN 2004, s.18, minimum annual leave after 12 months\u2019 continuous service). Both are referenced in the generated text and in its advisories.',
      effectiveDate: '2026-10-10',
      disclaimer:
        'A template, not legal advice and not a substitute for a contract reviewed by a qualified lawyer in your jurisdiction. Employment law differs materially between jurisdictions and between sectors; the governing law is an input precisely because the clauses that are enforceable depend on it.',
    },
    printable: true,
    fields: EMPLOYMENT_CONTRACT_FIELDS,
    compute: computeEmploymentContract,
  },
  {
    slug: 'cv-generator',
    name: 'CV Generator',
    category: 'generators',
    summary: 'A structured CV in ATS-friendly plain text or Markdown, with a wording review and a computed career timeline.',
    description:
      'Builds a CV from your details, summary, skills, work experience, projects, education, certifications and languages. Two output formats: ATS-friendly plain text with upper-case section headings and no Markdown or tables, which applicant-tracking systems parse most reliably; or Markdown for readability. It validates every experience entry — a start or end date that is not YYYY-MM, an end date before a start date, or a missing company or role is rejected rather than printed. It also computes each role\u2019s duration in months so a gap or overlap is visible at a glance, estimates the page length, and flags wording that describes a remit instead of a result.',
    icon: 'user',
    path: `${BUSINESS_TOOLS_ROOT}/cv-generator`,
    keywords: ['cv', 'resume', 'curriculum vitae', 'ats', 'job application', 'career'],
    units: 'Plain text or Markdown; dates as YYYY-MM; duration in months',
    printable: true,
    fields: CV_FIELDS,
    compute: computeCv,
  },
  {
    slug: 'business-invoice-generator',
    name: 'Business Invoice Generator',
    category: 'generators',
    summary: 'A tax-ready invoice with per-line tax, pro-rata discounts, payment status and CSV line-item export.',
    description:
      'Produces an invoice with issuer and customer details including tax identification numbers, issue and due dates, line items each with their own quantity, unit price and tax rate, a discount, shipping and an amount already paid. Discounts are spread pro-rata across the lines so tax is charged on the discounted value of each line, which is what a VAT invoice has to show. Totals, tax and the balance due are computed, and the payment status is derived — unpaid, part-paid, paid or overpaid, with an advisory when the amount paid exceeds the total. Advisories flag a missing tax point date or tax identification number. Downloads as a formatted invoice and as CSV line items.',
    icon: 'invoice',
    path: `${BUSINESS_TOOLS_ROOT}/business-invoice-generator`,
    keywords: ['invoice', 'billing', 'vat invoice', 'line items', 'payment terms', 'balance due'],
    units: 'Currency of your choice (₦ by default); dates as YYYY-MM-DD; tax rates in percent',
    jurisdiction: INVOICE_TAX_NOTE,
    printable: true,
    fields: INVOICE_FIELDS,
    compute: computeBusinessInvoice,
  },
  {
    slug: 'business-card-generator',
    name: 'Business Card Generator',
    category: 'generators',
    summary: 'A print-resolution business card as downloadable SVG, with automatic contrast-checked text colour.',
    description:
      'Generates a business card as SVG at ISO/IEC 7810 ID-1 proportions — 85.60 × 53.98 mm, the standard card size — in landscape or portrait, in a classic banded layout or a split layout with a brand panel. Because the output is SVG rather than a raster image, it is produced entirely in your browser with no image service and no font download, and it stays crisp at print resolution. Text colour is not a choice you make: the tool computes WCAG 2.1 relative luminance for your brand colour and picks black or white for the higher contrast, then reports the ratio and warns if it falls below 4.5:1. Malformed email addresses and domains are flagged, because a card is printed once and handed out many times.',
    icon: 'layout',
    path: `${BUSINESS_TOOLS_ROOT}/business-card-generator`,
    keywords: ['business card', 'card design', 'svg', 'print', 'branding', 'contact card'],
    units: 'SVG at 1050 × 600 px (landscape) or 600 × 1050 px (portrait); print size 85.60 × 53.98 mm; contrast as a ratio',
    printable: true,
    fields: BUSINESS_CARD_FIELDS,
    compute: computeBusinessCard,
  },
  {
    slug: 'employee-id-generator',
    name: 'Employee ID Generator',
    category: 'generators',
    summary: 'Batch employee identifiers in a structured scheme with a Luhn check digit, verified before they are issued.',
    description:
      'Generates employee identifiers in the scheme PREFIX-DEPT-YEAR-SEQUENCE-CHECK, in batches of up to 500. The final digit is a Luhn (mod 10) check digit computed over the department digits, year and sequence, so a single mistyped digit or most adjacent transpositions fail validation instead of silently resolving to a different employee\u2019s record — which matters when the identifier drives payroll routing or access control. Every generated ID is re-verified with the same routine before the batch is offered for download, and the tool warns if the batch exceeds what the sequence width can represent or produces a duplicate.',
    icon: 'tag',
    path: `${BUSINESS_TOOLS_ROOT}/employee-id-generator`,
    keywords: ['employee id', 'staff number', 'identifier', 'batch', 'luhn', 'check digit', 'hr'],
    units: 'Alphanumeric identifiers with a single-digit Luhn check; sequence zero-padded to the width you set',
    fields: EMPLOYEE_ID_FIELDS,
    compute: computeEmployeeIdGenerator,
  },
  {
    slug: 'employee-id-card-generator',
    name: 'Employee ID Card Generator',
    category: 'generators',
    summary: 'A printable staff identity badge as SVG, with contrast-checked colours and check-digit verification of the ID.',
    description:
      'Produces a staff identity badge as SVG in portrait or landscape: organisation header, employee name, ID number, designation, department, blood group, issue and expiry dates, an optional photo placeholder and a footer return line. If the ID was issued by the Employee ID Generator it is verified against its Luhn check digit here, so a mistyped number is caught before the badge is printed. Blood groups are validated against the eight recognised values, and an expiry date on or before the issue date is flagged. Text colour is selected automatically for contrast and the ratio is reported. The optional QR block is a marked placeholder showing the payload text — this tool will not claim to produce a scannable code it cannot verify; use the CloudHost247 QR Code Generator for that.',
    icon: 'key',
    path: `${BUSINESS_TOOLS_ROOT}/employee-id-card-generator`,
    keywords: ['id card', 'staff badge', 'identity card', 'employee badge', 'svg', 'hr'],
    units: 'SVG at 600 × 1050 px (portrait) or 1050 × 600 px (landscape); CR80 card stock 85.60 × 53.98 mm; dates as YYYY-MM-DD',
    printable: true,
    fields: ID_CARD_FIELDS,
    compute: computeEmployeeIdCard,
  },
  {
    slug: 'organizational-chart-generator',
    name: 'Organizational Chart Generator',
    category: 'generators',
    summary: 'A validated reporting tree with depth, span of control and an indented outline plus CSV export.',
    description:
      'Builds an organization chart from one line per person — "Name | Role | Reports to" — and validates the structure before computing anything: self-reporting, reporting cycles, managers who are not in the chart and duplicate names are all rejected with a message naming the line, because a chart that silently hides a person is a chart nobody notices is wrong until payroll does. It then reports headcount, number of managers, levels of depth, average and widest span of control, and each person\u2019s direct reports and total reports below them. Advisories flag a chart with several disconnected roots, a span wider than about ten (usually a missing management layer), or more layers than people to manage. Exports an indented outline and a CSV of the reporting structure.',
    icon: 'git-branch',
    path: `${BUSINESS_TOOLS_ROOT}/organizational-chart-generator`,
    keywords: ['org chart', 'organizational chart', 'reporting line', 'span of control', 'structure', 'hr'],
    units: 'Levels counted from 0 at the top; spans and headcounts in whole people',
    fields: ORG_CHART_FIELDS,
    compute: computeOrganizationalChart,
  },
  {
    slug: 'linkedin-engagement-assistant',
    name: 'LinkedIn Engagement Assistant',
    category: 'generators',
    summary: 'Three non-salesy comment drafts built from the post text, plus an analysis of what the post invites.',
    description:
      'Analyses the text of a LinkedIn post — length, sentence count, reading time, questions asked, whether it carries a call to action, whether it contains figures, its sentiment and its topics — and uses that analysis to draft three comment options in the tone you choose. Each draft anchors on a specific line from the post, which is what separates a comment that was read from one that was not, and each carries a rationale explaining why it works. Your own point and perspective are woven in where you supply them; without them the tool tells you the drafts can only agree. No language model and no third-party service is called: the post text is analysed in your browser and never transmitted, which matters because it is somebody else\u2019s content. Output is deterministic — the same inputs always produce the same drafts.',
    icon: 'sparkle',
    path: `${BUSINESS_TOOLS_ROOT}/linkedin-engagement-assistant`,
    keywords: ['linkedin', 'engagement', 'comment generator', 'social selling', 'drafting', 'post analysis'],
    units: 'Character counts and reading time in seconds (at a standard 200 words per minute)',
    fields: LINKEDIN_FIELDS,
    compute: computeLinkedInEngagementAssistant,
  },
];

const COMPARISONS: BusinessTool[] = [
  {
    slug: 'accounting-tool-comparison',
    name: 'Accounting Tool Comparison',
    category: 'comparisons',
    summary: 'Compare general-purpose accounting systems on what they do and do not handle for Nigerian payroll.',
    description:
      'Compares six accounting systems — QuickBooks Online, Zoho Books, Sage, Oracle NetSuite, Odoo Accounting and Xero — across ten weighted criteria. The finding the comparison exists to make visible is structural: every one of them is a capable general ledger with invoicing, bank reconciliation, multi-currency and an open API, and none of them computes Nigerian PAYE, PenCom pension or NHF and NHIS natively, or disburses pay to employees in Naira. That is a fact about the products, not an opinion about them, so those criteria are scored from published capability facts rather than assigned. You can reweight the criteria, override any score, restrict the comparison to a subset, and export the matrix.',
    icon: 'scale',
    path: `${BUSINESS_TOOLS_ROOT}/accounting-tool-comparison`,
    keywords: ['accounting software', 'quickbooks', 'zoho books', 'sage', 'netsuite', 'odoo', 'xero', 'payroll comparison'],
    units: 'Scores 0–5 per criterion; weights 0–10; final score normalised to 0–100',
    jurisdiction: ACCOUNTING_COMPARISON.note,
    printable: true,
    fields: comparisonFields(ACCOUNTING_COMPARISON),
    compute: computeAccountingComparison,
  },
  {
    slug: 'expense-tool-comparison',
    name: 'Expense Tool Comparison',
    category: 'comparisons',
    summary: 'Compare expense management platforms, including which card programmes are actually available to a Nigerian entity.',
    description:
      'Compares eight expense management platforms — Zoho Expense, SAP Concur, Expensify, Odoo Expenses, Ramp, Pleo, Spendesk and Sage Business Cloud — across nine weighted criteria: receipt OCR, corporate card issuance, whether cards are available to a Nigerian entity, approval workflows, policy rules engine, multi-currency handling, accounting sync, mobile offline capture and Naira support. The card-availability criterion is the one that decides most shortlists here, because several strong products issue cards only in US or European markets and are unusable for a Nigerian payroll regardless of how good the rest of them is. Criteria are weighted, scores can be overridden, and the matrix exports as CSV.',
    icon: 'cart',
    path: `${BUSINESS_TOOLS_ROOT}/expense-tool-comparison`,
    keywords: ['expense management', 'expensify', 'concur', 'zoho expense', 'ramp', 'pleo', 'spendesk', 'receipt ocr'],
    units: 'Scores 0–5 per criterion; weights 0–10; final score normalised to 0–100',
    jurisdiction: EXPENSE_COMPARISON.note,
    printable: true,
    fields: comparisonFields(EXPENSE_COMPARISON),
    compute: computeExpenseComparison,
  },
  {
    slug: 'hmo-comparison-nigeria',
    name: 'HMO Comparison (Nigeria)',
    category: 'comparisons',
    summary: 'Compare NHIA-accredited health maintenance organisations, with an indicative group-cover budget estimator.',
    description:
      'Compares ten NHIA-accredited health maintenance organisations — identified by their accreditation ID from the public NHIA register — across six weighted criteria: corporate plan range, provider network breadth, digital self-service, telemedicine, claims and authorisation speed, and dedicated employer account management. Alongside the ranking it produces what an employer actually needs first: an indicative annual budget from headcount and plan tier, the four market plan tiers with their published per-employee ranges, the benefit matrix showing what typically changes between tiers, and the ten questions to ask each provider before signing. The criterion scores are labelled as CloudHost247 planning guidance derived from published market positioning — they are not NHIA ratings and not endorsements, and accreditation must be re-verified on the NHIA register.',
    icon: 'pulse',
    path: `${BUSINESS_TOOLS_ROOT}/hmo-comparison-nigeria`,
    keywords: ['hmo', 'health insurance', 'nhia', 'group health', 'medical cover', 'nigeria', 'employer benefits'],
    units: 'Nigerian naira (₦) per employee per year for budget ranges; scores 0–5; weights 0–10; final score 0–100',
    jurisdiction: HMO_COMPARISON.note,
    printable: true,
    fields: comparisonFields(HMO_COMPARISON, HMO_EXTRA_FIELDS),
    compute: computeHmoComparison,
  },
  {
    slug: 'pfa-comparison-nigeria',
    name: 'PFA Comparison (Nigeria)',
    category: 'comparisons',
    summary: 'Compare PenCom-licensed pension fund administrators, and build a multi-PFA monthly remittance schedule.',
    description:
      'Compares fifteen PenCom-licensed Pension Fund Administrators — identified by their published PFA code — across eight weighted criteria covering RSA registration, digital portal, employer schedule support, customer service, fund performance consistency, branch network, the RSA transfer process and self-service features. It also does the payroll work that follows a choice: enter your employees with their RSA PIN, chosen PFA and basic, housing and transport figures, and it produces a monthly remittance schedule grouped by administrator, computed with the same Pension Reform Act 2014 engine as the Pension Calculator, exportable as CSV. Under the Contributory Pension Scheme the employee chooses the PFA and the account belongs to them, so a real schedule routinely spans several administrators — which is why the grouping is the output.',
    icon: 'database',
    path: `${BUSINESS_TOOLS_ROOT}/pfa-comparison-nigeria`,
    keywords: ['pfa', 'pension fund administrator', 'pencom', 'rsa', 'remittance schedule', 'pension comparison', 'nigeria'],
    units: 'Nigerian naira (₦) per month for remittances; scores 0–5; weights 0–10; final score 0–100',
    jurisdiction: PFA_COMPARISON.note,
    printable: true,
    fields: comparisonFields(PFA_COMPARISON, PFA_EXTRA_FIELDS),
    compute: computePfaComparison,
  },
];

/** All 21 Business Tools. Category counts are asserted by the test suite: 5 / 12 / 4. */
export const BUSINESS_TOOLS: readonly BusinessTool[] = [...CALCULATORS, ...GENERATORS, ...COMPARISONS];

export const BUSINESS_TOOL_COUNTS: Record<BusinessToolCategory, number> = {
  calculators: CALCULATORS.length,
  generators: GENERATORS.length,
  comparisons: COMPARISONS.length,
};

export const BUSINESS_TOOLS_TOTAL = BUSINESS_TOOLS.length;

export function findBusinessTool(slug: string): BusinessTool | undefined {
  return BUSINESS_TOOLS.find((tool) => tool.slug === slug);
}

export function businessToolsByCategory(category: BusinessToolCategory): BusinessTool[] {
  return BUSINESS_TOOLS.filter((tool) => tool.category === category);
}

/**
 * Search across name, summary, description, keywords and slug.
 *
 * Every term must match somewhere (AND across terms, OR across fields), so "vat nigeria" narrows
 * while a single term still casts wide. Matching is case-insensitive and diacritic-insensitive.
 */
export function searchBusinessTools(query: string, category?: BusinessToolCategory | 'all'): BusinessTool[] {
  const terms = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter((term) => term.length > 0);

  const scoped = category && category !== 'all' ? businessToolsByCategory(category) : [...BUSINESS_TOOLS];
  if (terms.length === 0) return scoped;

  return scoped.filter((tool) => {
    const haystack = [tool.name, tool.summary, tool.description, tool.slug, tool.units, ...tool.keywords]
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return terms.every((term) => haystack.includes(term));
  });
}

/** Apply the declared defaults so a workspace opens with a usable form rather than an empty one. */
export function defaultInputFor(tool: BusinessTool): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const field of tool.fields) {
    if (field.type === 'boolean') values[field.key] = Boolean(field.default ?? false);
    else if (field.type === 'number' || field.type === 'integer' || field.type === 'percent' || field.type === 'money') {
      values[field.key] = typeof field.default === 'number' ? field.default : '';
    } else {
      values[field.key] = typeof field.default === 'string' ? field.default : '';
    }
  }
  return values;
}
