/**
 * Tools Center — QR tools (spec §54 generator, §55 scanner, §56 WiFi QR).
 *
 * Generation and decoding are real: `qrcode` is a pure-JavaScript encoder and `jsqr` a pure-JavaScript
 * decoder, so nothing here needs a native toolchain (the constraint that shaped the rest of this
 * platform — see docs/CPANEL_DEPLOYMENT.md). The scanner decodes the uploaded IMAGE locally and
 * never fetches, opens or follows whatever the QR code contains: a QR code pointed at a phishing URL
 * is reported as text with a warning, not visited.
 */
import { invalidInput, ToolError } from '../core/errors';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const MAX_QR_INPUT = 2000;
const MAX_SCAN_BASE64 = 4 * 1024 * 1024; // ~3 MB image
const MAX_SCAN_DIMENSION = 4096;

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface QrGenerateInput {
  content: string;
  errorCorrectionLevel?: QrErrorCorrection;
  size?: number;
  margin?: number;
  dark?: string;
  light?: string;
  format?: 'svg' | 'png';
}

export interface QrGenerateResult {
  payload: string;
  contentType: string;
  format: 'svg' | 'png';
  svg: string | null;
  dataUrl: string | null;
  matrix: { modules: number; version: number | null };
  options: { errorCorrectionLevel: QrErrorCorrection; size: number; margin: number; dark: string; light: string };
  warnings: string[];
  notes: string[];
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export async function qrGenerate(input: QrGenerateInput): Promise<QrGenerateResult> {
  const content = input.content ?? '';
  if (content.length === 0) throw invalidInput('Enter the content to encode.');
  if (content.length > MAX_QR_INPUT) throw invalidInput(`QR content is limited to ${MAX_QR_INPUT} characters; use a short URL for very long text.`);

  const errorCorrectionLevel = input.errorCorrectionLevel ?? 'M';
  if (!['L', 'M', 'Q', 'H'].includes(errorCorrectionLevel)) throw invalidInput('Error correction must be L, M, Q or H.');
  const size = Math.min(Math.max(input.size ?? 512, 64), 2048);
  const margin = Math.min(Math.max(input.margin ?? 2, 0), 16);
  const dark = input.dark ?? '#000000';
  const light = input.light ?? '#ffffff';
  if (!HEX_COLOR.test(dark) || !HEX_COLOR.test(light)) throw invalidInput('Colours must be six-digit hex values such as #000000.');

  const warnings: string[] = [];
  if (errorCorrectionLevel === 'H' && content.length > 1000) {
    warnings.push('Error correction level H uses more modules; a long payload may produce a dense code that low-resolution cameras struggle with.');
  }

  const options = {
    errorCorrectionLevel,
    margin,
    width: size,
    color: { dark, light },
  };

  const format = input.format ?? 'svg';
  let svg: string | null = null;
  let dataUrl: string | null = null;

  try {
    if (format === 'svg') {
      svg = await QRCode.toString(content, { ...options, type: 'svg' });
    } else {
      dataUrl = await QRCode.toDataURL(content, { ...options, type: 'image/png' });
    }
  } catch (error) {
    throw new ToolError('INVALID_INPUT', `The QR code could not be generated: ${error instanceof Error ? error.message : 'the payload is too large for the selected error correction level.'}`);
  }

  return {
    payload: content,
    contentType: classifyQrContent(content).type,
    format,
    svg,
    dataUrl,
    matrix: { modules: estimateModules(content, errorCorrectionLevel), version: null },
    options: { errorCorrectionLevel, size, margin, dark, light },
    warnings,
    notes: [
      'The image encodes exactly the text you provided. The submitted text is processed on the CloudHost247 server and the image is returned inline; it is not sent to a third-party QR service.',
      'Error correction level: L recovers ~7%, M ~15%, Q ~25%, H ~30% of the code. Higher levels survive damage and logos better but make the code denser.',
      'Keep a quiet zone (the margin) clear, and test the printed code with a phone at the intended distance and size.',
      estimateModules(content, errorCorrectionLevel) > 57 ? 'This payload needs a dense code (version 10 or above); print it larger than 3 cm and avoid curved surfaces.' : 'This payload fits a low-density code that prints reliably at small sizes.',
    ],
  };
}

/** Rough module count estimate used only for the "will this print reliably" hint. */
function estimateModules(content: string, level: QrErrorCorrection): number {
  const bytes = Buffer.byteLength(content, 'utf8');
  const capacityPerVersion: Record<QrErrorCorrection, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 };
  const capacity = capacityPerVersion[level];
  const ratio = Math.min(bytes / capacity, 1);
  // Version 1 is 21 modules; version 40 is 177. Linear interpolation is deliberate: this is a hint.
  return Math.round(21 + ratio * (177 - 21));
}

// ---------------------------------------------------------------------------------------------
// §56 WiFi QR
// ---------------------------------------------------------------------------------------------

export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';

export interface WifiQrInput {
  ssid: string;
  password?: string;
  security?: WifiSecurity;
  hidden?: boolean;
  errorCorrectionLevel?: QrErrorCorrection;
  size?: number;
  format?: 'svg' | 'png';
}

export interface WifiQrResult {
  payload: string;
  ssid: string;
  security: WifiSecurity;
  hidden: boolean;
  qr: QrGenerateResult;
  warnings: string[];
  notes: string[];
}

/** ZXing's WIFI: escaping rules: backslash-escape \ ; , : and ". */
export function escapeWifiValue(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

export async function wifiQr(input: WifiQrInput): Promise<WifiQrResult> {
  const ssid = (input.ssid ?? '').trim();
  if (ssid.length === 0) throw invalidInput('Enter the WiFi network name (SSID).');
  if (ssid.length > 64) throw invalidInput('An SSID is at most 64 characters (32 bytes UTF-8 for best compatibility).');
  const security: WifiSecurity = input.security ?? 'WPA';
  if (!['WPA', 'WEP', 'nopass'].includes(security)) throw invalidInput('Security type must be WPA, WEP or nopass.');

  const warnings: string[] = [];
  const password = input.password ?? '';
  if (security !== 'nopass') {
    if (password.length === 0) throw invalidInput('Enter the network password, or choose "open network" (nopass).');
    if (password.length > 63) throw invalidInput('A WPA passphrase is 8–63 characters.');
    if (password.length < 8 && security === 'WPA') warnings.push('WPA passphrases shorter than 8 characters are usually rejected by devices.');
  } else if (password.length > 0) {
    warnings.push('A password was supplied for an open network; it was ignored.');
  }
  if (security === 'WEP') warnings.push('WEP is broken and should not be used for anything. The code still encodes it because old devices require it.');

  const payload = `WIFI:T:${security};S:${escapeWifiValue(ssid)};${security === 'nopass' ? '' : `P:${escapeWifiValue(password)};`}${input.hidden ? 'H:true;' : ''};`;

  const qr = await qrGenerate({
    content: payload,
    errorCorrectionLevel: input.errorCorrectionLevel ?? 'M',
    size: input.size ?? 512,
    format: input.format ?? 'svg',
    margin: 3,
  });

  return {
    payload,
    ssid,
    security,
    hidden: input.hidden ?? false,
    qr,
    warnings,
    notes: [
      'Anyone who can see the finished QR image can read the WiFi password — printing it exposes the password to everyone in the room. Use a guest network for public spaces.',
      'The payload follows the ZXing WIFI: format that iOS and Android both understand. Values are backslash-escaped where required by that format.',
      'WPA2/WPA3 and WPA are all encoded as "WPA" in this format; the distinction is made by the access point, not by the QR code.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// §55 QR scanner
// ---------------------------------------------------------------------------------------------

export interface QrScanInput {
  /** `data:image/png;base64,…` or the bare Base64 PNG payload. */
  image: string;
}

export interface QrScanResult {
  found: boolean;
  text: string | null;
  contentType: { type: string; detail: string; warnings: string[] };
  location: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomLeft: { x: number; y: number }; bottomRight: { x: number; y: number } } | null;
  version: number | null;
  image: { width: number; height: number; bytes: number };
  notes: string[];
}

const URL_SHORTENERS = new Set(['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 's.id', 'rebrand.ly']);

/** Describes what a QR payload is — without ever visiting it. */
export function classifyQrContent(content: string): { type: string; detail: string; warnings: string[] } {
  const warnings: string[] = [];
  const trimmed = content.trim();

  const url = /^https?:\/\//i.exec(trimmed);
  if (url) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { type: 'url-malformed', detail: 'The text starts with http(s):// but is not a parseable URL.', warnings: ['A malformed URL in a QR code is a common way to hide a destination from a casual glance.'] };
    }
    if (parsed.username || parsed.password) {
      warnings.push('The URL contains credentials (user:password@host). Legitimate services do not embed logins in a URL like this.');
    }
    if (URL_SHORTENERS.has(parsed.hostname.toLowerCase())) {
      warnings.push('This is a link shortener, so the real destination is hidden. Expand it with a link-expansion service before opening it.');
    }
    if (parsed.protocol === 'http:') warnings.push('The link is plain HTTP, not HTTPS.');
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname) || parsed.hostname.includes(':')) {
      warnings.push('The link points at a raw IP address rather than a domain name.');
    }
    if (/@/.test(parsed.hostname) || /xn--/i.test(parsed.hostname)) {
      warnings.push('The hostname contains an @ sign or punycode (xn--) sequence; check it carefully for a homograph or parsing trick.');
    }
    return { type: 'url', detail: `An HTTP(S) link to ${parsed.hostname}${parsed.pathname}`, warnings };
  }

  if (/^WIFI:/i.test(trimmed)) {
    const ssid = /S:((?:\\.|[^;])*)/i.exec(trimmed)?.[1]?.replace(/\\(.)/g, '$1') ?? 'unknown';
    const security = /T:([^;]*)/i.exec(trimmed)?.[1] ?? 'WPA';
    return { type: 'wifi', detail: `WiFi network "${ssid}" (${security}). This payload contains a network name and, usually, a password.`, warnings: ['Scanning a WiFi QR joins a network chosen by whoever printed it. Only use codes from a source you trust.'] };
  }
  if (/^mailto:/i.test(trimmed)) return { type: 'email', detail: 'An e-mail address (mailto: link).', warnings: [] };
  if (/^(?:tel|sms|smsto):/i.test(trimmed)) return { type: 'phone', detail: 'A telephone or SMS action.', warnings: [] };
  if (/^BEGIN:VCARD/i.test(trimmed)) return { type: 'vcard', detail: 'A contact card (vCard).', warnings: [] };
  if (/^BEGIN:VEVENT/i.test(trimmed)) return { type: 'event', detail: 'A calendar event (iCalendar).', warnings: [] };
  if (/^geo:/i.test(trimmed)) return { type: 'geo', detail: 'Geographic coordinates.', warnings: [] };
  if (/^otpauth:\/\//i.test(trimmed)) {
    return { type: 'otp', detail: 'A one-time-password (TOTP) provisioning URI. Treat this like a password: it can generate your login codes.', warnings: ['This is a two-factor provisioning secret. Anyone who sees it can generate your codes.'] };
  }
  return { type: 'text', detail: 'Plain text.', warnings: [] };
}

export function qrScan(input: QrScanInput): QrScanResult {
  const raw = input.image ?? '';
  if (raw.length === 0) throw invalidInput('Upload a PNG image containing the QR code.');
  if (raw.length > MAX_SCAN_BASE64) throw invalidInput(`The uploaded image is too large (limit ${Math.round(MAX_SCAN_BASE64 / 1024 / 1024)} MB of Base64 data).`);

  const base64 = raw.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw invalidInput('The image data is not valid Base64.');
  }
  if (buffer.length === 0) throw invalidInput('The uploaded image is empty.');
  if (buffer.length > 8 * 1024 * 1024) throw invalidInput('The decoded image exceeds the 8 MB limit.');

  let png: PNG;
  try {
    png = PNG.sync.read(buffer);
  } catch {
    throw new ToolError('INVALID_INPUT', 'The image could not be decoded as a PNG. Export the QR code as PNG and try again — other formats are not supported because they would require a native imaging library.');
  }
  if (png.width > MAX_SCAN_DIMENSION || png.height > MAX_SCAN_DIMENSION) {
    throw invalidInput(`Images larger than ${MAX_SCAN_DIMENSION}×${MAX_SCAN_DIMENSION} pixels are not accepted.`);
  }

  const rgba = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  const decoded = jsQR(rgba, png.width, png.height, { inversionAttempts: 'attemptBoth' });

  if (!decoded) {
    return {
      found: false,
      text: null,
      contentType: { type: 'none', detail: 'No QR code was detected in this image.', warnings: [] },
      location: null,
      version: null,
      image: { width: png.width, height: png.height, bytes: buffer.length },
      notes: [
        'The image was decoded locally on the CloudHost247 server; it was not sent to any third party.',
        'If the code is present but not detected: use a larger, sharper crop, keep the code square, ensure the quiet zone around it is intact, and avoid screenshots of screens with moiré patterns.',
        'Only PNG is supported. Convert JPEG/WebP images to PNG first.',
      ],
    };
  }

  return {
    found: true,
    text: decoded.data,
    contentType: classifyQrContent(decoded.data),
    location: {
      topLeft: decoded.location.topLeftCorner,
      topRight: decoded.location.topRightCorner,
      bottomLeft: decoded.location.bottomLeftCorner,
      bottomRight: decoded.location.bottomRightCorner,
    },
    version: decoded.version,
    image: { width: png.width, height: png.height, bytes: buffer.length },
    notes: [
      'The code was decoded locally and its contents are shown as text. CloudHost247 has not opened, fetched or followed anything it contains.',
      'A QR code is only a container. Treat a URL from a code stuck to a wall or printed on a flyer exactly like a link from an e-mail you did not expect.',
    ],
  };
}

export { invalidInput as qrInvalidInput };
