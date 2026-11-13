/**
 * A reader for the PDF files the Design Studio writes, used only by tests.
 *
 * The print file is the deliverable, so the tests examine the bytes a user downloads rather than
 * the drawing operations that went into them. This module does the two things that requires:
 *
 *  1. It checks the file's structure the way a strict reader would: every cross-reference entry
 *     must point at the object it names, every stream must be exactly as long as it declares, and
 *     the page tree must lead to the pages. Faults are collected in `problems`; a sound file has
 *     none.
 *  2. It replays a page's content stream (path construction, fills, strokes, the transformation
 *     matrix, form XObjects) and returns the painted shapes in millimetres from the page's top-left
 *     corner. Rasterised by `studio-raster.ts` and handed to the decoder, that answers "does the
 *     printed page carry a readable symbol, at the right size, in the right place" from the file
 *     alone.
 *
 * It understands the operators the studio's writer emits and reports any other operator it meets
 * in `unknownOperators`, so a change to the writer cannot quietly escape the tests. It is not a
 * general PDF library. Text is collected as strings, not drawn.
 */

import { inflateSync } from 'node:zlib';
import type { PathSegment, StudioOp } from '../../src/tools/design-studio/render/draw-ops';

const PT_PER_MM = 72 / 25.4;

export interface PdfObject {
  id: number;
  /** Byte offset of `N 0 obj`, as the cross-reference table gives it. */
  offset: number;
  dictionary: string;
  /** Stream data after any Flate decoding, or null for an object without a stream. */
  stream: Uint8Array | null;
  /** The stream's length in the file, before decoding. */
  storedLength: number;
}

export interface PdfPageInfo {
  objectId: number;
  widthPt: number;
  heightPt: number;
  widthMm: number;
  heightMm: number;
  contentsId: number;
  resourcesId: number;
}

export interface ParsedPdf {
  version: string;
  objects: Map<number, PdfObject>;
  pages: PdfPageInfo[];
  catalog: string;
  info: string;
  /** Structural faults. Empty for a sound file. */
  problems: string[];
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

/** The index just past a dictionary that starts at `start` (which must be `<<`), or -1. */
function dictionaryEnd(text: string, start: number): number {
  if (!text.startsWith('<<', start)) return -1;
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '(') {
      // Literal string: skip to the matching parenthesis, honouring escapes and nesting.
      let nesting = 1;
      index += 1;
      while (index < text.length && nesting > 0) {
        if (text[index] === '\\') index += 1;
        else if (text[index] === '(') nesting += 1;
        else if (text[index] === ')') nesting -= 1;
        index += 1;
      }
      continue;
    }
    if (text.startsWith('<<', index)) {
      depth += 1;
      index += 2;
      continue;
    }
    if (text.startsWith('>>', index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }
  return -1;
}

function reference(dictionary: string, key: string): number | null {
  const match = new RegExp(`/${key} (\\d+) 0 R`).exec(dictionary);
  return match ? Number(match[1]) : null;
}

/** Parse a PDF written with a classic cross-reference table. Never throws: faults go to `problems`. */
export function parsePdf(bytes: Uint8Array): ParsedPdf {
  const text = latin1(bytes);
  const problems: string[] = [];
  const objects = new Map<number, PdfObject>();
  const result: ParsedPdf = { version: '', objects, pages: [], catalog: '', info: '', problems };

  const header = /^%PDF-(\d\.\d)\n/.exec(text);
  if (!header) problems.push('The file does not start with a %PDF header.');
  else result.version = header[1] as string;

  const tail = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  if (!tail) {
    problems.push('The file does not end with startxref, an offset and %%EOF.');
    return result;
  }
  const xrefOffset = Number(tail[1]);
  const xrefHeader = /^xref\n0 (\d+)\n/.exec(text.slice(xrefOffset, xrefOffset + 32));
  if (!xrefHeader) {
    problems.push(`startxref points at byte ${xrefOffset}, which is not a cross-reference table.`);
    return result;
  }
  const size = Number(xrefHeader[1]);
  const tableStart = xrefOffset + xrefHeader[0].length;
  const trailerAt = tableStart + size * 20;
  const trailer = text.slice(trailerAt);
  if (!trailer.startsWith('trailer\n')) problems.push('The cross-reference table is not followed by the trailer: an entry is not 20 bytes long.');
  const trailerSize = /\/Size (\d+)/.exec(trailer);
  if (!trailerSize || Number(trailerSize[1]) !== size) problems.push('The trailer /Size does not match the cross-reference table.');

  for (let id = 0; id < size; id += 1) {
    const entry = text.slice(tableStart + id * 20, tableStart + id * 20 + 20);
    const match = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(entry);
    if (!match) {
      problems.push(`Cross-reference entry ${id} is malformed.`);
      continue;
    }
    if (id === 0) {
      if (match[3] !== 'f' || match[2] !== '65535') problems.push('Cross-reference entry 0 must be the free-list head.');
      continue;
    }
    if (match[3] !== 'n') {
      problems.push(`Object ${id} is marked free.`);
      continue;
    }
    const offset = Number(match[1]);
    const head = `${id} 0 obj\n`;
    if (!text.startsWith(head, offset)) {
      problems.push(`The cross-reference offset for object ${id} (${offset}) does not point at "${id} 0 obj".`);
      continue;
    }
    const bodyStart = offset + head.length;
    const dictEnd = dictionaryEnd(text, bodyStart);
    if (dictEnd < 0) {
      problems.push(`Object ${id} does not hold a dictionary.`);
      continue;
    }
    const dictionary = text.slice(bodyStart, dictEnd);
    let stream: Uint8Array | null = null;
    let storedLength = 0;
    let after = dictEnd;
    if (text.startsWith('\nstream\n', dictEnd)) {
      const declared = /\/Length (\d+)/.exec(dictionary);
      if (!declared) {
        problems.push(`Stream object ${id} has no /Length.`);
        continue;
      }
      storedLength = Number(declared[1]);
      const dataStart = dictEnd + '\nstream\n'.length;
      if (!text.startsWith('\nendstream', dataStart + storedLength)) {
        problems.push(`Stream object ${id} is not ${storedLength} bytes long as its /Length says.`);
        continue;
      }
      const raw = bytes.subarray(dataStart, dataStart + storedLength);
      if (/\/Filter \/FlateDecode/.test(dictionary)) {
        try {
          stream = new Uint8Array(inflateSync(Buffer.from(raw)));
        } catch {
          problems.push(`Stream object ${id} is marked FlateDecode but does not inflate.`);
          continue;
        }
      } else if (/\/Filter/.test(dictionary) && !/\/Filter \/DCTDecode/.test(dictionary)) {
        problems.push(`Stream object ${id} uses a filter this reader does not know.`);
        continue;
      } else {
        stream = raw;
      }
      after = dataStart + storedLength + '\nendstream'.length;
    }
    if (!text.startsWith('\nendobj\n', after)) problems.push(`Object ${id} is not closed by endobj.`);
    objects.set(id, { id, offset, dictionary, stream, storedLength });
  }

  const rootId = reference(trailer, 'Root');
  const infoId = reference(trailer, 'Info');
  const catalog = rootId === null ? undefined : objects.get(rootId);
  if (!catalog || !/\/Type \/Catalog/.test(catalog.dictionary)) {
    problems.push('The trailer /Root does not lead to a catalog.');
    return result;
  }
  result.catalog = catalog.dictionary;
  result.info = infoId === null ? '' : (objects.get(infoId)?.dictionary ?? '');

  const pagesId = reference(catalog.dictionary, 'Pages');
  const tree = pagesId === null ? undefined : objects.get(pagesId);
  if (!tree || !/\/Type \/Pages/.test(tree.dictionary)) {
    problems.push('The catalog /Pages does not lead to a page tree.');
    return result;
  }
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(tree.dictionary)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((match) => Number(match[1]));
  const count = Number(/\/Count (\d+)/.exec(tree.dictionary)?.[1] ?? -1);
  if (count !== kids.length) problems.push(`The page tree /Count is ${count} but it lists ${kids.length} pages.`);
  for (const kid of kids) {
    const page = objects.get(kid);
    const box = page ? /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(page.dictionary) : null;
    const contentsId = page ? reference(page.dictionary, 'Contents') : null;
    const resourcesId = page ? reference(page.dictionary, 'Resources') : null;
    if (!page || !/\/Type \/Page\b/.test(page.dictionary) || !box || contentsId === null || resourcesId === null) {
      problems.push(`Page object ${kid} is incomplete.`);
      continue;
    }
    if (reference(page.dictionary, 'Parent') !== pagesId) problems.push(`Page object ${kid} does not point back at the page tree.`);
    if (!objects.get(contentsId)?.stream) problems.push(`Page object ${kid} has no content stream.`);
    const widthPt = Number(box[1]);
    const heightPt = Number(box[2]);
    result.pages.push({ objectId: kid, widthPt, heightPt, widthMm: widthPt / PT_PER_MM, heightMm: heightPt / PT_PER_MM, contentsId, resourcesId });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Content stream replay                                               */
/* ------------------------------------------------------------------ */

type Matrix = [number, number, number, number, number, number];
type Point = { x: number; y: number };

/** `m` applied first, then `ctm`: the order in which PDF concatenates a `cm` operand. */
function multiply(m: Matrix, ctm: Matrix): Matrix {
  return [
    m[0] * ctm[0] + m[1] * ctm[2],
    m[0] * ctm[1] + m[1] * ctm[3],
    m[2] * ctm[0] + m[3] * ctm[2],
    m[2] * ctm[1] + m[3] * ctm[3],
    m[4] * ctm[0] + m[5] * ctm[2] + ctm[4],
    m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
  ];
}

function apply(ctm: Matrix, x: number, y: number): Point {
  return { x: x * ctm[0] + y * ctm[2] + ctm[4], y: x * ctm[1] + y * ctm[3] + ctm[5] };
}

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'string'; value: string } | { kind: 'array'; value: number[] } | { kind: 'operator'; value: string };

function tokenise(content: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\n' || char === '\r' || char === '\t';
  const isDelimiter = (char: string | undefined): boolean => char === undefined || isSpace(char) || '()[]<>/%'.includes(char);
  while (index < content.length) {
    const char = content[index] as string;
    if (isSpace(char)) {
      index += 1;
    } else if (char === '(') {
      let value = '';
      let nesting = 1;
      index += 1;
      while (index < content.length && nesting > 0) {
        const current = content[index] as string;
        if (current === '\\') {
          const next = content[index + 1] as string;
          const octal = /^[0-7]{1,3}/.exec(content.slice(index + 1, index + 4));
          if (octal) {
            value += String.fromCharCode(parseInt(octal[0], 8));
            index += 1 + octal[0].length;
          } else {
            value += next;
            index += 2;
          }
          continue;
        }
        if (current === '(') nesting += 1;
        if (current === ')') {
          nesting -= 1;
          if (nesting === 0) {
            index += 1;
            break;
          }
        }
        value += current;
        index += 1;
      }
      tokens.push({ kind: 'string', value });
    } else if (char === '[') {
      const end = content.indexOf(']', index);
      const value = content
        .slice(index + 1, end)
        .trim()
        .split(/\s+/)
        .filter((part) => part !== '')
        .map(Number);
      tokens.push({ kind: 'array', value });
      index = end + 1;
    } else if (char === '/') {
      let end = index + 1;
      while (!isDelimiter(content[end])) end += 1;
      tokens.push({ kind: 'name', value: content.slice(index + 1, end) });
      index = end;
    } else {
      let end = index;
      while (!isDelimiter(content[end])) end += 1;
      if (end === index) end += 1;
      const word = content.slice(index, end);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) tokens.push({ kind: 'number', value: Number(word) });
      else tokens.push({ kind: 'operator', value: word });
      index = end;
    }
  }
  return tokens;
}

export interface PdfText {
  text: string;
  /** Position of the start of the run, millimetres from the top-left of the page. */
  x: number;
  y: number;
  /** Font size in millimetres on the page. */
  sizeMm: number;
  font: string;
}

export interface ReplayedPage {
  widthMm: number;
  heightMm: number;
  /** Painted shapes, millimetres from the top-left corner of the page, in painting order. */
  ops: StudioOp[];
  texts: PdfText[];
  /** Each `Do` of a form XObject: its name and the matrix in force, in page millimetres. */
  placements: Array<{ name: string; x: number; y: number; scaleX: number; scaleY: number; rotated: boolean }>;
  images: number;
  unknownOperators: string[];
}

interface GraphicsState {
  ctm: Matrix;
  fill: string;
  stroke: string;
  lineWidth: number;
}

function hex(r: number, g: number, b: number): string {
  const channel = (value: number): string => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Replay one page and return what it paints. */
export function replayPage(pdf: ParsedPdf, pageIndex: number): ReplayedPage {
  const page = pdf.pages[pageIndex];
  if (!page) throw new Error(`The PDF has no page ${pageIndex + 1}.`);
  const out: ReplayedPage = { widthMm: page.widthMm, heightMm: page.heightMm, ops: [], texts: [], placements: [], images: 0, unknownOperators: [] };
  // Device space is PDF points with the origin at the bottom-left; results are reported in
  // millimetres from the top-left, which is how the labels are specified.
  const toPage = (point: Point): Point => ({ x: point.x / PT_PER_MM, y: (page.heightPt - point.y) / PT_PER_MM });

  const run = (content: string, resourcesId: number, initial: GraphicsState, depth: number): void => {
    const resources = pdf.objects.get(resourcesId)?.dictionary ?? '';
    const xobjects = new Map<string, number>();
    const xobjectBlock = /\/XObject << ([^>]*) >>/.exec(resources)?.[1] ?? '';
    for (const match of xobjectBlock.matchAll(/\/(\S+) (\d+) 0 R/g)) xobjects.set(match[1] as string, Number(match[2]));
    const fonts = new Map<string, string>();
    const fontBlock = /\/Font << ([^>]*) >>/.exec(resources)?.[1] ?? '';
    for (const match of fontBlock.matchAll(/\/(\S+) (\d+) 0 R/g)) {
      fonts.set(match[1] as string, /\/BaseFont \/(\S+)/.exec(pdf.objects.get(Number(match[2]))?.dictionary ?? '')?.[1] ?? '?');
    }

    let state: GraphicsState = { ...initial, ctm: [...initial.ctm] as Matrix };
    const stack: GraphicsState[] = [];
    let subpaths: Array<{ points: Point[]; closed: boolean }> = [];
    let current: { points: Point[]; closed: boolean } | null = null;
    let pen: Point = { x: 0, y: 0 };
    let inText = false;
    let font = '?';
    let fontSize = 0;
    let textMatrix: Matrix = [1, 0, 0, 1, 0, 0];
    const operands: Token[] = [];
    const numbers = (): number[] => operands.map((token) => (token.kind === 'number' ? token.value : Number.NaN));

    const fillPath = (rule: 'nonzero' | 'evenodd'): void => {
      const segments: PathSegment[] = [];
      for (const subpath of subpaths) {
        if (subpath.points.length < 3) continue;
        subpath.points.forEach((point, index) => {
          const placed = toPage(point);
          segments.push({ type: index === 0 ? 'M' : 'L', x: placed.x, y: placed.y });
        });
        segments.push({ type: 'Z' });
      }
      if (segments.length > 0) out.ops.push({ kind: 'path', segments, fill: state.fill, fillRule: rule });
    };
    const strokePath = (): void => {
      const scale = Math.sqrt(Math.abs(state.ctm[0] * state.ctm[3] - state.ctm[1] * state.ctm[2]));
      const width = (state.lineWidth * scale) / PT_PER_MM;
      for (const subpath of subpaths) {
        const points = subpath.points.map(toPage);
        const last = subpath.closed ? points.length : points.length - 1;
        for (let index = 0; index < last; index += 1) {
          const a = points[index] as Point;
          const b = points[(index + 1) % points.length] as Point;
          if (a.x === b.x && a.y === b.y) continue;
          out.ops.push({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: state.stroke, width });
        }
      }
    };
    const endPath = (): void => {
      subpaths = [];
      current = null;
    };

    for (const token of tokenise(content)) {
      if (token.kind !== 'operator') {
        operands.push(token);
        continue;
      }
      const args = numbers();
      switch (token.value) {
        case 'q':
          stack.push({ ...state, ctm: [...state.ctm] as Matrix });
          break;
        case 'Q':
          state = stack.pop() ?? state;
          break;
        case 'cm':
          state.ctm = multiply(args as Matrix, state.ctm);
          break;
        case 'rg':
          state.fill = hex(args[0] as number, args[1] as number, args[2] as number);
          break;
        case 'RG':
          state.stroke = hex(args[0] as number, args[1] as number, args[2] as number);
          break;
        case 'w':
          state.lineWidth = args[0] as number;
          break;
        case 'd':
        case 'gs':
          break;
        case 're': {
          const [x, y, w, h] = args as [number, number, number, number];
          subpaths.push({ points: [apply(state.ctm, x, y), apply(state.ctm, x + w, y), apply(state.ctm, x + w, y + h), apply(state.ctm, x, y + h)], closed: true });
          current = null;
          break;
        }
        case 'm':
          current = { points: [apply(state.ctm, args[0] as number, args[1] as number)], closed: false };
          subpaths.push(current);
          pen = { x: args[0] as number, y: args[1] as number };
          break;
        case 'l':
          current?.points.push(apply(state.ctm, args[0] as number, args[1] as number));
          pen = { x: args[0] as number, y: args[1] as number };
          break;
        case 'c': {
          const [x1, y1, x2, y2, x3, y3] = args as [number, number, number, number, number, number];
          for (let step = 1; step <= 12; step += 1) {
            const t = step / 12;
            const u = 1 - t;
            current?.points.push(
              apply(state.ctm, u * u * u * pen.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * pen.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3)
            );
          }
          pen = { x: x3, y: y3 };
          break;
        }
        case 'h':
          if (current) current.closed = true;
          break;
        case 'f':
        case 'F':
          fillPath('nonzero');
          endPath();
          break;
        case 'f*':
          fillPath('evenodd');
          endPath();
          break;
        case 'B':
          fillPath('nonzero');
          strokePath();
          endPath();
          break;
        case 'S':
          strokePath();
          endPath();
          break;
        case 'W':
          break;
        case 'n':
          endPath();
          break;
        case 'BT':
          inText = true;
          textMatrix = [1, 0, 0, 1, 0, 0];
          break;
        case 'ET':
          inText = false;
          break;
        case 'Tf':
          font = fonts.get(operands[0]?.kind === 'name' ? operands[0].value : '') ?? '?';
          fontSize = operands[1]?.kind === 'number' ? operands[1].value : 0;
          break;
        case 'Tm':
          textMatrix = args as Matrix;
          break;
        case 'Tc':
          break;
        case 'Tj': {
          const first = operands[0];
          if (inText && first?.kind === 'string') {
            const matrix = multiply(textMatrix, state.ctm);
            const origin = toPage(apply(matrix, 0, 0));
            const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
            out.texts.push({ text: first.value, x: origin.x, y: origin.y, sizeMm: (fontSize * scale) / PT_PER_MM, font });
          }
          break;
        }
        case 'Do': {
          const name = operands[0]?.kind === 'name' ? operands[0].value : '';
          const target = pdf.objects.get(xobjects.get(name) ?? -1);
          if (!target) {
            out.unknownOperators.push(`Do /${name} (no such XObject)`);
          } else if (/\/Subtype \/Image/.test(target.dictionary)) {
            out.images += 1;
          } else if (/\/Subtype \/Form/.test(target.dictionary) && target.stream && depth < 4) {
            const origin = toPage(apply(state.ctm, 0, 0));
            out.placements.push({
              name,
              x: origin.x,
              y: origin.y,
              // Millimetres on the page per unit of the form: 1 when the artwork is at true size.
              scaleX: Math.hypot(state.ctm[0], state.ctm[1]) / PT_PER_MM,
              scaleY: Math.hypot(state.ctm[2], state.ctm[3]) / PT_PER_MM,
              rotated: Math.abs(state.ctm[1]) > 1e-9 || Math.abs(state.ctm[2]) > 1e-9,
            });
            run(latin1(target.stream), reference(target.dictionary, 'Resources') ?? resourcesId, state, depth + 1);
          }
          break;
        }
        default:
          if (!out.unknownOperators.includes(token.value)) out.unknownOperators.push(token.value);
      }
      operands.length = 0;
    }
  };

  const contents = pdf.objects.get(page.contentsId)?.stream;
  if (contents) run(latin1(contents), page.resourcesId, { ctm: [1, 0, 0, 1, 0, 0], fill: '#000000', stroke: '#000000', lineWidth: 1 }, 0);
  return out;
}

/** The base fonts a document refers to, and whether any font program is embedded. */
export function pdfFonts(pdf: ParsedPdf): { baseFonts: string[]; embedded: boolean } {
  const baseFonts: string[] = [];
  let embedded = false;
  for (const object of pdf.objects.values()) {
    if (/\/Type \/Font\b/.test(object.dictionary)) baseFonts.push(/\/BaseFont \/(\S+)/.exec(object.dictionary)?.[1] ?? '?');
    if (/\/FontFile/.test(object.dictionary)) embedded = true;
  }
  return { baseFonts: baseFonts.sort(), embedded };
}

/** How many image XObjects the document stores. */
export function pdfImageCount(pdf: ParsedPdf): number {
  return [...pdf.objects.values()].filter((object) => /\/Subtype \/Image/.test(object.dictionary)).length;
}
