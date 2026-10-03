/**
 * Tools Center — Productivity category handlers (spec §49–§58).
 *
 * Everything here runs locally in the server process: text transformations, QR encoding/decoding,
 * colour maths, time cards. The two image tools are the exception and both require an operator
 * provider — OCR and reverse image search are reported as CONFIGURATION_REQUIRED rather than guessed
 * when no provider exists, and the uploaded bytes are never written to disk.
 */
import { wordCounter, loremIpsum, notepadTransform, smallText, invisibleCharacters, runicTranslate } from '../productivity/text';
import { qrGenerate, qrScan, wifiQr } from '../productivity/qr';
import { timeCard, timezoneView } from '../productivity/time-card';
import { colorBlindness, contrastCheck, palette, toColorRepresentation } from '../productivity/color';
import { imageOcr, reverseImageSearch } from '../productivity/image';
import { invalidInput } from '../core/errors';
import type { ToolHandler } from './kit';
import { bool, maybeNum, maybeStr, oneOf, str, strArray, targetLabel } from './kit';

const TEXT_OPERATIONS = [
  'trim-lines',
  'trim-text',
  'collapse-spaces',
  'remove-blank-lines',
  'remove-line-breaks',
  'sort-lines-asc',
  'sort-lines-desc',
  'dedupe-lines',
  'number-lines',
  'strip-line-numbers',
  'reverse-lines',
  'upper',
  'lower',
  'title',
  'sentence-case',
  'slug',
  'strip-html',
  'escape-html',
  'unescape-html',
  'escape-csv',
] as const;

const SMALL_TEXT_STYLES = ['superscript', 'subscript', 'small-caps', 'wide', 'mirror'] as const;
const PALETTE_KINDS = ['complementary', 'analogous', 'triadic', 'split-complementary', 'tetradic', 'monochromatic', 'shades', 'tints'] as const;
const BREAK_MODES = ['unpaid-30', 'unpaid-60', 'auto-us', 'none', 'custom'] as const;

function parseEntries(input: Record<string, unknown>): Array<{ date?: string; clockIn: string; clockOut: string; breakMinutes?: number; note?: string }> {
  const raw = input.entries;
  if (!Array.isArray(raw) || raw.length === 0) throw invalidInput('Provide at least one entry with clockIn and clockOut times.');
  if (raw.length > 31) throw invalidInput('A time card accepts at most 31 entries (one month of workdays).');
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw invalidInput(`Entry ${index + 1} must be an object with clockIn and clockOut.`);
    const record = entry as Record<string, unknown>;
    const clockIn = typeof record.clockIn === 'string' ? record.clockIn.trim() : '';
    const clockOut = typeof record.clockOut === 'string' ? record.clockOut.trim() : '';
    if (!clockIn || !clockOut) throw invalidInput(`Entry ${index + 1} needs both clockIn and clockOut (for example "09:00" and "17:30").`);
    const breakMinutes = record.breakMinutes === undefined || record.breakMinutes === null || record.breakMinutes === '' ? undefined : Number(record.breakMinutes);
    if (breakMinutes !== undefined && (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 720)) {
      throw invalidInput(`Entry ${index + 1}: breakMinutes must be between 0 and 720.`);
    }
    return {
      ...(typeof record.date === 'string' && record.date.trim() ? { date: record.date.trim() } : {}),
      clockIn,
      clockOut,
      ...(breakMinutes !== undefined ? { breakMinutes } : {}),
      ...(typeof record.note === 'string' && record.note.trim() ? { note: record.note.trim().slice(0, 200) } : {}),
    };
  });
}

function imagePayload(input: Record<string, unknown>, key = 'image'): { data?: string; url?: string; mimeType?: string } {
  const data = maybeStr(input, key, { max: 12 * 1024 * 1024 });
  const url = maybeStr(input, 'url', { max: 2000 });
  const mimeType = maybeStr(input, 'mimeType', { max: 100 });
  if (!data && !url) throw invalidInput('Provide the image as a base64 data URL (data:) or a public HTTPS URL.');
  return { ...(data ? { data } : {}), ...(url ? { url } : {}), ...(mimeType ? { mimeType } : {}) };
}

export const productivityHandlers: Record<string, ToolHandler> = {
  'word-counter': async (input) => wordCounter(str(input, 'text', { required: true, max: 1_000_000, trim: false })),

  'lorem-ipsum': async (input) =>
    loremIpsum({
      paragraphs: maybeNum(input, 'paragraphs', { min: 1, max: 50 }),
      sentencesPerParagraph: maybeNum(input, 'sentencesPerParagraph', { min: 1, max: 20 }),
      wordsPerSentence: maybeNum(input, 'wordsPerSentence', { min: 3, max: 40 }),
      startWithLorem: bool(input, 'startWithLorem', true),
      format: oneOf(input, 'format', ['plain', 'html'] as const, { default: 'plain' }),
      asList: bool(input, 'asList', false),
    }),

  notepad: async (input) =>
    notepadTransform({
      text: str(input, 'text', { required: true, max: 500_000, trim: false }),
      operations: (strArray(input, 'operations', { max: 20 }) ?? []).filter((operation): operation is (typeof TEXT_OPERATIONS)[number] =>
        (TEXT_OPERATIONS as readonly string[]).includes(operation)
      ),
      find: maybeStr(input, 'find', { max: 1000 }),
      replace: maybeStr(input, 'replace', { max: 1000 }),
      caseSensitive: bool(input, 'caseSensitive', false),
    }),

  'small-text': async (input) =>
    smallText({
      text: str(input, 'text', { required: true, max: 10_000, trim: false }),
      style: oneOf(input, 'style', SMALL_TEXT_STYLES, { default: 'superscript' }),
    }),

  'invisible-character': async (input) =>
    invisibleCharacters({
      text: str(input, 'text', { max: 20_000, trim: false }),
      clean: maybeStr(input, 'mode') === 'clean' || bool(input, 'clean', false),
    }),

  'runic-translator': async (input) =>
    runicTranslate({
      text: str(input, 'text', { required: true, max: 20_000, trim: false }),
      direction: oneOf(input, 'direction', ['to-runes', 'to-latin'] as const, { default: 'to-runes' }),
    }),

  'qr-generator': async (input) =>
    qrGenerate({
      content: str(input, 'content', { required: true, max: 2000, trim: false }),
      errorCorrectionLevel: oneOf(input, 'errorCorrectionLevel', ['L', 'M', 'Q', 'H'] as const, { default: 'M' }),
      size: maybeNum(input, 'size', { min: 64, max: 2048 }),
      margin: maybeNum(input, 'margin', { min: 0, max: 16 }),
      dark: maybeStr(input, 'dark', { max: 9 }),
      light: maybeStr(input, 'light', { max: 9 }),
      format: oneOf(input, 'format', ['png', 'svg'] as const, { default: 'png' }),
    }),

  'qr-scanner': async (input) => qrScan({ image: str(input, 'image', { required: true, max: 12 * 1024 * 1024, trim: false }) }),

  'wifi-qr': async (input) =>
    wifiQr({
      ssid: str(input, 'ssid', { required: true, max: 64 }),
      password: str(input, 'password', { max: 200, trim: false }),
      security: oneOf(input, 'security', ['WPA', 'WEP', 'nopass'] as const, { default: 'WPA' }),
      hidden: bool(input, 'hidden', false),
      errorCorrectionLevel: oneOf(input, 'errorCorrectionLevel', ['L', 'M', 'Q', 'H'] as const, { default: 'M' }),
      size: maybeNum(input, 'size', { min: 64, max: 2048 }),
      format: oneOf(input, 'format', ['png', 'svg'] as const, { default: 'png' }),
    }),

  'time-card': async (input) => {
    if (bool(input, 'timezoneOnly', false)) return timezoneView({ timezone: maybeStr(input, 'timezone', { max: 60 }) });
    return timeCard({
      entries: parseEntries(input),
      defaultBreakMinutes: maybeNum(input, 'defaultBreakMinutes', { min: 0, max: 720 }),
      breakMode: oneOf(input, 'breakMode', BREAK_MODES, { default: 'none' }),
      roundToMinutes: maybeNum(input, 'roundToMinutes', { min: 0, max: 60 }),
      weeklyOvertimeAfterMinutes: maybeNum(input, 'weeklyOvertimeAfterMinutes', { min: 0, max: 10_080 }),
      hourlyRate: maybeNum(input, 'hourlyRate', { min: 0, max: 100_000 }),
      currency: maybeStr(input, 'currency', { max: 10 }),
      timezone: maybeStr(input, 'timezone', { max: 60 }),
    });
  },

  'color-tools': async (input) => {
    const operation = oneOf(input, 'operation', ['convert', 'contrast', 'palette', 'color-blindness'] as const, { default: 'convert' });
    switch (operation) {
      case 'convert':
        return toColorRepresentation(str(input, 'color', { required: true, max: 60 }));
      case 'contrast':
        return contrastCheck({
          foreground: str(input, 'foreground', { max: 60 }) || str(input, 'color', { required: true, max: 60 }),
          background: str(input, 'background', { required: true, max: 60 }),
        });
      case 'palette':
        return palette({ color: str(input, 'color', { required: true, max: 60 }), kind: oneOf(input, 'kind', PALETTE_KINDS, { default: 'complementary' }) });
      case 'color-blindness':
        return colorBlindness({ color: str(input, 'color', { required: true, max: 60 }) });
      default:
        throw invalidInput('Unsupported colour operation.');
    }
  },

  'image-ocr': async (input, context) =>
    imageOcr(context.db, {
      image: imagePayload(input),
      language: maybeStr(input, 'language', { max: 20 }),
    }),

  'reverse-image-search': async (input, context) => reverseImageSearch(context.db, { image: imagePayload(input) }),
};

export const productivityTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  'word-counter': () => null,
  'lorem-ipsum': () => null,
  notepad: () => null,
  'small-text': () => null,
  'invisible-character': () => null,
  'runic-translator': () => null,
  'qr-generator': (input) => targetLabel(typeof input.content === 'string' ? input.content.slice(0, 80) : null),
  'qr-scanner': () => null,
  'wifi-qr': (input) => targetLabel(typeof input.ssid === 'string' ? `WiFi ${input.ssid}` : null),
  'time-card': () => null,
  'color-tools': (input) => targetLabel(typeof input.color === 'string' ? input.color : null),
  'image-ocr': () => null,
  'reverse-image-search': () => null,
};
