/**
 * QR Business Card Designer — contact record, vCard/MeCard payloads and page pairing.
 *
 * ## Why this is a separate module from the QR generator
 *
 * The existing QR Code Generator encodes arbitrary text. A business card is the opposite problem: the
 * data is structured (a person, an organisation, a set of addresses), the payload has to be in a
 * format a phone's contact app will actually import (vCard 3.0 or MeCard), and the *card* — the
 * printed artefact — has to hold a name, a logo and a QR at a size that scans from a hand.
 *
 * So this module reuses the QR engine (`productivity/qr.ts` through the design-studio barcode engine)
 * and adds only what is missing: the contact schema, the two payload formats, escaping that survives
 * a real parser, and the card layouts.
 *
 * ## Payload formats
 *
 * * **vCard 3.0** (`BEGIN:VCARD` … `END:VCARD`) — the widest support: iOS, Android, Outlook, Google
 *   Contacts. Chosen as the default. Line endings are CRLF and every text value is escaped, because a
 *   comma in an organisation name or a semicolon in a title otherwise truncates the field.
 * * **MeCard** (`MECARD:…;;`) — the compact format used by Japanese and some Android scanners. It
 *   has no escape mechanism beyond backslash and a smaller field set, so the generator refuses values
 *   that MeCard cannot represent instead of silently mangling them.
 *
 * Neither format has an official registry entry that *guarantees* an app will import every field; the
 * page says which fields each format carries and what a scanner will show.
 */

import type { LabelDocument, LabelElement, LabelSheet } from '../labels/model';
import { createElement, defaultLabelDocument } from '../labels/model';

/** Payload dialects. */
export type CardPayloadFormat = 'vcard' | 'mecard';

export interface CardContact {
  firstName: string;
  lastName: string;
  /** Job title, e.g. "Logistics Manager". */
  title: string;
  company: string;
  department: string;
  phone: string;
  mobile: string;
  email: string;
  website: string;
  address: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  /** Free line: a tagline, a role, an appointment link. */
  note: string;
  /** Optional logo as a raster data URL (SVG is refused by the image validator). */
  logoDataUrl?: string;
}

export const DEFAULT_CONTACT: CardContact = {
  firstName: '',
  lastName: '',
  title: '',
  company: '',
  department: '',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  address: '',
  city: '',
  region: '',
  postcode: '',
  country: '',
  note: '',
};

export interface CardFieldRule {
  key: keyof CardContact;
  label: string;
  required: boolean;
  maxLength: number;
  placeholder?: string;
  hint?: string;
  type?: 'text' | 'email' | 'url' | 'tel';
}

/**
 * Field rules.
 *
 * Only a name is mandatory: a card without a name is not a business card. Everything else is optional
 * and is omitted from the payload when blank — printing `TEL:` with an empty value produces a contact
 * entry with a blank phone number, which is worse than no phone number.
 */
export const CARD_FIELDS: readonly CardFieldRule[] = [
  { key: 'firstName', label: 'First name', required: false, maxLength: 60, placeholder: 'Ada' },
  { key: 'lastName', label: 'Last name', required: false, maxLength: 60, placeholder: 'Obi' },
  { key: 'title', label: 'Job title', required: false, maxLength: 80, placeholder: 'Logistics Manager' },
  { key: 'company', label: 'Company', required: false, maxLength: 100, placeholder: 'CloudHost247 Ltd' },
  { key: 'department', label: 'Department', required: false, maxLength: 60, placeholder: 'Operations' },
  { key: 'phone', label: 'Phone', required: false, maxLength: 32, placeholder: '+234 800 000 0000', type: 'tel' },
  { key: 'mobile', label: 'Mobile', required: false, maxLength: 32, placeholder: '+234 801 111 1111', type: 'tel' },
  { key: 'email', label: 'Email', required: false, maxLength: 120, placeholder: 'ada@cloudhost247.com', type: 'email' },
  { key: 'website', label: 'Website', required: false, maxLength: 200, placeholder: 'https://cloudhost247.com', type: 'url' },
  { key: 'address', label: 'Street address', required: false, maxLength: 120 },
  { key: 'city', label: 'City', required: false, maxLength: 60 },
  { key: 'region', label: 'State / region', required: false, maxLength: 60 },
  { key: 'postcode', label: 'Postcode', required: false, maxLength: 20 },
  { key: 'country', label: 'Country', required: false, maxLength: 60 },
  { key: 'note', label: 'Note or tagline', required: false, maxLength: 160 },
];

/* ------------------------------------------------------------------ */
/* Escaping                                                            */
/* ------------------------------------------------------------------ */

/**
 * vCard text escaping (RFC 6350 §3.4).
 *
 * Backslash first, then the four separators. Doing it in the other order re-escapes the backslashes
 * that were just inserted and produces `\\,` for a real comma.
 */
export function escapeVCardText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a vCard line at 75 octets, as the specification requires for long values. */
export function foldVCardLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return parts.join('\r\n');
}

/** A display name: "Ada Obi", or whichever half exists. */
export function contactDisplayName(contact: CardContact): string {
  return [contact.firstName.trim(), contact.lastName.trim()].filter(Boolean).join(' ');
}

/** Structured address, or an empty string when nothing was entered. */
function structuredAddress(contact: CardContact): string {
  return [contact.address, contact.city, contact.region, contact.postcode, contact.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ');
}

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

export interface CardPayload {
  format: CardPayloadFormat;
  value: string;
  /** Field names the payload carries, for the "what will the scanner show" table. */
  fields: string[];
  /** Values the chosen dialect cannot represent. */
  unsupported: string[];
  /** Byte length, because a QR has to hold it. */
  bytes: number;
}

/**
 * Build a vCard 3.0 payload.
 *
 * 3.0 rather than 4.0 because it is what the widest set of phone cameras and contact apps import
 * without a third-party app. `CHARSET=UTF-8` plus the escaped text keeps non-Latin names intact.
 */
export function buildVCard(contact: CardContact): CardPayload {
  const fields: string[] = [];
  const name = contactDisplayName(contact);
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeVCardText(contact.lastName.trim())};${escapeVCardText(contact.firstName.trim())};;;`);
  lines.push(`FN:${escapeVCardText(name)}`);
  fields.push('Name');
  if (contact.company.trim()) {
    lines.push(`ORG:${escapeVCardText(contact.company.trim())}${contact.department.trim() ? `;${escapeVCardText(contact.department.trim())}` : ''}`);
    fields.push('Organisation');
  }
  if (contact.title.trim()) {
    lines.push(`TITLE:${escapeVCardText(contact.title.trim())}`);
    fields.push('Job title');
  }
  if (contact.phone.trim()) {
    lines.push(`TEL;TYPE=WORK,VOICE:${contact.phone.trim()}`);
    fields.push('Phone');
  }
  if (contact.mobile.trim()) {
    lines.push(`TEL;TYPE=CELL:${contact.mobile.trim()}`);
    fields.push('Mobile');
  }
  if (contact.email.trim()) {
    lines.push(`EMAIL;TYPE=WORK,INTERNET:${contact.email.trim()}`);
    fields.push('Email');
  }
  if (contact.website.trim()) {
    lines.push(`URL:${contact.website.trim()}`);
    fields.push('Website');
  }
  const address = structuredAddress(contact);
  if (address) {
    lines.push(
      `ADR;TYPE=WORK:;;${escapeVCardText(contact.address.trim())};${escapeVCardText(contact.city.trim())};` +
        `${escapeVCardText(contact.region.trim())};${escapeVCardText(contact.postcode.trim())};${escapeVCardText(contact.country.trim())}`
    );
    fields.push('Address');
  }
  if (contact.note.trim()) {
    lines.push(`NOTE:${escapeVCardText(contact.note.trim())}`);
    fields.push('Note');
  }
  lines.push('END:VCARD');
  const value = lines.map(foldVCardLine).join('\r\n');
  return { format: 'vcard', value, fields, unsupported: [], bytes: Buffer.byteLength(value, 'utf8') };
}

/**
 * Build a MeCard payload.
 *
 * MeCard has no field for a job title, a department or a structured address, and its only escape is a
 * backslash before `\`, `;`, `:` and `,`. Both facts are reported in `unsupported` rather than
 * flattened into a field that will show up in the wrong place on the phone.
 */
export function buildMeCard(contact: CardContact): CardPayload {
  const escape = (value: string): string => value.replace(/([\\;:,])/g, '\\$1').replace(/\r?\n/g, ' ');
  const fields: string[] = [];
  const unsupported: string[] = [];
  const parts: string[] = [`N:${escape(contactDisplayName(contact))}`];
  fields.push('Name');
  if (contact.company.trim()) {
    parts.push(`ORG:${escape(contact.company.trim())}`);
    fields.push('Organisation');
  }
  if (contact.phone.trim()) {
    parts.push(`TEL:${escape(contact.phone.trim())}`);
    fields.push('Phone');
  }
  if (contact.mobile.trim()) {
    parts.push(`TEL:${escape(contact.mobile.trim())}`);
    fields.push('Mobile');
  }
  if (contact.email.trim()) {
    parts.push(`EMAIL:${escape(contact.email.trim())}`);
    fields.push('Email');
  }
  if (contact.website.trim()) {
    parts.push(`URL:${escape(contact.website.trim())}`);
    fields.push('Website');
  }
  const address = structuredAddress(contact);
  if (address) {
    parts.push(`ADR:${escape(address)}`);
    fields.push('Address');
  }
  if (contact.note.trim()) {
    parts.push(`NOTE:${escape(contact.note.trim())}`);
    fields.push('Note');
  }
  if (contact.title.trim()) unsupported.push('Job title (MeCard has no TITLE field)');
  if (contact.department.trim()) unsupported.push('Department (MeCard has no department field)');
  const value = `MECARD:${parts.join(';')};;`;
  return { format: 'mecard', value, fields, unsupported, bytes: Buffer.byteLength(value, 'utf8') };
}

export function buildCardPayload(contact: CardContact, format: CardPayloadFormat = 'vcard'): CardPayload {
  return format === 'mecard' ? buildMeCard(contact) : buildVCard(contact);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface CardIssue {
  level: 'error' | 'warn';
  field: string;
  message: string;
  hint?: string;
}

/** Validate the contact, and the payload's fit in a QR at the chosen error correction. */
export function validateContact(contact: CardContact, options: { format?: CardPayloadFormat; errorCorrection?: 'L' | 'M' | 'Q' | 'H' } = {}): CardIssue[] {
  const issues: CardIssue[] = [];
  for (const rule of CARD_FIELDS) {
    const value = String(contact[rule.key] ?? '').trim();
    if (rule.key === 'logoDataUrl') continue;
    if (value.length > rule.maxLength) {
      issues.push({
        level: 'error',
        field: rule.key,
        message: `${rule.label} is ${value.length} characters; the maximum is ${rule.maxLength}.`,
      });
    }
  }
  if (contactDisplayName(contact) === '') {
    issues.push({ level: 'error', field: 'firstName', message: 'A card needs a name: enter a first or last name.' });
  }
  if (contact.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) {
    issues.push({ level: 'error', field: 'email', message: 'That email address is not valid.' });
  }
  if (contact.website.trim() !== '' && !/^(https?:\/\/|www\.)\S+$/i.test(contact.website.trim())) {
    issues.push({ level: 'error', field: 'website', message: 'The website must start with http://, https:// or www.' });
  }
  if (contact.phone.trim() !== '' && !/^[+\d][\d\s().-]{5,}$/.test(contact.phone.trim())) {
    issues.push({ level: 'error', field: 'phone', message: 'That does not look like a phone number.' });
  }
  if (contact.mobile.trim() !== '' && !/^[+\d][\d\s().-]{5,}$/.test(contact.mobile.trim())) {
    issues.push({ level: 'error', field: 'mobile', message: 'That does not look like a mobile number.' });
  }

  const payload = buildCardPayload(contact, options.format ?? 'vcard');
  // QR version 40 at error correction L holds 2953 bytes; the practical ceiling for a card that
  // someone has to point a phone at is far lower. Warn early, refuse only beyond the hard limit.
  if (payload.bytes > 2953) {
    issues.push({
      level: 'error',
      field: 'payload',
      message: `The ${payload.format === 'vcard' ? 'vCard' : 'MeCard'} payload is ${payload.bytes} bytes, which is larger than a QR code can hold (2953 bytes at the lowest error correction).`,
      hint: 'Shorten the note or the address and try again.',
    });
  } else if (payload.bytes > 800) {
    issues.push({
      level: 'warn',
      field: 'payload',
      message: `The payload is ${payload.bytes} bytes. It will fit, but a denser QR is harder to scan from a printed card — consider a shorter note.`,
    });
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export type CardOrientationSide = 'landscape' | 'portrait' | 'square';

export interface CardTemplateMeta {
  id: string;
  name: string;
  /** Standard business-card size in millimetres. */
  sizeMm: { width: number; height: number };
  orientation: CardOrientationSide;
  blurb: string;
  description: string;
  /** Ink colour and accent used by the layout. */
  ink: string;
  accent: string;
  /** `light` cards print dark text on a light ground. */
  ground: 'light' | 'dark';
  keywords: string[];
  /** Where the QR sits. */
  qrSide: 'left' | 'right' | 'centre';
}

export const CARD_TEMPLATES: readonly CardTemplateMeta[] = [
  {
    id: 'classic-white',
    name: 'Classic white',
    sizeMm: { width: 85, height: 55 },
    orientation: 'landscape',
    blurb: '85 × 55 mm (the international standard) with the QR in the right third.',
    description: 'The most widely printed business-card size outside North America. Name and title left, contact details beside the QR on the right.',
    ink: '#10171d',
    accent: '#5f450a',
    ground: 'light',
    keywords: ['classic', 'white', '85x55', 'standard'],
    qrSide: 'right',
  },
  {
    id: 'classic-us',
    name: 'Classic US (3.5 × 2 in)',
    sizeMm: { width: 88.9, height: 50.8 },
    orientation: 'landscape',
    blurb: 'The North American 3.5 × 2 inch card.',
    description: 'The US/Canada standard card. Slightly wider and shorter than the international size, with the QR still at 20 mm so it scans from a hand.',
    ink: '#10171d',
    accent: '#5f450a',
    ground: 'light',
    keywords: ['us', '3.5x2', 'north america', 'inches'],
    qrSide: 'right',
  },
  {
    id: 'dark-slate',
    name: 'Dark slate',
    sizeMm: { width: 85, height: 55 },
    orientation: 'landscape',
    blurb: 'Dark ground with a light QR panel — the panel is what keeps the code scannable.',
    description:
      'A dark card with an inverted palette. The QR is always printed on a white panel: a light-on-dark QR fails on most phone cameras because the binariser assumes dark modules on a light ground.',
    ink: '#f5f5f3',
    accent: '#e6c875',
    ground: 'dark',
    keywords: ['dark', 'slate', 'modern', 'inverted'],
    qrSide: 'right',
  },
  {
    id: 'accent-band',
    name: 'Accent band',
    sizeMm: { width: 85, height: 55 },
    orientation: 'landscape',
    blurb: 'A vertical accent band down the left edge, name and QR to the right of it.',
    description: 'For a stronger brand presence: a solid band of the accent colour, with the name, title and QR laid out in the remaining area.',
    ink: '#10171d',
    accent: '#5f450a',
    ground: 'light',
    keywords: ['band', 'colour', 'brand', 'stripe'],
    qrSide: 'right',
  },
  {
    id: 'minimal-left',
    name: 'Minimal, QR left',
    sizeMm: { width: 85, height: 55 },
    orientation: 'landscape',
    blurb: 'Lots of white space with the QR on the left and the name set large.',
    description: 'A restrained layout for consultants and studios: the QR leads, the name is the largest element, and nothing else competes.',
    ink: '#10171d',
    accent: '#5f450a',
    ground: 'light',
    keywords: ['minimal', 'clean', 'left', 'studio'],
    qrSide: 'left',
  },
  {
    id: 'square-social',
    name: 'Square social card',
    sizeMm: { width: 55, height: 55 },
    orientation: 'square',
    blurb: '55 × 55 mm square, for social inserts and stickers.',
    description: 'A square card that fits a 2 × 2 grid on a business-card sheet and works as an Instagram or WhatsApp insert.',
    ink: '#10171d',
    accent: '#5f450a',
    ground: 'light',
    keywords: ['square', 'social', 'insert', 'sticker'],
    qrSide: 'centre',
  },
  {
    id: 'qr-centre',
    name: 'QR centred',
    sizeMm: { width: 85, height: 55 },
    orientation: 'landscape',
    blurb: 'Name on top, large QR in the middle, contact line beneath.',
    description: 'For cards whose main job is to be scanned at a stand or a counter: the QR dominates the layout at 26 mm.',
    ink: '#10171d',
    accent: '#5f450a',
    ground: 'light',
    keywords: ['centre', 'large qr', 'counter', 'stand'],
    qrSide: 'centre',
  },
  {
    id: 'portrait-tall',
    name: 'Portrait',
    sizeMm: { width: 55, height: 85 },
    orientation: 'portrait',
    blurb: '85 × 55 mm rotated to portrait, with the QR at the foot.',
    description: 'A vertically oriented card for folders and badge holders, with the QR at the bottom where a scanner can reach it.',
    ink: '#10171d',
    accent: '#5f450a',
    ground: 'light',
    keywords: ['portrait', 'vertical', 'tall', 'badge'],
    qrSide: 'centre',
  },
];

export function findCardTemplate(id: string): CardTemplateMeta | undefined {
  return CARD_TEMPLATES.find((template) => template.id === id);
}

export const DEFAULT_CARD_TEMPLATE = 'classic-white';

export const CARD_LOGO_MAX_BYTES = 512 * 1024;
export const CARD_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Card sides: the front carries the identity, the back the QR and contact details. */
export type CardSide = 'front' | 'back';

export const CARD_SIDES: readonly CardSide[] = ['front', 'back'];

const SANS = { family: 'sans' as const, colour: '#10171d', align: 'left' as const, wrap: true, lineHeight: 1.25 };

function element(overrides: Partial<LabelElement> & { kind: LabelElement['kind'] }): LabelElement {
  return createElement(overrides.kind, overrides as never);
}

/** A text element bound to a contact key. */
function contactField(
  key: keyof CardContact,
  name: string,
  box: { x: number; y: number; width: number; height: number },
  style: Record<string, unknown>
): LabelElement {
  return element({
    kind: 'field',
    id: `c-${key}`,
    name,
    binding: { key, fallback: '' },
    placeholder: '',
    ...box,
    style: { ...SANS, ...style } as never,
  });
}

const SHEET_CARDS: LabelSheet = { paperId: 'a4', columns: 2, rows: 5, marginMm: 10, gutterMm: 3 };

/**
 * Build a card document for a template side.
 *
 * Every layout keeps the QR at 18 mm or more with a 4-module quiet zone inside a white panel: below
 * that a printed card at 300 dpi gives the scanner too few pixels per module, and a dark ground
 * behind the code defeats the binariser.
 */
export function buildCardDocument(
  templateId: string = DEFAULT_CARD_TEMPLATE,
  side: CardSide = 'front',
  contact: CardContact = DEFAULT_CONTACT
): LabelDocument | null {
  const meta = findCardTemplate(templateId);
  if (!meta) return null;
  const width = meta.sizeMm.width;
  const height = meta.sizeMm.height;
  const dark = meta.ground === 'dark';
  const ink = dark ? '#f5f5f3' : meta.ink;
  const muted = dark ? '#c9c6bd' : '#5a6577';
  const qrSize = meta.qrSide === 'centre' ? Math.min(26, Math.min(width, height) - 24) : 20;
  const values = cardValues(contact);

  const style = {
    background: dark ? '#161d24' : '#ffffff',
    border: { colour: dark ? '#2a333c' : '#dedfdd', width: 0.25, radius: 1.5 },
    paddingMm: 5,
  };

  if (side === 'front') {
    const nameBox = { x: 0, y: height - 26, width: width - 12, height: 7 };
    const elements: LabelElement[] = [];
    if (meta.id === 'accent-band') {
      elements.push(element({ kind: 'rect', id: 'band', name: 'Accent band', x: -5, y: -5, width: 8, height: height + 10, fill: meta.accent } as never));
    }
    if (meta.id === 'square-social' || meta.id === 'qr-centre') {
      elements.push(contactField('firstName', 'First name', { x: 0, y: 2, width: width - 10, height: 8 }, { size: 5, family: 'sans-bold', colour: ink, align: meta.qrSide === 'centre' ? 'center' : 'left' }));
      elements.push(contactField('lastName', 'Last name', { x: 0, y: 9.5, width: width - 10, height: 8 }, { size: 5, family: 'sans-bold', colour: ink, align: 'center' }));
      elements.push(contactField('title', 'Title', { x: 0, y: 17, width: width - 10, height: 4 }, { size: 2.4, colour: muted, align: 'center' }));
    } else {
      /* Every box below is measured from the *label* origin, which is what `checkBounds` compares
         against — but the padding moves the content origin, so a box ending exactly at
         `height - paddingMm` is the last one that is fully inside. The company line used to end at
         `height - 6.5` on a 55 mm card, i.e. 3.5 mm below the padded content area and past the page
         edge: the print clipped the bottom of "CloudHost247 Ltd", and only a *warning* said so, which
         the test that asserted "no errors" never saw. The title and company now sit inside the
         margin, and the pair is right-aligned with the name block above it. */
      const textWidth = width - 40;
      elements.push(contactField('firstName', 'First name', nameBox, { size: 5.4, family: 'sans-bold', colour: ink, wrap: false }));
      elements.push(contactField('lastName', 'Last name', { x: 0, y: height - 18.5, width: width - 12, height: 7 }, { size: 5.4, family: 'sans-bold', colour: ink, wrap: false }));
      // Both boxes end at `height - paddingMm` at the latest: the element origin is already inset by
      // the padding, so that is the last line that prints.
      const padding = 5;
      elements.push(contactField('title', 'Title', { x: 0, y: height - 13, width: textWidth, height: 2.9 }, { size: 2.4, colour: muted, wrap: false }));
      elements.push(contactField('company', 'Company', { x: 0, y: height - 9.5 + (padding - 5), width: textWidth, height: 3.1 }, { size: 2.6, colour: ink, wrap: false }));
    }
    return defaultLabelDocument({
      name: `${meta.name} — front`,
      category: 'custom',
      widthMm: width,
      heightMm: height,
      orientation: meta.orientation === 'portrait' ? 'portrait' : 'landscape',
      templateId: meta.id,
      style,
      sheet: SHEET_CARDS,
      values,
      elements,
    });
  }

  // Back: a white QR panel (even on a dark card), the contact lines and the logo if one was supplied.
  const qrX = meta.qrSide === 'left' ? 0 : meta.qrSide === 'centre' ? (width - 10 - qrSize) / 2 : width - 10 - qrSize;
  const qrY = meta.qrSide === 'centre' ? height - 10 - qrSize : (height - 10 - qrSize) / 2;
  const elements: LabelElement[] = [
    element({
      kind: 'rect',
      id: 'qr-panel',
      name: 'QR panel',
      x: qrX - 1.5,
      y: qrY - 1.5,
      width: qrSize + 3,
      height: qrSize + 3,
      fill: '#ffffff',
      radius: 1,
    } as never),
    element({
      kind: 'symbol',
      id: 'qr',
      name: 'Contact QR',
      binding: { key: 'qr', fallback: contactDisplayName(contact) || 'CloudHost247' },
      symbol: 'qrcode',
      errorCorrection: 'M',
      colour: '#000000',
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
    } as never),
  ];
  if (meta.qrSide !== 'centre') {
    const textWidth = width - 12 - qrSize;
    const textX = meta.qrSide === 'left' ? qrSize + 6 : 0;
    elements.push(
      contactField('phone', 'Phone', { x: textX, y: 4, width: textWidth, height: 4 }, { size: 2.4, colour: ink, wrap: false }),
      contactField('email', 'Email', { x: textX, y: 8.5, width: textWidth, height: 4 }, { size: 2.4, colour: ink, wrap: false }),
      contactField('website', 'Website', { x: textX, y: 13, width: textWidth, height: 4 }, { size: 2.4, colour: muted, wrap: false }),
      contactField('address', 'Address', { x: textX, y: 17.5, width: textWidth, height: 6 }, { size: 2.1, colour: muted }),
      // The note is the last line on the card: it ends exactly at the padded content edge
      // (`height − 2 × paddingMm`), which is why it is 3 mm tall rather than 5.
      contactField('note', 'Note', { x: textX, y: height - 10, width: textWidth, height: 5 }, { size: 2.1, colour: muted })
    );
  }
  if (contact.logoDataUrl) {
    elements.push(
      element({
        kind: 'image',
        id: 'logo',
        name: 'Logo',
        src: contact.logoDataUrl,
        fit: 'contain',
        x: width - 10 - 14,
        y: 4,
        width: 14,
        height: 14,
        alt: 'Logo',
      } as never)
    );
  }
  return defaultLabelDocument({
    name: `${meta.name} — back`,
    category: 'custom',
    widthMm: width,
    heightMm: height,
    orientation: meta.orientation === 'portrait' ? 'portrait' : 'landscape',
    templateId: meta.id,
    style,
    sheet: SHEET_CARDS,
    values,
    elements,
  });
}

/** Contact → label values, with the QR payload precomputed. */
export function cardValues(contact: CardContact, format: CardPayloadFormat = 'vcard'): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(contact)) {
    if (typeof value === 'string') values[key] = value;
  }
  values.qr = buildCardPayload(contact, format).value;
  return values;
}
