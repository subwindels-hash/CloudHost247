/**
 * QR content for the badge maker.
 *
 * The badge's QR block is a real symbol, not a square with a caption. The matrix comes from the
 * `qrcode` encoder (the same one the Tools Center QR tool uses), is rendered as one rectangle per
 * module by both renderers, and is decoded back with a real scanner in the test suite — so "the QR
 * on the card scans" is a verified claim.
 *
 * One important honesty rule lives here: the QR is *not* an employment verification service. A
 * badge QR that resolves to `https://example.com/` proves nothing about the holder, so the tool
 * states what the code contains and refuses to describe plain text as a verification link.
 */

import QRCode from 'qrcode';

export interface QrMatrix {
  /** One boolean per module, `true` = dark. Row-major. */
  modules: boolean[][];
  /** Modules per side, excluding the quiet zone. */
  size: number;
  /** Error-correction level used. */
  ecc: 'L' | 'M' | 'Q' | 'H';
  payload: string;
}

export interface QrFailure {
  ok: false;
  message: string;
}

const MAX_PAYLOAD = 512;

/** A URL that the badge QR may point at. Only http/https, only a normal host. */
export function validateQrUrl(raw: string): { ok: true; url: string } | QrFailure {
  const value = raw.trim();
  if (value === '') return { ok: true, url: '' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, message: `“${value}” is not a valid URL. Include the scheme, for example https://verify.example.com/employee/EMP00123.` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, message: 'A verification link must use http:// or https:// — other schemes cannot be opened by a phone camera.' };
  }
  if (!parsed.hostname.includes('.')) {
    return { ok: false, message: `“${parsed.hostname}” is not a public host name, so the QR code would not resolve for anyone scanning it.` };
  }
  if (parsed.protocol === 'http:') {
    return { ok: true, url: parsed.toString() };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * The payload the card carries when the user supplies no verification URL.
 *
 * This is the employee ID — the string an access-control reader, a stock-room scanner or an HR app
 * can actually match on — falling back to `NAME:<full name>` for a card that has no ID yet. A
 * decorative sentence ("CloudHost247 employee badge · Ada Obi") was tried and rejected: it makes the
 * symbol denser and it is meaningless to every machine that reads it.
 */
export function defaultQrPayload(employeeId: string, fullName: string): string {
  const id = employeeId.trim();
  if (id !== '') return id;
  const name = fullName.trim();
  return name === '' ? '' : `NAME:${name}`;
}

/**
 * Encode `payload`. Callers pass the resolved payload; `resolveQrPayload()` does the choosing.
 */
export function encodeQrMatrix(payload: string, ecc: 'L' | 'M' | 'Q' | 'H' = 'M'): QrMatrix | QrFailure {
  const value = payload.trim();
  if (value === '') return { ok: false, message: 'There is no QR content to encode.' };
  if (value.length > MAX_PAYLOAD) {
    return { ok: false, message: `QR content is limited to ${MAX_PAYLOAD} characters so the symbol stays large enough to scan on a card.` };
  }
  try {
    const symbol = QRCode.create(value, { errorCorrectionLevel: ecc });
    const size = symbol.modules.size;
    const modules: boolean[][] = [];
    for (let row = 0; row < size; row += 1) {
      const line: boolean[] = [];
      for (let column = 0; column < size; column += 1) line.push(Boolean(symbol.modules.get(row, column)));
      modules.push(line);
    }
    return { modules, size, ecc, payload: value };
  } catch (error) {
    return { ok: false, message: `That QR content could not be encoded (${(error as Error).message}).` };
  }
}

/** Render a matrix as SVG rectangles — real modules, in the quiet zone, in the requested colours. */
export function qrMatrixToSvg(
  matrix: QrMatrix,
  options: { x: number; y: number; size: number; dark: string; light: string; quietModules?: number; label: string }
): string {
  const quiet = options.quietModules ?? 2;
  const total = matrix.size + quiet * 2;
  const moduleSize = options.size / total;
  const rects: string[] = [`<rect x="${options.x}" y="${options.y}" width="${options.size}" height="${options.size}" fill="${options.light}"/>`];
  const path: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    const line = matrix.modules[row] ?? [];
    for (let column = 0; column < matrix.size; column += 1) {
      if (!line[column]) continue;
      const px = options.x + (column + quiet) * moduleSize;
      const py = options.y + (row + quiet) * moduleSize;
      // Rounding to 3 decimals keeps the file small; the renderer never leaves the strip.
      path.push(
        `<rect x="${px.toFixed(3)}" y="${py.toFixed(3)}" width="${(moduleSize + 0.2).toFixed(3)}" height="${(moduleSize + 0.2).toFixed(3)}"/>`
      );
    }
  }
  rects.push(`<g fill="${options.dark}">${path.join('')}</g>`);
  rects.push(`<title>${options.label.replace(/[<>&]/g, '')}</title>`);
  return rects.join('');
}
