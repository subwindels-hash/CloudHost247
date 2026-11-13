/**
 * What a symbol carries, when that is more than the data as entered.
 *
 * Some barcode types complete the data themselves: a retail number entered without its check digit
 * is given one, and ITF, which encodes digits in pairs, gains a leading zero when the count is odd.
 * A result that repeated the input and called it "the encoded data" would then be describing a
 * symbol that does not exist, so the tools state the final content instead.
 *
 * Only the cases that can be computed exactly are reported here, and each of them is compared with
 * what an independent decoder reads in tests/unit/design-studio-barcodes.test.ts.
 */

import { gs1CheckDigit } from '../shared/gs1';
import type { Symbology } from './symbologies';

/** Retail and trade-unit numbers that may be entered one digit short: the GS1 check digit is added. */
const LENGTH_WITHOUT_CHECK: Readonly<Record<string, number>> = { ean13: 12, ean8: 7, upca: 11, itf14: 13 };

export interface CarriedContent {
  /** The complete content of the symbol. */
  content: string;
  /** What was added to the entered data, in words. */
  why: string;
}

/**
 * The content of the symbol for `data`, or null when the symbol carries `data` exactly.
 * `includeCheck` is the "add a check digit" option, which only ITF reports here.
 */
export function carriedContent(symbology: Symbology, data: string, includeCheck: boolean): CarriedContent | null {
  if (!/^\d+$/.test(data)) return null;
  if (LENGTH_WITHOUT_CHECK[symbology.id] === data.length) {
    const check = gs1CheckDigit(data);
    return { content: `${data}${check}`, why: `check digit ${check} added` };
  }
  if (symbology.id === 'itf') {
    const check = includeCheck ? String(gs1CheckDigit(data)) : '';
    const padded = (data.length + check.length) % 2 === 1;
    if (!padded && check === '') return null;
    const reasons = [...(padded ? ['a leading zero added, because ITF encodes digits in pairs'] : []), ...(check !== '' ? [`check digit ${check} added`] : [])];
    return { content: `${padded ? '0' : ''}${data}${check}`, why: reasons.join(' and ') };
  }
  return null;
}
