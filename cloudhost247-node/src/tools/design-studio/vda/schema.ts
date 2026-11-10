/**
 * VDA-4902 — the data schema, its validation and the 2D payload.
 *
 * The schema is the field list from `spec.ts` expressed as a plain record, so the form, the API, the
 * CSV importer and the label renderer all read one definition. Validation is deliberately strict
 * about the fields that cause a delivery to be refused (receiver, plant, supplier number, part
 * number, quantity) and lenient about the ones that are genuinely optional.
 *
 * ## Dates
 *
 * Every date is stored as an ISO `YYYY-MM-DD` string, validated as a real calendar date, and printed
 * in the format the label calls for. Dates in the 2D payload are `YYMMDD`, which is what the
 * published identifier structure uses. A date of `2026-02-30` is refused rather than rolled forward
 * to March: a delivery note dated the 30th of February is a data-entry error, and printing it would
 * hide it.
 */

import { error, warn, type Issue } from '../shared/validate';
import { VDA_SUPPORTED_VERSION, fieldsForFormat, vdaFormat, VDA_2D_HEADER, VDA_2D_TRAILER, VDA_2D_IDENTIFIERS, type VdaFormat } from './spec';

export interface VdaData {
  /** The only accepted value is `4`; anything else is refused. */
  version: string;
  format: VdaFormat;
  receiver: string;
  plant: string;
  supplier: string;
  supplierNumber: string;
  deliveryNote: string;
  deliveryNoteDate: string;
  customerNumber: string;
  partNumber: string;
  partDescription: string;
  quantity: string;
  unit: string;
  purchaseOrder: string;
  deliveryDate: string;
  batch: string;
  serial: string;
  /** Marks the load unit as mixed (field 8 prints the mixed-load marker on the master tag). */
  mixedLoad: boolean;
  /** Print the German field captions alongside the English ones. */
  germanCaptions: boolean;
}

export const DEFAULT_VDA_DATA: VdaData = {
  version: VDA_SUPPORTED_VERSION,
  format: 'master',
  receiver: '',
  plant: '',
  supplier: '',
  supplierNumber: '',
  deliveryNote: '',
  deliveryNoteDate: '',
  customerNumber: '',
  partNumber: '',
  partDescription: '',
  quantity: '',
  unit: 'PCE',
  purchaseOrder: '',
  deliveryDate: '',
  batch: '',
  serial: '',
  mixedLoad: false,
  germanCaptions: false,
};

/** Coerce an untrusted record into a `VdaData` without throwing. */
export function vdaDataFromInput(input: Record<string, unknown>): VdaData {
  const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : fallback);
  const format = text(input.format);
  return {
    version: text(input.version, VDA_SUPPORTED_VERSION) || VDA_SUPPORTED_VERSION,
    format: (format === 'klt' ? 'klt' : 'master') as VdaFormat,
    receiver: text(input.receiver),
    plant: text(input.plant),
    supplier: text(input.supplier),
    supplierNumber: text(input.supplierNumber),
    deliveryNote: text(input.deliveryNote),
    deliveryNoteDate: text(input.deliveryNoteDate),
    customerNumber: text(input.customerNumber),
    partNumber: text(input.partNumber),
    partDescription: text(input.partDescription),
    quantity: text(input.quantity),
    unit: text(input.unit, 'PCE'),
    purchaseOrder: text(input.purchaseOrder),
    deliveryDate: text(input.deliveryDate),
    batch: text(input.batch),
    serial: text(input.serial),
    mixedLoad: input.mixedLoad === true || input.mixedLoad === 'true' || input.mixedLoad === 1,
    germanCaptions: input.germanCaptions === true || input.germanCaptions === 'true' || input.germanCaptions === 1,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when the string is a real calendar date in ISO form. */
export function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `YYYY-MM-DD` → `YYMMDD`, the form the 2D identifiers use. */
export function toVdaDate(iso: string): string {
  if (!isRealDate(iso)) return '';
  const [year, month, day] = iso.split('-');
  return `${(year ?? '').slice(2)}${month}${day}`;
}

/** `YYYY-MM-DD` → `DD.MM.YYYY`, the German printed form used on the label. */
export function toGermanDate(iso: string): string {
  if (!isRealDate(iso)) return iso;
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

/**
 * Validate a VDA data set for a format.
 *
 * Errors are things the standard requires or that make the label wrong. Warnings are advisories that
 * a receiving plant is likely to raise (a short part number, a unit code that is not one of the
 * common ones) but which do not prevent printing — the tool's job is to inform, not to gate a
 * shipment the operator may know more about.
 */
export function validateVdaData(data: VdaData): Issue[] {
  const issues: Issue[] = [];
  const format = vdaFormat(data.format);
  if (!format) {
    issues.push(error('format', 'Choose the master (210 × 148 mm) or KLT (210 × 74 mm) label.'));
    return issues;
  }
  if (data.version !== VDA_SUPPORTED_VERSION) {
    issues.push(
      error(
        'version',
        `Version ${data.version} of VDA 4902 is not supported. This tool renders version ${VDA_SUPPORTED_VERSION} only.`,
        'Versions 1–3 use different field sets. Rendering them from the version-4 layout would produce a label that looks plausible and is wrong.'
      )
    );
  }

  const fields = fieldsForFormat(data.format);
  for (const field of fields) {
    const raw = (data as unknown as Record<string, string>)[field.key] ?? '';
    const value = String(raw).trim();
    const printed = field.formats.includes(data.format);
    if (!printed) continue;
    if (field.required && value === '') {
      issues.push(error(field.key, `${field.label} (field ${field.no}) is required on this label.`, field.help));
      continue;
    }
    if (value.length > field.maxLength) {
      issues.push(error(field.key, `${field.label} is ${value.length} characters; the printed field holds ${field.maxLength}.`, 'Shorten the value or the text will be clipped on the label.'));
    }
    if (field.type === 'number' && value !== '') {
      const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(parsed)) issues.push(error(field.key, `${field.label} must be a number.`));
      else if (parsed <= 0) issues.push(error(field.key, `${field.label} must be greater than zero.`));
    }
    if (field.type === 'date' && value !== '' && !isRealDate(value)) {
      issues.push(error(field.key, `${field.label} must be a real date in YYYY-MM-DD form.`));
    }
    if (field.type === 'integer' && value !== '' && !/^\d+$/.test(value)) {
      issues.push(error(field.key, `${field.label} must be a whole number.`));
    }
  }

  // Fields that are not printed on the KLT label are still accepted, but say so rather than dropping
  // them silently — an operator who types a batch number on a KLT label needs to know it will not
  // appear.
  for (const field of fieldsForFormat('master')) {
    if (field.formats.includes(data.format)) continue;
    const value = String((data as unknown as Record<string, string>)[field.key] ?? '').trim();
    if (value !== '') {
      issues.push(warn(field.key, `${field.label} is not printed on the KLT label, so the value you entered will not appear.`, 'Use the master tag if the field is required.'));
    }
  }

  if (data.unit && !/^[A-Z]{2,3}$/.test(data.unit)) {
    issues.push(warn('unit', `“${data.unit}” does not look like a unit code. The common codes are PCE (pieces), KGM (kilograms), LTR (litres) and MTR (metres).`));
  }
  if (data.partNumber && data.partNumber.length < 4) {
    issues.push(warn('partNumber', 'The part number is very short. Customer part numbers are usually 6–20 characters — check it against the call-off.'));
  }
  if (data.mixedLoad && data.format === 'klt') {
    issues.push(warn('mixedLoad', 'A mixed-load marker is part of the master tag layout. The KLT label does not print it.'));
  }
  if (data.deliveryNote && !/^[A-Za-z0-9\-/._]+$/.test(data.deliveryNote)) {
    issues.push(warn('deliveryNote', 'The delivery note number contains characters that Code 39 cannot encode (it needs A–Z, 0–9, space and - . $ / + %). The Code 39 symbol will be omitted; the PDF417 still carries the value.'));
  }

  return issues;
}

/**
 * Build the PDF417 payload.
 *
 * Structure: header, then one `IDENTIFIER:VALUE` element per populated field in the order the label
 * prints them, separated by a carriage return, then the trailer. The identifiers are documented in
 * `spec.ts`; the values are exactly what is printed, so a receiver that decodes the code and reads
 * the human-readable fields sees the same strings.
 *
 * The payload is capped because PDF417 has a practical limit (~1.8 kB): a label whose 2D code fails
 * to encode at the printer is worse than a label without one.
 */
export function buildVda2dPayload(data: VdaData): { payload: string; included: string[]; omitted: string[] } {
  const order: Array<{ key: keyof VdaData; identifier: string; format?: (value: string) => string }> = [
    { key: 'supplier', identifier: VDA_2D_IDENTIFIERS.supplier?.id ?? 'L' },
    { key: 'supplierNumber', identifier: VDA_2D_IDENTIFIERS.supplier?.id ?? 'L' },
    { key: 'deliveryNote', identifier: VDA_2D_IDENTIFIERS.deliveryNote?.id ?? '16K' },
    { key: 'deliveryNoteDate', identifier: VDA_2D_IDENTIFIERS.deliveryNoteDate?.id ?? 'D', format: toVdaDate },
    { key: 'customerNumber', identifier: VDA_2D_IDENTIFIERS.customerNumber?.id ?? 'C' },
    { key: 'partNumber', identifier: VDA_2D_IDENTIFIERS.partNumber?.id ?? 'P' },
    { key: 'quantity', identifier: VDA_2D_IDENTIFIERS.quantity?.id ?? 'Q' },
    { key: 'unit', identifier: VDA_2D_IDENTIFIERS.unit?.id ?? 'U' },
    { key: 'plant', identifier: VDA_2D_IDENTIFIERS.plant?.id ?? 'W' },
    { key: 'purchaseOrder', identifier: VDA_2D_IDENTIFIERS.purchaseOrder?.id ?? 'K' },
    { key: 'deliveryDate', identifier: VDA_2D_IDENTIFIERS.deliveryDate?.id ?? 'T', format: toVdaDate },
    { key: 'batch', identifier: VDA_2D_IDENTIFIERS.batch?.id ?? 'H' },
    { key: 'serial', identifier: VDA_2D_IDENTIFIERS.serial?.id ?? 'S' },
  ];

  const included: string[] = [];
  const omitted: string[] = [];
  const elements: string[] = [];
  for (const entry of order) {
    const raw = String(data[entry.key] ?? '').trim();
    if (raw === '') continue;
    // A value containing the element separator would split into two elements on decode. Replace it
    // and say so, rather than emitting a payload that decodes to something else.
    const value = entry.format ? entry.format(raw) : raw.replace(/[\r\n]+/g, ' ');
    if (entry.format && value === '') {
      omitted.push(`${entry.key} (not a valid date)`);
      continue;
    }
    elements.push(`${entry.identifier}:${value}`);
    included.push(entry.key);
  }
  const payload = `${VDA_2D_HEADER}\r${elements.join('\r')}\r${VDA_2D_TRAILER}`;
  if (payload.length > 1600) {
    omitted.push('payload truncated to 1600 characters');
    return { payload: payload.slice(0, 1600), included, omitted };
  }
  return { payload, included, omitted };
}

/**
 * The Code 39 value: the delivery note number.
 *
 * Code 39 is chosen because supplier requirements that reference 4902 specify it for the linear
 * symbol. Characters outside its set are stripped (with the caller warned by validation), because a
 * Code 39 symbol cannot carry them and a silently altered number on a label is worse than an absent
 * one — which is why validation warns when that will happen.
 */
export function buildVdaLinearValue(data: VdaData): string {
  return data.deliveryNote.replace(/[^0-9A-Z\-. $/+%]/gi, '').toUpperCase();
}
