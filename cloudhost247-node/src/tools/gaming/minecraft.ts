/**
 * Minecraft colour and format codes — reference table plus a converter.
 *
 * Minecraft chat uses a section sign (U+00A7, "§") followed by one code character. Many servers,
 * config files and chat tools write the same code with an ampersand ("&a"). The table below is the
 * standard legacy code set as documented by the Minecraft Wiki ("Formatting codes"). The converter
 * only touches `&` followed by a code in that table; any other `&` is left exactly as typed.
 */

export interface MinecraftCode {
  code: string;
  name: string;
  kind: 'colour' | 'format' | 'reset';
  /** Hex colour for colour codes; null for formats, which inherit the surrounding colour. */
  hex: string | null;
}

export const MINECRAFT_CODES: readonly MinecraftCode[] = [
  { code: '0', name: 'Black', kind: 'colour', hex: '#000000' },
  { code: '1', name: 'Dark Blue', kind: 'colour', hex: '#0000AA' },
  { code: '2', name: 'Dark Green', kind: 'colour', hex: '#00AA00' },
  { code: '3', name: 'Dark Aqua', kind: 'colour', hex: '#00AAAA' },
  { code: '4', name: 'Dark Red', kind: 'colour', hex: '#AA0000' },
  { code: '5', name: 'Dark Purple', kind: 'colour', hex: '#AA00AA' },
  { code: '6', name: 'Gold', kind: 'colour', hex: '#FFAA00' },
  { code: '7', name: 'Gray', kind: 'colour', hex: '#AAAAAA' },
  { code: '8', name: 'Dark Gray', kind: 'colour', hex: '#555555' },
  { code: '9', name: 'Blue', kind: 'colour', hex: '#5555FF' },
  { code: 'a', name: 'Green', kind: 'colour', hex: '#55FF55' },
  { code: 'b', name: 'Aqua', kind: 'colour', hex: '#55FFFF' },
  { code: 'c', name: 'Red', kind: 'colour', hex: '#FF5555' },
  { code: 'd', name: 'Light Purple', kind: 'colour', hex: '#FF55FF' },
  { code: 'e', name: 'Yellow', kind: 'colour', hex: '#FFFF55' },
  { code: 'f', name: 'White', kind: 'colour', hex: '#FFFFFF' },
  { code: 'k', name: 'Obfuscated (random characters)', kind: 'format', hex: null },
  { code: 'l', name: 'Bold', kind: 'format', hex: null },
  { code: 'm', name: 'Strikethrough', kind: 'format', hex: null },
  { code: 'n', name: 'Underline', kind: 'format', hex: null },
  { code: 'o', name: 'Italic', kind: 'format', hex: null },
  { code: 'r', name: 'Reset (clears colour and formats)', kind: 'reset', hex: null },
];

const CODE_CHARS = new Set(MINECRAFT_CODES.map((entry) => entry.code));
const SECTION = '\u00a7';

export type MinecraftMode = 'ampersand-to-section' | 'strip' | 'section-to-ampersand';

export interface MinecraftConversion {
  mode: MinecraftMode;
  output: string;
  /** Number of codes that were converted or removed. */
  codesProcessed: number;
  /** Counts per code, so the user can see exactly what changed. */
  byCode: Record<string, number>;
  explanation: string;
}

/**
 * Convert between `&x` and `§x` notation, or strip codes entirely. Matching is case-insensitive for
 * the code character, because chat tools accept `&A` as well as `&a`; the output uses lowercase.
 */
export function convertMinecraftCodes(text: string, mode: MinecraftMode): MinecraftConversion {
  const byCode: Record<string, number> = {};
  let processed = 0;
  // Which prefix characters each mode matches: `&` to convert from ampersand notation, `§` to
  // convert from section notation, and both when stripping.
  const prefixes = mode === 'ampersand-to-section' ? '&' : mode === 'section-to-ampersand' ? SECTION : `&${SECTION}`;
  const pattern = new RegExp(`[${prefixes}]([0-9a-fk-or])`, 'gi');
  const output = text.replace(pattern, (match: string, rawCode: string) => {
    const code = rawCode.toLowerCase();
    if (!CODE_CHARS.has(code)) return match;
    processed += 1;
    byCode[code] = (byCode[code] ?? 0) + 1;
    if (mode === 'strip') return '';
    if (mode === 'section-to-ampersand') return `&${code}`;
    return `${SECTION}${code}`;
  });
  const explanations: Record<MinecraftMode, string> = {
    'ampersand-to-section': 'Each &x that matches a Minecraft code was replaced by §x. Any other & was left as typed. A literal "&" followed by a code letter (for example "R&D") is converted too, so review the output for that case.',
    strip: 'Every recognised §x or &x code was removed, leaving the plain text.',
    'section-to-ampersand': 'Each §x that matches a Minecraft code was replaced by &x, which is the form most server configuration files expect.',
  };
  return { mode, output, codesProcessed: processed, byCode, explanation: explanations[mode] };
}
