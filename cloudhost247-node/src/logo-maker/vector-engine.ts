/**
 * Logo Maker vector engine.
 *
 * Composes real SVG from validated inputs. Three properties make this honest, deterministic
 * output rather than a mockup:
 *
 *   1. It produces complete, standards-compliant SVG — no raster stand-in, no external asset, no
 *      web font, no remote image. What the customer previews is byte-for-byte what they export.
 *   2. Company names, taglines and initialisms are XML-escaped on the way in, so a name containing
 *      `&`, `<` or quotes can never break the document or inject markup into an exported file.
 *   3. Every geometric decision is a pure function of (layout, mark style, palette, font preset,
 *      name), so the same inputs always produce the same logo and a concept can always be
 *      re-derived after an edit.
 */
import { LOGO_FONT_PRESETS, LOGO_MARK_STYLES, monogramFor, type LogoFontPreset, type LogoPalette } from './catalog';

export type LogoLayout = 'mark_left' | 'mark_above' | 'mark_only' | 'monogram_badge' | 'emblem_round';
export type MarkStyle = (typeof LOGO_MARK_STYLES)[number]['slug'];

export interface LogoConceptSpec {
  companyName: string;
  tagline?: string | null;
  layout: LogoLayout;
  markStyle: MarkStyle;
  palette: LogoPalette;
  font: LogoFontPreset;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function applyTransform(text: string, font: LogoFontPreset): string {
  if (font.transform === 'uppercase') return text.toUpperCase();
  if (font.transform === 'lowercase') return text.toLowerCase();
  return text;
}

/** The brand symbol, drawn inside a 100×100 box and positioned by the caller. */
function mark(style: MarkStyle, palette: LogoPalette, monogram: string, font: LogoFontPreset): string {
  const { primary, accent } = palette;
  switch (style) {
    case 'ring':
      return `
        <circle cx="50" cy="50" r="40" fill="none" stroke="${primary}" stroke-width="10"/>
        <circle cx="50" cy="50" r="18" fill="${accent}"/>`;
    case 'shield':
      return `
        <path d="M50 8 L86 24 V54 C86 74 70 88 50 94 C30 88 14 74 14 54 V24 Z" fill="${primary}"/>
        <path d="M50 26 L70 35 V54 C70 66 61 75 50 80 C39 75 30 66 30 54 V35 Z" fill="${accent}"/>`;
    case 'orbit':
      return `
        <circle cx="50" cy="50" r="20" fill="${primary}"/>
        <ellipse cx="50" cy="50" rx="44" ry="20" fill="none" stroke="${accent}" stroke-width="7" transform="rotate(-28 50 50)"/>
        <circle cx="86" cy="32" r="7" fill="${accent}"/>`;
    case 'leaf':
      return `
        <path d="M18 82 C18 40 44 16 84 16 C84 56 58 82 18 82 Z" fill="${primary}"/>
        <path d="M26 74 C40 56 58 40 76 30" fill="none" stroke="${accent}" stroke-width="7" stroke-linecap="round"/>`;
    case 'bolt':
      return `
        <path d="M56 6 L22 56 H46 L40 94 L78 40 H52 Z" fill="${primary}"/>
        <path d="M56 6 L22 56 H38 L46 24 Z" fill="${accent}" opacity="0.85"/>`;
    case 'wave':
      return `
        <path d="M8 62 C24 38 38 38 50 50 C62 62 76 62 92 38" fill="none" stroke="${primary}" stroke-width="12" stroke-linecap="round"/>
        <path d="M8 82 C24 58 38 58 50 70 C62 82 76 82 92 58" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round"/>`;
    case 'cube':
      return `
        <path d="M50 8 L88 30 V70 L50 92 L12 70 V30 Z" fill="${primary}"/>
        <path d="M50 8 L88 30 L50 52 L12 30 Z" fill="${accent}" opacity="0.9"/>`;
    case 'geometric':
    default:
      return `
        <rect x="14" y="14" width="50" height="50" rx="10" fill="${primary}"/>
        <rect x="36" y="36" width="50" height="50" rx="10" fill="${accent}" opacity="0.9"/>
        <text x="50" y="56" text-anchor="middle" font-family="${escapeXml(font.family)}" font-size="30" font-weight="700" fill="#ffffff">${escapeXml(monogram)}</text>`;
  }
}

function textBlock(
  spec: LogoConceptSpec,
  options: { x: number; y: number; anchor: 'start' | 'middle'; nameSize: number; taglineSize: number }
): string {
  const { palette, font } = spec;
  const name = escapeXml(applyTransform(spec.companyName, font));
  const tagline = spec.tagline ? escapeXml(applyTransform(spec.tagline, font)) : '';
  return `
      <text x="${options.x}" y="${options.y}" text-anchor="${options.anchor}" font-family="${escapeXml(font.family)}"
            font-size="${options.nameSize}" font-weight="${font.weight}" letter-spacing="${font.letterSpacing}" fill="${palette.text}">${name}</text>
      ${
        tagline
          ? `<text x="${options.x}" y="${options.y + options.taglineSize * 1.6}" text-anchor="${options.anchor}"
              font-family="${escapeXml(font.family)}" font-size="${options.taglineSize}" letter-spacing="${font.letterSpacing + 1.4}"
              fill="${palette.primary}">${tagline}</text>`
          : ''
      }`;
}

export interface RenderedLogo {
  svg: string;
  width: number;
  height: number;
}

/**
 * Renders a concept to SVG. The viewBox is chosen per layout so the mark and wordmark sit in a
 * balanced frame; `width`/`height` are the natural export dimensions (the SVG scales beyond them
 * without loss).
 */
export function renderLogo(spec: LogoConceptSpec, options: { background?: 'transparent' | 'palette' } = {}): RenderedLogo {
  const monogram = monogramFor(spec.companyName);
  const nameLength = Math.max(spec.companyName.trim().length, 4);
  const nameSizeByLayout: Record<LogoLayout, number> = {
    mark_left: 44,
    mark_above: 40,
    mark_only: 0,
    monogram_badge: 34,
    emblem_round: 30,
  };
  const nameSize = nameSizeByLayout[spec.layout];
  const taglineSize = Math.max(13, Math.round(nameSize * 0.34));
  const markBox = 100;
  const markScale = spec.layout === 'mark_only' ? 1.2 : spec.layout === 'mark_above' || spec.layout === 'emblem_round' ? 1 : 0.72;
  const markSize = markBox * markScale;

  const width = Math.min(1600, Math.max(420, Math.round(180 + nameLength * (nameSize * 0.62))));
  const height = spec.layout === 'mark_above' || spec.layout === 'emblem_round' ? 420 : spec.layout === 'mark_only' ? 320 : 260;

  const background =
    options.background === 'palette'
      ? `<rect width="100%" height="100%" fill="${spec.palette.background === '#ffffff' ? spec.palette.primary : spec.palette.background}"/>`
      : '';

  let body = '';
  if (spec.layout === 'mark_only') {
    body = `<g transform="translate(${(width - markSize) / 2} ${(height - markSize) / 2}) scale(${markScale})">${mark(spec.markStyle, spec.palette, monogram, spec.font)}</g>`;
  } else if (spec.layout === 'mark_left') {
    const y = (height - markSize) / 2;
    body =
      `<g transform="translate(40 ${y}) scale(${markScale})">${mark(spec.markStyle, spec.palette, monogram, spec.font)}</g>` +
      textBlock(spec, { x: 40 + markSize + 28, y: height / 2 + nameSize * 0.18, anchor: 'start', nameSize, taglineSize });
  } else if (spec.layout === 'mark_above') {
    const y = 60;
    body =
      `<g transform="translate(${(width - markSize) / 2} ${y}) scale(${markScale})">${mark(spec.markStyle, spec.palette, monogram, spec.font)}</g>` +
      textBlock(spec, { x: width / 2, y: y + markSize + nameSize * 1.1, anchor: 'middle', nameSize, taglineSize });
  } else if (spec.layout === 'monogram_badge') {
    const badge = 150;
    const x = 44;
    const y = (height - badge) / 2;
    body =
      `<rect x="${x}" y="${y}" width="${badge}" height="${badge}" rx="34" fill="${spec.palette.primary}"/>` +
      `<text x="${x + badge / 2}" y="${y + badge / 2 + 22}" text-anchor="middle" font-family="${escapeXml(spec.font.family)}"
             font-size="62" font-weight="800" letter-spacing="2" fill="#ffffff">${escapeXml(monogram)}</text>` +
      textBlock(spec, { x: x + badge + 32, y: height / 2 + nameSize * 0.18, anchor: 'start', nameSize, taglineSize });
  } else {
    const ringSize = 210;
    const y = 40;
    body =
      `<g transform="translate(${(width - ringSize) / 2} ${y}) scale(${ringSize / markBox})">${mark('ring', spec.palette, monogram, spec.font)}</g>` +
      textBlock(spec, { x: width / 2, y: y + ringSize + nameSize * 1.2, anchor: 'middle', nameSize, taglineSize });
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(spec.companyName)} logo">${background}${body}</svg>`;
  return { svg, width, height };
}

/** Deterministic style/layout picks so "generate concepts" yields variety without randomness. */
export function conceptVariants(style: string): Array<{ layout: LogoLayout; markStyle: MarkStyle }> {
  const layoutByStyle: Record<string, LogoLayout[]> = {
    modern: ['mark_left', 'monogram_badge', 'mark_above'],
    classic: ['emblem_round', 'mark_above', 'mark_left'],
    minimal: ['mark_left', 'mark_only', 'monogram_badge'],
    bold: ['monogram_badge', 'mark_left', 'mark_above'],
    playful: ['mark_above', 'mark_left', 'emblem_round'],
    luxury: ['emblem_round', 'mark_above', 'monogram_badge'],
    tech: ['mark_left', 'mark_only', 'monogram_badge'],
    organic: ['mark_above', 'emblem_round', 'mark_left'],
  };
  const markByStyle: Record<string, MarkStyle[]> = {
    modern: ['geometric', 'orbit', 'cube'],
    classic: ['shield', 'ring', 'wave'],
    minimal: ['ring', 'geometric', 'cube'],
    bold: ['bolt', 'geometric', 'cube'],
    playful: ['leaf', 'wave', 'orbit'],
    luxury: ['shield', 'ring', 'leaf'],
    tech: ['cube', 'orbit', 'bolt'],
    organic: ['leaf', 'wave', 'ring'],
  };
  const layouts = layoutByStyle[style] ?? layoutByStyle.modern!;
  const marks = markByStyle[style] ?? markByStyle.modern!;
  return layouts.map((layout, index) => ({ layout, markStyle: marks[index] ?? 'geometric' }));
}

export const DEFAULT_FONT_SLUG = LOGO_FONT_PRESETS[0]!.slug;
