/**
 * Pure helpers for the Extractor Pro panel: wildcard matching for file names and for excluded
 * address patterns, batching file text into API-sized requests, and the list rules.
 */

/**
 * The extractor API accepts 500,000 characters per request and the server caps a request body at
 * 1 MB. 300,000 characters stays under both even when every character is escaped or multi-byte.
 */
export const PRO_CHUNK_CHARS = 300_000;
export const PRO_MAX_FILES = 500;
/** About 70 batches at most — inside the 90-requests-a-minute limit this tool has per visitor. */
export const PRO_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/** `*` matches any run of characters, `?` exactly one. Case-insensitive, whole-string. */
export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** `*.htm; *.html, *.txt` → matchers. An empty pattern matches every file. */
export function fileNameMatcher(patterns: string): (name: string) => boolean {
  const list = patterns.split(/[;,\s]+/).map((entry) => entry.trim()).filter(Boolean).map(wildcardToRegExp);
  if (list.length === 0) return () => true;
  return (name) => list.some((expression) => expression.test(name));
}

/** True when a file picked through the folder chooser sits directly in the chosen folder. */
export function isTopLevel(relativePath: string): boolean {
  return relativePath.split('/').filter(Boolean).length <= 2;
}

/**
 * Packs texts into as few requests as possible. A text longer than one request is cut at
 * whitespace, so an address is never split across two requests.
 */
export function chunkTexts(texts: string[], limit = PRO_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = '';
  const push = (piece: string) => {
    if (current.length + piece.length + 1 > limit && current) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + piece;
  };
  for (const text of texts) {
    let rest = text;
    while (rest.length > limit) {
      let cut = rest.lastIndexOf('\n', limit);
      if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit);
      if (cut < limit / 2) cut = limit;
      push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest.trim()) push(rest);
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface ProLists {
  subscription: string[];
  unsubscription: string[];
  excluding: string[];
}

export type ProListKey = keyof ProLists;

export const EMPTY_LISTS: ProLists = { subscription: [], unsubscription: [], excluding: [] };

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * The rule that ties the three lists together: the Subscription list never contains an address
 * that is on the UnSubscription list or that matches an excluded pattern.
 */
export function normalizeLists(lists: ProLists): ProLists {
  const unsubscription = unique(lists.unsubscription);
  const excluding = unique(lists.excluding);
  const blocked = new Set(unsubscription.map((address) => address.toLowerCase()));
  const patterns = excluding.map(wildcardToRegExp);
  const subscription = unique(lists.subscription).filter(
    (address) => !blocked.has(address.toLowerCase()) && !patterns.some((expression) => expression.test(address))
  );
  return { subscription, unsubscription, excluding };
}

/** Adds entries to one list and re-applies the rule. Returns the new lists and how many were kept. */
export function addToList(lists: ProLists, key: ProListKey, entries: string[]): { lists: ProLists; added: number } {
  const next = normalizeLists({ ...lists, [key]: [...lists[key], ...entries] });
  return { lists: next, added: next[key].length - lists[key].length };
}
