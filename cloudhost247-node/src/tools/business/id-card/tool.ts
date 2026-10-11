/**
 * The Employee ID Card Generator as the Tools Center sees it.
 *
 * The interactive badge maker is a browser tool, but the API still has to be able to produce the
 * same card server-side — for the tool's own JSON/HTML response, for `explain`, and for anyone
 * scripting it. This adapter is the bridge: it accepts the historical field names the catalogue has
 * published since the generator shipped (`employeeName`, `designation`, `themeColor`, `issueDate`,
 * `expiryDate`, `includePhoto`, `includeQr`) alongside the newer ones, validates through the same
 * `buildSpec()` the form uses, and returns an SVG of both faces.
 *
 * Keeping the old names working is not politeness: those field keys are in the published API, in
 * saved form state and in the tests. A rebuilt generator that silently renamed its inputs would
 * break working integrations, which is the one thing a "completion" pass must not do.
 */

import { buildCardLayout } from './templates';
import { cardToPrintSvg, faceToSvg } from './svg';
import { cardPixelSize, CARD_MM, CARD_TEMPLATES, type CardTemplateId } from './types';
import { buildSpec, defaultFormState, paletteFor, type CardFormState } from './model';
import { CARD_PRESETS } from './types';
import { fileSlug } from './text';
import type { BusinessToolInput, BusinessToolOutcome } from '../types';

function text(input: BusinessToolInput, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function flag(input: BusinessToolInput, fallback: boolean, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (/^(true|1|yes|on)$/i.test(value)) return true;
      if (/^(false|0|no|off)$/i.test(value)) return false;
    }
  }
  return fallback;
}

/** Map any accepted spelling of the form onto one internal state. */
export function formStateFromInput(input: BusinessToolInput): CardFormState {
  const base = defaultFormState();
  const templateInput = text(input, 'template', 'templateId');
  const template = (CARD_TEMPLATES.some((entry) => entry.id === templateInput) ? templateInput : base.template) as CardTemplateId;
  const presetInput = text(input, 'preset', 'colourPreset', 'colorPreset');
  const preset = (CARD_PRESETS.some((entry) => entry.id === presetInput) ? presetInput : base.preset) as CardFormState['preset'];

  const state: CardFormState = {
    ...base,
    fullName: text(input, 'fullName', 'employeeName', 'name'),
    employeeId: text(input, 'employeeId', 'id', 'staffId'),
    jobTitle: text(input, 'jobTitle', 'designation', 'role', 'title'),
    department: text(input, 'department', 'dept'),
    email: text(input, 'email'),
    phone: text(input, 'phone', 'telephone'),
    bloodGroup: text(input, 'bloodGroup').toUpperCase(),
    dateOfJoining: text(input, 'dateOfJoining', 'joined'),
    emergencyContact: text(input, 'emergencyContact'),
    validFrom: text(input, 'validFrom', 'issueDate', 'issued'),
    validUntil: text(input, 'validUntil', 'expiryDate', 'expires'),
    companyName: text(input, 'companyName', 'organisation', 'organization'),
    companyAddress: text(input, 'companyAddress', 'address'),
    companyWebsite: text(input, 'companyWebsite', 'website'),
    photo: text(input, 'photo', 'photoDataUrl'),
    logo: text(input, 'logo', 'logoDataUrl'),
    signature: text(input, 'signature', 'signatureDataUrl'),
    showPhoto: flag(input, base.showPhoto, 'showPhoto', 'includePhoto'),
    showLogo: flag(input, base.showLogo, 'showLogo', 'includeLogo'),
    showSignature: flag(input, base.showSignature, 'showSignature', 'includeSignature'),
    showQr: flag(input, base.showQr, 'showQr', 'includeQr'),
    showBarcode: flag(input, base.showBarcode, 'showBarcode', 'includeBarcode'),
    barcodeValue: text(input, 'barcodeValue', 'barcode'),
    qrContent: text(input, 'qrContent', 'qrPayload', 'verificationUrl'),
    orientation: text(input, 'orientation') === 'portrait' ? 'portrait' : text(input, 'orientation') === 'landscape' ? 'landscape' : base.orientation,
    template,
    preset,
    primary: text(input, 'primary', 'themeColor', 'brandColor') || base.primary,
    background: text(input, 'background', 'cardBackground') || base.background,
    text: text(input, 'textColor', 'text') || base.text,
    detail: text(input, 'detail', 'detailColor', 'accentColor') || base.detail,
  };
  return state;
}

/**
 * The QR payload this tool has always defaulted to: the employee ID, or `NAME:<full name>` when no
 * ID was supplied. Preserved verbatim so an existing integration that reads the symbol still gets
 * the same string back.
 */
export function defaultQrFor(state: CardFormState): string {
  if (state.qrContent.trim() !== '') return state.qrContent.trim();
  const id = state.employeeId.trim();
  if (id !== '') return id;
  const name = state.fullName.trim();
  return name === '' ? '' : `NAME:${name}`;
}

function luhnStatus(employeeId: string): 'valid' | 'invalid' | null {
  const digits = employeeId.replace(/\D/g, '');
  if (digits.length < 2) return null;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0 ? 'valid' : 'invalid';
}

export function computeIdCardTool(input: BusinessToolInput): BusinessToolOutcome {
  const state = formStateFromInput(input);
  const effectiveQr = defaultQrFor(state);
  const specResult = buildSpec({ ...state, qrContent: state.showQr ? effectiveQr : '' }, { strict: false });
  const { spec } = specResult;

  // The published API has always accepted a card without an employee ID (it falls back to the name
  // for the QR payload), so that one field is a warning here rather than a refusal. The interactive
  // form is stricter: it will not draw a badge whose identifier is missing.
  const demoted = specResult.errors.filter((error) => error.key === 'employeeId').map((error) => error.message);
  const errors = specResult.errors.filter(
    (error) => !['photo', 'logo', 'signature', 'employeeId'].includes(error.key)
  );
  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        message: `The card could not be generated: ${errors.length} field${errors.length > 1 ? 's need' : ' needs'} attention.`,
        fieldErrors: errors,
      },
    };
  }

  const layout = buildCardLayout(spec);
  const frontSvg = faceToSvg(layout.front, {
    title: `Employee ID card front — ${spec.employee.fullName || 'employee'}`,
    description: `Front face of the ${templateName(spec.options.template)} template, CR80 card.`,
  });
  const backSvg = faceToSvg(layout.back, {
    title: `Employee ID card back — ${spec.employee.fullName || 'employee'}`,
    description: 'Reverse face: contact details, emergency contact and the machine-readable codes.',
  });
  const sheet = cardToPrintSvg(layout.front, layout.back, `${spec.employee.fullName || 'Employee'} — employee ID card`);
  const slug = fileSlug(spec.employee.employeeId || spec.employee.fullName);
  const check = luhnStatus(spec.employee.employeeId);
  const size = cardPixelSize(spec.options.orientation);

  const warnings: string[] = [...demoted, ...specResult.warnings, ...layout.warnings];
  if (check === 'invalid') {
    warnings.push(
      `The employee ID “${spec.employee.employeeId}” fails Luhn check-digit verification. If it was issued by the Employee ID Generator, it may have been mistyped — an invalid ID will not match a payroll or access-control record.`
    );
  }
  warnings.push(
    'An ID card is an identity artefact. Printing one for a person who does not work for the organisation, or altering an existing card, may constitute fraud in your jurisdiction — this tool produces the artwork only and verifies nothing about the holder.'
  );
  if (spec.options.qrContent.trim() !== '' && !/^https?:\/\//i.test(spec.options.qrContent)) {
    warnings.push(
      'The QR code carries plain text, not a web address. It tells a scanner what the badge already says; it does not verify employment, and nothing is looked up when it is scanned.'
    );
  }

  const codes: string[] = [];
  codes.push(spec.options.showQr ? `QR — ${spec.options.qrContent.length} characters, error correction M` : 'QR — switched off');
  codes.push(
    spec.options.showBarcode && spec.options.barcodeValue !== ''
      ? `Code 128 — “${spec.options.barcodeValue}”`
      : spec.options.showBarcode
        ? 'Code 128 — switched on with no value'
        : 'Code 128 — switched off'
  );

  return {
    ok: true,
    result: {
      metrics: [
        { label: 'Cardholder', value: spec.employee.fullName || '(not supplied)', emphasis: 'primary' },
        { label: 'Employee ID', value: spec.employee.employeeId || '—', emphasis: 'primary' },
        {
          label: 'Check digit',
          value: check === null ? 'Not verifiable' : check === 'valid' ? 'Valid (Luhn)' : 'Invalid (Luhn)',
          emphasis: check === 'invalid' ? 'primary' : 'muted',
          hint: check === null ? 'An ID with fewer than two digits cannot carry a Luhn check digit' : undefined,
        },
        { label: 'Template', value: templateName(spec.options.template), emphasis: 'secondary' },
        {
          label: 'Card size',
          value: `${size.width} × ${size.height} px · ${CARD_MM.width} × ${CARD_MM.height} mm`,
          emphasis: 'secondary',
          hint: '300 dpi, ISO/IEC 7810 ID-1 (CR80)',
        },
        { label: 'Sides', value: 'Front and back', emphasis: 'muted' },
      ],
      document: { format: 'svg', filename: `id-card-${slug}-front-back.svg`, label: 'ID card, both sides (SVG)', content: sheet },
      extraDocuments: [
        { format: 'svg', filename: `id-card-${slug}-front.svg`, label: 'Front (SVG)', content: frontSvg },
        { format: 'svg', filename: `id-card-${slug}-back.svg`, label: 'Back (SVG)', content: backSvg },
      ],
      tables: [
        {
          title: 'Card fields',
          columns: ['Field', 'Value'],
          rows: [
            { label: 'Company', cells: [spec.company.name || '(placeholder)'] },
            { label: 'Employee name', cells: [spec.employee.fullName || '(placeholder)'] },
            { label: 'Employee ID', cells: [spec.employee.employeeId || '—'] },
            { label: 'Job title', cells: [spec.employee.jobTitle || '—'] },
            { label: 'Department', cells: [spec.employee.department || '—'] },
            { label: 'Email', cells: [spec.employee.email || '—'] },
            { label: 'Phone', cells: [spec.employee.phone || '—'] },
            { label: 'Blood group', cells: [spec.employee.bloodGroup || '—'] },
            { label: 'Date of joining', cells: [spec.employee.dateOfJoining || '—'] },
            { label: 'Emergency contact', cells: [spec.employee.emergencyContact || '—'] },
            { label: 'Valid from', cells: [spec.employee.validFrom || '—'] },
            { label: 'Valid until', cells: [spec.employee.validUntil || '—'] },
            { label: 'Photograph', cells: [spec.images.photo ? 'Embedded' : spec.options.showPhoto ? 'Monogram placeholder' : 'Omitted'] },
            { label: 'Logo', cells: [spec.images.logo ? 'Embedded' : spec.options.showLogo ? 'Initials tile' : 'Omitted'] },
            { label: 'Signature', cells: [spec.images.signature ? 'Embedded' : spec.options.showSignature ? 'Signature line' : 'Omitted'] },
          ],
        },
        {
          title: 'Machine-readable codes',
          columns: ['Element', 'Content', 'Status'],
          caption: 'Both symbols are drawn module by module from their encoders, so a downloaded card scans the same as the preview.',
          rows: [
            {
              label: 'QR code',
              cells: [
                spec.options.showQr ? 'Employee identifier or configured content' : 'Not printed',
                spec.options.showQr ? 'scannable QR (error correction M)' : 'Omitted',
              ],
            },
            {
              label: 'Code 128 barcode',
              cells: [
                spec.options.showBarcode ? spec.options.barcodeValue || 'no value supplied' : 'Not printed',
                spec.options.showBarcode && spec.options.barcodeValue !== '' ? 'Code 128 with modulo-103 check symbol' : spec.options.showBarcode ? 'Not drawn — no value' : 'Omitted',
              ],
            },
          ],
        },
        { title: 'Design', columns: ['Setting', 'Value'], rows: [
          { label: 'Template', cells: [templateName(spec.options.template)] },
          { label: 'Orientation', cells: [spec.options.orientation === 'portrait' ? 'Portrait' : 'Landscape'] },
          { label: 'Palette', cells: [`accent ${spec.options.palette.primary}, background ${spec.options.palette.background}, text ${spec.options.palette.text}, detail ${spec.options.palette.detail}`] },
        ] },
      ],
      explanation: [
        'The card is laid out in your browser and, when the API is used, in the tool server: the same template, the same palette and the same code encoders produce the SVG, the PNG, the JPG and the PDF.',
        `Card geometry is ISO/IEC 7810 ID-1 — ${CARD_MM.width} × ${CARD_MM.height} mm — rendered at 300 dpi (${size.width} × ${size.height} px), which is what a card printer and a print bureau expect.`,
        'The QR symbol and the Code 128 barcode are drawn module by module from real encoders (the QR with error correction M, the barcode with its modulo-103 check symbol), so they scan.',
        'Blood group, emergency contact and the validity dates are printed because a badge is read by someone who has no access to your HR system.',
        check === 'valid'
          ? 'The employee ID passes Luhn check-digit verification, so a single mistyped digit is rejected instead of silently matching another employee.'
          : check === 'invalid'
            ? 'The employee ID does not pass Luhn verification; see the advisory below.'
            : 'No check-digit verification was possible for this ID format.',
        'Uploaded photographs, logos and signatures are used only to draw the card. They are never uploaded by the browser tool; when the API is used, they are used in memory for this request only.',
      ],
      warnings,
    },
  };
}

function templateName(id: CardTemplateId): string {
  return CARD_TEMPLATES.find((template) => template.id === id)?.name ?? 'Corporate Split';
}

export { paletteFor };
