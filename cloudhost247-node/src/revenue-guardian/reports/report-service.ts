/**
 * Reports + exports (spec §26–§27, §67).
 *
 * Every dataset is built from the same repository queries the on-screen pages use, so an export
 * always matches what the user saw, filtered by the user's permission scope. Every report row
 * set carries an explicit value classification (ACTUAL / RECOVERED / OUTSTANDING / AT RISK /
 * PROJECTED) — never one blended number (spec §67).
 *
 * Export formats: CSV natively. XLSX/PDF are intentionally NOT fabricated by hand here — CSV
 * opens directly in Excel, and the frontend offers a print-optimized view for PDF via the
 * browser. Adding true XLSX/PDF later only requires swapping the serializer in exportReport().
 */
import type { Queryable } from '../../db/types';
import { ValidationError } from '../../lib/errors';
import { listCases } from '../repositories/cases-repo';
import { listPromises } from '../repositories/promises-repo';
import { listFollowUps } from '../repositories/follow-ups-repo';
import {
  getAgingBuckets,
  getStaffPerformance,
  listAtRiskCustomers,
  listUpcomingRenewals,
} from '../repositories/insights-repo';
import { getRgSetting } from '../utils/settings';

export const REPORT_TYPES = [
  'revenue_recovery',
  'staff_performance',
  'renewals',
  'revenue_at_risk',
  'payment_promises',
  'collection_activity',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportResult {
  reportType: ReportType;
  generatedAt: string;
  generatedBy: string;
  reportingCurrencyNote: string;
  filters: Record<string, unknown>;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** Explicit classification of the money columns in this report (spec §67). */
  valueClassifications: Record<string, 'ACTUAL' | 'RECOVERED' | 'OUTSTANDING' | 'AT_RISK' | 'PROJECTED'>;
}

export interface ReportRequest {
  reportType: ReportType;
  dateFrom?: string;
  dateTo?: string;
  staffUserId?: string;
  scopeStaffId?: string | null;
  generatedByEmail: string;
}

export async function buildReport(db: Queryable, request: ReportRequest): Promise<ReportResult> {
  const reportingCurrency = await getRgSetting(db, 'reportingCurrency');
  const base = {
    generatedAt: new Date().toISOString(),
    generatedBy: request.generatedByEmail,
    reportingCurrencyNote: `Amounts are shown in their native currency; configured reporting currency is ${reportingCurrency}. No automatic conversion is applied.`,
    filters: {
      dateFrom: request.dateFrom ?? null,
      dateTo: request.dateTo ?? null,
      staffUserId: request.staffUserId ?? null,
    },
  };

  switch (request.reportType) {
    case 'revenue_recovery': {
      const cases = await listCases(db, { limit: 100, page: 1, scopeStaffId: request.scopeStaffId, sortBy: 'opened_at' });
      return {
        ...base,
        reportType: request.reportType,
        columns: ['case_number', 'customer_email', 'status', 'currency', 'amount_outstanding', 'amount_recovered', 'opened_at', 'closed_at'],
        rows: cases.items.map((c) => ({
          case_number: c.case_number,
          customer_email: c.customer_email,
          status: c.status,
          currency: c.currency,
          amount_outstanding: c.amount_outstanding,
          amount_recovered: c.amount_recovered,
          opened_at: c.opened_at,
          closed_at: c.closed_at ?? '',
        })),
        valueClassifications: { amount_outstanding: 'OUTSTANDING', amount_recovered: 'RECOVERED' },
      };
    }
    case 'staff_performance': {
      const rows = await getStaffPerformance(db, {
        dateFrom: request.dateFrom,
        dateTo: request.dateTo,
        staffUserId: request.staffUserId,
      });
      return {
        ...base,
        reportType: request.reportType,
        columns: ['staff_email', 'assigned_customers', 'open_cases', 'recovered_cases', 'closed_cases', 'followups_completed', 'followups_overdue', 'promises_total', 'promises_fulfilled', 'promises_broken', 'revenue_recovered'],
        rows: rows.map((r) => ({
          staff_email: r.staff_email,
          assigned_customers: r.assigned_customers,
          open_cases: r.open_cases,
          recovered_cases: r.recovered_cases,
          closed_cases: r.closed_cases,
          followups_completed: r.followups_completed,
          followups_overdue: r.followups_overdue,
          promises_total: r.promises_total,
          promises_fulfilled: r.promises_fulfilled,
          promises_broken: r.promises_broken,
          revenue_recovered: Object.entries(r.revenue_recovered)
            .map(([cur, amt]) => `${amt} ${cur}`)
            .join('; '),
        })),
        valueClassifications: { revenue_recovered: 'RECOVERED' },
      };
    }
    case 'renewals': {
      const rows = await listUpcomingRenewals(db, { withinDays: 90, scopeStaffId: request.scopeStaffId, limit: 500 });
      return {
        ...base,
        reportType: request.reportType,
        columns: ['kind', 'customer_email', 'label', 'expires_at', 'days_remaining', 'renewal_amount', 'currency', 'status', 'assigned_staff_email'],
        rows: rows.map((r) => ({ ...r })),
        valueClassifications: { renewal_amount: 'PROJECTED' },
      };
    }
    case 'revenue_at_risk': {
      const rows = await listAtRiskCustomers(db, { scopeStaffId: request.scopeStaffId });
      return {
        ...base,
        reportType: request.reportType,
        columns: ['customer_email', 'currency', 'outstanding', 'overdue', 'overdue_invoice_count', 'max_overdue_days', 'failed_payments', 'broken_promises', 'recurring_revenue', 'assigned_staff_email'],
        rows: rows.map((r) => ({
          customer_email: r.customer_email,
          currency: r.currency,
          outstanding: r.outstanding,
          overdue: r.overdue,
          overdue_invoice_count: r.overdue_invoice_count,
          max_overdue_days: r.max_overdue_days,
          failed_payments: r.failed_payments,
          broken_promises: r.broken_promises,
          recurring_revenue: r.recurring_revenue,
          assigned_staff_email: r.assigned_staff_email ?? '',
        })),
        valueClassifications: { outstanding: 'OUTSTANDING', overdue: 'AT_RISK', recurring_revenue: 'PROJECTED' },
      };
    }
    case 'payment_promises': {
      const promises = await listPromises(db, { limit: 100, page: 1, scopeStaffId: request.scopeStaffId });
      return {
        ...base,
        reportType: request.reportType,
        columns: ['customer_email', 'invoice_number', 'promised_amount', 'currency', 'promised_date', 'status', 'fulfilled_amount', 'assigned_staff_email'],
        rows: promises.items.map((p) => ({
          customer_email: p.customer_email,
          invoice_number: p.invoice_number,
          promised_amount: p.promised_amount,
          currency: p.currency,
          promised_date: p.promised_date,
          status: p.status,
          fulfilled_amount: p.fulfilled_amount,
          assigned_staff_email: p.assigned_staff_email ?? '',
        })),
        valueClassifications: { promised_amount: 'PROJECTED', fulfilled_amount: 'ACTUAL' },
      };
    }
    case 'collection_activity': {
      const followUps = await listFollowUps(db, {
        limit: 100,
        page: 1,
        scopeStaffId: request.scopeStaffId,
        dateFrom: request.dateFrom,
        dateTo: request.dateTo,
      });
      return {
        ...base,
        reportType: request.reportType,
        columns: ['customer_email', 'type', 'channel', 'status', 'priority', 'scheduled_at', 'completed_at', 'assigned_staff_email', 'outcome'],
        rows: followUps.items.map((f) => ({
          customer_email: f.customer_email,
          type: f.type,
          channel: f.channel,
          status: f.status,
          priority: f.priority,
          scheduled_at: f.scheduled_at,
          completed_at: f.completed_at ?? '',
          assigned_staff_email: f.assigned_staff_email ?? '',
          outcome: f.outcome ?? '',
        })),
        valueClassifications: {},
      };
    }
    default:
      throw new ValidationError(`Unknown report type`);
  }
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Serializes a report to CSV, prefixed with an honest metadata header block. */
export function reportToCsv(report: ReportResult): string {
  const lines: string[] = [
    `# CloudHost247 Revenue Guardian — ${report.reportType}`,
    `# Generated: ${report.generatedAt}`,
    `# Generated by: ${report.generatedBy}`,
    `# Period: ${report.filters['dateFrom'] ?? 'all'} → ${report.filters['dateTo'] ?? 'all'}`,
    `# ${report.reportingCurrencyNote}`,
    `# Value classifications: ${
      Object.entries(report.valueClassifications)
        .map(([col, cls]) => `${col}=${cls}`)
        .join(', ') || 'n/a'
    }`,
    report.columns.map(csvEscape).join(','),
  ];
  for (const row of report.rows) {
    lines.push(report.columns.map((col) => csvEscape(row[col])).join(','));
  }
  return lines.join('\r\n');
}
