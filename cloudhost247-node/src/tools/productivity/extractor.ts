/**
 * Tools Center — Email & Link Extractor.
 *
 * Pulls every email address (or every web address) out of pasted text, removes duplicates, and
 * formats the list with the chosen separator. Pure string work: the text is processed in memory,
 * nothing is fetched, no address is contacted or verified, and nothing is stored by this module.
 */
import { invalidInput } from '../core/errors';

export const EXTRACT_TYPES = ['email', 'web'] as const;
export type ExtractType = (typeof EXTRACT_TYPES)[number];

export const EXTRACT_SEPARATORS = ['comma', 'pipe', 'colon', 'new-line', 'other'] as const;
export type ExtractSeparator = (typeof EXTRACT_SEPARATORS)[number];

export const EXTRACT_FILTER_MODES = ['only', 'exclude'] as const;
export type ExtractFilterMode = (typeof EXTRACT_FILTER_MODES)[number];

/** Kept well under the API's 1 MB request-body limit, including JSON escaping and multi-byte text. */
export const EXTRACT_MAX_INPUT = 500_000;

export interface ExtractInput {
  text: string;
  type?: ExtractType;
  separator?: ExtractSeparator;
  /** Used when `separator` is `other`. */
  customSeparator?: string;
  /** Start a new line after every N addresses. */
  groupSize?: number;
  sort?: boolean;
  /** Keep (`only`) or drop (`exclude`) addresses containing this string, case-insensitively. */
  filter?: string;
  filterMode?: ExtractFilterMode;
}

export interface ExtractResult {
  type: ExtractType;
  count: number;
  found: number;
  duplicatesRemoved: number;
  filteredOut: number;
  output: string;
  addresses: string[];
  notes: string[];
}

const EMAIL_PATTERN = /[A-Za-z0-9][A-Za-z0-9._%+-]*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}/g;
const WEB_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`{}|\\^\[\]]+/gi;
/** Sentence punctuation that follows a link in prose rather than belonging to it. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

const SEPARATORS: Record<Exclude<ExtractSeparator, 'other'>, string> = {
  comma: ', ',
  pipe: ' | ',
  colon: ' : ',
  'new-line': '\n',
};

function matches(text: string, type: ExtractType): string[] {
  if (type === 'email') return text.match(EMAIL_PATTERN) ?? [];
  return (text.match(WEB_PATTERN) ?? [])
    .map((url) => url.replace(TRAILING_PUNCTUATION, ''))
    .filter((url) => url.length > 4);
}

export function extractAddresses(input: ExtractInput): ExtractResult {
  if (typeof input.text !== 'string' || input.text.trim().length === 0) {
    throw invalidInput('Paste the text to extract addresses from.');
  }
  if (input.text.length > EXTRACT_MAX_INPUT) {
    throw invalidInput(`Input is limited to ${EXTRACT_MAX_INPUT.toLocaleString('en-US')} characters.`);
  }
  const type: ExtractType = input.type ?? 'email';
  const separatorKind: ExtractSeparator = input.separator ?? 'comma';
  if (separatorKind === 'other' && !input.customSeparator) {
    throw invalidInput('Enter the custom separator to use, or choose one of the listed separators.');
  }
  const separator = separatorKind === 'other' ? (input.customSeparator as string) : SEPARATORS[separatorKind];

  const all = matches(input.text, type);
  // Email addresses are compared case-insensitively (the first spelling seen is kept); web
  // addresses are compared exactly, because URL paths are case-sensitive.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const address of all) {
    const key = type === 'email' ? address.toLowerCase() : address;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(address);
  }

  const needle = input.filter?.trim().toLowerCase();
  const filterMode: ExtractFilterMode = input.filterMode ?? 'only';
  const kept = needle
    ? unique.filter((address) => address.toLowerCase().includes(needle) === (filterMode === 'only'))
    : unique;
  if (input.sort) kept.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));

  const groupSize = input.groupSize && input.groupSize > 0 ? Math.floor(input.groupSize) : 0;
  let output: string;
  if (groupSize > 0) {
    const groups: string[] = [];
    for (let index = 0; index < kept.length; index += groupSize) {
      groups.push(kept.slice(index, index + groupSize).join(separator));
    }
    output = groups.join(separator === '\n' ? '\n\n' : '\n');
  } else {
    output = kept.join(separator);
  }

  const notes = [
    type === 'email'
      ? 'Addresses are matched by their format only. No mailbox is contacted or verified.'
      : 'Links are matched by their format only (http://, https:// or www.). No link is visited.',
  ];
  if (kept.length === 0) notes.push(type === 'email' ? 'No email addresses were found in the text.' : 'No web addresses were found in the text.');

  return {
    type,
    count: kept.length,
    found: all.length,
    duplicatesRemoved: all.length - unique.length,
    filteredOut: unique.length - kept.length,
    output,
    addresses: kept,
    notes,
  };
}
