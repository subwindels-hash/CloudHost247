/**
 * QR Code Maker.
 *
 * What these tests establish, as opposed to assume:
 *
 *  - For every kind of code, the PNG and the PDF a visitor downloads are read by an independent
 *    decoder (tests/helpers/barcode-reader.ts) and the text it returns is compared with the payload
 *    written out by hand here, character for character. The expected strings are not produced by
 *    the code under test.
 *  - Each format's reserved characters are escaped by that format's rules, checked on values that
 *    contain them.
 *  - A value a format cannot hold is refused, and the refusal never repeats what was entered.
 *
 * What a phone then does with a payload is the phone's business and is not tested here.
 */
import { describe, expect, it } from 'vitest';

import { TOOL_CATALOG } from '../../src/tools/catalog';
import { ToolError } from '../../src/tools/core/errors';
import { handlerFor, targetFor } from '../../src/tools/handlers';
import { QR_CODE_TYPES, QR_KINDS, QR_LIMITS, QR_SOCIAL_PLATFORMS, type QrKind } from '../../src/tools/design-studio/definitions';
import { STUDIO_FORMS, applyStudioChange, buildStudioInput, studioDefaults, studioExample, studioFields, visibleStudioFields, type StudioValues } from '../../src/tools/design-studio/forms';
import { readPngDpi } from '../../src/tools/design-studio/render/png-meta';
import { isValidCreditorReference, isValidIban, phoneNumber, webAddress } from '../../src/tools/design-studio/shared/qr-content';
import type { StudioFile, StudioResult } from '../../src/tools/design-studio/shared/result';
import { decodePixels, decodePng } from '../helpers/barcode-reader';
import { parsePdf, replayPage } from '../helpers/studio-pdf';
import { rasteriseOps } from '../helpers/studio-raster';

const SLUG = 'qr-code-maker';
const context = {} as never;

async function make(input: Record<string, unknown>): Promise<StudioResult> {
  const handler = handlerFor(SLUG);
  if (!handler) throw new Error('No handler is registered for the QR Code Maker.');
  return (await handler(input, context)) as StudioResult;
}

async function refusal(input: Record<string, unknown>): Promise<ToolError> {
  try {
    await make(input);
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error('Expected the QR Code Maker to refuse this request.');
}

function fileOf(result: StudioResult, mime: StudioFile['mime']): StudioFile {
  const file = result.files.find((entry) => entry.mime === mime);
  if (!file) throw new Error(`The result has no ${mime} file.`);
  return file;
}

const bytesOf = (file: StudioFile): Uint8Array => new Uint8Array(Buffer.from(file.base64, 'base64'));
const fact = (result: StudioResult, label: string): string | undefined => result.facts.find((entry) => entry.label === label)?.value;

/** What a decoder reads from the PNG the visitor downloads. */
async function readPng(result: StudioResult): Promise<Array<{ format: string; text: string }>> {
  const found = await decodePng(bytesOf(fileOf(result, 'image/png')));
  for (const symbol of found) expect(symbol.valid, `${symbol.format}: ${symbol.error}`).toBe(true);
  return found.map(({ format, text }) => ({ format, text }));
}

/** What a decoder reads from the PDF, printed at 300 dpi. */
async function readPdf(result: StudioResult): Promise<Array<{ format: string; text: string }>> {
  const pdf = parsePdf(bytesOf(fileOf(result, 'application/pdf')));
  expect(pdf.problems).toEqual([]);
  expect(pdf.pages).toHaveLength(1);
  const page = replayPage(pdf, 0);
  expect(page.unknownOperators).toEqual([]);
  const found = await decodePixels(rasteriseOps(page.ops, page.widthMm, page.heightMm, 300 / 25.4));
  for (const symbol of found) expect(symbol.valid, `${symbol.format}: ${symbol.error}`).toBe(true);
  return found.map(({ format, text }) => ({ format, text }));
}

/** A request for each kind and the payload a phone must receive for it, written out by hand. */
const CASES: Array<{ kind: QrKind; input: Record<string, unknown>; carries: string }> = [
  { kind: 'url', input: { url: 'https://cloudhost247.com/tools?ref=poster&lang=en' }, carries: 'https://cloudhost247.com/tools?ref=poster&lang=en' },
  { kind: 'text', input: { text: 'Opening hours\n\nMon to Sat: 8:00 to 18:00\nSunday: closed' }, carries: 'Opening hours\n\nMon to Sat: 8:00 to 18:00\nSunday: closed' },
  { kind: 'wifi', input: { ssid: 'CloudHost247 Guest', wifiPassword: 'welcome-2026', wifiSecurity: 'WPA' }, carries: 'WIFI:T:WPA;S:CloudHost247 Guest;P:welcome-2026;;' },
  {
    kind: 'contact',
    input: { firstName: 'Amina', lastName: 'Yusuf', jobTitle: 'Solutions Architect', organization: 'CloudHost247', email: 'amina.yusuf@cloudhost247.com', phone: '+234 803 555 0142', website: 'https://cloudhost247.com', city: 'Jos', country: 'Nigeria' },
    carries: [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Yusuf;Amina;;;',
      'FN:Amina Yusuf',
      'ORG:CloudHost247',
      'TITLE:Solutions Architect',
      'TEL;TYPE=WORK,VOICE:+234 803 555 0142',
      'EMAIL;TYPE=INTERNET:amina.yusuf@cloudhost247.com',
      'URL:https://cloudhost247.com',
      'ADR;TYPE=WORK:;;;Jos;;;Nigeria',
      'END:VCARD',
    ].join('\r\n'),
  },
  { kind: 'email', input: { emailTo: 'support@cloudhost247.com', emailSubject: 'Hosting & domains', emailBody: 'Hello,\nplease call me.' }, carries: 'mailto:support@cloudhost247.com?subject=Hosting%20%26%20domains&body=Hello%2C%0D%0Aplease%20call%20me.' },
  { kind: 'phone', input: { phoneNumber: '+234 (803) 555-0142' }, carries: 'tel:+2348035550142' },
  { kind: 'sms', input: { smsNumber: '+234 803 555 0142', smsMessage: 'Please call me back: today.' }, carries: 'SMSTO:+2348035550142:Please call me back: today.' },
  { kind: 'whatsapp', input: { whatsappNumber: '+234 803 555 0142', whatsappMessage: 'Hello, I scanned your code & have a question' }, carries: 'https://wa.me/2348035550142?text=Hello%2C%20I%20scanned%20your%20code%20%26%20have%20a%20question' },
  {
    kind: 'event',
    input: { eventTitle: 'Customer open day', eventStart: '2026-12-12', eventStartTime: '10:00', eventEnd: '2026-12-12', eventEndTime: '16:00', eventPlace: '14 Ahmadu Bello Way, Jos', eventNotes: 'Refreshments provided.' },
    carries: ['BEGIN:VEVENT', 'SUMMARY:Customer open day', 'DTSTART:20261212T100000', 'DTEND:20261212T160000', 'LOCATION:14 Ahmadu Bello Way\\, Jos', 'DESCRIPTION:Refreshments provided.', 'END:VEVENT'].join('\r\n'),
  },
  { kind: 'location', input: { latitude: '9.896527', longitude: '8.858331' }, carries: 'https://maps.google.com/?q=9.896527,8.858331' },
  { kind: 'social', input: { platform: 'instagram', handle: '@cloudhost247' }, carries: 'https://www.instagram.com/cloudhost247' },
  {
    kind: 'payment',
    input: { payeeName: 'Example Trading GmbH', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX', amount: '49.9', paymentText: 'Invoice 2026-0042' },
    carries: ['BCD', '002', '1', 'SCT', 'COBADEFFXXX', 'Example Trading GmbH', 'DE89370400440532013000', 'EUR49.90', '', '', 'Invoice 2026-0042'].join('\n'),
  },
];

/* ------------------------------------------------------------------ */
/* Read-back                                                           */
/* ------------------------------------------------------------------ */

describe('every kind of code, read back from the files a visitor downloads', () => {
  it('has a case here for every kind the tool offers', () => {
    expect(CASES.map((entry) => entry.kind)).toEqual(QR_KINDS.map((entry) => entry.id));
    expect(QR_KINDS).toHaveLength(12);
  });

  it.each(CASES)('$kind: the PNG and the PDF carry exactly the format a phone expects', async ({ kind, input, carries }) => {
    const result = await make({ kind, ...input });
    expect(await readPng(result)).toEqual([{ format: 'QRCode', text: carries }]);
    expect(await readPdf(result)).toEqual([{ format: 'QRCode', text: carries }]);

    // The files: a PNG that declares its resolution, an SVG and a one-page PDF; a contact adds its vCard.
    expect(result.files.map((file) => file.mime)).toEqual(['image/png', 'image/svg+xml', 'application/pdf', ...(kind === 'contact' ? ['text/vcard'] : [])]);
    expect(readPngDpi(bytesOf(fileOf(result, 'image/png')))).toBe(300);
    expect(Buffer.from(fileOf(result, 'image/svg+xml').base64, 'base64').toString('utf8')).toMatch(/^<svg[^>]* width="[\d.]+mm" height="[\d.]+mm"/);
    // File names say what kind of code it is and nothing about its content.
    expect(result.files.map((file) => file.name)).toEqual([`qr-code-${kind}-300dpi.png`, `qr-code-${kind}.svg`, `qr-code-${kind}.pdf`, ...(kind === 'contact' ? ['contact.vcf'] : [])]);

    const label = QR_KINDS.find((entry) => entry.id === kind);
    expect(result.title).toBe(`QR Code for ${label?.noun}`);
    expect(fact(result, 'When scanned')).toBe(label?.label);
    expect(fact(result, 'Content length')).toBe(`${Buffer.byteLength(carries, 'utf8')} bytes`);
    expect(fact(result, 'Verification')).toBe('This code type is read back by an independent decoder in our automated tests.');
    expect(result.notices).toContain('Scan the code with a phone before you print or publish it.');
    expect(result.count).toBe(1);
  });

  it.each(QR_CODE_TYPES.filter((entry) => entry.id !== 'qrcode').map((entry) => ({ id: entry.id, label: entry.label })))('$label carries the same payloads', async ({ id }) => {
    const format = id === 'datamatrix' ? 'DataMatrix' : 'Aztec';
    for (const { kind, input, carries } of CASES.filter((entry) => entry.kind !== 'payment')) {
      const result = await make({ kind, ...input, codeType: id });
      expect(await readPng(result), kind).toEqual([{ format, text: carries }]);
      expect(await readPdf(result), kind).toEqual([{ format, text: carries }]);
      expect(fact(result, 'Error correction'), kind).toBeUndefined();
    }
  });

  it('carries text beyond ASCII without loss', async () => {
    const text = 'Ọláyínká Adéwálé · ₦5,000 · Jos → Lagos · مرحبا · 你好';
    for (const codeType of ['qrcode', 'datamatrix', 'aztec']) {
      const [read] = await readPng(await make({ kind: 'text', text, codeType }));
      expect(read?.text, codeType).toBe(text);
    }
  });

  it('draws the code at the size it states, and at the size asked for', async () => {
    // "https://cloudhost247.com" at level M is a 25 × 25 QR Code (version 2); the quiet zone is 4 squares a side.
    const result = await make({ kind: 'url', url: 'https://cloudhost247.com' });
    expect(fact(result, 'Size of one square (SVG, PDF)')).toBe('0.5 mm');
    expect(fact(result, 'Size')).toBe('16.5 × 16.5 mm including the quiet zone');
    expect(result.previews[0]?.widthMm).toBeCloseTo((25 + 8) * 0.5, 6);
    // At 300 dpi half a millimetre is 5.9 pixels, so the PNG uses 6 per square and says so.
    expect(fact(result, 'PNG')).toBe('198 × 198 px at 300 dpi');
    expect(result.notices).toContain('The PNG uses 6 pixels per square, which is 0.51 mm at 300 dpi. A bitmap square must be a whole number of pixels; the SVG and PDF are exactly 0.5 mm.');

    const large = await make({ kind: 'url', url: 'https://cloudhost247.com', moduleMm: 1, dpi: 600 });
    expect(fact(large, 'Size')).toBe('33 × 33 mm including the quiet zone');
    expect(readPngDpi(bytesOf(fileOf(large, 'image/png')))).toBe(600);
    expect(await readPng(large)).toEqual([{ format: 'QRCode', text: 'https://cloudhost247.com' }]);

    // Outside the range offered, the nearest size is used and the result says which.
    const tiny = await make({ kind: 'url', url: 'https://cloudhost247.com', moduleMm: 0.1 });
    expect(fact(tiny, 'Size of one square (SVG, PDF)')).toBe('0.25 mm');
    expect(tiny.notices).toContain('The size of one square was set to 0.25 mm: QR Code is offered between 0.25 and 3 mm here.');
    expect(tiny.notices).toContain('One square of this code is 0.25 mm wide. Print it at 300 dpi or finer and scan a printed copy before you rely on it.');
  });

  it('makes a denser code at a higher error correction level, and still reads', async () => {
    const low = await make({ kind: 'url', url: 'https://cloudhost247.com/tools/qr-code-maker', eclevel: 'L' });
    const high = await make({ kind: 'url', url: 'https://cloudhost247.com/tools/qr-code-maker', eclevel: 'H' });
    expect(fact(low, 'Error correction')).toBe('L');
    expect(fact(high, 'Error correction')).toBe('H');
    expect(high.previews[0]?.widthMm ?? 0).toBeGreaterThan(low.previews[0]?.widthMm ?? 0);
    expect((await readPng(high))[0]?.text).toBe('https://cloudhost247.com/tools/qr-code-maker');
  });

  it('colours the code, warns about weak contrast, and leaves the background out on request', async () => {
    const blue = await make({ kind: 'url', url: 'https://cloudhost247.com', color: '#0f4c81', background: '#fff8e1' });
    expect(blue.previews[0]?.svg).toContain('#0f4c81');
    expect(blue.previews[0]?.svg).toContain('#fff8e1');
    expect(blue.notices.join(' ')).not.toMatch(/contrast/i);
    const pale = await make({ kind: 'url', url: 'https://cloudhost247.com', color: '#cccccc' });
    expect(pale.notices.join(' ')).toMatch(/contrast/i);
    const clear = await make({ kind: 'url', url: 'https://cloudhost247.com', transparent: true });
    expect(clear.notices).toContain('The background is transparent. Place the code on a plain, light surface with clear space around it.');
    expect((await readPng(clear))[0]?.text).toBe('https://cloudhost247.com');
  });
});

/* ------------------------------------------------------------------ */
/* Formats                                                             */
/* ------------------------------------------------------------------ */

describe('payload formats', () => {
  const carried = async (input: Record<string, unknown>): Promise<string> => (await readPng(await make(input)))[0]?.text ?? '';

  it('adds https:// to a web address without a scheme and keeps the rest as typed', async () => {
    expect(await carried({ kind: 'url', url: 'cloudhost247.com/tools' })).toBe('https://cloudhost247.com/tools');
    expect(await carried({ kind: 'url', url: 'http://example.com:8080/a?b=c#d' })).toBe('http://example.com:8080/a?b=c#d');
    expect(await carried({ kind: 'url', url: 'example.com:8080/path' })).toBe('https://example.com:8080/path');
    expect(webAddress('HTTPS://Example.com/Path', 'Web address')).toBe('HTTPS://Example.com/Path');
  });

  it('escapes the Wi-Fi format’s own punctuation in a network name and a password', async () => {
    // Backslash, semicolon, comma, quotation mark and colon are written with a backslash before them.
    expect(await carried({ kind: 'wifi', ssid: 'Cafe; Bar, "Upstairs": 2\\3', wifiPassword: 'p;a,s"s:w\\d!', wifiSecurity: 'WPA' })).toBe(
      'WIFI:T:WPA;S:Cafe\\; Bar\\, \\"Upstairs\\"\\: 2\\\\3;P:p\\;a\\,s\\"s\\:w\\\\d!;;'
    );
    expect(await carried({ kind: 'wifi', ssid: 'Office', wifiPassword: 'longer password with spaces', wifiHidden: true })).toBe('WIFI:T:WPA;S:Office;P:longer password with spaces;H:true;;');
    // An open network has no password field at all, whatever was typed in it.
    expect(await carried({ kind: 'wifi', ssid: 'Free Wi-Fi', wifiSecurity: 'nopass', wifiPassword: 'ignored' })).toBe('WIFI:T:nopass;S:Free Wi-Fi;;');
    expect(await carried({ kind: 'wifi', ssid: 'Old Router', wifiSecurity: 'WEP', wifiPassword: 'wxyz1' })).toBe('WIFI:T:WEP;S:Old Router;P:wxyz1;;');
  });

  it('quotes a network name or password that could be mistaken for a hexadecimal key, and not a real key', async () => {
    // "Cafe" and "12345678" consist only of hexadecimal digits; the format asks for quotation marks.
    expect(await carried({ kind: 'wifi', ssid: 'Cafe', wifiPassword: '12345678' })).toBe('WIFI:T:WPA;S:"Cafe";P:"12345678";;');
    // A 64-digit hexadecimal WPA key and a 10 or 26-digit WEP key are keys, and stay bare.
    const key = '0123456789abcdef'.repeat(4);
    expect(await carried({ kind: 'wifi', ssid: 'Lab', wifiPassword: key })).toBe(`WIFI:T:WPA;S:Lab;P:${key};;`);
    expect(await carried({ kind: 'wifi', ssid: 'Lab', wifiSecurity: 'WEP', wifiPassword: '0123456789' })).toBe('WIFI:T:WEP;S:Lab;P:0123456789;;');
    // Five characters that happen to be hexadecimal digits are a five-character key, not a hexadecimal one.
    expect(await carried({ kind: 'wifi', ssid: 'Lab', wifiSecurity: 'WEP', wifiPassword: 'abcde' })).toBe('WIFI:T:WEP;S:Lab;P:"abcde";;');
    // The result says when it has done this, and only then.
    const QUOTED = /consists only of the characters 0 to 9 and A to F, so the code writes it in quotation marks/;
    expect((await make({ kind: 'wifi', ssid: 'Cafe', wifiPassword: 'welcome-2026' })).notices.join(' ')).toMatch(QUOTED);
    expect((await make({ kind: 'wifi', ssid: 'Lab', wifiPassword: key })).notices.join(' ')).not.toMatch(QUOTED);
    // A name that merely contains a colon and a quotation mark is escaped, not quoted.
    expect((await make({ kind: 'wifi', ssid: 'A:"B"', wifiPassword: 'welcome-2026' })).notices.join(' ')).not.toMatch(QUOTED);
  });

  it('carries a network name and password exactly as typed, and says so when one ends in a space', async () => {
    const result = await make({ kind: 'wifi', ssid: 'Office ', wifiPassword: ' secret pass' });
    expect((await readPng(result))[0]?.text).toBe('WIFI:T:WPA;S:Office ;P: secret pass;;');
    expect(result.notices).toContain('The network name or the password begins or ends with a space, and the code carries it exactly as typed. Remove the space unless it is really part of it.');
    expect((await make({ kind: 'wifi', ssid: 'Office', wifiPassword: 'secret pass' })).notices.join(' ')).not.toMatch(/begins or ends with a space/);
  });

  it('never shows a Wi-Fi password anywhere but in the code itself', async () => {
    const password = 'Zx9!canary-PASSWORD';
    const result = await make({ kind: 'wifi', ssid: 'Office', wifiPassword: password });
    expect((await readPng(result))[0]?.text).toBe(`WIFI:T:WPA;S:Office;P:${password};;`);
    expect(fact(result, 'The code carries')).toBe('WIFI:T:WPA;S:Office;P:••••••••;;');
    const visible = JSON.stringify({ title: result.title, facts: result.facts, notices: result.notices, files: result.files.map((file) => [file.name, file.label, file.hint]), previews: result.previews.map((preview) => preview.title) });
    expect(visible).not.toContain(password);
    expect(result.notices).toContain('Anyone who scans this code can join the network. Put it where your guests are, not where passers-by are.');
    expect((await make({ kind: 'wifi', ssid: 'Free', wifiSecurity: 'nopass' })).notices).toContain('This network has no password: the code only saves people typing its name.');
  });

  it('writes a contact as a vCard or as a MeCard, and offers the vCard as a file either way', async () => {
    const contact = { kind: 'contact', firstName: 'Chidi', lastName: 'Okafor; Jr', organization: 'Okafor, Sons & Co', phone: '+234 809 555 0177', email: 'chidi@example.com' };
    const vcard = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Okafor\\; Jr;Chidi;;;', 'FN:Chidi Okafor\\; Jr', 'ORG:Okafor\\, Sons & Co', 'TEL;TYPE=WORK,VOICE:+234 809 555 0177', 'EMAIL;TYPE=INTERNET:chidi@example.com', 'END:VCARD'].join('\r\n');
    const asVcard = await make(contact);
    expect((await readPng(asVcard))[0]?.text).toBe(vcard);
    // The file is the code's content plus the line end that closes a file.
    expect(Buffer.from(fileOf(asVcard, 'text/vcard').base64, 'base64').toString('utf8')).toBe(`${vcard}\r\n`);

    const asMecard = await make({ ...contact, contactFormat: 'mecard' });
    expect((await readPng(asMecard))[0]?.text).toBe('MECARD:N:Okafor\\; Jr,Chidi;ORG:Okafor\\, Sons & Co;TEL:+2348095550177;EMAIL:chidi@example.com;;');
    expect(Buffer.from(fileOf(asMecard, 'text/vcard').base64, 'base64').toString('utf8')).toBe(`${vcard}\r\n`);
    // The MeCard is the shorter of the two, so its code is the smaller one.
    expect(asMecard.previews[0]?.widthMm ?? 0).toBeLessThan(asVcard.previews[0]?.widthMm ?? 0);
  });

  it('percent-encodes an email’s subject and message and leaves the address readable', async () => {
    expect(await carried({ kind: 'email', emailTo: 'sales@example.com' })).toBe('mailto:sales@example.com');
    expect(await carried({ kind: 'email', emailTo: 'first.last+tag@example.co.uk', emailSubject: 'Is 50% off? Yes & no' })).toBe('mailto:first.last%2Btag@example.co.uk?subject=Is%2050%25%20off%3F%20Yes%20%26%20no');
    expect(await carried({ kind: 'email', emailTo: 'a@b.ng', emailBody: 'One\nTwo' })).toBe('mailto:a@b.ng?body=One%0D%0ATwo');
  });

  it('reduces phone numbers to digits and an optional plus', async () => {
    expect(await carried({ kind: 'phone', phoneNumber: '0803 555 0142' })).toBe('tel:08035550142');
    expect(await carried({ kind: 'phone', phoneNumber: '112' })).toBe('tel:112');
    expect(await carried({ kind: 'sms', smsNumber: '+44 20 7946 0958' })).toBe('SMSTO:+442079460958:');
    expect(phoneNumber('+1 (415) 555-0100', 'Phone number')).toBe('+14155550100');
    // WhatsApp addresses a number by country code, without the plus.
    expect(await carried({ kind: 'whatsapp', whatsappNumber: '+234 803 555 0142' })).toBe('https://wa.me/2348035550142');
    expect(await carried({ kind: 'whatsapp', whatsappNumber: '2348035550142', whatsappMessage: 'Line 1\nLine 2' })).toBe('https://wa.me/2348035550142?text=Line%201%0ALine%202');
  });

  it('writes calendar events with the end a calendar expects', async () => {
    const event = { kind: 'event', eventTitle: 'Stand-up', eventStart: '2026-03-02' };
    // With a start time and nothing else, the event lasts an hour.
    expect(await carried({ ...event, eventStartTime: '09:30' })).toBe('BEGIN:VEVENT\r\nSUMMARY:Stand-up\r\nDTSTART:20260302T093000\r\nDTEND:20260302T103000\r\nEND:VEVENT');
    // An hour that crosses midnight ends on the next day; one that crosses a month end, in the next month.
    expect(await carried({ ...event, eventStart: '2026-02-28', eventStartTime: '23:30' })).toContain('DTSTART:20260228T233000\r\nDTEND:20260301T003000');
    // An end date without an end time ends at the same time on that day.
    expect(await carried({ ...event, eventStartTime: '09:30', eventEnd: '2026-03-04' })).toContain('DTSTART:20260302T093000\r\nDTEND:20260304T093000');
    // An all-day event is a date range whose end is the day after its last day.
    expect(await carried(event)).toBe('BEGIN:VEVENT\r\nSUMMARY:Stand-up\r\nDTSTART;VALUE=DATE:20260302\r\nDTEND;VALUE=DATE:20260303\r\nEND:VEVENT');
    expect(await carried({ ...event, eventStart: '2026-12-30', eventEnd: '2026-12-31' })).toContain('DTSTART;VALUE=DATE:20261230\r\nDTEND;VALUE=DATE:20270101');
    // 2028 is a leap year.
    expect(await carried({ ...event, eventStart: '2028-02-29' })).toContain('DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301');
    // Backslash, semicolon, comma and line breaks are escaped in text.
    expect(await carried({ ...event, eventTitle: 'Q&A; part 1, live', eventPlace: 'Room A\\B', eventNotes: 'Bring:\n- laptop' })).toBe(
      'BEGIN:VEVENT\r\nSUMMARY:Q&A\\; part 1\\, live\r\nDTSTART;VALUE=DATE:20260302\r\nDTEND;VALUE=DATE:20260303\r\nLOCATION:Room A\\\\B\r\nDESCRIPTION:Bring:\\n- laptop\r\nEND:VEVENT'
    );
    expect((await make({ ...event, eventStartTime: '09:30' })).notices).toContain('The times carry no time zone, so a phone reads them in its own local time. That suits an event people attend in person.');
    expect((await make(event)).notices.join(' ')).not.toMatch(/time zone/);
  });

  it('writes a place as a map link or as geo: coordinates, to six decimals at most', async () => {
    expect(await carried({ kind: 'location', latitude: 6.5244, longitude: 3.3792 })).toBe('https://maps.google.com/?q=6.5244,3.3792');
    expect(await carried({ kind: 'location', latitude: '-33.8688197', longitude: '151.20929559999', mapFormat: 'geo' })).toBe('geo:-33.86882,151.209296');
    expect(await carried({ kind: 'location', latitude: '9,5', longitude: '8', mapFormat: 'geo' })).toBe('geo:9.5,8');
    expect(await carried({ kind: 'location', latitude: 0, longitude: -180, mapFormat: 'geo' })).toBe('geo:0,-180');
    expect((await make({ kind: 'location', latitude: 1, longitude: 1, mapFormat: 'geo' })).notices).toContain(
      'A geo: code relies on the scanning app to pass the coordinates to a maps app. A map link is a web address and opens wherever a browser does.'
    );
  });

  it('builds the profile address of each social platform', async () => {
    const expected: Record<string, string> = {
      facebook: 'https://www.facebook.com/cloud.host-247',
      instagram: 'https://www.instagram.com/cloud.host-247',
      x: 'https://x.com/cloud.host-247',
      tiktok: 'https://www.tiktok.com/@cloud.host-247',
      youtube: 'https://www.youtube.com/@cloud.host-247',
      linkedin: 'https://www.linkedin.com/in/cloud.host-247',
      'linkedin-company': 'https://www.linkedin.com/company/cloud.host-247',
      telegram: 'https://t.me/cloud.host-247',
    };
    expect(Object.keys(expected)).toEqual(QR_SOCIAL_PLATFORMS.map((entry) => entry.id));
    for (const [platform, address] of Object.entries(expected)) {
      expect(await carried({ kind: 'social', platform, handle: '@cloud.host-247' }), platform).toBe(address);
    }
  });

  it('lays a SEPA payment out line by line as the EPC QR code format has it', async () => {
    const base = { kind: 'payment', payeeName: 'Wikimedia Foerdergesellschaft', iban: 'de33 1002 0500 0001 1947 00' };
    // Only what is needed: the lines after the IBAN are dropped when they are all empty.
    expect(await carried(base)).toBe('BCD\n002\n1\nSCT\n\nWikimedia Foerdergesellschaft\nDE33100205000001194700');
    expect(await carried({ ...base, amount: 5 })).toBe('BCD\n002\n1\nSCT\n\nWikimedia Foerdergesellschaft\nDE33100205000001194700\nEUR5.00');
    expect(await carried({ ...base, bic: 'bfswde33ber', amount: '1234,5' })).toBe('BCD\n002\n1\nSCT\nBFSWDE33BER\nWikimedia Foerdergesellschaft\nDE33100205000001194700\nEUR1234.50');
    // A structured reference sits on line 10 and a message on line 11; an empty purpose line comes before both.
    expect(await carried({ ...base, paymentReference: 'RF18 5390 0754 7034' })).toBe('BCD\n002\n1\nSCT\n\nWikimedia Foerdergesellschaft\nDE33100205000001194700\n\n\nRF18539007547034');
    expect(await carried({ ...base, amount: '0.01', paymentText: 'Spende für Wikipedia' })).toBe('BCD\n002\n1\nSCT\n\nWikimedia Foerdergesellschaft\nDE33100205000001194700\nEUR0.01\n\n\nSpende für Wikipedia');
  });

  it('makes a SEPA payment code a QR Code at level M, whatever was selected', async () => {
    const payment = { kind: 'payment', payeeName: 'Example Trading GmbH', iban: 'DE89370400440532013000', amount: '10' };
    const result = await make({ ...payment, eclevel: 'H' });
    expect(fact(result, 'Error correction')).toBe('M');
    expect(result.notices).toContain('A SEPA payment code uses error correction level M, so that level was used instead of the one selected.');
    expect((await make(payment)).notices.join(' ')).not.toMatch(/level M, so that level/);
    expect((await refusal({ ...payment, codeType: 'datamatrix' })).message).toBe('A SEPA payment code is a QR Code by its standard. Choose QR Code as the code type.');
    expect(result.notices[0]).toMatch(/^Scan the code with your own banking app and check the name, IBAN and amount/);
    expect((await make({ kind: 'payment', payeeName: 'X', iban: 'DE89370400440532013000' })).notices).toContain('No amount is set, so the payer enters it.');
  });

  it('checks an IBAN and a creditor reference by their check digits', () => {
    // Published examples of valid IBANs for several countries.
    for (const iban of ['DE89370400440532013000', 'GB82WEST12345698765432', 'FR1420041010050500013M02606', 'NL91ABNA0417164300', 'AT611904300234573201', 'BE68539007547034', 'ES9121000418450200051332']) {
      expect(isValidIban(iban), iban).toBe(true);
    }
    // One digit changed, two characters swapped, too short, lowercase, and not an IBAN at all.
    for (const iban of ['DE89370400440532013001', 'DE98370400440532013000', 'DE8937040044', 'de89370400440532013000', 'HELLO', '']) {
      expect(isValidIban(iban), iban).toBe(false);
    }
    // ISO 11649: RF18 5390 0754 7034 is the standard's own example.
    expect(isValidCreditorReference('RF18539007547034')).toBe(true);
    expect(isValidCreditorReference('RF18539007547035')).toBe(false);
    expect(isValidCreditorReference('RF19539007547034')).toBe(false);
    expect(isValidCreditorReference('539007547034')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

describe('what the tool refuses, and how it says so', () => {
  const MARK = 'Zq7canaryZq7';

  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ['an unknown kind', { kind: 'fax' }, `What the code does must be one of: ${QR_KINDS.map((entry) => entry.id).join(', ')}.`],
    ['no web address', { kind: 'url' }, 'Web address is required.'],
    ['a web address with a space', { kind: 'url', url: `https://example.com/${MARK} page` }, 'Web address cannot contain spaces.'],
    ['an address that is not the web', { kind: 'url', url: `ftp://${MARK}.example.com` }, 'Web address must begin with http:// or https://.'],
    ['a script instead of an address', { kind: 'url', url: `javascript:alert('${MARK}')` }, 'Web address is not a web address. Enter one such as https://example.com.'],
    ['an address with a password in it', { kind: 'url', url: `https://user:${MARK}@example.com` }, 'Web address is not a web address. Enter one such as https://example.com.'],
    ['a web address that is too long', { kind: 'url', url: `https://example.com/${MARK}${'a'.repeat(QR_LIMITS.url)}` }, `Web address is limited to ${QR_LIMITS.url} characters.`],
    ['no text', { kind: 'text', text: '   ' }, 'Text is required.'],
    ['too much text', { kind: 'text', text: MARK.repeat(200) }, `Text is limited to ${QR_LIMITS.text} characters.`],
    ['no network name', { kind: 'wifi', wifiPassword: `${MARK}pass` }, 'Network name is required.'],
    ['a network name longer than a router allows', { kind: 'wifi', ssid: `${MARK}${'x'.repeat(30)}`, wifiPassword: 'password1' }, 'Network name is limited to 32 bytes, which is what a Wi-Fi network name can hold.'],
    // 11 characters, but 33 bytes: each of these letters takes three bytes in UTF-8.
    ['a network name of 33 bytes', { kind: 'wifi', ssid: '你好世界你好世界你好世', wifiPassword: 'password1' }, 'Network name is limited to 32 bytes, which is what a Wi-Fi network name can hold.'],
    ['a WPA network without a password', { kind: 'wifi', ssid: 'Office' }, 'Password is required.'],
    ['a WPA password that is too short', { kind: 'wifi', ssid: 'Office', wifiPassword: 'Zq7can' }, 'A WPA password has 8 to 63 characters, or is a 64-digit hexadecimal key.'],
    ['a WPA password that is too long', { kind: 'wifi', ssid: 'Office', wifiPassword: `${MARK}${'x'.repeat(60)}` }, 'A WPA password has 8 to 63 characters, or is a 64-digit hexadecimal key.'],
    ['a WEP key of the wrong length', { kind: 'wifi', ssid: 'Office', wifiSecurity: 'WEP', wifiPassword: MARK }, 'A WEP key has 5 or 13 characters, or 10 or 26 hexadecimal digits.'],
    ['an unknown security type', { kind: 'wifi', ssid: 'Office', wifiSecurity: 'WPA9', wifiPassword: 'password1' }, 'Security must be one of: WPA, WEP, nopass.'],
    ['a contact without a first name', { kind: 'contact', lastName: MARK }, 'First name is required.'],
    ['a contact whose email is not one', { kind: 'contact', firstName: 'A', email: MARK }, 'Email does not look like an email address.'],
    ['an email to nobody', { kind: 'email', emailSubject: MARK }, 'Send to is required.'],
    ['an email to something that is not an address', { kind: 'email', emailTo: `${MARK}@nowhere` }, 'Send to does not look like an email address.'],
    ['a phone number with letters', { kind: 'phone', phoneNumber: `+234 ${MARK}` }, 'Phone number must be a phone number: 3 to 15 digits, with an optional + before the country code.'],
    ['a phone number that is too long', { kind: 'phone', phoneNumber: '+1234567890123456' }, 'Phone number must be a phone number: 3 to 15 digits, with an optional + before the country code.'],
    ['a text message to no number', { kind: 'sms', smsMessage: MARK }, 'Phone number is required.'],
    ['a WhatsApp number in national format', { kind: 'whatsapp', whatsappNumber: '0803 555 0142' }, 'WhatsApp number must be in international format: the country code and the number, without a leading 0. A Nigerian number begins 234.'],
    ['an event without a name', { kind: 'event', eventStart: '2026-12-12' }, 'Event name is required.'],
    ['an event without a date', { kind: 'event', eventTitle: MARK }, 'Start date is required.'],
    ['a date written another way', { kind: 'event', eventTitle: 'X', eventStart: '12/12/2026' }, 'Start date must be a date written as year-month-day, for example 2026-12-31.'],
    ['a date that is not on the calendar', { kind: 'event', eventTitle: 'X', eventStart: '2026-02-30' }, 'Start date is not a date on the calendar.'],
    ['29 February in a year that has none', { kind: 'event', eventTitle: 'X', eventStart: '2027-02-29' }, 'Start date is not a date on the calendar.'],
    ['a time that is not on the clock', { kind: 'event', eventTitle: 'X', eventStart: '2026-12-12', eventStartTime: '24:00' }, 'Start time must be a time on the 24-hour clock, for example 14:30.'],
    ['an end time without a start time', { kind: 'event', eventTitle: 'X', eventStart: '2026-12-12', eventEndTime: '10:00' }, 'End time needs a start time. Leave both empty for an all-day event.'],
    ['an event that ends before it starts', { kind: 'event', eventTitle: 'X', eventStart: '2026-12-12', eventStartTime: '10:00', eventEndTime: '09:00' }, 'The event ends before it starts. Check the end date and time.'],
    ['an all-day event that ends before it starts', { kind: 'event', eventTitle: 'X', eventStart: '2026-12-12', eventEnd: '2026-12-11' }, 'The event ends before it starts. Check the end date.'],
    ['a place without a latitude', { kind: 'location', longitude: 8 }, 'Latitude is required.'],
    ['a latitude off the globe', { kind: 'location', latitude: 90.5, longitude: 8 }, 'Latitude must be a number between -90 and 90.'],
    ['a longitude that is not a number', { kind: 'location', latitude: 9, longitude: MARK }, 'Longitude must be a number between -180 and 180.'],
    ['a profile name with a space', { kind: 'social', handle: `${MARK} name` }, 'Profile name is the name in your profile’s address: up to 60 letters, digits, dots, hyphens or underscores, without spaces.'],
    ['a profile address instead of a name', { kind: 'social', handle: `https://x.com/${MARK}` }, 'Profile name is the name in your profile’s address: up to 60 letters, digits, dots, hyphens or underscores, without spaces.'],
    ['an unknown platform', { kind: 'social', platform: 'myspace', handle: 'x' }, `Platform must be one of: ${QR_SOCIAL_PLATFORMS.map((entry) => entry.id).join(', ')}.`],
    ['a payment to nobody', { kind: 'payment', iban: 'DE89370400440532013000' }, 'Pay to (account holder) is required.'],
    ['a payment without an IBAN', { kind: 'payment', payeeName: MARK }, 'IBAN is required.'],
    ['an IBAN with a wrong digit', { kind: 'payment', payeeName: 'X', iban: 'DE89 3704 0044 0532 0130 01' }, 'IBAN is not valid: check each character. Its two check digits do not match the rest of the number.'],
    ['something that is not an IBAN', { kind: 'payment', payeeName: 'X', iban: MARK }, 'IBAN is not valid: check each character. Its two check digits do not match the rest of the number.'],
    ['a BIC of the wrong shape', { kind: 'payment', payeeName: 'X', iban: 'DE89370400440532013000', bic: 'Zq7' }, 'BIC must be 8 or 11 letters and digits, for example BKAUATWW. It can be left empty.'],
    ['an amount with three decimals', { kind: 'payment', payeeName: 'X', iban: 'DE89370400440532013000', amount: '10.999' }, 'Amount must be a sum in euros with at most two decimals, for example 49.90.'],
    ['an amount of nothing', { kind: 'payment', payeeName: 'X', iban: 'DE89370400440532013000', amount: '0' }, 'Amount must be between 0.01 and 999999999.99 euros.'],
    ['a negative amount', { kind: 'payment', payeeName: 'X', iban: 'DE89370400440532013000', amount: '-5' }, 'Amount must be a sum in euros with at most two decimals, for example 49.90.'],
    ['a reference and a message together', { kind: 'payment', payeeName: 'X', iban: 'DE89370400440532013000', paymentReference: 'RF18539007547034', paymentText: MARK }, 'Enter a payment reference or a message, not both: a SEPA payment code carries one of them.'],
    ['a creditor reference with wrong check digits', { kind: 'payment', payeeName: 'X', iban: 'DE89370400440532013000', paymentReference: 'RF19539007547034' }, 'Payment reference begins with RF, but its two check digits do not match the rest. Check it against your invoice.'],
    ['a reference with punctuation', { kind: 'payment', payeeName: 'X', iban: 'DE89370400440532013000', paymentReference: 'INV/2026-42' }, 'Payment reference may hold letters and digits only.'],
    ['an unknown code type', { kind: 'url', url: 'https://example.com', codeType: 'pdf417' }, 'Code type must be one of: qrcode, datamatrix, aztec.'],
    ['an unknown error correction level', { kind: 'url', url: 'https://example.com', eclevel: 'Z' }, 'Error correction must be one of: L, M, Q, H.'],
    ['a colour that is not one', { kind: 'url', url: 'https://example.com', color: 'blue' }, 'Code colour must be a colour such as #1a2b3c.'],
  ];

  it.each(refusals)('refuses %s', async (_label, input, message) => {
    const error = await refusal(input);
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe(message);
    // A refusal is logged, so it must not carry what was entered.
    expect(JSON.stringify({ message: error.message, detail: error.detail ?? null })).not.toContain(MARK);
  });

  it('carries the longest text it accepts, and refuses a payment that passes the format’s size', async () => {
    const text = 'lorem ipsum dolor sit amet, '.repeat(60).slice(0, QR_LIMITS.text).trim();
    expect(text.length).toBeGreaterThan(QR_LIMITS.text - 3);
    for (const codeType of ['qrcode', 'datamatrix', 'aztec']) {
      expect((await readPng(await make({ kind: 'text', text, codeType })))[0]?.text, codeType).toBe(text);
    }
    // 140 two-byte letters alone are 280 bytes; with the name and the rest the payload passes the format's 331.
    const tooLong = await refusal({ kind: 'payment', payeeName: 'N'.repeat(70), iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', amount: '999999999.99', paymentText: 'ä'.repeat(140) });
    expect(tooLong.message).toBe('A SEPA payment code holds 331 bytes at most. Shorten the account holder’s name or the message.');
    // The same fields in one-byte letters fit, and are read back whole.
    const fits = await make({ kind: 'payment', payeeName: 'N'.repeat(70), iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', amount: '999999999.99', paymentText: 'a'.repeat(140) });
    expect((await readPng(fits))[0]?.text).toBe(['BCD', '002', '1', 'SCT', 'COBADEFFXXX', 'N'.repeat(70), 'DE89370400440532013000', 'EUR999999999.99', '', '', 'a'.repeat(140)].join('\n'));
  });

  it('labels a signed-in caller’s history by the kind of code and never by its content', () => {
    for (const kind of QR_KINDS) {
      const target = targetFor(SLUG, { kind: kind.id, url: `https://${MARK}.example`, text: MARK, ssid: MARK, wifiPassword: MARK, firstName: MARK, emailTo: `${MARK}@x.ng`, phoneNumber: MARK, payeeName: MARK, iban: MARK, handle: MARK });
      expect(target, kind.id).toBe(`QR code for ${kind.noun}`);
      expect(target ?? '', kind.id).not.toContain(MARK);
    }
    expect(targetFor(SLUG, {})).toBe('QR code for a website link');
    expect(targetFor(SLUG, { kind: MARK })).toBe('QR code');
  });
});

/* ------------------------------------------------------------------ */
/* Form and catalogue                                                  */
/* ------------------------------------------------------------------ */

describe('the form', () => {
  const form = STUDIO_FORMS[SLUG];
  const names = (values: StudioValues): string[] => form.sections.flatMap((section) => visibleStudioFields(form, section, values)).map((field) => field.name);

  it('offers every kind, and for each kind an example the tool accepts and a decoder reads', async () => {
    const kindField = studioFields(form).find((field) => field.name === 'kind');
    expect(kindField?.options?.map((entry) => entry.value)).toEqual(QR_KINDS.map((entry) => entry.id));
    for (const kind of QR_KINDS) {
      const values = studioExample(form, applyStudioChange(form, studioDefaults(form), 'kind', kind.id));
      const input = buildStudioInput(form, values);
      expect(input.kind, kind.id).toBe(kind.id);
      const result = await make(input);
      const [read] = await readPng(result);
      expect(read?.format, kind.id).toBe('QRCode');
      // The result shows what the code carries; a Wi-Fi password is the one thing it hides.
      const shown = (read?.text ?? '').replace(/\r?\n/g, ' ↵ ');
      if (kind.id === 'wifi') expect(fact(result, 'The code carries'), kind.id).toBe('WIFI:T:WPA;S:CloudHost247 Guest;P:••••••••;;');
      else expect(fact(result, 'The code carries'), kind.id).toBe(shown.length > 400 ? `${shown.slice(0, 399)}…` : shown);
    }
  });

  it('shows the fields of the chosen kind and no others', () => {
    const own: Record<QrKind, string[]> = {
      url: ['url'],
      text: ['text'],
      wifi: ['ssid', 'wifiSecurity', 'wifiPassword', 'wifiHidden'],
      contact: ['firstName', 'lastName', 'jobTitle', 'organization', 'email', 'phone', 'mobile', 'website', 'street', 'city', 'region', 'postalCode', 'country', 'contactFormat'],
      email: ['emailTo', 'emailSubject', 'emailBody'],
      phone: ['phoneNumber'],
      sms: ['smsNumber', 'smsMessage'],
      whatsapp: ['whatsappNumber', 'whatsappMessage'],
      event: ['eventTitle', 'eventStart', 'eventStartTime', 'eventEnd', 'eventEndTime', 'eventPlace', 'eventNotes'],
      location: ['latitude', 'longitude', 'mapFormat'],
      social: ['platform', 'handle'],
      payment: ['payeeName', 'iban', 'bic', 'amount', 'paymentText', 'paymentReference'],
    };
    const always = ['kind', 'codeType', 'eclevel', 'moduleMm', 'dpi', 'color', 'background', 'transparent'];
    for (const kind of QR_KINDS) {
      const visible = names(applyStudioChange(form, studioDefaults(form), 'kind', kind.id));
      expect([...visible].sort(), kind.id).toEqual([...always, ...own[kind.id]].sort());
    }
    // Every field of the form belongs to exactly one of those lists.
    expect(studioFields(form).map((field) => field.name).sort()).toEqual([...always, ...Object.values(own).flat()].sort());
  });

  it('offers a SEPA payment as a QR Code only, and hides error correction for the other code types', () => {
    const payment = applyStudioChange(form, { ...studioDefaults(form), codeType: 'aztec' }, 'kind', 'payment');
    expect(payment.codeType).toBe('qrcode');
    const codeType = form.sections.flatMap((section) => visibleStudioFields(form, section, payment)).find((field) => field.name === 'codeType');
    expect(codeType?.options?.map((entry) => entry.value)).toEqual(['qrcode']);
    const matrix = applyStudioChange(form, studioDefaults(form), 'codeType', 'datamatrix');
    expect(names(matrix)).not.toContain('eclevel');
    expect(buildStudioInput(form, { ...matrix, url: 'https://example.com' })).not.toHaveProperty('eclevel');
  });

  it('states the limits the tool enforces', () => {
    const field = (name: string) => studioFields(form).find((entry) => entry.name === name);
    expect([field('url')?.maxLength, field('text')?.maxLength, field('ssid')?.maxLength, field('payeeName')?.maxLength, field('paymentText')?.maxLength, field('paymentReference')?.maxLength]).toEqual([
      QR_LIMITS.url, QR_LIMITS.text, QR_LIMITS.ssid, QR_LIMITS.payeeName, QR_LIMITS.paymentText, QR_LIMITS.paymentReference,
    ]);
    expect([field('eventStart')?.type, field('eventStartTime')?.type]).toEqual(['date', 'time']);
    expect([field('moduleMm')?.min, field('moduleMm')?.max]).toEqual([0.25, 3]);
  });
});

describe('the catalogue entry', () => {
  const entry = TOOL_CATALOG.find((tool) => tool.slug === SLUG);

  it('is a public, POST-only tool that is never cached, and says what it cannot promise', () => {
    expect(entry).toMatchObject({ name: 'QR Code Maker', path: '/tools/qr-code-maker', apiPath: '/api/tools/qr-code-maker', methods: ['POST'], authRequired: false, visibility: 'public', cacheSeconds: 0 });
    const notes = (entry?.notes ?? []).join(' ');
    expect(notes).toMatch(/read back by an independent decoder/);
    expect(notes).toMatch(/A Wi-Fi code contains the network password/);
    expect(notes).toMatch(/does not check that an account exists/);
    // Every kind the summary and description name is one the tool makes.
    for (const word of ['link', 'Wi-Fi', 'contact', 'WhatsApp', 'event', 'SEPA']) expect(entry?.summary, word).toContain(word);
  });
});
