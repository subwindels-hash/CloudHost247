import type { Plugin } from 'vite';

/**
 * Keep the long em dash out of customer-facing page copy.
 *
 * Most page copy is authored directly in TSX, while marketing and legal write-ups are imported
 * from generated JSON. Applying this small build transform at the shared frontend boundary keeps
 * the presentation rule consistent without changing the meaning of authoritative source material.
 */
export function editorialPunctuationPlugin(): Plugin {
  const replaceEmDashes = (value: string) => value.replaceAll('—', '-');

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
