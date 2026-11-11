import type { Plugin } from 'vite';

/** Em dash (U+2014), the character this transform rewrites. */
const EM_DASH = '\u2014';

/**
 * Keep the long em dash out of customer-facing page copy.
 *
 * Most page copy is authored directly in TSX, while marketing and legal write-ups are imported
 * from generated JSON. Applying this small build transform at the shared frontend boundary keeps
 * the presentation rule consistent without changing the meaning of authoritative source material.
 */
export function editorialPunctuationPlugin(): Plugin {
  // Split/join rather than String.prototype.replaceAll: the frontend tsconfig pins lib to ES2020,
  // where replaceAll does not exist (TS2550). Raising the lib would change the target for the
  // whole frontend, so the ES2020-compatible form is used instead.
  const replaceEmDashes = (value: string) => value.split(EM_DASH).join('-');

  return {
    name: 'cloudhost247-editorial-punctuation',
    enforce: 'pre',
    transform(code, id) {
      const filename = id.split('?', 1)[0] ?? id;
      if (filename.includes('/node_modules/') || !/\.(?:[cm]?[jt]sx?|json)$/.test(filename) || !code.includes('—')) {
        return null;
      }
      return { code: replaceEmDashes(code), map: null };
    },
    transformIndexHtml(html) {
      return replaceEmDashes(html);
    },
  };
}
