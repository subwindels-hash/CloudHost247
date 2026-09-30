import { describe, expect, it } from 'vitest';
import { assessRisk, levelForScore } from '../../src/revenue-guardian/rules/risk';
import { isValidTransition, allowedTransitions, TERMINAL_STATUSES } from '../../src/revenue-guardian/rules/transitions';
import { determineEscalationLevel } from '../../src/revenue-guardian/rules/escalation';
import { matchesAssignmentConditions, assignmentConditionsSchema } from '../../src/revenue-guardian/rules/rule-schemas';
import { renderTemplate } from '../../src/revenue-guardian/notifications/email';
import { reportToCsv } from '../../src/revenue-guardian/reports/report-service';

const THRESHOLDS = { medium: 25, high: 50, critical: 75 };

describe('revenue guardian risk rules', () => {
  it('scores zero with no reasons for a clean account (never fabricates risk)', () => {
    const result = assessRisk(
      {
        maxOverdueDays: 0,
        overdueInvoiceCount: 0,
        outstandingCents: 0,
        failedPaymentCount: 0,
        brokenPromiseCount: 0,
        hasPastDueSubscription: false,
        hasSuspendedSubscription: false,
        daysToNextRenewal: null,
        recurringRevenueCents: 0,
      },
      THRESHOLDS
    );
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
    expect(result.reasons).toEqual([]);
  });

  it('every point of score is backed by an explicit reason', () => {
    const result = assessRisk(
      {
        maxOverdueDays: 10,
        overdueInvoiceCount: 3,
        outstandingCents: 25_000,
        failedPaymentCount: 2,
        brokenPromiseCount: 1,
        hasPastDueSubscription: true,
        hasSuspendedSubscription: false,
        daysToNextRenewal: 5,
        recurringRevenueCents: 5_000,
      },
      THRESHOLDS
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThanOrEqual(6);
    expect(result.reasons.join(' ')).toContain('10 day(s) overdue');
    expect(result.reasons.join(' ')).toContain('broken payment promise');
  });

  it('clamps the score to 100 and maps levels using configured thresholds', () => {
    const result = assessRisk(
      {
        maxOverdueDays: 400,
        overdueInvoiceCount: 20,
        outstandingCents: 100_000_000,
        failedPaymentCount: 50,
        brokenPromiseCount: 10,
        hasPastDueSubscription: true,
        hasSuspendedSubscription: true,
        daysToNextRenewal: 1,
        recurringRevenueCents: 100_000,
      },
      THRESHOLDS
    );
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.level).toBe('critical');
    expect(levelForScore(30, THRESHOLDS)).toBe('medium');
    expect(levelForScore(74, THRESHOLDS)).toBe('high');
    expect(levelForScore(10, { medium: 5, high: 50, critical: 75 })).toBe('medium');
  });
});

describe('recovery case transitions', () => {
  it('permits the documented lifecycle paths', () => {
    expect(isValidTransition('new', 'contacted')).toBe(true);
    expect(isValidTransition('contacted', 'payment_promised')).toBe(true);
    expect(isValidTransition('payment_promised', 'payment_pending')).toBe(true);
    expect(isValidTransition('partially_recovered', 'recovered')).toBe(true);
    expect(isValidTransition('escalated', 'disputed')).toBe(true);
  });

  it('rejects invalid transitions including out of terminal states', () => {
    expect(isValidTransition('closed', 'new')).toBe(false);
    expect(isValidTransition('written_off', 'contacted')).toBe(false);
    expect(isValidTransition('recovered', 'contact_required')).toBe(false);
    expect(isValidTransition('new', 'new')).toBe(false);
    for (const terminal of ['closed', 'written_off'] as const) {
      expect(allowedTransitions(terminal)).toHaveLength(0);
    }
    expect(TERMINAL_STATUSES).toContain('recovered');
  });
});

describe('escalation ladder', () => {
  const LEVELS = [
    { level: 1, overdueDays: 7 },
    { level: 2, overdueDays: 21 },
    { level: 3, overdueDays: 45 },
    { level: 4, overdueDays: 90 },
  ];

  it('escalates by configured overdue days', () => {
    expect(determineEscalationLevel({ overdueDays: 3, brokenPromiseCount: 0, isPreTermination: false }, LEVELS)).toBe(0);
    expect(determineEscalationLevel({ overdueDays: 8, brokenPromiseCount: 0, isPreTermination: false }, LEVELS)).toBe(1);
    expect(determineEscalationLevel({ overdueDays: 50, brokenPromiseCount: 0, isPreTermination: false }, LEVELS)).toBe(3);
    expect(determineEscalationLevel({ overdueDays: 200, brokenPromiseCount: 0, isPreTermination: false }, LEVELS)).toBe(4);
  });

  it('broken promises bump one level; pre-termination forces at least level 3', () => {
    expect(determineEscalationLevel({ overdueDays: 8, brokenPromiseCount: 1, isPreTermination: false }, LEVELS)).toBe(2);
    expect(determineEscalationLevel({ overdueDays: 0, brokenPromiseCount: 0, isPreTermination: true }, LEVELS)).toBe(3);
    expect(determineEscalationLevel({ overdueDays: 200, brokenPromiseCount: 5, isPreTermination: true }, LEVELS)).toBe(4);
  });
});

describe('assignment rule matching', () => {
  const candidate = {
    country: 'Nigeria',
    currency: 'USD',
    isNewCustomer: false,
    recurringRevenue: 150,
    lifetimeRevenue: 2000,
    activeServices: 4,
    accountStatus: 'active',
    hasActiveAssignment: false,
  };

  it('matches the documented example: country + minimum recurring revenue', () => {
    const conditions = assignmentConditionsSchema.parse({ country: 'nigeria', minRecurringRevenue: 100 });
    expect(matchesAssignmentConditions(candidate, conditions)).toBe(true);
    expect(matchesAssignmentConditions({ ...candidate, recurringRevenue: 50 }, conditions)).toBe(false);
    expect(matchesAssignmentConditions({ ...candidate, country: 'Ghana' }, conditions)).toBe(false);
  });

  it('respects onlyUnassigned and customerType', () => {
    const conditions = assignmentConditionsSchema.parse({ onlyUnassigned: true, customerType: 'existing' });
    expect(matchesAssignmentConditions(candidate, conditions)).toBe(true);
    expect(matchesAssignmentConditions({ ...candidate, hasActiveAssignment: true }, conditions)).toBe(false);
    expect(matchesAssignmentConditions({ ...candidate, isNewCustomer: true }, conditions)).toBe(false);
  });

  it('rejects unknown condition keys (validated schema, never free-form)', () => {
    expect(assignmentConditionsSchema.safeParse({ evil: 'code' }).success).toBe(false);
  });
});

describe('email template rendering and CSV export', () => {
  it('substitutes variables and leaves unknown placeholders empty', () => {
    expect(renderTemplate('Hi {{name}}, invoice {{invoiceNumber}} — {{missing}}!', { name: 'A', invoiceNumber: 'INV-1' })).toBe(
      'Hi A, invoice INV-1 — !'
    );
  });

  it('escapes CSV fields and includes honest metadata headers', () => {
    const csv = reportToCsv({
      reportType: 'revenue_recovery',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generatedBy: 'admin@example.com',
      reportingCurrencyNote: 'native currency',
      filters: { dateFrom: null, dateTo: null },
      columns: ['a', 'b'],
      rows: [{ a: 'plain', b: 'quote " and, comma' }],
      valueClassifications: { a: 'ACTUAL' },
    });
    expect(csv).toContain('# Generated by: admin@example.com');
    expect(csv).toContain('a=ACTUAL');
    expect(csv).toContain('"quote "" and, comma"');
  });
});
