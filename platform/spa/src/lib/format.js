/**
 * Formatting helpers for the customer pages.
 *
 * Deliberately plain functions with no DOM or React import: the page components stay thin, and
 * `tests/spa-format.test.js` can import this file directly and pin the edge cases (a missing
 * currency, a null due date, an over-paid invoice) that would otherwise only show up as odd-looking
 * text in a browser nobody runs here.
 */

/** Currency display. An unrecognised ISO code falls back to "<amount> <code>" rather than blank. */
export function formatMoney(amount, currency = 'USD') {
  // A missing amount is blank, not zero: Number(null) is 0, and "$0.00" would be a lie about a
  // value the server never sent.
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  const code = String(currency ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return `${value.toFixed(2)}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

/** Short date, or date + time for activity logs. Anything unparseable renders as an em dash. */
export function formatDate(value, { withTime = false } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const options = withTime
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('en-GB', options).format(date);
}

/** 'past_due' -> 'Past due', 'cancel_at_period_end' -> 'Cancel at period end'. */
export function humanizeStatus(status) {
  if (typeof status !== 'string' || status.length === 0) return '—';
  const words = status.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What is still owed on an invoice, never negative and never a floating-point artefact. */
export function invoiceBalance(invoice) {
  if (!invoice) return 0;
  const total = Number(invoice.total ?? 0);
  const paid = Number(invoice.amountPaid ?? 0);
  if (!Number.isFinite(total) || !Number.isFinite(paid)) return 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

/** An unpaid invoice past its due date. Paid invoices are never overdue, whatever the dates say. */
export function isOverdue(invoice, now = Date.now()) {
  if (!invoice || invoice.status === 'paid') return false;
  if (invoiceBalance(invoice) <= 0) return false;
  if (!invoice.dueAt) return false;
  const due = new Date(invoice.dueAt).getTime();
  return Number.isFinite(due) && due < now;
}

/** Badge class suffix for a status; unknown statuses fall back to the neutral badge. */
export function statusClass(status) {
  const key = String(status ?? '').toLowerCase().replace(/[^a-z_]/g, '');
  return `status status-${key || 'unknown'}`;
}
