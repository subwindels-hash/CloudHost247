/**
 * Real, verifiable QR symbols for the Business Tools card generators.
 *
 * The business card and the employee ID card embed actual QR codes, not pictures of one. The
 * encoding uses the same pure-JavaScript `qrcode` encoder the Tools Center QR tool uses
 * (`src/tools/productivity/qr.ts`), and the tests decode the generated SVG back with `jsqr` —
 * the same decode round-trip that tool is tested with — so a code that did not scan would fail
 * the build rather than ship on a printed badge.
 *
 * Everything here is synchronous and pure: the browser bundle and the API route import the same
 * module, and the same input always yields the same symbol.
 *
 * The symbol is emitted as SVG path data (one rectangular subpath per horizontal run of dark
 * modules) inside a group tagged `data-qr-payload`, so the payload the symbol encodes is stated
 * in the document itself and a test — or a reviewer — can parse and decode it without a browser.
 */
import QRCode from 'qrcode';
import { escapeXml } from './format';

export type QrEcc = 'L' | 'M';

/** A two-module quiet zone on every side, as a fraction of the symbol's own footprint. */
const QUIET_MODULES = 2;

export interface EncodedQr {
  /** Modules per side, excluding the quiet zone. */
  modules: number;
  /** QR version (1–40) as reported by the encoder. */
  version: number;
  /** Row-run path in module units: `M{x} {y}h{w}v1h-{w}z` per run. */
  pathData: string;
  /** Number of dark modules — asserted by tests against an independent encoding. */
  darkModules: number;
}

export function encodeQr(content: string, ecc: QrEcc = 'L'): EncodedQr {
  const symbol = QRCode.create(content, { errorCorrectionLevel: ecc });
  const size = symbol.modules.size;
  const data = symbol.modules.data;
  let pathData = '';
  let darkModules = 0;
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (data[y * size + x]) {
        let run = 1;
        while (x + run < size && data[y * size + x + run]) run += 1;
        pathData += `M${x} ${y}h${run}v1h-${run}z`;
        darkModules += run;
        x += run;
      } else {
        x += 1;
      }
    }
  }
  return { modules: size, version: symbol.version, pathData, darkModules };
}

export interface QrFragmentOptions {
  /** Top-left corner of the symbol's footprint, including its quiet zone. */
  x: number;
  y: number;
  /** Edge length in user units, quiet zone included. */
  boxPx: number;
  dark: string;
  light: string;
  ecc?: QrEcc;
  /** Read by screen readers; also surfaced as the printed caption by the callers. */
  ariaLabel: string;
}

export interface QrFragment {
  svg: string;
  payload: string;
  modules: number;
  version: number;
}

/**
 * One QR symbol as an SVG fragment positioned at (x, y). The white quiet-zone rect is part of
 * the fragment so the symbol scans even when the card background is not white.
 */
export function qrSvgFragment(payload: string, options: QrFragmentOptions): QrFragment {
  const { modules, version, pathData } = encodeQr(payload, options.ecc ?? 'L');
  const cells = modules + QUIET_MODULES * 2;
  const cell = options.boxPx / cells;
  const inner = cell * QUIET_MODULES;
  const svg =
    `<g class="bt247-qr" role="img" aria-label="${escapeXml(options.ariaLabel)}" data-qr-payload="${escapeXml(payload)}">` +
    `<rect x="${options.x}" y="${options.y}" width="${options.boxPx}" height="${options.boxPx}" fill="${options.light}"/>` +
    `<g transform="translate(${round2(options.x + inner)} ${round2(options.y + inner)}) scale(${round2(cell)})">` +
    `<path d="${pathData}" fill="${options.dark}"/>` +
    `</g></g>`;
  return { svg, payload, modules, version };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Escape a value for a vCard 3.0 property (backslash, semicolon, comma, newline). */
function vcardEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export interface VCardFields {
  fullName: string;
  company?: string;
  title?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
}

/**
 * A minimal vCard 3.0 that phone cameras recognise and file into contacts. Only non-empty
 * properties are emitted; N splits on the first space (Western-order assumption, which is what
 * the card itself prints).
 */
export function buildVCard(fields: VCardFields): string {
  const fullName = fields.fullName.trim();
  const firstSpace = fullName.indexOf(' ');
  const first = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
  const last = firstSpace === -1 ? '' : fullName.slice(firstSpace + 1);
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vcardEscape(last)};${vcardEscape(first)};;;`, `FN:${vcardEscape(fullName)}`];
  if (fields.company?.trim()) lines.push(`ORG:${vcardEscape(fields.company.trim())}`);
  if (fields.title?.trim()) lines.push(`TITLE:${vcardEscape(fields.title.trim())}`);
  if (fields.phone?.trim()) lines.push(`TEL;TYPE=WORK,VOICE:${vcardEscape(fields.phone.trim())}`);
  if (fields.email?.trim()) lines.push(`EMAIL;TYPE=WORK:${vcardEscape(fields.email.trim())}`);
  if (fields.website?.trim()) lines.push(`URL:${vcardEscape(fields.website.trim())}`);
  if (fields.address?.trim()) lines.push(`ADR;TYPE=WORK:;;${vcardEscape(fields.address.trim())};;;;`);
  lines.push('END:VCARD');
  return lines.join('\n');
}
