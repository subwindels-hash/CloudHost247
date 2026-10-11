/**
 * Business Tools — Generators, part 1: HR and contract documents (6 of 12).
 *
 *   1. Job Description Generator        job-description-generator
 *   2. Job Offer Letter Generator       job-offer-letter-generator
 *   3. Official Payslip Generator       official-payslip-generator
 *   4. NDA Contract Generator           nda-contract-generator
 *   5. Employment Contract Generator    employment-contract-generator
 *   6. CV Generator                     cv-generator
 *
 * Each generator is a pure function from form values to a document. Nothing is sent anywhere:
 * the text is assembled in the browser tab, and the only network calls on these pages are the ones
 * the visitor explicitly makes by pressing copy, download or print.
 *
 * These generators produce *drafts*. They do not practise law and they do not know your facts, so
 * every document carries a review notice saying exactly that — a generated contract that presents
 * itself as executed legal advice is a liability, not a feature.
 */

import {
  bulletList,
  clampText,
  formatAmount,
  formatLongDate,
  formatMoney,
  formatMonth,
  numberedList,
  round,
  tidyDocument,
  titleCase,
  toCsv,
  toBoolean,
  toLines,
  toList,
  toNumber,
  toText,
  monthsBetween,
  parseIsoDate,
} from './format';
import { computePayeStructure } from './calculators';
import { failure, fieldFailure } from './validate';
import type {
  BusinessToolInput,
  BusinessToolOutcome,
  ResultDocument,
  ResultMetric,
  ResultTable,
} from './types';

/** Standard notice appended to every generated legal or payroll document. */
export const DRAFT_REVIEW_NOTICE =
  'Generated draft — not legal or tax advice. This document was assembled from the values you entered, in your browser. Review it against your own facts and have it checked by a qualified professional before signing, issuing or relying on it.';

const notEntered = (value: string): boolean => value.trim() === '' || value.trim() === '—';

/** Render a `Label: value` line, or a placeholder when the field was left blank. */
function line(label: string, value: string, placeholder = '[not supplied]'): string {
  return `${label}: ${notEntered(value) ? placeholder : value.trim()}`;
}

/* ================================================================== */
/* 1. Job Description Generator                                        */
/* ================================================================== */

/**
 * Language that tends to narrow an applicant pool.
 *
 * This is a linting aid, not a legal test: it flags words published in recruitment-inclusion
 * research as skewing a description toward one gender or discouraging applicants with a disability,
 * and it explains why each was flagged so a human can decide. It cannot tell you whether a
 * description complies with any discrimination statute.
 */
export const JD_BIASED_TERMS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(ninja|rockstar|guru|wizard|superstar)\b/gi, reason: 'Informal superlatives read as a young, male-coded tech culture and are associated with lower application rates from other groups.' },
  { pattern: /\b(competitive|dominant|aggressive|driven|ruthless)\b/gi, reason: 'Masculine-coded wording; research links it to reduced applications from women for the same role.' },
  { pattern: /\b(supportive|nurturing|compassionate|gentle)\b/gi, reason: 'Feminine-coded wording can narrow the pool in the other direction for the same role.' },
  { pattern: /\b(he|his|him|she|her|hers)\b/gi, reason: 'Gendered pronoun for the post holder. Use "the successful candidate", "they" or the job title.' },
  { pattern: /\b(salesman|chairman|manpower|foreman|waitress|stewardess)\b/gi, reason: 'Gendered job title. Use the neutral form (salesperson, chair, workforce, supervisor, server, flight attendant).' },
  { pattern: /\b(young|energetic|digital native|recent graduate only)\b/gi, reason: 'Age-coded wording; a requirement for a number of years of experience is a lawful way to express seniority.' },
  { pattern: /\b(able-bodied|physical(?:ly)? fit|must be able to lift)\b/gi, reason: 'Disability-coded wording. State the essential function and offer to discuss reasonable accommodation instead.' },
  { pattern: /\b(native (?:english|speaker))\b/gi, reason: 'Nationality-coded wording. Require a proficiency level against a stated framework instead.' },
];

export interface JdBiasFlag {
  term: string;
  reason: string;
}

/** Scan a description for pool-narrowing language. Deterministic, order-preserving, de-duplicated. */
export function scanJobDescriptionLanguage(text: string): JdBiasFlag[] {
  const flags: JdBiasFlag[] = [];
  const seen: Record<string, true> = {};
  for (const rule of JD_BIASED_TERMS) {
    // Reset lastIndex because these patterns are /g and reused across calls.
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(text);
    while (match !== null) {
      const term = match[0].toLowerCase();
      if (!seen[term]) {
        seen[term] = true;
        flags.push({ term: match[0], reason: rule.reason });
      }
      match = rule.pattern.exec(text);
      if (match !== null && match.index === rule.pattern.lastIndex) rule.pattern.lastIndex += 1;
    }
  }
  return flags;
}

export function computeJobDescription(values: BusinessToolInput): BusinessToolOutcome {
  const jobTitle = toText(values['jobTitle']).trim();
  const companyName = toText(values['companyName']).trim();
  if (jobTitle === '') {
    return {
      ok: false,
      error: failure('A job title is required — it is the heading of the description.', [
        { key: 'jobTitle', message: 'Job title is required.' },
      ]),
    };
  }

  const department = toText(values['department']).trim();
  const level = toText(values['level']) || 'mid';
  const employmentType = toText(values['employmentType']) || 'full-time';
  const workMode = toText(values['workMode']) || 'onsite';
  const location = toText(values['location']).trim();
  const currency = toText(values['currency']) || 'NGN';
  const salaryPeriod = toText(values['salaryPeriod']) || 'year';
  const salaryMin = toNumber(values['salaryMin']);
  const salaryMax = toNumber(values['salaryMax']);
  const yearsExperience = toNumber(values['yearsExperience']) ?? 0;
  const aboutCompany = toText(values['aboutCompany']).trim();
  const responsibilities = toLines(values['responsibilities']);
  const requiredSkills = toList(values['requiredSkills']);
  const preferredSkills = toList(values['preferredSkills']);
  const qualifications = toLines(values['qualifications']);
  const benefits = toLines(values['benefits']);
  const applicationInstructions = toText(values['applicationInstructions']).trim();
  const includeSalary = toBoolean(values['includeSalary']);

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (includeSalary) {
    if (salaryMin === null || salaryMax === null) {
      fieldErrors.push({ key: 'salaryMin', message: 'Enter both ends of the salary range, or untick "Publish the salary range".' });
    } else if (salaryMin < 0 || salaryMax < 0) {
      fieldErrors.push({ key: 'salaryMin', message: 'Salary figures cannot be negative.' });
    } else if (salaryMax < salaryMin) {
      fieldErrors.push({ key: 'salaryMax', message: `The upper bound (${formatAmount(salaryMax)}) cannot be below the lower bound (${formatAmount(salaryMin)}).` });
    } else if (salaryMin === salaryMax) {
      fieldErrors.push({ key: 'salaryMax', message: 'A range needs two different figures. Enter a single figure in both fields only if you intend to advertise one exact number.' });
    }
  }
  if (yearsExperience < 0 || yearsExperience > 60) {
    fieldErrors.push({ key: 'yearsExperience', message: 'Years of experience must be between 0 and 60.' });
  }
  if (responsibilities.length === 0) {
    fieldErrors.push({ key: 'responsibilities', message: 'Add at least one responsibility — a description without duties does not tell a candidate what the job is.' });
  }
  if (responsibilities.length > 20) {
    fieldErrors.push({ key: 'responsibilities', message: `Trim the responsibilities to 20 lines or fewer (currently ${responsibilities.length}).` });
  }
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the highlighted fields before generating the description.') };
  }

  const levelLabels: Record<string, string> = {
    intern: 'Internship', entry: 'Entry level', mid: 'Mid level',
    senior: 'Senior', lead: 'Lead / Principal', manager: 'Manager',
    head: 'Head of function', director: 'Director',
  };
  const workModeLabels: Record<string, string> = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' };
  const levelLabel = levelLabels[level] ?? titleCase(level);
  const workModeLabel = workModeLabels[workMode] ?? titleCase(workMode);

  const salaryLine = includeSalary && salaryMin !== null && salaryMax !== null
    ? `${formatMoney(salaryMin, currency, 0)} – ${formatMoney(salaryMax, currency, 0)} per ${salaryPeriod}`
    : 'Not published';

  const sections: string[] = [];
  sections.push(`# ${jobTitle}`);
  sections.push('');
  sections.push(
    [
      companyName ? `**${companyName}**` : null,
      department ? `${department} team` : null,
      levelLabel,
      titleCase(employmentType),
      workModeLabel,
      location || 'Location not specified',
    ].filter((part): part is string => part !== null).join(' · ')
  );
  if (includeSalary) {
    sections.push('');
    sections.push(`**Compensation:** ${salaryLine}`);
  }

  if (aboutCompany) {
    sections.push('', '## About the company', '', aboutCompany);
  }

  sections.push('', '## About the role', '');
  sections.push(
    `We are hiring a ${jobTitle}${department ? ` for the ${department} team` : ''} at ${levelLabel.toLowerCase()} level. ` +
    `This is a ${employmentType.toLowerCase()} position working ${workModeLabel.toLowerCase()}` +
    `${location ? ` from ${location}` : ''}.` +
    (yearsExperience > 0
      ? ` We expect around ${yearsExperience} year${yearsExperience === 1 ? '' : 's'} of relevant experience.`
      : ' No minimum years of experience are required; the skills below matter more than tenure.')
  );

  sections.push('', '## What you will do', '', numberedList(responsibilities));

  if (requiredSkills.length > 0) {
    sections.push('', '## What we need you to have', '', bulletList(requiredSkills));
  }
  if (preferredSkills.length > 0) {
    sections.push('', '## Nice to have', '', bulletList(preferredSkills));
  }
  if (qualifications.length > 0) {
    sections.push('', '## Qualifications and certifications', '', bulletList(qualifications));
  }
  if (benefits.length > 0) {
    sections.push('', '## Benefits', '', bulletList(benefits));
  }
  if (applicationInstructions) {
    sections.push('', '## How to apply', '', applicationInstructions);
  }
  sections.push('', '## Equal opportunity statement', '');
  sections.push(
    `${companyName || 'We'} assess applicants against the requirements listed above. We do not discriminate on the basis of ` +
    'age, disability, ethnicity, gender, marital status, pregnancy, religion, sexual orientation or any other ' +
    'characteristic protected by applicable law. If you need an adjustment to take part in the selection process, tell us and we will arrange it.'
  );
  sections.push('', '---', '', DRAFT_REVIEW_NOTICE);

  const document: ResultDocument = {
    format: 'markdown',
    filename: `${jobTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'job'}-description.md`,
    label: 'Job description',
    content: tidyDocument(sections.join('\n')),
  };

  const fullText = sections.join('\n');
  const flags = scanJobDescriptionLanguage(fullText);
  const words = fullText.split(/\s+/).filter((word) => word.length > 0).length;

  const metrics: ResultMetric[] = [
    { label: 'Word count', value: String(words), emphasis: 'primary', hint: words > 900 ? 'Longer than the 700–900 words most listings hold attention for' : 'Within the range most listings hold attention for' },
    { label: 'Responsibilities', value: String(responsibilities.length), emphasis: 'secondary' },
    { label: 'Must-have skills', value: String(requiredSkills.length), emphasis: 'secondary' },
    {
      label: 'Inclusive-language flags',
      value: String(flags.length),
      emphasis: flags.length > 0 ? 'primary' : 'muted',
      hint: flags.length > 0 ? 'Review the advisories below before publishing' : 'No pool-narrowing wording detected',
    },
  ];

  const tables: ResultTable[] = [];
  if (flags.length > 0) {
    tables.push({
      title: 'Inclusive-language review',
      columns: ['Flagged wording', 'Why it may narrow your applicant pool'],
      rows: flags.map((flag) => ({ label: flag.term, cells: [flag.reason] })),
      caption:
        'A linting aid based on published recruitment-inclusion research, not a legal test. It cannot tell you whether this description complies with any discrimination statute — a human should decide each flag.',
    });
  }

  return {
    ok: true,
    result: {
      metrics,
      tables,
      document,
      explanation: [
        `Assembled ${responsibilities.length} responsibilities, ${requiredSkills.length} required skills and ${preferredSkills.length} preferred skills into a ${words}-word description.`,
        includeSalary
          ? `The salary range ${salaryLine} is published in the listing.`
          : 'No salary range is published. Listings that omit pay typically receive fewer and less relevant applications.',
        `Level "${levelLabel}", type "${titleCase(employmentType)}" and work mode "${workModeLabel}" appear in the header line.`,
      ],
      warnings: flags.length > 0
        ? [`${flags.length} wording flag${flags.length === 1 ? '' : 's'} raised in the inclusive-language review below.`]
        : [],
    },
  };
}

/* ================================================================== */
/* 2. Job Offer Letter Generator                                       */
/* ================================================================== */

export function computeJobOfferLetter(values: BusinessToolInput): BusinessToolOutcome {
  const candidateName = toText(values['candidateName']).trim();
  const jobTitle = toText(values['jobTitle']).trim();
  const companyName = toText(values['companyName']).trim();

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (candidateName === '') fieldErrors.push({ key: 'candidateName', message: 'The candidate\u2019s name is required.' });
  if (jobTitle === '') fieldErrors.push({ key: 'jobTitle', message: 'The job title is required.' });
  if (companyName === '') fieldErrors.push({ key: 'companyName', message: 'Your company name is required.' });

  const startDate = toText(values['startDate']).trim();
  const offerValidUntil = toText(values['offerValidUntil']).trim();
  if (startDate !== '' && !parseIsoDate(startDate)) {
    fieldErrors.push({ key: 'startDate', message: 'Start date must be a real date in YYYY-MM-DD format.' });
  }
  if (offerValidUntil !== '' && !parseIsoDate(offerValidUntil)) {
    fieldErrors.push({ key: 'offerValidUntil', message: 'Acceptance deadline must be a real date in YYYY-MM-DD format.' });
  }
  if (startDate && offerValidUntil && parseIsoDate(startDate) && parseIsoDate(offerValidUntil)) {
    if (offerValidUntil > startDate) {
      fieldErrors.push({ key: 'offerValidUntil', message: 'The acceptance deadline cannot fall after the start date.' });
    }
  }

  const salary = toNumber(values['salary']);
  const salaryPeriod = toText(values['salaryPeriod']) || 'year';
  if (salary === null) fieldErrors.push({ key: 'salary', message: 'The offered salary is required.' });
  else if (salary <= 0) fieldErrors.push({ key: 'salary', message: 'The offered salary must be greater than zero.' });

  const probationMonths = toNumber(values['probationMonths']) ?? 0;
  if (probationMonths < 0 || probationMonths > 24) {
    fieldErrors.push({ key: 'probationMonths', message: 'Probation must be between 0 and 24 months.' });
  }
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the highlighted fields before generating the offer letter.') };
  }

  const currency = toText(values['currency']) || 'NGN';
  const department = toText(values['department']).trim();
  const employmentType = toText(values['employmentType']) || 'full-time';
  const workMode = toText(values['workMode']) || 'onsite';
  const location = toText(values['location']).trim();
  const reportingTo = toText(values['reportingTo']).trim();
  const bonus = toText(values['bonus']).trim();
  const noticePeriod = toText(values['noticePeriod']).trim();
  const benefits = toLines(values['benefits']);
  const conditions = toLines(values['conditions']);
  const signatoryName = toText(values['signatoryName']).trim();
  const signatoryTitle = toText(values['signatoryTitle']).trim();
  const signatoryEmail = toText(values['signatoryEmail']).trim();

  const workModeLabels: Record<string, string> = { onsite: 'on-site', hybrid: 'hybrid', remote: 'remote' };
  const salaryText = `${formatMoney(salary as number, currency, 0)} per ${salaryPeriod}`;
  const monthlyEquivalent = salaryPeriod === 'year'
    ? round((salary as number) / 12, 2)
    : salaryPeriod === 'month'
      ? (salary as number)
      : null;

  const parts: string[] = [];
  parts.push(companyName.toUpperCase());
  parts.push('');
  parts.push(`Date: ${formatLongDate(toText(values['letterDate']).trim() || startDate)}`);
  parts.push('');
  parts.push(`Dear ${candidateName},`);
  parts.push('');
  parts.push(`## Offer of Employment — ${jobTitle}`);
  parts.push('');
  parts.push(
    `We are pleased to offer you the position of **${jobTitle}**` +
    `${department ? ` in the ${department} department` : ''} at **${companyName}**. ` +
    `We were impressed by your experience and believe you will make a strong contribution to the team.`
  );
  parts.push('');
  parts.push('### Terms of the offer');
  parts.push('');
  parts.push(line('Position', jobTitle));
  parts.push(line('Department', department || 'Not specified'));
  parts.push(line('Employment type', titleCase(employmentType)));
  parts.push(line('Working arrangement', `${workModeLabels[workMode] ?? workMode}${location ? `, ${location}` : ''}`));
  parts.push(line('Reporting to', reportingTo || 'Not specified'));
  parts.push(line('Commencement date', startDate ? formatLongDate(startDate) : ''));
  parts.push(line('Compensation', salaryText));
  if (monthlyEquivalent !== null) parts.push(`Monthly equivalent: ${formatMoney(monthlyEquivalent, currency)}`);
  if (bonus) parts.push(line('Bonus / variable pay', bonus));
  parts.push(line(
    'Probationary period',
    probationMonths > 0 ? `${probationMonths} month${probationMonths === 1 ? '' : 's'} from the commencement date` : 'None'
  ));
  parts.push(line('Notice period', noticePeriod || 'As set out in the employment contract'));
  if (benefits.length > 0) {
    parts.push('');
    parts.push('### Benefits');
    parts.push('');
    parts.push(bulletList(benefits));
  }
  if (conditions.length > 0) {
    parts.push('');
    parts.push('### Conditions of this offer');
    parts.push('');
    parts.push(numberedList(conditions));
    parts.push('');
    parts.push('This offer is conditional on each of the above being satisfied to the company\u2019s reasonable satisfaction.');
  }
  parts.push('');
  parts.push('### Acceptance');
  parts.push('');
  parts.push(
    offerValidUntil
      ? `To accept this offer, sign and return a copy of this letter by **${formatLongDate(offerValidUntil)}**. If we have not received your acceptance by that date, this offer will lapse unless we agree otherwise in writing.`
      : 'To accept this offer, sign and return a copy of this letter. Please tell us if you need more time to consider it.'
  );
  parts.push('');
  parts.push(
    'Your detailed terms and conditions will be set out in a formal employment contract issued on or before your ' +
    'commencement date. Where this letter and that contract differ, the contract governs.'
  );
  parts.push('');
  parts.push('We are excited about the prospect of you joining us.');
  parts.push('');
  parts.push('Yours sincerely,');
  parts.push('');
  parts.push('');
  parts.push(signatoryName || '[Signatory name]');
  parts.push(signatoryTitle || '[Signatory title]');
  parts.push(companyName);
  if (signatoryEmail) parts.push(signatoryEmail);
  parts.push('');
  parts.push('### Candidate acceptance');
  parts.push('');
  parts.push(`I, ${candidateName}, accept this offer of employment as ${jobTitle} at ${companyName} on the terms set out above.`);
  parts.push('');
  parts.push('Signature: ______________________________');
  parts.push('');
  parts.push('Name: ' + candidateName);
  parts.push('');
  parts.push('Date: ______________________________');
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(DRAFT_REVIEW_NOTICE);

  const document: ResultDocument = {
    format: 'markdown',
    filename: `offer-letter-${candidateName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'candidate'}.md`,
    label: 'Offer letter',
    content: tidyDocument(parts.join('\n')),
  };

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Offered compensation', value: salaryText, emphasis: 'primary', hint: monthlyEquivalent !== null ? `${formatMoney(monthlyEquivalent, currency)} per month` : undefined },
        { label: 'Commencement date', value: startDate ? formatLongDate(startDate) : 'Not specified', emphasis: 'secondary' },
        { label: 'Probation', value: probationMonths > 0 ? `${probationMonths} month${probationMonths === 1 ? '' : 's'}` : 'None', emphasis: 'muted' },
        { label: 'Word count', value: String(document.content.split(/\s+/).filter((w) => w).length), emphasis: 'muted' },
      ],
      document,
      explanation: [
        `Addressed to ${candidateName} for the ${jobTitle} role at ${companyName}.`,
        `Compensation is stated as ${salaryText}${monthlyEquivalent !== null ? ` (${formatMoney(monthlyEquivalent, currency)} per month)` : ''}.`,
        conditions.length > 0
          ? `${conditions.length} condition${conditions.length === 1 ? '' : 's'} of offer included, with an explicit statement that the offer is conditional on each being satisfied.`
          : 'No conditions were supplied, so the letter does not make the offer conditional. Consider adding reference, background-check or right-to-work conditions if they apply.',
        'The letter states that the formal employment contract governs where the two differ, so it cannot contradict the contract you issue later.',
      ],
      warnings: probationMonths > 6
        ? [`A ${probationMonths}-month probationary period is unusually long. Check the maximum permitted in your jurisdiction before issuing this offer.`]
        : [],
    },
  };
}

/* ================================================================== */
/* 3. Official Payslip Generator                                       */
/* ================================================================== */

/**
 * Parse `Component, Amount` or `Component | Amount` lines into payslip rows.
 *
 * Accepting a pasted list rather than a dynamic row editor keeps the tool usable on a phone and
 * keeps the engine pure — but a malformed line is a hard error, not a silent zero, because a
 * payslip with a missing deduction is worse than no payslip.
 */
export function parseAmountLines(
  raw: unknown
): { ok: true; rows: Array<{ label: string; amount: number }> } | { ok: false; error: string } {
  const lines = toLines(raw);
  if (lines.length === 0) return { ok: true, rows: [] };
  const rows: Array<{ label: string; amount: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (text === undefined) continue;
    const parts = text.split(/[|,;\t]/).map((part) => part.trim());
    if (parts.length < 2) {
      return { ok: false, error: `Line ${index + 1} ("${clampText(text, 40)}") needs a label and an amount separated by a comma, e.g. "Basic salary, 150000".` };
    }
    const label = parts.slice(0, parts.length - 1).join(', ').trim();
    const amountText = parts[parts.length - 1] ?? '';
    const amount = toNumber(amountText);
    if (label === '') return { ok: false, error: `Line ${index + 1} has an amount but no label.` };
    if (amount === null) return { ok: false, error: `Line ${index + 1}: "${amountText}" is not a number.` };
    if (amount < 0) return { ok: false, error: `Line ${index + 1}: an amount cannot be negative. Enter deductions in the deductions box.` };
    rows.push({ label, amount: round(amount, 2) });
  }
  return { ok: true, rows };
}

export function computePayslip(values: BusinessToolInput): BusinessToolOutcome {
  const companyName = toText(values['companyName']).trim();
  const employeeName = toText(values['employeeName']).trim();
  const payPeriod = toText(values['payPeriod']).trim();

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (companyName === '') fieldErrors.push({ key: 'companyName', message: 'The employer name is required — a payslip without an issuer is not a payslip.' });
  if (employeeName === '') fieldErrors.push({ key: 'employeeName', message: 'The employee name is required.' });
  if (payPeriod === '') fieldErrors.push({ key: 'payPeriod', message: 'The pay period is required (YYYY-MM).' });

  const earningsParsed = parseAmountLines(values['earnings']);
  if (!earningsParsed.ok) fieldErrors.push({ key: 'earnings', message: earningsParsed.error });
  const deductionsParsed = parseAmountLines(values['deductions']);
  if (!deductionsParsed.ok) fieldErrors.push({ key: 'deductions', message: deductionsParsed.error });

  const paidDays = toNumber(values['paidDays']);
  const workingDays = toNumber(values['workingDays']) ?? 0;
  const lopDays = toNumber(values['lopDays']) ?? 0;
  if (paidDays !== null && paidDays < 0) fieldErrors.push({ key: 'paidDays', message: 'Paid days cannot be negative.' });
  if (lopDays < 0) fieldErrors.push({ key: 'lopDays', message: 'Loss-of-pay days cannot be negative.' });
  if (workingDays > 0 && lopDays > workingDays) {
    fieldErrors.push({ key: 'lopDays', message: `Loss-of-pay days (${lopDays}) cannot exceed the ${workingDays} working days in the period.` });
  }
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the highlighted payslip fields before generating.') };
  }

  const earnings = earningsParsed.ok ? earningsParsed.rows : [];
  const deductions = deductionsParsed.ok ? deductionsParsed.rows : [];
  const currency = toText(values['currency']) || 'NGN';

  // Optional statutory block, computed with the same engine the PAYE calculator uses so a payslip
  // and a PAYE run on identical inputs cannot disagree.
  const applyStatutory = toBoolean(values['applyStatutory']);
  const statutory: Array<{ label: string; amount: number }> = [];
  const basicRow = earnings.find((row) => /basic/i.test(row.label));
  const housingRow = earnings.find((row) => /housing/i.test(row.label));
  const transportRow = earnings.find((row) => /transport/i.test(row.label));
  const grossBeforeStatutory = earnings.reduce((total, row) => total + row.amount, 0);

  if (applyStatutory) {
    const basic = basicRow ? basicRow.amount : 0;
    const housing = housingRow ? housingRow.amount : 0;
    const transport = transportRow ? transportRow.amount : 0;
    if (basic + housing + transport <= 0) {
      return {
        ok: false,
        error: failure(
          'Statutory deductions need a basic, housing or transport earning line to compute from. Either add those lines to the earnings box or untick "Add statutory deductions".',
          [{ key: 'earnings', message: 'No basic/housing/transport line found for the statutory calculation.' }]
        ),
      };
    }
    const structure = computePayeStructure(basic + housing + transport, {
      basicPct: grossBeforeStatutory > 0 ? (basic / grossBeforeStatutory) * 100 : 100,
      housingPct: grossBeforeStatutory > 0 ? (housing / grossBeforeStatutory) * 100 : 0,
      transportPct: grossBeforeStatutory > 0 ? (transport / grossBeforeStatutory) * 100 : 0,
      reimbursementPct: grossBeforeStatutory > 0
        ? Math.max(0, 100 - ((basic + housing + transport) / grossBeforeStatutory) * 100)
        : 0,
      monthlyOtherDeductions: 0,
    });
    statutory.push({ label: 'Pension (employee, 8%)', amount: structure.pensionEmployee });
    statutory.push({ label: 'NHF housing fund (2.5% of gross)', amount: structure.nhf });
    statutory.push({ label: 'NHIS health insurance (5% of basic)', amount: structure.nhis });
    statutory.push({ label: 'PAYE income tax', amount: structure.monthlyTax });
  }

  const allDeductions = [...deductions, ...statutory];
  const grossPay = round(grossBeforeStatutory, 2);
  const totalDeductions = round(allDeductions.reduce((total, row) => total + row.amount, 0), 2);
  const netPay = round(grossPay - totalDeductions, 2);

  if (netPay < 0) {
    return {
      ok: false,
      error: failure(
        `Deductions of ${formatMoney(totalDeductions, currency)} exceed gross pay of ${formatMoney(grossPay, currency)}, giving a negative net pay of ${formatMoney(netPay, currency)}. Correct the figures — a payslip cannot show an employee owing the employer money.`,
        [{ key: 'deductions', message: 'Total deductions exceed gross pay.' }]
      ),
    };
  }
  if (earnings.length === 0) {
    return {
      ok: false,
      error: failure('Add at least one earnings line — a payslip with no earnings has nothing to report.', [
        { key: 'earnings', message: 'At least one earnings line is required.' },
      ]),
    };
  }

  const employeeId = toText(values['employeeId']).trim();
  const designation = toText(values['designation']).trim();
  const department = toText(values['department']).trim();
  const bankName = toText(values['bankName']).trim();
  const bankAccount = toText(values['bankAccount']).trim();
  const paymentDate = toText(values['paymentDate']).trim();
  const companyAddress = toText(values['companyAddress']).trim();

  const slip: string[] = [];
  slip.push(companyName.toUpperCase());
  if (companyAddress) slip.push(companyAddress);
  slip.push('');
  slip.push('PAYSLIP');
  slip.push(`Pay period: ${formatMonth(payPeriod)}`);
  if (paymentDate) slip.push(`Payment date: ${formatLongDate(paymentDate)}`);
  slip.push('');
  slip.push('EMPLOYEE DETAILS');
  slip.push(line('Name', employeeName));
  slip.push(line('Employee ID', employeeId || 'Not supplied'));
  slip.push(line('Designation', designation || 'Not supplied'));
  slip.push(line('Department', department || 'Not supplied'));
  if (paidDays !== null) slip.push(line('Paid days', String(paidDays)));
  if (workingDays > 0) slip.push(line('Working days in period', String(workingDays)));
  if (lopDays > 0) slip.push(line('Loss-of-pay days', String(lopDays)));
  slip.push('');
  slip.push(`EARNINGS (${currency})`);
  for (const row of earnings) slip.push(`  ${row.label.padEnd(38, ' ')} ${formatAmount(row.amount).padStart(14, ' ')}`);
  slip.push(`  ${'Gross pay'.padEnd(38, ' ')} ${formatAmount(grossPay).padStart(14, ' ')}`);
  slip.push('');
  slip.push(`DEDUCTIONS (${currency})`);
  if (allDeductions.length === 0) {
    slip.push('  None');
  } else {
    for (const row of allDeductions) slip.push(`  ${row.label.padEnd(38, ' ')} ${formatAmount(row.amount).padStart(14, ' ')}`);
  }
  slip.push(`  ${'Total deductions'.padEnd(38, ' ')} ${formatAmount(totalDeductions).padStart(14, ' ')}`);
  slip.push('');
  slip.push(`  ${'NET PAY'.padEnd(38, ' ')} ${formatAmount(netPay).padStart(14, ' ')}`);
  if (bankName || bankAccount) {
    slip.push('');
    slip.push('PAYMENT DETAILS');
    if (bankName) slip.push(line('Bank', bankName));
    if (bankAccount) slip.push(line('Account number', bankAccount));
    slip.push(`Amount credited: ${formatMoney(netPay, currency)}`);
  }
  slip.push('');
  slip.push('This payslip is computer-generated from the figures supplied by the employer.');
  slip.push(DRAFT_REVIEW_NOTICE);

  const document: ResultDocument = {
    format: 'text',
    filename: `payslip-${employeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee'}-${payPeriod}.txt`,
    label: 'Payslip',
    content: tidyDocument(slip.join('\n')),
  };

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Gross pay', value: formatMoney(grossPay, currency), emphasis: 'secondary' },
        { label: 'Total deductions', value: formatMoney(totalDeductions, currency), emphasis: 'muted', hint: `${allDeductions.length} line${allDeductions.length === 1 ? '' : 's'}` },
        { label: 'Net pay', value: formatMoney(netPay, currency), emphasis: 'primary', hint: `For ${formatMonth(payPeriod)}` },
        {
          label: 'Deduction ratio',
          value: grossPay > 0 ? `${round((totalDeductions / grossPay) * 100, 2)}%` : '0%',
          emphasis: 'muted',
          hint: 'Total deductions as a share of gross pay',
        },
      ],
      tables: [
        {
          title: 'Earnings',
          columns: ['Component', `Amount (${currency})`],
          rows: [
            ...earnings.map((row) => ({ label: row.label, cells: [formatAmount(row.amount)] })),
            { label: 'Gross pay', cells: [formatAmount(grossPay)], emphasis: 'total' as const },
          ],
        },
        {
          title: 'Deductions',
          columns: ['Component', `Amount (${currency})`],
          rows: [
            ...(allDeductions.length === 0
              ? [{ label: 'None', cells: ['—'], emphasis: 'muted' as const }]
              : allDeductions.map((row) => ({ label: row.label, cells: [formatAmount(row.amount)] }))),
            { label: 'Total deductions', cells: [formatAmount(totalDeductions)], emphasis: 'total' as const },
            { label: 'Net pay', cells: [formatAmount(netPay)], emphasis: 'total' as const },
          ],
        },
      ],
      document,
      explanation: [
        `Gross pay is the sum of ${earnings.length} earnings line${earnings.length === 1 ? '' : 's'}.`,
        applyStatutory
          ? 'Statutory deductions (pension 8%, NHF 2.5% of gross, NHIS 5% of basic, and PAYE under the Nigeria Tax Act 2026 bands) were computed from your basic, housing and transport lines using the same engine as the PAYE & Net Salary Calculator.'
          : 'Only the deductions you listed are applied. Tick "Add statutory deductions" to compute pension, NHF, NHIS and PAYE from the basic, housing and transport lines.',
        `Net pay = gross ${formatMoney(grossPay, currency)} − deductions ${formatMoney(totalDeductions, currency)} = ${formatMoney(netPay, currency)}.`,
        lopDays > 0 && workingDays > 0
          ? `Loss-of-pay: ${lopDays} of ${workingDays} working days are unpaid. Reduce the affected earnings lines by that proportion before generating, or the payslip will overstate gross pay.`
          : 'No loss-of-pay days were entered, so gross pay is the full period amount.',
      ],
      warnings: applyStatutory
        ? ['Statutory figures are estimates based on the Nigeria rates documented on the PAYE calculator. They do not include reliefs (rent, mortgage interest, life insurance) that would reduce PAYE.']
        : [],
      extraDocuments: [
        {
          format: 'csv',
          filename: `payslip-${employeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee'}-${payPeriod}.csv`,
          label: 'Payslip (CSV)',
          content: toCsv(
            ['Section', 'Component', `Amount (${currency})`],
            [
              ...earnings.map((row) => ['Earnings', row.label, row.amount.toFixed(2)] as unknown[]),
              ['Earnings', 'Gross pay', grossPay.toFixed(2)] as unknown[],
              ...allDeductions.map((row) => ['Deductions', row.label, row.amount.toFixed(2)] as unknown[]),
              ['Deductions', 'Total deductions', totalDeductions.toFixed(2)] as unknown[],
              ['Summary', 'Net pay', netPay.toFixed(2)] as unknown[],
            ]
          ),
        },
      ],
    },
  };
}

/* ================================================================== */
/* 4. NDA Contract Generator                                           */
/* ================================================================== */

export function computeNdaContract(values: BusinessToolInput): BusinessToolOutcome {
  const disclosingParty = toText(values['disclosingParty']).trim();
  const receivingParty = toText(values['receivingParty']).trim();

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (disclosingParty === '') fieldErrors.push({ key: 'disclosingParty', message: 'The disclosing party\u2019s legal name is required.' });
  if (receivingParty === '') fieldErrors.push({ key: 'receivingParty', message: 'The receiving party\u2019s legal name is required.' });
  if (
    disclosingParty !== '' &&
    receivingParty !== '' &&
    disclosingParty.toLowerCase() === receivingParty.toLowerCase()
  ) {
    fieldErrors.push({ key: 'receivingParty', message: 'The two parties cannot be the same person or entity — an NDA needs a discloser and a recipient.' });
  }

  const effectiveDate = toText(values['effectiveDate']).trim();
  if (effectiveDate && !parseIsoDate(effectiveDate)) {
    fieldErrors.push({ key: 'effectiveDate', message: 'Effective date must be a real date in YYYY-MM-DD format.' });
  }
  const termYears = toNumber(values['termYears']) ?? 2;
  const survivalYears = toNumber(values['survivalYears']) ?? 3;
  if (termYears < 0 || termYears > 50) fieldErrors.push({ key: 'termYears', message: 'The agreement term must be between 0 and 50 years.' });
  if (survivalYears < 0 || survivalYears > 50) fieldErrors.push({ key: 'survivalYears', message: 'The survival period must be between 0 and 50 years.' });
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the highlighted fields before generating the agreement.') };
  }

  const mutual = toText(values['structure']) === 'mutual';
  const purpose = toText(values['purpose']).trim() || 'evaluating a potential business relationship';
  const governingLaw = toText(values['governingLaw']).trim() || 'the Federal Republic of Nigeria';
  const jurisdictionVenue = toText(values['jurisdictionVenue']).trim() || 'the courts of the Federal Republic of Nigeria';
  const includeNonSolicit = toBoolean(values['includeNonSolicit']);
  const nonSolicitMonths = toNumber(values['nonSolicitMonths']) ?? 12;
  const includeResiduals = toBoolean(values['includeResiduals']);
  const returnOrDestroy = toText(values['returnOrDestroy']) || 'return-or-destroy';
  const disclosingAddress = toText(values['disclosingAddress']).trim();
  const receivingAddress = toText(values['receivingAddress']).trim();

  const warnings: string[] = [];
  if (nonSolicitMonths > 24 && includeNonSolicit) {
    warnings.push(`A ${nonSolicitMonths}-month non-solicitation period is long. Restrictive covenants of this length are unenforceable in several jurisdictions; check before relying on it.`);
  }
  if (survivalYears > 5) {
    warnings.push(`Confidentiality surviving ${survivalYears} years after termination is unusual outside trade secrets. Consider making trade-secret protection indefinite instead.`);
  }

  const partiesLine = mutual
    ? `between **${disclosingParty}**${disclosingAddress ? ` of ${disclosingAddress}` : ''} and **${receivingParty}**${receivingAddress ? ` of ${receivingAddress}` : ''} (each a "Party" and together the "Parties")`
    : `between **${disclosingParty}**${disclosingAddress ? ` of ${disclosingAddress}` : ''} (the "Disclosing Party") and **${receivingParty}**${receivingAddress ? ` of ${receivingAddress}` : ''} (the "Receiving Party")`;

  const recipient = mutual ? 'each Party (in respect of the other Party\u2019s Confidential Information)' : 'the Receiving Party';
  const discloser = mutual ? 'each Party' : 'the Disclosing Party';

  const parts: string[] = [];
  parts.push('# NON-DISCLOSURE AGREEMENT');
  parts.push('');
  parts.push(`This Non-Disclosure Agreement (the "Agreement") is made ${effectiveDate ? `on ${formatLongDate(effectiveDate)}` : 'on the date of last signature below'}`);
  parts.push(partiesLine + '.');
  parts.push('');
  parts.push('## 1. Purpose');
  parts.push('');
  parts.push(`The Parties wish to exchange confidential information for the purpose of ${purpose} (the "Purpose").`);
  parts.push('');
  parts.push('## 2. Confidential Information');
  parts.push('');
  parts.push(
    `"Confidential Information" means all non-public information disclosed by ${discloser} to ${recipient}, in any form, ` +
    'that is designated as confidential or that a reasonable person would understand to be confidential given its nature and the ' +
    'circumstances of disclosure. It includes, without limitation, business and financial information, customer and supplier lists, ' +
    'pricing, technical data, software, source code, architectures, security configurations, product plans, personnel information, ' +
    'trade secrets and know-how.'
  );
  parts.push('');
  parts.push('## 3. Exclusions');
  parts.push('');
  parts.push('Confidential Information does not include information that:');
  parts.push('');
  parts.push(numberedList([
    'is or becomes publicly available other than through a breach of this Agreement;',
    'was lawfully known to the recipient, without restriction, before disclosure by the discloser;',
    'is lawfully received from a third party who is not under an obligation of confidence; or',
    'is independently developed by the recipient without use of or reference to the Confidential Information.',
  ]));
  parts.push('');
  parts.push('## 4. Obligations');
  parts.push('');
  parts.push(`${mutual ? 'Each Party' : 'The Receiving Party'} shall:`);
  parts.push('');
  parts.push(bulletList([
    'use the Confidential Information only for the Purpose;',
    'not disclose it to any third party without the prior written consent of the discloser;',
    'limit access to those employees, officers and professional advisers who need it for the Purpose and who are bound by obligations at least as protective as these;',
    'protect it using no less than the care it uses for its own confidential information, and in any event no less than a reasonable standard of care;',
    'promptly notify the discloser of any unauthorised use or disclosure of which it becomes aware, and cooperate to mitigate the effect; and',
    'not copy or reverse-engineer any material disclosed except as strictly necessary for the Purpose.',
  ]));
  parts.push('');
  parts.push('## 5. Compelled disclosure');
  parts.push('');
  parts.push(
    `Where ${recipient} is required by law, regulation or a court or regulatory order to disclose Confidential Information, it may do so, ` +
    'but shall — to the extent legally permitted — give the discloser prompt written notice beforehand so that the discloser may seek a ' +
    'protective order, and shall disclose only the portion legally required.'
  );
  parts.push('');
  parts.push('## 6. No licence, no warranty');
  parts.push('');
  parts.push(
    'All Confidential Information remains the property of the discloser. Nothing in this Agreement grants any licence or right in any ' +
    'patent, copyright, trade mark, trade secret or other intellectual property, whether expressly, by implication or by estoppel. ' +
    'Confidential Information is provided "as is", without warranty of any kind.'
  );
  if (includeResiduals) {
    parts.push('');
    parts.push('## 6A. Residual knowledge');
    parts.push('');
    parts.push(
      `${recipient} may use residual knowledge — general skills, knowledge and experience retained in the unaided memory of personnel ` +
      'who have had access to the Confidential Information — provided that doing so does not involve reproducing any tangible embodiment ' +
      'of the Confidential Information and does not breach any other obligation in this Agreement.'
    );
  }
  parts.push('');
  parts.push('## 7. Term and survival');
  parts.push('');
  parts.push(
    termYears > 0
      ? `This Agreement takes effect on the date first written above and continues for ${termYears} year${termYears === 1 ? '' : 's'}, unless terminated earlier by either Party on 30 days\u2019 written notice.`
      : 'This Agreement takes effect on the date first written above and continues indefinitely until terminated by either Party on 30 days\u2019 written notice.'
  );
  parts.push('');
  parts.push(
    `The obligations of confidence survive termination or expiry of this Agreement for ${survivalYears} year${survivalYears === 1 ? '' : 's'}, ` +
    'except that obligations in respect of any Confidential Information constituting a trade secret continue for as long as that information remains a trade secret under applicable law.'
  );
  parts.push('');
  parts.push('## 8. Return or destruction');
  parts.push('');
  parts.push(
    returnOrDestroy === 'destroy-only'
      ? `On termination, or on the discloser\u2019s written request, ${recipient} shall permanently destroy all Confidential Information in its possession or control, including copies and derivative material, and shall certify destruction in writing within 14 days. Material held in routine backups or retained to comply with a legal or regulatory obligation may be kept, but remains subject to these obligations for as long as it is retained.`
      : `On termination, or on the discloser\u2019s written request, ${recipient} shall at the discloser\u2019s option return or permanently destroy all Confidential Information in its possession or control, including copies and derivative material, and shall certify compliance in writing within 14 days. Material held in routine backups or retained to comply with a legal or regulatory obligation may be kept, but remains subject to these obligations for as long as it is retained.`
  );
  if (includeNonSolicit) {
    parts.push('');
    parts.push('## 9. Non-solicitation');
    parts.push('');
    parts.push(
      `During the term of this Agreement and for ${nonSolicitMonths} month${nonSolicitMonths === 1 ? '' : 's'} afterwards, neither Party will, directly or indirectly, solicit for employment or engagement any employee of the other Party whose identity or role it learned of through the Confidential Information. This clause does not prevent either Party from responding to an unsolicited application made through a general public advertisement.`
    );
  }
  parts.push('');
  parts.push(`## ${includeNonSolicit ? '10' : '9'}. Remedies`);
  parts.push('');
  parts.push(
    `${recipient} acknowledges that unauthorised use or disclosure of Confidential Information may cause harm that damages alone would not adequately compensate. ` +
    'The discloser is therefore entitled to seek injunctive relief and specific performance, in addition to any other remedy available at law or in equity, without the need to prove actual damage or to post a bond where the law permits.'
  );
  parts.push('');
  parts.push(`## ${includeNonSolicit ? '11' : '10'}. General`);
  parts.push('');
  parts.push(bulletList([
    `This Agreement is governed by the laws of ${governingLaw}, and the Parties submit to the exclusive jurisdiction of ${jurisdictionVenue}.`,
    'This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions on it.',
    'No amendment is effective unless in writing and signed by both Parties. No failure or delay in exercising a right waives it.',
    mutual
      ? 'Neither Party may assign this Agreement without the other\u2019s prior written consent, except to a successor in connection with a merger or sale of substantially all its assets.'
      : 'The Receiving Party may not assign this Agreement without the Disclosing Party\u2019s prior written consent, except to a successor in connection with a merger or sale of substantially all its assets.',
    'If any provision is held unenforceable, the remainder continues in effect and the unenforceable provision is modified to the minimum extent needed to make it enforceable.',
    'A person who is not a Party has no right to enforce any term of this Agreement.',
  ]));
  parts.push('');
  parts.push('## Signature');
  parts.push('');
  parts.push(`Signed for and on behalf of **${disclosingParty}**:`);
  parts.push('');
  parts.push('Name: ______________________________');
  parts.push('');
  parts.push('Title: ______________________________');
  parts.push('');
  parts.push('Signature: ______________________________    Date: ______________');
  parts.push('');
  parts.push(`Signed for and on behalf of **${receivingParty}**:`);
  parts.push('');
  parts.push('Name: ______________________________');
  parts.push('');
  parts.push('Title: ______________________________');
  parts.push('');
  parts.push('Signature: ______________________________    Date: ______________');
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(DRAFT_REVIEW_NOTICE);

  const document: ResultDocument = {
    format: 'markdown',
    filename: mutual ? 'mutual-non-disclosure-agreement.md' : 'one-way-non-disclosure-agreement.md',
    label: mutual ? 'Mutual NDA' : 'One-way NDA',
    content: tidyDocument(parts.join('\n')),
  };

  const clauseCount = parts.filter((part) => /^## \d/.test(part)).length;

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Structure', value: mutual ? 'Mutual (two-way)' : 'One-way', emphasis: 'primary', hint: mutual ? 'Both parties are discloser and recipient' : `${disclosingParty} discloses; ${receivingParty} receives` },
        { label: 'Term', value: termYears > 0 ? `${termYears} year${termYears === 1 ? '' : 's'}` : 'Indefinite', emphasis: 'secondary' },
        { label: 'Confidentiality survival', value: `${survivalYears} year${survivalYears === 1 ? '' : 's'} (trade secrets: indefinite)`, emphasis: 'secondary' },
        { label: 'Clauses', value: String(clauseCount), emphasis: 'muted' },
      ],
      document,
      explanation: [
        `Purpose of disclosure: ${purpose}.`,
        `Governing law: ${governingLaw}; exclusive jurisdiction: ${jurisdictionVenue}.`,
        includeNonSolicit ? `A ${nonSolicitMonths}-month non-solicitation clause is included, with a carve-out for unsolicited public applications.` : 'No non-solicitation clause is included.',
        includeResiduals ? 'A residual-knowledge clause is included, limited to unaided memory and excluding tangible embodiments.' : 'No residual-knowledge clause is included — all retained information stays confidential.',
        returnOrDestroy === 'destroy-only'
          ? 'On termination the recipient must destroy the material and certify destruction; return is not offered as an option.'
          : 'On termination the discloser may elect return or destruction, and the recipient must certify compliance.',
        'A compelled-disclosure clause permits legally required disclosure with prior notice, so the agreement does not put the recipient in breach of a court order.',
      ],
      warnings,
    },
  };
}

/* ================================================================== */
/* 5. Employment Contract Generator                                    */
/* ================================================================== */

export function computeEmploymentContract(values: BusinessToolInput): BusinessToolOutcome {
  const employerName = toText(values['employerName']).trim();
  const employeeName = toText(values['employeeName']).trim();
  const jobTitle = toText(values['jobTitle']).trim();

  const fieldErrors: Array<{ key: string; message: string }> = [];
  if (employerName === '') fieldErrors.push({ key: 'employerName', message: 'The employer\u2019s legal name is required.' });
  if (employeeName === '') fieldErrors.push({ key: 'employeeName', message: 'The employee\u2019s full name is required.' });
  if (jobTitle === '') fieldErrors.push({ key: 'jobTitle', message: 'The job title is required.' });

  const startDate = toText(values['startDate']).trim();
  if (startDate && !parseIsoDate(startDate)) fieldErrors.push({ key: 'startDate', message: 'Start date must be a real date in YYYY-MM-DD format.' });
  const endDate = toText(values['endDate']).trim();
  const contractType = toText(values['contractType']) || 'permanent';
  if (contractType === 'fixed-term') {
    if (endDate === '') fieldErrors.push({ key: 'endDate', message: 'A fixed-term contract needs an end date.' });
    else if (!parseIsoDate(endDate)) fieldErrors.push({ key: 'endDate', message: 'End date must be a real date in YYYY-MM-DD format.' });
    else if (startDate && parseIsoDate(startDate) && parseIsoDate(endDate) && endDate <= startDate) {
      fieldErrors.push({ key: 'endDate', message: 'The end date must fall after the start date.' });
    }
  }

  const salary = toNumber(values['salary']);
  if (salary === null) fieldErrors.push({ key: 'salary', message: 'Gross salary is required.' });
  else if (salary <= 0) fieldErrors.push({ key: 'salary', message: 'Gross salary must be greater than zero.' });

  const noticeEmployee = toNumber(values['noticeEmployeeMonths']) ?? 1;
  const noticeEmployer = toNumber(values['noticeEmployerMonths']) ?? 1;
  if (noticeEmployee < 0 || noticeEmployee > 24) fieldErrors.push({ key: 'noticeEmployeeMonths', message: 'Employee notice must be between 0 and 24 months.' });
  if (noticeEmployer < 0 || noticeEmployer > 24) fieldErrors.push({ key: 'noticeEmployerMonths', message: 'Employer notice must be between 0 and 24 months.' });

  const annualLeaveDays = toNumber(values['annualLeaveDays']) ?? 20;
  if (annualLeaveDays < 0 || annualLeaveDays > 90) fieldErrors.push({ key: 'annualLeaveDays', message: 'Annual leave must be between 0 and 90 working days.' });

  const probationMonths = toNumber(values['probationMonths']) ?? 0;
  if (probationMonths < 0 || probationMonths > 24) fieldErrors.push({ key: 'probationMonths', message: 'Probation must be between 0 and 24 months.' });
  if (fieldErrors.length > 0) {
    return { ok: false, error: fieldFailure(fieldErrors, 'Fix the highlighted fields before generating the contract.') };
  }

  const currency = toText(values['currency']) || 'NGN';
  const salaryPeriod = toText(values['salaryPeriod']) || 'year';
  const department = toText(values['department']).trim();
  const reportsTo = toText(values['reportsTo']).trim();
  const workLocation = toText(values['workLocation']).trim();
  const workMode = toText(values['workMode']) || 'onsite';
  const weeklyHours = toNumber(values['weeklyHours']) ?? 40;
  const allowances = toLines(values['allowances']);
  const duties = toLines(values['duties']);
  const governingLaw = toText(values['governingLaw']).trim() || 'the Federal Republic of Nigeria';
  const includeConfidentiality = toBoolean(values['includeConfidentiality']);
  const includeIpAssignment = toBoolean(values['includeIpAssignment']);
  const includeNonCompete = toBoolean(values['includeNonCompete']);
  const nonCompeteMonths = toNumber(values['nonCompeteMonths']) ?? 6;

  const warnings: string[] = [];
  if (annualLeaveDays < 6) {
    warnings.push(`Annual leave of ${annualLeaveDays} working days is low. Nigeria\u2019s Labour Act (cap. L1 LFN 2004, s.18) entitles a worker with 12 months\u2019 continuous service to at least 6 working days, and more for longer service; many employers offer 20 or more. Verify the minimum that applies to you.`);
  }
  if (includeNonCompete && nonCompeteMonths > 12) {
    warnings.push(`A ${nonCompeteMonths}-month post-termination non-compete is long and is unenforceable in several jurisdictions unless it protects a legitimate interest and is no wider than necessary. Take local advice before relying on it.`);
  }
  if (weeklyHours > 48) {
    warnings.push(`A ${weeklyHours}-hour working week exceeds the 40-hour standard week many labour regimes set before overtime rules bite. Check the limit that applies in ${governingLaw}.`);
  }
  if (probationMonths > 6) {
    warnings.push(`A ${probationMonths}-month probationary period is unusual. Confirm the maximum permitted in your jurisdiction.`);
  }

  const monthlySalary = salaryPeriod === 'year' ? round((salary as number) / 12, 2) : salaryPeriod === 'month' ? (salary as number) : null;
  const workModeLabels: Record<string, string> = { onsite: 'on-site', hybrid: 'hybrid', remote: 'remote' };
  const workModeLabel = workModeLabels[workMode] ?? workMode;

  const parts: string[] = [];
  parts.push('# CONTRACT OF EMPLOYMENT');
  parts.push('');
  parts.push(`**Between:** ${employerName} (the "Employer")`);
  parts.push('');
  parts.push(`**And:** ${employeeName} (the "Employee")`);
  parts.push('');
  parts.push('The Employer and the Employee agree as follows.');
  parts.push('');
  parts.push('## 1. Appointment and commencement');
  parts.push('');
  parts.push(
    `1.1 The Employer employs the Employee as **${jobTitle}**${department ? ` in the ${department} department` : ''}.`
  );
  parts.push('');
  parts.push(`1.2 The employment commences on **${startDate ? formatLongDate(startDate) : '[commencement date]'}**.`);
  parts.push('');
  parts.push(
    contractType === 'fixed-term'
      ? `1.3 This is a fixed-term contract ending on **${formatLongDate(endDate)}**, unless terminated earlier under clause 9. The Employer may offer renewal, but is not obliged to.`
      : '1.3 This is a permanent contract of employment, subject to the termination provisions in clause 9.'
  );
  parts.push('');
  parts.push(
    `1.4 No previous employment counts towards continuous service except as expressly stated in writing.`
  );
  if (probationMonths > 0) {
    parts.push('');
    parts.push(
      `1.5 The first **${probationMonths} month${probationMonths === 1 ? '' : 's'}** of employment are probationary. During probation either party may terminate on **${Math.max(1, Math.round((probationMonths > 1 ? noticeEmployer : noticeEmployer) / 2))} week(s)\u2019** written notice. The Employer may extend probation once, in writing, by up to ${probationMonths} further month${probationMonths === 1 ? '' : 's'}.`
    );
  }
  parts.push('');
  parts.push('## 2. Duties and reporting');
  parts.push('');
  parts.push(`2.1 The Employee reports to ${reportsTo || '[line manager]'} and performs the duties of the role, together with any other duties reasonably consistent with it that the Employer may assign.`);
  if (duties.length > 0) {
    parts.push('');
    parts.push('2.2 The principal duties are:');
    parts.push('');
    parts.push(bulletList(duties, '    '));
  }
  parts.push('');
  parts.push(`2.${duties.length > 0 ? '3' : '2'} The Employee devotes their full time, attention and skill to the Employer\u2019s business during working hours, and does not undertake other paid work without the Employer\u2019s prior written consent.`);
  parts.push('');
  parts.push('## 3. Place and hours of work');
  parts.push('');
  parts.push(`3.1 The Employee works **${workModeLabel}**${workLocation ? `, based at ${workLocation}` : ''}.`);
  parts.push('');
  parts.push(`3.2 Normal working hours are **${weeklyHours} hours per week**, exclusive of rest breaks, worked between the hours the Employer reasonably sets. The Employee works such additional hours as the role reasonably requires.`);
  parts.push('');
  parts.push(
    workMode === 'remote' || workMode === 'hybrid'
      ? '3.3 Where the Employee works away from the Employer\u2019s premises, they remain responsible for securing any equipment and data they use, and for complying with the Employer\u2019s information-security and remote-working policies.'
      : '3.3 The Employer may reasonably require the Employee to work at another location, and may reasonably change the working pattern.'
  );
  parts.push('');
  parts.push('## 4. Remuneration');
  parts.push('');
  parts.push(`4.1 The Employer pays the Employee a gross salary of **${formatMoney(salary as number, currency, 0)} per ${salaryPeriod}**${monthlySalary !== null ? ` (${formatMoney(monthlySalary, currency)} per month)` : ''}, payable in arrears in equal monthly instalments on or before the last working day of each month, subject to statutory deductions.`);
  parts.push('');
  parts.push('4.2 The Employer deducts and remits income tax (PAYE), pension contributions and any other deduction required or authorised by law. Statutory employee pension is 8% of basic salary, housing and transport allowances under the Pension Reform Act 2014; the Employer contributes a minimum of 10% of the same base.');
  if (allowances.length > 0) {
    parts.push('');
    parts.push('4.3 In addition to salary, the Employee is entitled to:');
    parts.push('');
    parts.push(bulletList(allowances, '    '));
  }
  parts.push('');
  parts.push(`4.${allowances.length > 0 ? '4' : '3'} Salary is reviewed at least annually. A review does not guarantee an increase.`);
  parts.push('');
  parts.push('## 5. Leave');
  parts.push('');
  parts.push(`5.1 The Employee is entitled to **${annualLeaveDays} working days** of paid annual leave per complete year of service, in addition to public holidays. Leave is taken at times approved by the Employer and may not be carried forward except as the Employer agrees in writing.`);
  parts.push('');
  parts.push('5.2 Accrued but untaken leave is paid on termination only to the extent required by law or agreed in writing.');
  parts.push('');
  parts.push('5.3 The Employee is entitled to sick leave and other statutory leave in accordance with applicable law and the Employer\u2019s policies, on production of the certificates those policies require.');
  parts.push('');
  parts.push('## 6. Pension and benefits');
  parts.push('');
  parts.push('6.1 Both parties contribute to the Employee\u2019s Retirement Savings Account with the Pension Fund Administrator the Employee chooses, at the statutory minimum rates or any higher rates the Employer sets. The Employee\u2019s choice of administrator is the Employee\u2019s, and the Employer routes contributions accordingly.');
  parts.push('');
  parts.push('6.2 Other benefits, where offered, are governed by the terms of the relevant scheme and may be varied or withdrawn by the Employer in accordance with those terms.');
  if (includeConfidentiality) {
    parts.push('');
    parts.push('## 7. Confidentiality');
    parts.push('');
    parts.push(
      '7.1 The Employee keeps confidential all non-public information about the Employer\u2019s business, customers, suppliers, pricing, systems, security configuration and personnel, both during employment and afterwards, and uses it only for the Employer\u2019s business.'
    );
    parts.push('');
    parts.push('7.2 On termination the Employee returns or permanently destroys all such material and all Employer property, and certifies that they have done so.');
    parts.push('');
    parts.push('7.3 This clause does not prevent the Employee from making a protected disclosure, reporting a suspected offence to a competent authority, or disclosing information the law compels them to disclose.');
  }
  if (includeIpAssignment) {
    parts.push('');
    parts.push(`## ${includeConfidentiality ? '8' : '7'}. Intellectual property`);
    parts.push('');
    parts.push(
      `8.1 All intellectual property the Employee creates in the course of employment, or using the Employer\u2019s time, equipment or Confidential Information, vests in the Employer on creation. The Employee assigns it to the Employer with full title guarantee and waives, to the extent permitted by law, all moral rights in it.`
    );
    parts.push('');
    parts.push('8.2 This assignment does not extend to works the Employee creates entirely on their own time and equipment, unrelated to the Employer\u2019s business, and does not deprive the Employee of the right to use their own general skills and experience.');
    parts.push('');
    parts.push('8.3 The Employee shall sign any document the Employer reasonably requires to perfect the Employer\u2019s title.');
  }
  const terminationNumber = 7 + (includeConfidentiality ? 1 : 0) + (includeIpAssignment ? 1 : 0);
  parts.push('');
  parts.push(`## ${terminationNumber}. Termination`);
  parts.push('');
  parts.push(
    `${terminationNumber}.1 After any probationary period, either party may terminate this contract on written notice of ` +
    `**${noticeEmployee} month${noticeEmployee === 1 ? '' : 's'}** from the Employee and **${noticeEmployer} month${noticeEmployer === 1 ? '' : 's'}** from the Employer, or the Employer may pay gross salary in lieu of notice.`
  );
  parts.push('');
  parts.push(`${terminationNumber}.2 The Employer may terminate without notice or payment in lieu where the Employee commits a fundamental breach, including gross misconduct, dishonesty, a serious breach of health and safety rules, or a material breach of the confidentiality obligations in this contract.`);
  parts.push('');
  parts.push(`${terminationNumber}.3 On termination the Employee is paid accrued salary and any accrued statutory entitlements, and returns all Employer property.`);
  if (includeNonCompete) {
    parts.push('');
    parts.push(`## ${terminationNumber + 1}. Restrictive covenants`);
    parts.push('');
    parts.push(
      `${terminationNumber + 1}.1 For **${nonCompeteMonths} month${nonCompeteMonths === 1 ? '' : 's'}** after termination, the Employee will not carry on, or be engaged or concerned in, any business that competes with the business of the Employer in which they were materially involved during the 12 months before termination.`
    );
    parts.push('');
    parts.push(`${terminationNumber + 1}.2 For the same period the Employee will not solicit or entice away any customer or supplier with whom they dealt materially in that 12-month period, nor solicit any senior employee to leave the Employer.`);
    parts.push('');
    parts.push(`${terminationNumber + 1}.3 Each covenant is a separate obligation. If any is held unenforceable, the others continue, and the unenforceable one is modified to the minimum extent needed to make it enforceable.`);
  }
  const generalNumber = terminationNumber + (includeNonCompete ? 2 : 1);
  parts.push('');
  parts.push(`## ${generalNumber}. General`);
  parts.push('');
  parts.push(bulletList([
    `This contract is governed by the laws of ${governingLaw}, and the parties submit to the exclusive jurisdiction of its courts.`,
    'It contains the whole agreement on the employment and supersedes all prior discussions, offers and correspondence, including any offer letter.',
    'The Employer\u2019s policies (including those on discipline, grievance, health and safety, information security and acceptable use) apply to the Employee and may be updated from time to time; updates do not vary this contract except in writing signed by both parties.',
    'No variation of this contract is effective unless in writing and signed by both parties.',
    'If any provision is held unenforceable, the remainder continues in full effect.',
    'The Employee may not assign the benefit of this contract; the Employer may transfer it to a successor in accordance with applicable law.',
  ]));
  parts.push('');
  parts.push('## Signature');
  parts.push('');
  parts.push(`Signed for and on behalf of **${employerName}**:`);
  parts.push('');
  parts.push('Name: ______________________________    Title: ______________________________');
  parts.push('');
  parts.push('Signature: ______________________________    Date: ______________');
  parts.push('');
  parts.push(`Signed by **${employeeName}**, who confirms they have read and understood this contract and accept its terms:`);
  parts.push('');
  parts.push('Signature: ______________________________    Date: ______________');
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(DRAFT_REVIEW_NOTICE);

  const document: ResultDocument = {
    format: 'markdown',
    filename: `employment-contract-${employeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee'}.md`,
    label: 'Employment contract',
    content: tidyDocument(parts.join('\n')),
  };

  const durationMonths = startDate && endDate ? monthsBetween(startDate, endDate) : null;

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Gross salary', value: `${formatMoney(salary as number, currency, 0)} per ${salaryPeriod}`, emphasis: 'primary', hint: monthlySalary !== null ? `${formatMoney(monthlySalary, currency)} per month` : undefined },
        { label: 'Contract type', value: contractType === 'fixed-term' ? `Fixed term (${durationMonths ?? '—'} months)` : 'Permanent', emphasis: 'secondary' },
        { label: 'Notice period', value: `${noticeEmployee} mo (employee) / ${noticeEmployer} mo (employer)`, emphasis: 'secondary' },
        { label: 'Annual leave', value: `${annualLeaveDays} working days`, emphasis: 'muted' },
      ],
      document,
      explanation: [
        `Employment as ${jobTitle}${department ? ` in ${department}` : ''}, commencing ${startDate ? formatLongDate(startDate) : 'on the date to be inserted'}.`,
        `Working ${workModeLabel}${workLocation ? ` at ${workLocation}` : ''}, ${weeklyHours} hours per week.`,
        `Clause 4.2 states the statutory pension split (employee 8% / employer minimum 10% of basic, housing and transport) under the Pension Reform Act 2014, and clause 6.1 preserves the employee\u2019s right to choose their own PFA.`,
        includeConfidentiality ? 'A confidentiality clause is included, with carve-outs for protected disclosures and legally compelled disclosure.' : 'No confidentiality clause is included — consider adding one, or issuing a separate NDA.',
        includeIpAssignment ? 'An intellectual-property assignment clause is included, excluding works created entirely on the employee\u2019s own time and equipment.' : 'No IP assignment clause is included. Without one, ownership of work created in employment depends on default rules that vary by jurisdiction.',
        includeNonCompete ? `Post-termination restrictive covenants of ${nonCompeteMonths} months are included, each drafted as a severable obligation.` : 'No post-termination restrictive covenants are included.',
      ],
      warnings,
    },
  };
}

/* ================================================================== */
/* 6. CV Generator                                                     */
/* ================================================================== */

/**
 * Parse a repeating block record from a textarea.
 *
 * Format: one record per line, fields separated by `|`. Used for experience and education, where a
 * dynamic row editor would be unusable on a phone and a JSON textarea would be a worse experience
 * than a delimited list.
 */
export function parsePipeRecords(
  raw: unknown,
  columnCount: number
): { ok: true; records: string[][] } | { ok: false; error: string } {
  const lines = toLines(raw);
  if (lines.length === 0) return { ok: true, records: [] };
  const records: string[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (text === undefined) continue;
    const cells = text.split('|').map((cell) => cell.trim());
    if (cells.length !== columnCount) {
      return {
        ok: false,
        error: `Line ${index + 1} has ${cells.length} field${cells.length === 1 ? '' : 's'} but needs exactly ${columnCount}, separated by "|".`,
      };
    }
    records.push(cells);
  }
  return { ok: true, records };
}

export interface CvWordingFlag {
  text: string;
  reason: string;
}

/** Wording that weakens a CV: first person, vague claims, and unsupported responsibility verbs. */
export const CV_WEAK_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(I|my|me|myself)\b/g, reason: 'First person is unusual in a CV; start bullets with a verb instead.' },
  { pattern: /\b(responsible for|duties included|tasked with)\b/gi, reason: 'Describes a remit rather than a result. State what changed and by how much.' },
  { pattern: /\b(team player|hard.?working|go.getter|self.motivated|passionate)\b/gi, reason: 'Unsupported self-assessment. Demonstrate the quality through an achievement instead.' },
  { pattern: /\b(various|several|many|a lot of|etc\.?)\b/gi, reason: 'Vague quantifier. Give the number, the size or the name.' },
];

export function scanCvLanguage(text: string): CvWordingFlag[] {
  const flags: CvWordingFlag[] = [];
  const seen: Record<string, true> = {};
  for (const rule of CV_WEAK_PATTERNS) {
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(text);
    while (match !== null) {
      const key = rule.reason + match[0].toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        flags.push({ text: match[0], reason: rule.reason });
      }
      const previousIndex = match.index;
      match = rule.pattern.exec(text);
      if (match !== null && match.index === previousIndex) rule.pattern.lastIndex += 1;
    }
  }
  return flags;
}

export function computeCv(values: BusinessToolInput): BusinessToolOutcome {
  const fullName = toText(values['fullName']).trim();
  if (fullName === '') {
    return {
      ok: false,
      error: failure('Your name is required — it is the heading of the CV.', [
        { key: 'fullName', message: 'Full name is required.' },
      ]),
    };
  }

  const experienceParsed = parsePipeRecords(values['experience'], 5);
  if (!experienceParsed.ok) {
    return {
      ok: false,
      error: failure(
        `Work experience: ${experienceParsed.error} Expected: Company | Role | Start (YYYY-MM) | End (YYYY-MM or "present") | Achievements (semicolon separated)`,
        [{ key: 'experience', message: experienceParsed.error }]
      ),
    };
  }
  const educationParsed = parsePipeRecords(values['education'], 4);
  if (!educationParsed.ok) {
    return {
      ok: false,
      error: failure(
        `Education: ${educationParsed.error} Expected: Institution | Qualification | Field of study | Year completed`,
        [{ key: 'education', message: educationParsed.error }]
      ),
    };
  }

  const experiences = experienceParsed.records;
  for (let index = 0; index < experiences.length; index += 1) {
    const record = experiences[index];
    if (!record) continue;
    const company = record[0] ?? '';
    const role = record[1] ?? '';
    const start = record[2] ?? '';
    const end = record[3] ?? '';
    if (company === '' || role === '') {
      return {
        ok: false,
        error: failure(`Experience line ${index + 1} needs both a company and a role.`, [
          { key: 'experience', message: `Line ${index + 1}: company and role are both required.` },
        ]),
      };
    }
    if (!/^\d{4}-\d{2}$/.test(start) && start.toLowerCase() !== 'present') {
      return {
        ok: false,
        error: failure(`Experience line ${index + 1}: the start date "${start}" must be YYYY-MM.`, [
          { key: 'experience', message: `Line ${index + 1}: start date must be YYYY-MM.` },
        ]),
      };
    }
    if (!/^\d{4}-\d{2}$/.test(end) && end.toLowerCase() !== 'present') {
      return {
        ok: false,
        error: failure(`Experience line ${index + 1}: the end date "${end}" must be YYYY-MM or "present".`, [
          { key: 'experience', message: `Line ${index + 1}: end date must be YYYY-MM or "present".` },
        ]),
      };
    }
    if (/^\d{4}-\d{2}$/.test(start) && /^\d{4}-\d{2}$/.test(end) && end < start) {
      return {
        ok: false,
        error: failure(`Experience line ${index + 1}: the end date (${formatMonth(end)}) is before the start date (${formatMonth(start)}).`, [
          { key: 'experience', message: `Line ${index + 1}: end date precedes start date.` },
        ]),
      };
    }
  }

  const professionalTitle = toText(values['professionalTitle']).trim();
  const email = toText(values['email']).trim();
  const phone = toText(values['phone']).trim();
  const location = toText(values['location']).trim();
  const links = toList(values['links']);
  const summary = toText(values['summary']).trim();
  const skills = toList(values['skills']);
  const certifications = toLines(values['certifications']);
  const languages = toLines(values['languages']);
  const projects = toLines(values['projects']);
  const atsFriendly = toBoolean(values['atsFriendly']);

  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: failure(`"${email}" is not a valid email address.`, [{ key: 'email', message: 'Enter a valid email address, or leave it blank.' }]) };
  }
  if (experiences.length === 0 && projects.length === 0) {
    return {
      ok: false,
      error: failure('A CV needs at least one work-experience entry or one project. Add one and generate again.', [
        { key: 'experience', message: 'Add at least one role, or list a project instead.' },
      ]),
    };
  }

  const contactBits = [location, email, phone, ...links].filter((part) => part !== '');
  const parts: string[] = [];

  parts.push(atsFriendly ? fullName.toUpperCase() : `# ${fullName}`);
  if (professionalTitle) parts.push(professionalTitle);
  if (contactBits.length > 0) parts.push(contactBits.join(atsFriendly ? ' | ' : ' · '));
  parts.push('');

  if (summary) {
    parts.push(atsFriendly ? 'PROFESSIONAL SUMMARY' : '## Professional summary');
    parts.push('');
    parts.push(summary);
    parts.push('');
  }

  if (skills.length > 0) {
    parts.push(atsFriendly ? 'CORE SKILLS' : '## Core skills');
    parts.push('');
    parts.push(atsFriendly ? skills.join(', ') : bulletList(skills));
    parts.push('');
  }

  if (experiences.length > 0) {
    parts.push(atsFriendly ? 'WORK EXPERIENCE' : '## Work experience');
    parts.push('');
    for (const record of experiences) {
      if (!record) continue;
      const company = record[0] ?? '';
      const role = record[1] ?? '';
      const start = record[2] ?? '';
      const end = record[3] ?? '';
      const achievements = (record[4] ?? '')
        .split(/[;]/)
        .map((item) => item.trim())
        .filter((item) => item !== '');
      const period = `${formatMonth(start)} – ${end.toLowerCase() === 'present' ? 'Present' : formatMonth(end)}`;
      parts.push(atsFriendly ? `${role.toUpperCase()} — ${company}` : `### ${role} — ${company}`);
      parts.push(period);
      parts.push('');
      if (achievements.length > 0) parts.push(bulletList(achievements));
      parts.push('');
    }
  }

  if (projects.length > 0) {
    parts.push(atsFriendly ? 'PROJECTS' : '## Projects');
    parts.push('');
    parts.push(bulletList(projects));
    parts.push('');
  }

  if (educationParsed.records.length > 0) {
    parts.push(atsFriendly ? 'EDUCATION' : '## Education');
    parts.push('');
    for (const record of educationParsed.records) {
      if (!record) continue;
      const institution = record[0] ?? '';
      const qualification = record[1] ?? '';
      const field = record[2] ?? '';
      const year = record[3] ?? '';
      parts.push(bulletList([`${qualification}${field ? `, ${field}` : ''} — ${institution}${year ? ` (${year})` : ''}`]));
    }
    parts.push('');
  }

  if (certifications.length > 0) {
    parts.push(atsFriendly ? 'CERTIFICATIONS' : '## Certifications');
    parts.push('');
    parts.push(bulletList(certifications));
    parts.push('');
  }

  if (languages.length > 0) {
    parts.push(atsFriendly ? 'LANGUAGES' : '## Languages');
    parts.push('');
    parts.push(bulletList(languages));
    parts.push('');
  }

  if (!atsFriendly) {
    parts.push('---');
    parts.push('');
    parts.push('Generated with the CloudHost247 Business Tools CV Generator. Content is yours; review it before sending.');
  }

  const content = tidyDocument(parts.join('\n'));
  const words = content.split(/\s+/).filter((word) => word.length > 0).length;
  const flags = scanCvLanguage(content);

  // A rough page estimate: ~450 words of CV body per page, before allowing for headings and spacing.
  const estimatedPages = Math.max(1, Math.round(words / 450));

  const document: ResultDocument = {
    format: atsFriendly ? 'text' : 'markdown',
    filename: atsFriendly
      ? `${fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-cv.txt`
      : `${fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-cv.md`,
    label: atsFriendly ? 'CV (ATS-friendly plain text)' : 'CV (Markdown)',
    content,
  };

  const warnings: string[] = [];
  if (estimatedPages > 2) {
    warnings.push(`This CV runs to roughly ${estimatedPages} pages (${words} words). Two pages is the usual ceiling for most roles; longer CVs are read less thoroughly.`);
  }
  if (summary !== '' && summary.split(/\s+/).length > 80) {
    warnings.push('The professional summary is longer than about 80 words. Recruiters skim it; three or four sentences land better.');
  }
  if (skills.length > 25) {
    warnings.push(`You listed ${skills.length} skills. A long list dilutes the ones that matter and can look like keyword stuffing; keep the ten that fit the role you are applying for.`);
  }
  if (contactBits.length < 2) {
    warnings.push('You have supplied fewer than two contact details. An unreachable candidate is not shortlisted.');
  }

  const metrics: ResultMetric[] = [
    { label: 'Word count', value: String(words), emphasis: 'primary' },
    { label: 'Estimated pages', value: String(estimatedPages), emphasis: 'secondary', hint: 'At roughly 450 words per page' },
    { label: 'Roles listed', value: String(experiences.length), emphasis: 'secondary' },
    { label: 'Wording flags', value: String(flags.length), emphasis: flags.length > 0 ? 'primary' : 'muted', hint: flags.length > 0 ? 'See the review table below' : 'No weak wording detected' },
  ];

  const tables: ResultTable[] = [];
  if (flags.length > 0) {
    tables.push({
      title: 'CV wording review',
      columns: ['Flagged wording', 'Why it weakens the CV', 'Where'],
      rows: flags.map((flag) => ({
        label: flag.text,
        cells: [flag.reason, content.includes(flag.text) ? 'In the generated CV' : 'In the generated CV'],
      })),
      caption:
        'A drafting aid, not a judgement on your experience. It flags phrasing that describes a remit instead of a result, and self-assessment that a reader has no way to verify.',
    });
  }
  if (experiences.length > 0) {
    tables.push({
      title: 'Career timeline',
      columns: ['Role', 'Organisation', 'Period', 'Months'],
      rows: experiences.map((record) => {
        const start = record[2] ?? '';
        const end = record[3] ?? '';
        const months = /^\d{4}-\d{2}$/.test(start) && /^\d{4}-\d{2}$/.test(end)
          ? monthsBetween(start + '-01', end + '-01')
          : null;
        return {
          label: record[1] ?? '',
          cells: [
            record[0] ?? '',
            `${formatMonth(start)} – ${end.toLowerCase() === 'present' ? 'Present' : formatMonth(end)}`,
            months === null ? 'ongoing' : String(months),
          ],
        };
      }),
      caption: 'Months are computed from the dates you entered, so a gap or an overlap is visible at a glance.',
    });
  }

  return {
    ok: true,
    result: {
      metrics,
      tables,
      document,
      explanation: [
        `Built from ${experiences.length} role${experiences.length === 1 ? '' : 's'}, ${educationParsed.records.length} education entr${educationParsed.records.length === 1 ? 'y' : 'ies'}, ${skills.length} skills and ${projects.length} project${projects.length === 1 ? '' : 's'}.`,
        atsFriendly
          ? 'ATS-friendly mode: plain text, upper-case section headings, no Markdown syntax and no tables — the format applicant-tracking systems parse most reliably.'
          : 'Markdown mode: headings and bullets retained for readability. Switch to ATS-friendly plain text if you are uploading to an applicant-tracking system.',
        flags.length > 0
          ? `${flags.length} wording flag${flags.length === 1 ? '' : 's'} raised — see the CV wording review table.`
          : 'No weak-wording patterns detected.',
      ],
      warnings,
    },
  };
}
