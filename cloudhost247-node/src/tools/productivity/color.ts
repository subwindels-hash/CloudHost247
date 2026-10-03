/**
 * Tools Center — colour tools (spec §58).
 *
 * Everything here is arithmetic on colour spaces (sRGB, HSL, HSV, CMYK, CIELAB, WCAG relative
 * luminance) plus one fixed reference table: the CSS named colours. There is no "AI palette
 * suggestion" and no random colour generator dressed up as design advice.
 */
import { invalidInput } from '../core/errors';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export interface Cmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface ColorRepresentation {
  input: string;
  hex: string;
  hexShort: string | null;
  rgb: Rgb;
  rgbCss: string;
  hsl: Hsl;
  hslCss: string;
  hsv: Hsv;
  cmyk: Cmyk;
  lab: { l: number; a: number; b: number };
  luminance: number;
  perceivedBrightness: number;
  nearestNamedColor: { name: string; hex: string; distance: number } | null;
  isDark: boolean;
  textColorForContrast: { hex: string; ratio: number; passesAA: boolean };
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits;

export function hexToRgb(input: string): Rgb {
  const value = input.trim().replace(/^#/, '');
  const expanded = value.length === 3 ? value.split('').map((character) => `${character}${character}`).join('') : value;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(expanded)) {
    throw invalidInput('Enter a colour as #RGB, #RRGGBB or #RRGGBBAA, or use rgb()/hsl().');
  }
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function rgbToHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b].map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: round(l * 100) };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  if (h < 0) h += 360;
  return { h: round(h), s: round(s * 100), l: round(l * 100) };
}

export function hslToRgb(hsl: Hsl): Rgb {
  const h = ((hsl.h % 360) + 360) % 360;
  const s = clamp(hsl.s, 0, 100) / 100;
  const l = clamp(hsl.l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

export function rgbToHsv(rgb: Rgb): Hsv {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h: round(h), s: round(max === 0 ? 0 : (delta / max) * 100), v: round(max * 100) };
}

export function rgbToCmyk(rgb: Rgb): Cmyk {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: round(((1 - r - k) / (1 - k)) * 100),
    m: round(((1 - g - k) / (1 - k)) * 100),
    y: round(((1 - b - k) / (1 - k)) * 100),
    k: round(k * 100),
  };
}

export function relativeLuminance(rgb: Rgb): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const l1 = relativeLuminance(first);
  const l2 = relativeLuminance(second);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return round((lighter + 0.05) / (darker + 0.05));
}

function rgbToLab(rgb: Rgb): { l: number; a: number; b: number } {
  const toLinear = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (value: number): number => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: round(116 * fy - 16), a: round(500 * (fx - fy)), b: round(200 * (fy - fz)) };
}

// CSS Color Module Level 4 named colours — a fixed standard, not a guess.
export const CSS_NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff',
  beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff',
  blueviolet: '#8a2be2', brown: '#a52a2a', burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
  chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9',
  darkgreen: '#006400', darkkhaki: '#bdb76b', darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00',
  darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff',
  dimgray: '#696969', dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520',
  gray: '#808080', green: '#008000', greenyellow: '#adff2f', honeydew: '#f0fff0', hotpink: '#ff69b4',
  indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
  lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90', lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff',
  maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db',
  mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23',
  orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98',
  paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f',
  pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072',
  sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0',
  skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090', snow: '#fffafa', springgreen: '#00ff7f',
  steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347',
  turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5',
  yellow: '#ffff00', yellowgreen: '#9acd32',
};

export function toColorRepresentation(input: string): ColorRepresentation {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw invalidInput('Enter a colour such as #336699, rgb(51,102,153) or hsl(210,50%,40%).');

  let rgb: Rgb;
  const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i.exec(trimmed);
  const hslMatch = /^hsla?\(\s*(-?[\d.]+)\s*[,\s]\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%?/i.exec(trimmed);
  if (rgbMatch) {
    rgb = { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
    if ([rgb.r, rgb.g, rgb.b].some((channel) => channel > 255)) throw invalidInput('RGB channels must be between 0 and 255.');
  } else if (hslMatch) {
    rgb = hslToRgb({ h: Number(hslMatch[1]), s: Number(hslMatch[2]), l: Number(hslMatch[3]) });
  } else if (CSS_NAMED_COLORS[trimmed.toLowerCase()]) {
    rgb = hexToRgb(CSS_NAMED_COLORS[trimmed.toLowerCase()]!);
  } else {
    rgb = hexToRgb(trimmed);
  }

  const hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);
  const hex = rgbToHex(rgb);
  const luminance = relativeLuminance(rgb);
  const perceivedBrightness = round(Math.sqrt(0.299 * rgb.r ** 2 + 0.587 * rgb.g ** 2 + 0.114 * rgb.b ** 2) / 255, 4);

  let nearest: ColorRepresentation['nearestNamedColor'] = null;
  for (const [name, value] of Object.entries(CSS_NAMED_COLORS)) {
    const candidate = hexToRgb(value);
    const distance = Math.sqrt((candidate.r - rgb.r) ** 2 + (candidate.g - rgb.g) ** 2 + (candidate.b - rgb.b) ** 2);
    if (!nearest || distance < nearest.distance) nearest = { name, hex: value, distance: round(distance, 1) };
  }

  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  const whiteRatio = contrastRatio(rgb, white);
  const blackRatio = contrastRatio(rgb, black);
  const preferred = whiteRatio >= blackRatio ? { hex: '#ffffff', ratio: whiteRatio } : { hex: '#000000', ratio: blackRatio };

  return {
    input: trimmed,
    hex,
    hexShort: /^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i.exec(hex) ? `#${hex[1]}${hex[3]}${hex[5]}` : null,
    rgb,
    rgbCss: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    hsl,
    hslCss: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    hsv,
    cmyk: rgbToCmyk(rgb),
    lab: rgbToLab(rgb),
    luminance: round(luminance, 4),
    perceivedBrightness,
    nearestNamedColor: nearest,
    isDark: luminance < 0.179,
    textColorForContrast: { hex: preferred.hex, ratio: preferred.ratio, passesAA: preferred.ratio >= 4.5 },
  };
}

export interface ContrastResult {
  foreground: { input: string; hex: string };
  background: { input: string; hex: string };
  ratio: number;
  wcag: {
    normalTextAA: boolean;
    normalTextAAA: boolean;
    largeTextAA: boolean;
    largeTextAAA: boolean;
    nonTextAA: boolean;
    uiComponentsAA: boolean;
  };
  recommendation: string;
  alternatives: Array<{ hex: string; ratio: number; detail: string }>;
  notes: string[];
}

export function contrastCheck(input: { foreground: string; background: string }): ContrastResult {
  const foreground = toColorRepresentation(input.foreground);
  const background = toColorRepresentation(input.background);
  const ratio = contrastRatio(foreground.rgb, background.rgb);

  const alternatives: ContrastResult['alternatives'] = [];
  const base = foreground.hsl;
  for (const delta of [-40, -30, -20, -10, 10, 20, 30, 40]) {
    const candidate = hslToRgb({ h: base.h, s: base.s, l: clamp(base.l + delta, 0, 100) });
    const candidateRatio = contrastRatio(candidate, background.rgb);
    if (candidateRatio >= 4.5 && candidateRatio > ratio) {
      alternatives.push({ hex: rgbToHex(candidate), ratio: candidateRatio, detail: `Same hue and saturation, lightness ${delta > 0 ? '+' : ''}${delta}.` });
    }
    if (alternatives.length >= 4) break;
  }

  return {
    foreground: { input: foreground.input, hex: foreground.hex },
    background: { input: background.input, hex: background.hex },
    ratio,
    wcag: {
      normalTextAA: ratio >= 4.5,
      normalTextAAA: ratio >= 7,
      largeTextAA: ratio >= 3,
      largeTextAAA: ratio >= 4.5,
      nonTextAA: ratio >= 3,
      uiComponentsAA: ratio >= 3,
    },
    recommendation:
      ratio >= 7
        ? 'This pair passes WCAG AAA for normal text.'
        : ratio >= 4.5
          ? 'This pair passes WCAG AA for normal text but not AAA.'
          : ratio >= 3
            ? 'This pair passes only for large text (18pt/14pt bold) and graphical objects, not for body text.'
            : 'This pair fails WCAG AA for text. Change the foreground or background lightness before shipping it.',
    alternatives,
    notes: [
      'Ratios are computed with the WCAG 2.x formula on sRGB relative luminance. Alpha is ignored: enter opaque colours.',
      'WCAG AA needs 4.5:1 for normal text and 3:1 for large text; AAA needs 7:1 and 4.5:1. "Large" means 18pt (24px) or 14pt (18.66px) bold.',
      'Contrast is about legibility, not beauty. A passing ratio can still look bad, and a failing one can still be the right choice for decorative text.',
    ],
  };
}

export type PaletteKind = 'complementary' | 'analogous' | 'triadic' | 'split-complementary' | 'tetradic' | 'monochromatic' | 'shades' | 'tints';

export interface PaletteResult {
  base: ColorRepresentation;
  kind: PaletteKind;
  colors: Array<{ hex: string; hsl: Hsl; label: string; contrastWithBase: number }>;
  notes: string[];
}

export function palette(input: { color: string; kind: PaletteKind }): PaletteResult {
  const base = toColorRepresentation(input.color);
  const entries: Array<{ hsl: Hsl; label: string }> = [];
  const { h, s, l } = base.hsl;

  switch (input.kind) {
    case 'complementary':
      entries.push({ hsl: { h: (h + 180) % 360, s, l }, label: 'Complement (opposite hue)' });
      break;
    case 'analogous':
      entries.push({ hsl: { h: (h + 330) % 360, s, l }, label: 'Analogous −30°' });
      entries.push({ hsl: { h: (h + 30) % 360, s, l }, label: 'Analogous +30°' });
      break;
    case 'triadic':
      entries.push({ hsl: { h: (h + 120) % 360, s, l }, label: 'Triad +120°' });
      entries.push({ hsl: { h: (h + 240) % 360, s, l }, label: 'Triad +240°' });
      break;
    case 'split-complementary':
      entries.push({ hsl: { h: (h + 150) % 360, s, l }, label: 'Split complement +150°' });
      entries.push({ hsl: { h: (h + 210) % 360, s, l }, label: 'Split complement +210°' });
      break;
    case 'tetradic':
      entries.push({ hsl: { h: (h + 90) % 360, s, l }, label: 'Tetrad +90°' });
      entries.push({ hsl: { h: (h + 180) % 360, s, l }, label: 'Tetrad +180°' });
      entries.push({ hsl: { h: (h + 270) % 360, s, l }, label: 'Tetrad +270°' });
      break;
    case 'monochromatic':
      for (const delta of [-30, -15, 15, 30]) entries.push({ hsl: { h, s, l: clamp(l + delta, 0, 100) }, label: `Lightness ${delta > 0 ? '+' : ''}${delta}` });
      break;
    case 'shades':
      for (const step of [20, 40, 60, 80]) entries.push({ hsl: { h, s, l: clamp(l * (1 - step / 100), 0, 100) }, label: `Shade −${step}% lightness` });
      break;
    case 'tints':
      for (const step of [20, 40, 60, 80]) entries.push({ hsl: { h, s, l: clamp(l + (100 - l) * (step / 100), 0, 100) }, label: `Tint +${step}% toward white` });
      break;
    default:
      throw invalidInput('Choose one of: complementary, analogous, triadic, split-complementary, tetradic, monochromatic, shades or tints.');
  }

  return {
    base,
    kind: input.kind,
    colors: entries.map((entry) => {
      const rgb = hslToRgb(entry.hsl);
      return { hex: rgbToHex(rgb), hsl: { h: round(entry.hsl.h), s: round(entry.hsl.s), l: round(entry.hsl.l) }, label: entry.label, contrastWithBase: contrastRatio(rgb, base.rgb) };
    }),
    notes: [
      'Palettes are generated by rotating hue or adjusting lightness in HSL. They are starting points for exploration, not a guarantee of accessibility or brand fit.',
      'Check every pairing you intend to use with the contrast checker — in particular, text on a tint or a shade.',
    ],
  };
}

export interface ColorBlindnessResult {
  base: ColorRepresentation;
  simulations: Array<{ type: string; hex: string; prevalence: string; note: string }>;
  notes: string[];
}

/**
 * Colour-vision simulations use the Machado, Oliveira & Fernandes (2009) severity-1.0 matrices on
 * linear RGB. They are an approximation of a perceptual condition, used as a design sanity check.
 */
export function colorBlindness(input: { color: string }): ColorBlindnessResult {
  const base = toColorRepresentation(input.color);
  const matrices: Array<{ type: string; matrix: number[][]; prevalence: string; note: string }> = [
    {
      type: 'Protanopia',
      matrix: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
      prevalence: 'about 1% of men, 0.01% of women',
      note: 'Reduced sensitivity to red (L cone loss).',
    },
    {
      type: 'Deuteranopia',
      matrix: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
      prevalence: 'about 1.3% of men, 0.01% of women',
      note: 'Reduced sensitivity to green (M cone loss) — the most common form.',
    },
    {
      type: 'Tritanopia',
      matrix: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
      prevalence: 'about 0.01% of people',
      note: 'Reduced sensitivity to blue-yellow (S cone loss).',
    },
    {
      type: 'Achromatopsia',
      matrix: [[0.299, 0.587, 0.114], [0.299, 0.587, 0.114], [0.299, 0.587, 0.114]],
      prevalence: 'about 0.003% of people',
      note: 'Total colour blindness (rod monochromacy); the matrix is the standard luminance conversion.',
    },
  ];

  const toLinear = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const toSrgb = (value: number): number => {
    const v = clamp(value, 0, 1);
    return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
  };

  const linear = [toLinear(base.rgb.r), toLinear(base.rgb.g), toLinear(base.rgb.b)];
  return {
    base,
    simulations: matrices.map((entry) => {
      const [r, g, b] = entry.matrix.map((row) => row[0]! * linear[0]! + row[1]! * linear[1]! + row[2]! * linear[2]!);
      return {
        type: entry.type,
        hex: rgbToHex({ r: toSrgb(r!), g: toSrgb(g!), b: toSrgb(b!) }),
        prevalence: entry.prevalence,
        note: entry.note,
      };
    }),
    notes: [
      'Simulations apply published colour-vision-deficiency matrices in linear RGB. Real perception varies between individuals and severities; use this to check that information is not carried by colour alone.',
      'The practical test is whether your design still works when hue is removed: check labels, icons, patterns and contrast, not just the simulated swatch.',
    ],
  };
}

export { invalidInput as colorInvalidInput };
