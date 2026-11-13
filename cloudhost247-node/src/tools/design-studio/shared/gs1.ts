/**
 * GS1 check digits.
 *
 * The same modulo-10 rule closes every GS1 identification key (GTIN, SSCC, GLN): weight the digits
 * 3, 1, 3, … starting from the one next to the check digit, and the check digit is what brings the
 * sum up to a multiple of ten.
 */

export function gs1CheckDigit(digitsWithoutCheck: string): number {
  let sum = 0;
  for (let index = 0; index < digitsWithoutCheck.length; index += 1) {
    const digit = digitsWithoutCheck.charCodeAt(digitsWithoutCheck.length - 1 - index) - 48;
    sum += digit * (index % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export type SsccResult = { ok: true; sscc: string } | { ok: false; message: string };

/**
 * An 18-digit SSCC from what the user typed: 17 digits (the check digit is added) or 18 digits (the
 * check digit is verified). Spaces are ignored. The message never repeats the number.
 */
export function resolveSscc(raw: string): SsccResult {
  const digits = raw.replace(/[\s-]+/g, '').replace(/^\(00\)/, '');
  if (!/^\d+$/.test(digits)) return { ok: false, message: 'The SSCC must contain digits only.' };
  if (digits.length === 17) return { ok: true, sscc: `${digits}${gs1CheckDigit(digits)}` };
  if (digits.length === 18) {
    const expected = gs1CheckDigit(digits.slice(0, 17));
    if (expected !== Number(digits[17])) {
      return { ok: false, message: `The SSCC check digit is wrong: the last digit should be ${expected}. Enter the first 17 digits to have it calculated.` };
    }
    return { ok: true, sscc: digits };
  }
  return { ok: false, message: 'An SSCC has 18 digits. Enter all 18, or the first 17 to have the check digit calculated.' };
}

/** The SSCC `offset` logistic units after `sscc`, with its own check digit, or null if the serial runs out. */
export function nextSscc(sscc: string, offset: number): string | null {
  const body = (BigInt(sscc.slice(0, 17)) + BigInt(offset)).toString().padStart(17, '0');
  if (body.length > 17) return null;
  return `${body}${gs1CheckDigit(body)}`;
}
