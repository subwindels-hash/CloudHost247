/**
 * What a 2D code has to carry for a phone to do something with it.
 *
 * A camera app decides what to offer (open a page, join a network, save a contact) from the first
 * characters of the payload, so each builder here writes the format phones recognise and nothing
 * looser: reserved characters are escaped by the rules of that format, and a value that the format
 * cannot hold is refused instead of being written in a way a phone would misread.
 *
 * Messages name the form field and never repeat what was entered: a refusal is written to the
 * execution log, and a Wi-Fi password, a phone number or an IBAN must not be.
 */

import { invalidInput } from '../../core/errors';
import type { ToolInput } from '../../handlers/kit';
import { CARD_FIELDS, QR_CONTACT_FORMATS, QR_KINDS, QR_LIMITS, QR_MAP_FORMATS, QR_SOCIAL_PLATFORMS, QR_WIFI_SECURITY, type QrKind } from '../definitions';
import { buildContactVCard, buildMeCard, emptyContact, type ContactFields } from './contact';
import { choiceOf, fieldText, flag } from './input';

export interface QrContent {
  kind: QrKind;
  /** Exactly what the code carries. */
  payload: string;
  /** The payload as it may be shown on a screen: a Wi-Fi password is replaced by dots. */
  shown: string;
  /** What a person should know before relying on the code. */
  notices: string[];
  /** A contact code also offers its contact as a file. */
  vcard?: string;
  /** A SEPA payment code is a QR Code at error correction level M by its standard. */
  fixed?: { symbology: 'qrcode'; eclevel: 'M' };
}

/* ------------------------------------------------------------------ */
/* Reading fields                                                      */
/* ------------------------------------------------------------------ */

// Everything below U+0020 except tab and line feed, plus DEL.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * Text kept as it was typed. Line breaks and inner spacing are content here (a message, a password),
 * so only carriage returns and stray control characters are removed.
 */
function exactText(input: ToolInput, name: string, label: string, maxLength: number, options: { required?: boolean; trim?: boolean } = {}): string {
  const raw = input[name];
  if (raw === undefined || raw === null || raw === '') {
    if (options.required) throw invalidInput(`${label} is required.`);
    return '';
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') throw invalidInput(`${label} must be text.`);
  let text = String(raw).replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '');
  if (options.trim !== false) text = text.replace(/^\s+|\s+$/g, '');
  if (text === '') {
    if (options.required) throw invalidInput(`${label} is required.`);
    return '';
  }
  if (text.length > maxLength) throw invalidInput(`${label} is limited to ${maxLength} characters.`);
  return text;
}

const line = (input: ToolInput, name: string, label: string, maxLength: number, required = false): string =>
  fieldText(input, { name, label, maxLength, ...(required ? { required: true } : {}) });

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/* ------------------------------------------------------------------ */
/* Shared value rules                                                  */
/* ------------------------------------------------------------------ */

/** A web address as it was typed, with https:// added when it has no scheme. */
export function webAddress(value: string, label: string): string {
  if (/\s/.test(value)) throw invalidInput(`${label} cannot contain spaces.`);
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw invalidInput(`${label} is not a web address. Enter one such as https://example.com.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw invalidInput(`${label} must begin with http:// or https://.`);
  if (parsed.hostname === '' || parsed.username !== '' || parsed.password !== '') throw invalidInput(`${label} is not a web address. Enter one such as https://example.com.`);
  return candidate;
}

/** A phone number reduced to an optional + and its digits. */
export function phoneNumber(value: string, label: string): string {
  const compact = value.replace(/[\s().-]/g, '');
  if (!/^\+?\d{3,15}$/.test(compact)) throw invalidInput(`${label} must be a phone number: 3 to 15 digits, with an optional + before the country code.`);
  return compact;
}

export function looksLikeEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** The remainder modulo 97 of a string of digits and capital letters, a letter counting as 10 to 35. */
function mod97(text: string): number {
  let remainder = 0;
  for (const character of text) {
    const value = character >= 'A' ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/** ISO 13616: with its first four characters moved to the end, an IBAN is 1 modulo 97. */
export function isValidIban(iban: string): boolean {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) && mod97(`${iban.slice(4)}${iban.slice(0, 4)}`) === 1;
}

/** ISO 11649 creditor reference: "RF", two check digits, up to 21 letters and digits; checked like an IBAN. */
export function isValidCreditorReference(reference: string): boolean {
  return /^RF\d{2}[A-Z0-9]{1,21}$/.test(reference) && mod97(`${reference.slice(4)}${reference.slice(0, 4)}`) === 1;
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function urlContent(input: ToolInput): QrContent {
  const payload = webAddress(exactText(input, 'url', 'Web address', QR_LIMITS.url, { required: true }), 'Web address');
  return { kind: 'url', payload, shown: payload, notices: [] };
}

function textContent(input: ToolInput): QrContent {
  const payload = exactText(input, 'text', 'Text', QR_LIMITS.text, { required: true });
  return { kind: 'text', payload, shown: payload, notices: [] };
}

/** `\`, `;`, `,`, `"` and `:` are the Wi-Fi format's own punctuation and are written with a backslash. */
function wifiValue(value: string, rawKey: boolean): string {
  const escaped = value.replace(/([\\;,":])/g, '\\$1');
  // A name or password made only of hexadecimal digits would be read as a raw key, so it is quoted.
  return !rawKey && /^[0-9A-Fa-f]+$/.test(value) ? `"${escaped}"` : escaped;
}

function wifiContent(input: ToolInput): QrContent {
  const ssid = exactText(input, 'ssid', 'Network name', 200, { required: true, trim: false });
  if (ssid.includes('\n')) throw invalidInput('Network name must be a single line.');
  if (utf8Length(ssid) > QR_LIMITS.ssid) throw invalidInput(`Network name is limited to ${QR_LIMITS.ssid} bytes, which is what a Wi-Fi network name can hold.`);
  const security = choiceOf(input, 'wifiSecurity', 'Security', QR_WIFI_SECURITY.map((entry) => entry.id), 'WPA');
  const hidden = flag(input, 'wifiHidden', false);
  let passwordPart = '';
  let shownPassword = '';
  let edgeSpace = ssid !== ssid.trim();
  if (security !== 'nopass') {
    const password = exactText(input, 'wifiPassword', 'Password', 200, { required: true, trim: false });
    if (password.includes('\n')) throw invalidInput('Password must be a single line.');
    edgeSpace = edgeSpace || password !== password.trim();
    const hex = /^[0-9A-Fa-f]+$/.test(password);
    let rawKey = false;
    if (security === 'WPA') {
      rawKey = hex && password.length === 64;
      if (!rawKey && (password.length < 8 || password.length > QR_LIMITS.wifiPassword)) {
        throw invalidInput(`A WPA password has 8 to ${QR_LIMITS.wifiPassword} characters, or is a 64-digit hexadecimal key.`);
      }
    } else {
      rawKey = hex && (password.length === 10 || password.length === 26);
      if (!rawKey && password.length !== 5 && password.length !== 13) {
        throw invalidInput('A WEP key has 5 or 13 characters, or 10 or 26 hexadecimal digits.');
      }
    }
    passwordPart = `P:${wifiValue(password, rawKey)};`;
    shownPassword = `P:${'•'.repeat(8)};`;
  }
  const head = `WIFI:T:${security};S:${wifiValue(ssid, false)};`;
  const tail = `${hidden ? 'H:true;' : ''};`;
  return {
    kind: 'wifi',
    payload: `${head}${passwordPart}${tail}`,
    shown: `${head}${shownPassword}${tail}`,
    notices: [
      security === 'nopass' ? 'This network has no password: the code only saves people typing its name.' : 'Anyone who scans this code can join the network. Put it where your guests are, not where passers-by are.',
      // A network name and a password are carried exactly as typed, so a stray space would make the code fail without a visible reason.
      ...(edgeSpace ? ['The network name or the password begins or ends with a space, and the code carries it exactly as typed. Remove the space unless it is really part of it.'] : []),
      ...(`${head}${passwordPart}`.includes(':"')
        ? ['The network name or the password consists only of the characters 0 to 9 and A to F, so the code writes it in quotation marks, as the Wi-Fi code format asks, to keep it from being read as a hexadecimal key. Test the code with the phones your guests use.']
        : []),
    ],
  };
}

function contactContent(input: ToolInput): QrContent {
  const format = choiceOf(input, 'contactFormat', 'Contact format', QR_CONTACT_FORMATS.map((entry) => entry.id), 'vcard');
  const contact: ContactFields = emptyContact();
  for (const field of CARD_FIELDS) {
    (contact as unknown as Record<string, string>)[field.name] = line(input, field.name, field.label, field.maxLength, field.required === true);
  }
  if (contact.email !== '' && !looksLikeEmail(contact.email)) throw invalidInput('Email does not look like an email address.');
  const vcard = buildContactVCard(contact);
  const payload = format === 'mecard' ? buildMeCard(contact) : vcard;
  return { kind: 'contact', payload, shown: payload, notices: [], vcard };
}

function emailContent(input: ToolInput): QrContent {
  const to = line(input, 'emailTo', 'Send to', 254, true);
  if (!looksLikeEmail(to)) throw invalidInput('Send to does not look like an email address.');
  const subject = line(input, 'emailSubject', 'Subject', QR_LIMITS.subject);
  const body = exactText(input, 'emailBody', 'Message', QR_LIMITS.message);
  // RFC 6068: the address keeps its @, everything else is percent-encoded, and a line break is CRLF.
  const query = [...(subject !== '' ? [`subject=${encodeURIComponent(subject)}`] : []), ...(body !== '' ? [`body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`] : [])].join('&');
  const payload = `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}${query !== '' ? `?${query}` : ''}`;
  return { kind: 'email', payload, shown: payload, notices: [] };
}

function phoneContent(input: ToolInput): QrContent {
  const payload = `tel:${phoneNumber(line(input, 'phoneNumber', 'Phone number', 40, true), 'Phone number')}`;
  return { kind: 'phone', payload, shown: payload, notices: [] };
}

function smsContent(input: ToolInput): QrContent {
  const number = phoneNumber(line(input, 'smsNumber', 'Phone number', 40, true), 'Phone number');
  const message = exactText(input, 'smsMessage', 'Message', QR_LIMITS.message);
  const payload = `SMSTO:${number}:${message}`;
  return { kind: 'sms', payload, shown: payload, notices: [] };
}

function whatsappContent(input: ToolInput): QrContent {
  const number = phoneNumber(line(input, 'whatsappNumber', 'WhatsApp number', 40, true), 'WhatsApp number').replace(/^\+/, '');
  if (number.length < 7 || number.startsWith('0')) {
    throw invalidInput('WhatsApp number must be in international format: the country code and the number, without a leading 0. A Nigerian number begins 234.');
  }
  const message = exactText(input, 'whatsappMessage', 'Message', QR_LIMITS.message);
  const payload = `https://wa.me/${number}${message !== '' ? `?text=${encodeURIComponent(message)}` : ''}`;
  return { kind: 'whatsapp', payload, shown: payload, notices: [] };
}

interface Moment {
  year: number;
  month: number;
  day: number;
  hour: number | null;
  minute: number | null;
}

function dateOf(value: string, label: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw invalidInput(`${label} must be a date written as year-month-day, for example 2026-12-31.`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (year < 1970 || year > 2100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw invalidInput(`${label} is not a date on the calendar.`);
  }
  return { year, month, day };
}

function timeOf(value: string, label: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hour = match ? Number(match[1]) : Number.NaN;
  const minute = match ? Number(match[2]) : Number.NaN;
  if (!match || hour > 23 || minute > 59) throw invalidInput(`${label} must be a time on the 24-hour clock, for example 14:30.`);
  return { hour, minute };
}

const two = (value: number): string => String(value).padStart(2, '0');
const stampDate = (moment: { year: number; month: number; day: number }): string => `${moment.year}${two(moment.month)}${two(moment.day)}`;
const asUtc = (moment: Moment): number => Date.UTC(moment.year, moment.month - 1, moment.day, moment.hour ?? 0, moment.minute ?? 0);

function fromUtc(milliseconds: number, timed: boolean): Moment {
  const date = new Date(milliseconds);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: timed ? date.getUTCHours() : null, minute: timed ? date.getUTCMinutes() : null };
}

/** RFC 5545 text: backslash, semicolon and comma are escaped and a line break is written as \n. */
const calendarText = (value: string): string => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function eventContent(input: ToolInput): QrContent {
  const title = line(input, 'eventTitle', 'Event name', QR_LIMITS.eventTitle, true);
  const startDate = dateOf(line(input, 'eventStart', 'Start date', 10, true), 'Start date');
  const startTimeText = line(input, 'eventStartTime', 'Start time', 5);
  const endDateText = line(input, 'eventEnd', 'End date', 10);
  const endTimeText = line(input, 'eventEndTime', 'End time', 5);
  const place = line(input, 'eventPlace', 'Place', QR_LIMITS.eventPlace);
  const notes = exactText(input, 'eventNotes', 'Notes', QR_LIMITS.eventNotes);

  const timed = startTimeText !== '';
  if (!timed && endTimeText !== '') throw invalidInput('End time needs a start time. Leave both empty for an all-day event.');
  const start: Moment = { ...startDate, ...(timed ? timeOf(startTimeText, 'Start time') : { hour: null, minute: null }) };
  const endDate = endDateText !== '' ? dateOf(endDateText, 'End date') : startDate;

  let startStamp: string;
  let endStamp: string;
  if (timed) {
    // Without an end time the event lasts an hour on its day, or ends at the same time on its last day.
    const sameDay = stampDate(endDate) === stampDate(startDate);
    const end: Moment = endTimeText !== '' ? { ...endDate, ...timeOf(endTimeText, 'End time') } : sameDay ? fromUtc(asUtc(start) + 3_600_000, true) : { ...endDate, hour: start.hour, minute: start.minute };
    if (asUtc(end) < asUtc(start)) throw invalidInput('The event ends before it starts. Check the end date and time.');
    startStamp = `DTSTART:${stampDate(start)}T${two(start.hour ?? 0)}${two(start.minute ?? 0)}00`;
    endStamp = `DTEND:${stampDate(end)}T${two(end.hour ?? 0)}${two(end.minute ?? 0)}00`;
  } else {
    const last: Moment = { ...endDate, hour: null, minute: null };
    if (asUtc(last) < asUtc(start)) throw invalidInput('The event ends before it starts. Check the end date.');
    // An all-day event ends on the day after its last day: the end of a calendar date range is exclusive.
    startStamp = `DTSTART;VALUE=DATE:${stampDate(start)}`;
    endStamp = `DTEND;VALUE=DATE:${stampDate(fromUtc(asUtc(last) + 86_400_000, false))}`;
  }

  const lines = ['BEGIN:VEVENT', `SUMMARY:${calendarText(title)}`, startStamp, endStamp];
  if (place !== '') lines.push(`LOCATION:${calendarText(place)}`);
  if (notes !== '') lines.push(`DESCRIPTION:${calendarText(notes)}`);
  lines.push('END:VEVENT');
  const payload = lines.join('\r\n');
  return {
    kind: 'event',
    payload,
    shown: payload,
    notices: timed ? ['The times carry no time zone, so a phone reads them in its own local time. That suits an event people attend in person.'] : [],
  };
}

function coordinate(input: ToolInput, name: string, label: string, limit: number): string {
  const raw = input[name];
  if (raw === undefined || raw === null || raw === '') throw invalidInput(`${label} is required.`);
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(value) || Math.abs(value) > limit) throw invalidInput(`${label} must be a number between -${limit} and ${limit}.`);
  // Six decimals is about a tenth of a metre; more would be noise, and trailing zeros are dropped.
  return String(Number(value.toFixed(6)));
}

function locationContent(input: ToolInput): QrContent {
  const latitude = coordinate(input, 'latitude', 'Latitude', 90);
  const longitude = coordinate(input, 'longitude', 'Longitude', 180);
  const format = choiceOf(input, 'mapFormat', 'Format', QR_MAP_FORMATS.map((entry) => entry.id), 'link');
  const payload = format === 'geo' ? `geo:${latitude},${longitude}` : `https://maps.google.com/?q=${latitude},${longitude}`;
  return {
    kind: 'location',
    payload,
    shown: payload,
    notices: format === 'geo' ? ['A geo: code relies on the scanning app to pass the coordinates to a maps app. A map link is a web address and opens wherever a browser does.'] : [],
  };
}

function socialContent(input: ToolInput): QrContent {
  const platformId = choiceOf(input, 'platform', 'Platform', QR_SOCIAL_PLATFORMS.map((entry) => entry.id), 'facebook');
  const platform = QR_SOCIAL_PLATFORMS.find((entry) => entry.id === platformId) ?? QR_SOCIAL_PLATFORMS[0];
  const handle = line(input, 'handle', 'Profile name', QR_LIMITS.handle + 1, true).replace(/^@/, '');
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(handle)) {
    throw invalidInput(`Profile name is the name in your profile’s address: up to ${QR_LIMITS.handle} letters, digits, dots, hyphens or underscores, without spaces.`);
  }
  const payload = platform.url.replace('{handle}', handle);
  return { kind: 'social', payload, shown: payload, notices: [] };
}

function paymentContent(input: ToolInput): QrContent {
  const name = line(input, 'payeeName', 'Pay to (account holder)', QR_LIMITS.payeeName, true);
  const iban = line(input, 'iban', 'IBAN', 42, true).replace(/\s+/g, '').toUpperCase();
  if (!isValidIban(iban)) throw invalidInput('IBAN is not valid: check each character. Its two check digits do not match the rest of the number.');
  const bic = line(input, 'bic', 'BIC', 11).replace(/\s+/g, '').toUpperCase();
  if (bic !== '' && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) throw invalidInput('BIC must be 8 or 11 letters and digits, for example BKAUATWW. It can be left empty.');

  let amountLine = '';
  const amountRaw = input.amount;
  if (amountRaw !== undefined && amountRaw !== null && amountRaw !== '') {
    const amountText = String(amountRaw).trim().replace(',', '.');
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amountText)) throw invalidInput('Amount must be a sum in euros with at most two decimals, for example 49.90.');
    const amount = Number(amountText);
    if (amount < 0.01 || amount > 999_999_999.99) throw invalidInput('Amount must be between 0.01 and 999999999.99 euros.');
    amountLine = `EUR${amount.toFixed(2)}`;
  }

  const reference = line(input, 'paymentReference', 'Payment reference', QR_LIMITS.paymentReference).replace(/\s+/g, '').toUpperCase();
  const message = line(input, 'paymentText', 'Message to the payee', QR_LIMITS.paymentText);
  if (reference !== '' && message !== '') throw invalidInput('Enter a payment reference or a message, not both: a SEPA payment code carries one of them.');
  if (reference !== '' && !/^[A-Z0-9]+$/.test(reference)) throw invalidInput('Payment reference may hold letters and digits only.');
  if (reference.startsWith('RF') && !isValidCreditorReference(reference)) {
    throw invalidInput('Payment reference begins with RF, but its two check digits do not match the rest. Check it against your invoice.');
  }

  // EPC069-12: service tag, version 002 (the BIC is optional), UTF-8, SEPA credit transfer; then the
  // BIC, name, IBAN, amount, purpose, structured reference, unstructured text and a note to the payer.
  const lines = ['BCD', '002', '1', 'SCT', bic, name, iban, amountLine, '', reference, message, ''];
  while (lines[lines.length - 1] === '') lines.pop();
  const payload = lines.join('\n');
  if (utf8Length(payload) > QR_LIMITS.paymentBytes) {
    throw invalidInput(`A SEPA payment code holds ${QR_LIMITS.paymentBytes} bytes at most. Shorten the account holder’s name or the message.`);
  }
  return {
    kind: 'payment',
    payload,
    shown: payload,
    notices: [
      'Scan the code with your own banking app and check the name, IBAN and amount before you give it to anyone. A banking app decides whether it accepts the code; this tool is not a bank and does not check that the account exists.',
      ...(amountLine === '' ? ['No amount is set, so the payer enters it.'] : []),
    ],
    fixed: { symbology: 'qrcode', eclevel: 'M' },
  };
}

const BUILDERS: Record<QrKind, (input: ToolInput) => QrContent> = {
  url: urlContent,
  text: textContent,
  wifi: wifiContent,
  contact: contactContent,
  email: emailContent,
  phone: phoneContent,
  sms: smsContent,
  whatsapp: whatsappContent,
  event: eventContent,
  location: locationContent,
  social: socialContent,
  payment: paymentContent,
};

/** The kind of code a request asks for. */
export function qrKindOf(input: ToolInput): QrKind {
  return choiceOf(input, 'kind', 'What the code does', QR_KINDS.map((entry) => entry.id), 'url');
}

export function buildQrContent(input: ToolInput): QrContent {
  return BUILDERS[qrKindOf(input)](input);
}
