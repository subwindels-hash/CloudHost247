/**
 * Logo Maker design catalogue: palettes, typography presets and layouts.
 *
 * Every entry is a real, self-contained design decision the vector engine can execute — there are
 * no "preview only" palettes. Adding a palette or a font preset here immediately makes it available
 * to the editor, the AI suggestion parser and the exporter, because all three read this module.
 *
 * Typography presets are named by *character* (geometric sans, humanist sans, serif, slab, mono)
 * rather than by a vendor font name: the exported SVG references the family generically with
 * sensible fallbacks, so an exported logo never depends on a font the customer cannot license, and
 * nothing is downloaded at render time.
 */

export interface LogoPalette {
  slug: string;
  name: string;
  primary: string;
  accent: string;
  background: string;
  text: string;
  mood: string;
}

export interface LogoFontPreset {
  slug: string;
  name: string;
  /** Generic family + fallbacks written into the SVG (no web font is ever loaded). */
  family: string;
  letterSpacing: number;
  weight: number;
  transform: 'none' | 'uppercase' | 'lowercase';
  description: string;
}

export interface LogoLayoutPreset {
  slug: 'mark_left' | 'mark_above' | 'mark_only' | 'monogram_badge' | 'emblem_round';
  name: string;
  description: string;
}

export interface LogoMarkStyle {
  slug: 'geometric' | 'ring' | 'shield' | 'orbit' | 'leaf' | 'bolt' | 'wave' | 'cube';
  name: string;
  description: string;
}

export const LOGO_PALETTES: readonly LogoPalette[] = [
  { slug: 'ch247-blue', name: 'CloudHost247 blue', primary: '#0756d8', accent: '#12b886', background: '#ffffff', text: '#0b1c3d', mood: 'Dependable, technical' },
  { slug: 'midnight-teal', name: 'Midnight teal', primary: '#0f766e', accent: '#22d3ee', background: '#f8fafc', text: '#0f172a', mood: 'Calm, modern' },
  { slug: 'indigo-sunrise', name: 'Indigo sunrise', primary: '#4338ca', accent: '#f59e0b', background: '#ffffff', text: '#1e1b4b', mood: 'Optimistic, confident' },
  { slug: 'forest-clay', name: 'Forest clay', primary: '#2f6b3c', accent: '#c2703d', background: '#fbf8f3', text: '#1f2d20', mood: 'Organic, grounded' },
  { slug: 'graphite-neon', name: 'Graphite neon', primary: '#111827', accent: '#84cc16', background: '#ffffff', text: '#111827', mood: 'Bold, technical' },
  { slug: 'rose-ink', name: 'Rose ink', primary: '#9d174d', accent: '#fb7185', background: '#fff7fb', text: '#3b0a22', mood: 'Warm, editorial' },
  { slug: 'navy-gold', name: 'Navy gold', primary: '#0b2447', accent: '#c9a227', background: '#ffffff', text: '#0b2447', mood: 'Premium, established' },
  { slug: 'slate-sky', name: 'Slate sky', primary: '#334155', accent: '#38bdf8', background: '#f8fafc', text: '#1e293b', mood: 'Minimal, professional' },
];

export const LOGO_FONT_PRESETS: readonly LogoFontPreset[] = [
  { slug: 'geometric-sans', name: 'Geometric sans', family: "'Inter', 'Segoe UI', system-ui, sans-serif", letterSpacing: 0, weight: 700, transform: 'none', description: 'Clean, current, extremely legible at small sizes.' },
  { slug: 'humanist-sans', name: 'Humanist sans', family: "'Helvetica Neue', Arial, sans-serif", letterSpacing: 0.5, weight: 600, transform: 'none', description: 'Approachable and neutral.' },
  { slug: 'editorial-serif', name: 'Editorial serif', family: "'Georgia', 'Times New Roman', serif", letterSpacing: 0.2, weight: 700, transform: 'none', description: 'Considered and trustworthy.' },
  { slug: 'slab-industrial', name: 'Slab industrial', family: "'Rockwell', 'Courier New', serif", letterSpacing: 0.4, weight: 700, transform: 'uppercase', description: 'Solid and engineered.' },
  { slug: 'uppercase-wide', name: 'Uppercase wide', family: "'Inter', 'Segoe UI', system-ui, sans-serif", letterSpacing: 3.2, weight: 600, transform: 'uppercase', description: 'A wordmark that reads as a statement.' },
  { slug: 'mono-technical', name: 'Mono technical', family: "'IBM Plex Mono', 'Courier New', monospace", letterSpacing: 1.2, weight: 500, transform: 'uppercase', description: 'Developer and infrastructure brands.' },
];

export const LOGO_LAYOUTS: readonly LogoLayoutPreset[] = [
  { slug: 'mark_left', name: 'Mark left', description: 'Symbol beside the wordmark — the most versatile lockup.' },
  { slug: 'mark_above', name: 'Mark above', description: 'Symbol stacked over the wordmark — good for square avatars.' },
  { slug: 'mark_only', name: 'Mark only', description: 'Just the symbol, for favicons and app icons.' },
  { slug: 'monogram_badge', name: 'Monogram badge', description: 'Initials inside a badge — strong at very small sizes.' },
  { slug: 'emblem_round', name: 'Round emblem', description: 'Wordmark wrapped with a circular emblem.' },
];

export const LOGO_MARK_STYLES: readonly LogoMarkStyle[] = [
  { slug: 'geometric', name: 'Geometric', description: 'Overlapping squares — modern and balanced.' },
  { slug: 'ring', name: 'Ring', description: 'Concentric circles — continuous and calm.' },
  { slug: 'shield', name: 'Shield', description: 'Protective outline — security, hosting, legal.' },
  { slug: 'orbit', name: 'Orbit', description: 'A circle with an ellipse — networks and platforms.' },
  { slug: 'leaf', name: 'Leaf', description: 'Two arcs meeting — organic, food and wellness.' },
  { slug: 'bolt', name: 'Bolt', description: 'An angular flash — energy, speed, delivery.' },
  { slug: 'wave', name: 'Wave', description: 'Flowing lines — communication and travel.' },
  { slug: 'cube', name: 'Cube', description: 'An isometric block — logistics and infrastructure.' },
];

export const STYLE_TO_PALETTE: Record<string, string[]> = {
  modern: ['ch247-blue', 'slate-sky', 'indigo-sunrise', 'midnight-teal'],
  classic: ['navy-gold', 'forest-clay', 'slate-sky'],
  minimal: ['slate-sky', 'graphite-neon', 'midnight-teal'],
  bold: ['graphite-neon', 'indigo-sunrise', 'navy-gold'],
  playful: ['indigo-sunrise', 'rose-ink', 'forest-clay'],
  luxury: ['navy-gold', 'rose-ink', 'graphite-neon'],
  tech: ['ch247-blue', 'graphite-neon', 'slate-sky', 'midnight-teal'],
  organic: ['forest-clay', 'rose-ink', 'midnight-teal'],
};

export function paletteBySlug(slug: string): LogoPalette | undefined {
  return LOGO_PALETTES.find((palette) => palette.slug === slug);
}

export function fontBySlug(slug: string): LogoFontPreset | undefined {
  return LOGO_FONT_PRESETS.find((font) => font.slug === slug);
}

export function markStyleBySlug(slug: string): LogoMarkStyle | undefined {
  return LOGO_MARK_STYLES.find((mark) => mark.slug === slug);
}

export function isValidHex(value: string | undefined): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Initials for a monogram concept: up to two letters from the words of the company name. */
export function monogramFor(companyName: string): string {
  const words = companyName
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
}
