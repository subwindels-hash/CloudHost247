/**
 * Tools Center — time card calculator (spec §52, "Time Card").
 *
 * Computes worked time from explicit clock times. Two rules the output must respect:
 *   - Every total is traceable: per-entry minutes, per-day totals and the grand total all come from
 *     the same arithmetic, and rounding (when requested) is applied per day and reported.
 *   - It is a calculator, not payroll advice. Overtime rules, break entitlements and rounding
 *     conventions vary by jurisdiction and by contract; the result says exactly which convention it
 *     used and nothing more.
 */
import { invalidInput } from '../core/errors';

export type BreakMode = 'unpaid-30' | 'unpaid-60' | 'auto-us' | 'none' | 'custom';

export interface TimeEntry {
  /** ISO date (YYYY-MM-DD) or any label such as "Monday". */
  date?: string;
  clockIn: string;
  clockOut: string;
  breakMinutes?: number;
  note?: string;
}

export interface TimeCardOptions {
  entries: TimeEntry[];
  /** Minutes added when an entry does not carry its own break (default 0). */
  defaultBreakMinutes?: number;
  breakMode?: BreakMode;
  /** Round each day's worked minutes to the nearest N minutes (0 = no rounding). */
  roundToMinutes?: number;
  /** Minutes per week after which time counts as overtime (0 = do not compute overtime). */
  weeklyOvertimeAfterMinutes?: number;
  hourlyRate?: number;
  currency?: string;
  /** IANA timezone used for "now"-relative calculations; clock times themselves are wall-clock. */
  timezone?: string;
}

export interface TimeCardDay {
  label: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  breakSource: string;
  grossMinutes: number;
  workedMinutes: number;
  roundedMinutes: number;
  roundingDeltaMinutes: number;
  decimalHours: number;
  formatted: string;
  crossesMidnight: boolean;
  warnings: string[];
}

export interface TimeCardResult {
  days: TimeCardDay[];
  totals: {
    days: number;
    grossMinutes: number;
    breakMinutes: number;
    workedMinutes: number;
    roundedMinutes: number;
    decimalHours: number;
    formatted: string;
    overtimeMinutes: number;
    regularMinutes: number;
    averagePerDayMinutes: number;
  };
  pay: { hourlyRate: number | null; currency: string; regularPay: number | null; overtimePay: number | null; totalPay: number | null; overtimeMultiplier: number };
  options: { breakMode: BreakMode; defaultBreakMinutes: number; roundToMinutes: number; weeklyOvertimeAfterMinutes: number; timezone: string };
  notes: string[];
}

function toMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim());
  if (!match) throw invalidInput(`"${value}" is not a valid clock time. Use 24-hour HH:MM (09:30) or add am/pm (9:30pm).`);
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[4]?.toLowerCase();
  if (minutes > 59) throw invalidInput(`"${value}" has an invalid minute value.`);
  if (suffix) {
    if (hours < 1 || hours > 12) throw invalidInput(`"${value}" is not a valid 12-hour clock time.`);
    if (suffix === 'pm' && hours !== 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
  } else if (hours > 23) {
    throw invalidInput(`"${value}" has an invalid hour value; use 00:00–23:59 for 24-hour times.`);
  }
  return hours * 60 + minutes;
}

/** Classic US practice: deduct 30 unpaid minutes when a shift exceeds 6 hours ("auto-us"). */
function autoBreakMinutes(grossMinutes: number): number {
  return grossMinutes > 360 ? 30 : 0;
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(minutes));
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${sign}${hours}h ${remainder.toString().padStart(2, '0')}m`;
}

export function timeCard(options: TimeCardOptions): TimeCardResult {
  const entries = options.entries ?? [];
  if (!Array.isArray(entries) || entries.length === 0) throw invalidInput('Add at least one time entry.');
  if (entries.length > 62) throw invalidInput('A time card is limited to 62 entries (one month of days).');

  const breakMode: BreakMode = options.breakMode ?? 'none';
  const defaultBreakMinutes = Math.min(Math.max(options.defaultBreakMinutes ?? 0, 0), 480);
  const roundToMinutes = Math.min(Math.max(options.roundToMinutes ?? 0, 0), 60);
  const weeklyOvertimeAfterMinutes = Math.max(options.weeklyOvertimeAfterMinutes ?? 0, 0);
  const timezone = options.timezone ?? 'UTC';

  const days: TimeCardDay[] = entries.map((entry, index) => {
    if (!entry.clockIn || !entry.clockOut) throw invalidInput(`Entry ${index + 1} needs both a clock-in and a clock-out time.`);
    const inMinutes = toMinutes(entry.clockIn);
    const outMinutes = toMinutes(entry.clockOut);
    const crossesMidnight = outMinutes <= inMinutes;
    const grossMinutes = crossesMidnight ? 24 * 60 - inMinutes + outMinutes : outMinutes - inMinutes;

    const warnings: string[] = [];
    if (crossesMidnight) warnings.push('The clock-out time is not after the clock-in time, so the shift is treated as crossing midnight.');
    if (grossMinutes > 16 * 60) warnings.push('This shift is longer than 16 hours; check the times.');
    if (grossMinutes <= 0) warnings.push('This entry has no positive duration.');

    let breakMinutes: number;
    let breakSource: string;
    if (typeof entry.breakMinutes === 'number') {
      breakMinutes = entry.breakMinutes;
      breakSource = 'Entered for this entry.';
    } else if (breakMode === 'custom') {
      breakMinutes = defaultBreakMinutes;
      breakSource = `Default break (${defaultBreakMinutes} minutes).`;
    } else if (breakMode === 'auto-us') {
      breakMinutes = autoBreakMinutes(grossMinutes);
      breakSource = breakMinutes > 0 ? 'Automatic 30-minute unpaid break (shift over 6 hours).' : 'No break: shift is 6 hours or less.';
    } else if (breakMode === 'unpaid-30') {
      breakMinutes = 30;
      breakSource = 'Fixed 30-minute unpaid break.';
    } else if (breakMode === 'unpaid-60') {
      breakMinutes = 60;
      breakSource = 'Fixed 60-minute unpaid break.';
    } else {
      breakMinutes = 0;
      breakSource = 'No break deducted.';
    }

    breakMinutes = Math.max(0, Math.min(breakMinutes, grossMinutes));
    const workedMinutes = grossMinutes - breakMinutes;
    const roundedMinutes = roundToMinutes > 0 ? Math.round(workedMinutes / roundToMinutes) * roundToMinutes : workedMinutes;
    if (roundToMinutes > 0 && roundedMinutes !== workedMinutes) {
      warnings.push(`Rounded by ${roundedMinutes - workedMinutes > 0 ? '+' : ''}${roundedMinutes - workedMinutes} minutes to the nearest ${roundToMinutes}.`);
    }
    if (breakMinutes > 0) warnings.push(`Break deducted: ${breakMinutes} minutes. ${breakSource}`);

    return {
      label: entry.date ?? `Entry ${index + 1}`,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      breakMinutes,
      breakSource,
      grossMinutes,
      workedMinutes,
      roundedMinutes,
      roundingDeltaMinutes: roundedMinutes - workedMinutes,
      decimalHours: Math.round((roundedMinutes / 60) * 100) / 100,
      formatted: formatDuration(roundedMinutes),
      crossesMidnight,
      warnings,
    };
  });

  const grossMinutes = days.reduce((sum, day) => sum + day.grossMinutes, 0);
  const breakMinutes = days.reduce((sum, day) => sum + day.breakMinutes, 0);
  const workedMinutes = days.reduce((sum, day) => sum + day.workedMinutes, 0);
  const roundedMinutes = days.reduce((sum, day) => sum + day.roundedMinutes, 0);
  const overtimeMinutes = weeklyOvertimeAfterMinutes > 0 ? Math.max(0, roundedMinutes - weeklyOvertimeAfterMinutes) : 0;
  const regularMinutes = roundedMinutes - overtimeMinutes;
  const hourlyRate = options.hourlyRate ?? null;
  const overtimeMultiplier = 1.5;

  const pay =
    hourlyRate === null
      ? { hourlyRate: null, currency: options.currency ?? 'USD', regularPay: null, overtimePay: null, totalPay: null, overtimeMultiplier }
      : {
          hourlyRate,
          currency: options.currency ?? 'USD',
          regularPay: Math.round((regularMinutes / 60) * hourlyRate * 100) / 100,
          overtimePay: overtimeMinutes > 0 ? Math.round((overtimeMinutes / 60) * hourlyRate * overtimeMultiplier * 100) / 100 : 0,
          totalPay: Math.round(((regularMinutes / 60) * hourlyRate + (overtimeMinutes / 60) * hourlyRate * overtimeMultiplier) * 100) / 100,
          overtimeMultiplier,
        };

  return {
    days,
    totals: {
      days: days.length,
      grossMinutes,
      breakMinutes,
      workedMinutes,
      roundedMinutes,
      decimalHours: Math.round((roundedMinutes / 60) * 100) / 100,
      formatted: formatDuration(roundedMinutes),
      overtimeMinutes,
      regularMinutes,
      averagePerDayMinutes: Math.round(roundedMinutes / days.length),
    },
    pay,
    options: { breakMode, defaultBreakMinutes, roundToMinutes, weeklyOvertimeAfterMinutes, timezone },
    notes: [
      'Times are treated as wall-clock times on the date you label them; no timezone conversion is applied to the entered times.',
      breakMode === 'auto-us'
        ? 'The automatic break rule deducts 30 unpaid minutes when a shift exceeds 6 hours. It is a common US practice, not a legal requirement everywhere.'
        : 'No break is deducted unless you asked for it or entered one per row.',
      roundToMinutes > 0
        ? `Each day is rounded to the nearest ${roundToMinutes} minutes before totalling. Rounding conventions are regulated in many jurisdictions — check yours.`
        : 'No rounding was applied.',
      weeklyOvertimeAfterMinutes > 0
        ? `Overtime is everything over ${formatDuration(weeklyOvertimeAfterMinutes)} and is valued at ${overtimeMultiplier}× the hourly rate. Real overtime rules are far more specific (daily thresholds, seventh-day rules, averaging periods).`
        : 'Overtime was not calculated. Set a weekly threshold to estimate it.',
      hourlyRate !== null ? `Pay is an estimate using the rate you entered (${hourlyRate} per hour) and is not a payroll figure.` : 'No hourly rate was entered, so no pay figures are shown.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Timezone helpers used by the same page (spec §52): "now" in the requester's timezone.
// ---------------------------------------------------------------------------------------------

export interface TimezoneView {
  timezone: string;
  localTime: string;
  localDate: string;
  utcOffset: string;
  dayOfYear: number;
  weekNumber: number;
  isDaylightSavingTime: boolean;
  unixSeconds: number;
  iso: string;
}

export function timezoneView(input: { timezone?: string; now?: Date } = {}): TimezoneView {
  const timezone = input.timezone ?? 'UTC';
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'shortOffset',
    });
  } catch {
    throw invalidInput(`"${timezone}" is not a timezone this server recognises. Use an IANA name such as Europe/Amsterdam.`);
  }

  const now = input.now ?? new Date();
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  const utcParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const utcGet = (type: Intl.DateTimeFormatPartTypes): string => utcParts.find((part) => part.type === type)?.value ?? '';

  const startOfYear = Date.UTC(Number(utcGet('year')), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86_400_000) + 1;
  const weekNumber = Math.ceil((((now.getTime() - startOfYear) / 86_400_000) + new Date(startOfYear).getUTCDay() + 1) / 7);

  const january = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const july = new Date(Date.UTC(now.getUTCFullYear(), 6, 1));
  const offsetAt = (date: Date): number => {
    const utcTime = date.getTime();
    const localText = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
    const [datePart, timePart] = localText.split(', ');
    const [day, month, year] = (datePart ?? '').split('/').map(Number);
    const [hour, minute, second] = (timePart ?? '').split(':').map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0) - utcTime;
  };
  const winterOffset = offsetAt(january);
  const summerOffset = offsetAt(july);
  const currentOffset = offsetAt(now);
  const isDaylightSavingTime = summerOffset !== winterOffset && currentOffset === Math.max(winterOffset, summerOffset) && Math.min(winterOffset, summerOffset) !== Math.max(winterOffset, summerOffset);

  const offsetMinutes = Math.round(currentOffset / 60000);
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetRemainder = Math.abs(offsetMinutes) % 60;

  return {
    timezone,
    localTime: `${get('hour')}:${get('minute')}:${get('second')}`,
    localDate: formatter.format(now),
    utcOffset: `${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetRemainder.toString().padStart(2, '0')}`,
    dayOfYear,
    weekNumber,
    isDaylightSavingTime,
    unixSeconds: Math.floor(now.getTime() / 1000),
    iso: now.toISOString(),
  };
}

export { invalidInput as timeCardInvalidInput };
