/**
 * Form state → validated card specification.
 *
 * The badge maker is a single-page application with thirty inputs, and "validate on the way in, not
 * on the way out" is what keeps it honest: `buildSpec()` is the one place that decides whether a
 * value may reach a template, and it returns the errors and advisories that the workspace renders.
 * A template can therefore assume a well-formed spec and never has to invent a fallback for
 * "employee@@" or a blood group of "ZZ".
 *
 * Everything here is pure. The same function validates the interactive form, a bulk CSV row and the
 * API payload, so a row imported from a spreadsheet is held to exactly the same standard as a typed
 * one — which is the only way "we validated the import" means anything.
 */

import { defaultQrPayload, validateQrUrl } from './qr';
import { isCardTemplate } from './templates';
import { CARD_PRESETS } from './types';
import type { CardImages, CardOptions, CardPalette, CardPresetId, CardSpec, CardTemplateId } from './types';
import { normalizeColor, normalizePalette } from './colors';
import { validateDataUrl } from './images';

export interface CardFormState {
  /* Employee */
  fullName: string;
  employeeId: string;
  jobTitle: string;
  department: string;
  email: string;
  phone: string;
  bloodGroup: string;
  dateOfJoining: string;
  emergencyContact: string;
  validFrom: string;
  validUntil: string;
  /* Company */
  companyName: string;
  companyAddress: string;
  companyWebsite: string;
  /* Design */
  template: CardTemplateId | string;
  preset: CardPresetId | 'custom' | string;
  primary: string;
  background: string;
  text: string;
  detail: string;
  orientation: 'landscape' | 'portrait' | string;
  showPhoto: boolean;
  showLogo: boolean;
  showSignature: boolean;
  /* Codes */
  showQr: boolean;
  qrContent: string;
  showBarcode: boolean;
  barcodeValue: string;
  /* Images (data URLs) */
  photo: string;
  logo: string;
  signature: string;
}

export interface FieldIssue {
  key: string;
  message: string;
}

export interface SpecResult {
  spec: CardSpec;
  errors: FieldIssue[];
  warnings: string[];
  /** What the QR actually contains, after the default is applied — shown to the user verbatim. */
  qrPayload: string;
}

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/** The preset's accent/detail pair, or the custom values when the user has overridden them. */
export function paletteFor(state: Pick<CardFormState, 'preset' | 'primary' | 'background' | 'text' | 'detail'>): CardPalette {
  const preset = CARD_PRESETS.find((entry) => entry.id === state.preset);
  if (state.preset !== 'custom' && preset) {
    return normalizePalette({
      primary: preset.accent,
      detail: preset.detail,
      background: state.background,
      text: state.text,
    });
  }
  return normalizePalette({ primary: state.primary, background: state.background, text: state.text, detail: state.detail });
}

/** Defaults for a fresh card. Deliberately empty of employee data: nothing is pre-filled for them. */
export function defaultFormState(): CardFormState {
  return {
    fullName: '',
    employeeId: '',
    jobTitle: '',
    department: '',
    email: '',
    phone: '',
    bloodGroup: '',
    dateOfJoining: '',
    emergencyContact: '',
    validFrom: '',
    validUntil: '',
    companyName: '',
    companyAddress: '',
    companyWebsite: '',
    template: 'corporate-split',
    preset: 'salario-green',
    primary: '#18BF63',
    background: '#FFFFFF',
    text: '#111C16',
    detail: '#0E7A3F',
    orientation: 'landscape',
    showPhoto: true,
    showLogo: true,
    showSignature: true,
    showQr: true,
    qrContent: '',
    showBarcode: true,
    barcodeValue: '',
    photo: '',
    logo: '',
    signature: '',
  };
}

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const PHONE = /^[+]?[0-9][0-9\s().-]{5,24}$/;
const EMPLOYEE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validate and assemble. `strict` controls whether a missing name stops the build: the interactive
 * form is strict (a badge with no name is not a badge), a bulk row is not — a row is reported and
 * skipped, and the remaining employees are still generated.
 */
export function buildSpec(state: CardFormState, settings: { strict?: boolean } = {}): SpecResult {
  const strict = settings.strict ?? true;
  const errors: FieldIssue[] = [];
  const warnings: string[] = [];

  const fullName = trim(state.fullName);
  const employeeId = trim(state.employeeId);
  const email = trim(state.email);
  const phone = trim(state.phone);
  const companyName = trim(state.companyName);

  if (fullName === '') {
    errors.push({ key: 'fullName', message: 'An employee name is required — a badge without a name identifies nobody.' });
  } else if (fullName.length > 60) {
    errors.push({ key: 'fullName', message: 'Names longer than 60 characters will not fit the card; use the name the person is known by at work.' });
  } else if (!/[\p{L}]/u.test(fullName)) {
    errors.push({ key: 'fullName', message: 'The employee name must contain letters.' });
  }

  if (employeeId === '') {
    errors.push({ key: 'employeeId', message: 'An employee ID is required; it is the field the card is matched on.' });
  } else if (!EMPLOYEE_ID.test(employeeId)) {
    errors.push({
      key: 'employeeId',
      message: 'The employee ID may contain letters, digits, dot, dash, slash and underscore, and must start with a letter or digit (32 characters maximum).',
    });
  }

  if (companyName === '') {
    errors.push({ key: 'companyName', message: 'A company name is required — it appears on the card face and the return line.' });
  } else if (companyName.length > 60) {
    errors.push({ key: 'companyName', message: 'Company names longer than 60 characters will not fit the card header.' });
  }

  if (email !== '' && !EMAIL.test(email)) errors.push({ key: 'email', message: `“${email}” is not a valid email address.` });
  if (phone !== '' && !PHONE.test(phone)) errors.push({ key: 'phone', message: `“${phone}” is not a valid telephone number.` });
  if (trim(state.bloodGroup) !== '' && !BLOOD_GROUPS.includes(trim(state.bloodGroup).toUpperCase() as (typeof BLOOD_GROUPS)[number])) {
    errors.push({ key: 'bloodGroup', message: `Blood group must be one of ${BLOOD_GROUPS.join(', ')}, or left blank.` });
  }
  if (trim(state.dateOfJoining) !== '' && !isIsoDate(trim(state.dateOfJoining))) {
    errors.push({ key: 'dateOfJoining', message: 'The date of joining must be a real date in YYYY-MM-DD form.' });
  } else if (trim(state.dateOfJoining) !== '') {
    const joined = new Date(`${trim(state.dateOfJoining)}T00:00:00Z`).getTime();
    const now = Date.now();
    if (joined > now + 24 * 60 * 60 * 1000) {
      warnings.push('The date of joining is in the future. That is allowed for a pre-issued badge, but check it is intended.');
    }
  }
  const validFrom = trim(state.validFrom);
  const validUntil = trim(state.validUntil);
  if (validFrom !== '' && !isIsoDate(validFrom)) errors.push({ key: 'validFrom', message: 'The issue date must be a real date in YYYY-MM-DD form.' });
  if (validUntil !== '' && !isIsoDate(validUntil)) errors.push({ key: 'validUntil', message: 'The expiry date must be a real date in YYYY-MM-DD form.' });
  if (validFrom !== '' && validUntil !== '' && isIsoDate(validFrom) && isIsoDate(validUntil) && validUntil <= validFrom) {
    warnings.push(`The expiry date (${validUntil}) is not after the issue date (${validFrom}), so the card would be invalid the day it is printed.`);
  }
  if (trim(state.emergencyContact).length > 120) {
    errors.push({ key: 'emergencyContact', message: 'Emergency contact details are limited to 120 characters.' });
  }

  const website = trim(state.companyWebsite);
  if (website !== '' && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(website) && !/^[^\s.]+\.[^\s]{2,}$/.test(website)) {
    errors.push({ key: 'companyWebsite', message: `“${website}” is not a valid website address.` });
  }
  if (trim(state.companyAddress).length > 160) {
    errors.push({ key: 'companyAddress', message: 'The address is limited to 160 characters so it fits the back of the card.' });
  }

  if (!isCardTemplate(String(state.template))) {
    errors.push({ key: 'template', message: 'Choose one of the twelve templates.' });
  }

  const images: CardImages = {};
  const imageChecks: Array<[keyof CardImages, string]> = [
    ['photo', 'photograph'],
    ['logo', 'logo'],
    ['signature', 'signature'],
  ];
  for (const [key, label] of imageChecks) {
    const value = trim(state[key]);
    if (value === '') continue;
    const check = validateDataUrl(value, key === 'photo' ? 'photo' : key === 'logo' ? 'logo' : 'signature');
    if (!check.ok) errors.push({ key, message: `The ${label} could not be used: ${check.message}` });
    else images[key] = value;
  }

  /* QR content: a verification URL, a vCard-ish text payload, or the generated default. */
  const requestedQr = trim(state.qrContent);
  let qrPayload = '';
  if (state.showQr) {
    if (requestedQr === '') {
      qrPayload = defaultQrPayload(employeeId, fullName);
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestedQr)) {
      const check = validateQrUrl(requestedQr);
      if ('ok' in check && check.ok === false) errors.push({ key: 'qrContent', message: check.message });
      else qrPayload = check.url;
    } else if (requestedQr.length > 512) {
      errors.push({ key: 'qrContent', message: 'QR content is limited to 512 characters so the symbol stays scannable at card size.' });
    } else {
      qrPayload = requestedQr;
    }
  }

  /* Barcode value: the employee ID unless the user says otherwise. */
  const requestedBarcode = trim(state.barcodeValue) || employeeId;
  if (state.showBarcode && requestedBarcode === '') {
    warnings.push('The barcode is switched on but there is no value to encode. Enter an employee ID or a barcode value, or switch the barcode off.');
  }

  const options: CardOptions = {
    template: (isCardTemplate(String(state.template)) ? state.template : 'corporate-split') as CardTemplateId,
    preset: (CARD_PRESETS.some((preset) => preset.id === state.preset) ? state.preset : 'custom') as CardPresetId | 'custom',
    palette: paletteFor(state),
    orientation: state.orientation === 'portrait' ? 'portrait' : 'landscape',
    showPhoto: Boolean(state.showPhoto),
    showLogo: Boolean(state.showLogo),
    showSignature: Boolean(state.showSignature),
    showQr: Boolean(state.showQr),
    qrContent: qrPayload,
    showBarcode: Boolean(state.showBarcode),
    barcodeValue: requestedBarcode,
  };

  if (options.showLogo && !images.logo) {
    warnings.push('No company logo was uploaded, so the card draws the company initials instead. Upload a PNG or JPEG logo for the printed badge.');
  }
  if (options.showSignature && !images.signature) {
    warnings.push('No signature image was uploaded, so the card shows a signature line to sign by hand.');
  }
  if (normalizeColor(state.primary, '') === '') {
    errors.push({ key: 'primary', message: 'The primary colour must be a six-digit hex value such as #18BF63.' });
  }

  const spec: CardSpec = {
    employee: {
      fullName,
      employeeId,
      jobTitle: trim(state.jobTitle),
      department: trim(state.department),
      email,
      phone,
      bloodGroup: trim(state.bloodGroup).toUpperCase(),
      dateOfJoining: trim(state.dateOfJoining),
      emergencyContact: trim(state.emergencyContact),
      validFrom: trim(state.validFrom),
      validUntil: trim(state.validUntil),
    },
    company: {
      name: companyName,
      address: trim(state.companyAddress),
      website: website,
    },
    images,
    options,
  };

  if (strict && errors.length > 0) {
    return { spec, errors, warnings, qrPayload };
  }
  return { spec, errors, warnings, qrPayload };
}

/** A one-line summary used by the "ready to download" panel. */
export function specSummary(result: SpecResult): string {
  const { spec } = result;
  const parts = [spec.employee.fullName || 'Unnamed employee', spec.employee.employeeId || 'no ID', spec.company.name || 'no company'];
  return parts.join(' · ');
}
