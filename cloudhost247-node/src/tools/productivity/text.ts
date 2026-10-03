/**
 * Tools Center — text tools (spec §52 word/text tools): word counter, lorem ipsum, notepad
 * transformations, small-text converters, invisible-character inspector and the runic translator.
 *
 * All of it is pure string work: no I/O, no provider, nothing sent anywhere. Every number the word
 * counter reports is counted from the submitted text, and every readability score names the formula
 * it implements rather than producing an unexplained "grade level".
 */
import { invalidInput } from '../core/errors';

// ---------------------------------------------------------------------------------------------
// §52 Word counter
// ---------------------------------------------------------------------------------------------

export interface WordCounterResult {
  counts: {
    characters: number;
    charactersNoSpaces: number;
    words: number;
    uniqueWords: number;
    sentences: number;
    paragraphs: number;
    lines: number;
    syllables: number;
  };
  timing: { readingMinutes: number; speakingMinutes: number; assumptions: string };
  averages: { wordsPerSentence: number; charactersPerWord: number; syllablesPerWord: number };
  longestWord: { word: string; length: number } | null;
  keywordDensity: Array<{ word: string; count: number; percent: number }>;
  characterFrequency: Array<{ character: string; count: number }>;
  readability: {
    fleschReadingEase: number;
    fleschInterpretation: string;
    fleschKincaidGrade: number;
    gunningFog: number;
    colemanLiau: number;
    note: string;
  };
  limits: { maxCharacters: number; truncated: boolean };
}

const MAX_TEXT_CHARACTERS = 200_000;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'of', 'to', 'in', 'on',
  'at', 'by', 'for', 'with', 'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against',
  'during', 'without', 'before', 'under', 'around', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can', 'could', 'may',
  'might', 'must', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they', 'them', 'his', 'her', 'our', 'your', 'their',
  'not', 'no', 'so', 'up', 'down', 'from', 'also', 'there', 'here', 'when', 'where', 'which', 'who', 'what', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very',
]);

/** Counts syllables with the standard vowel-group heuristic — documented, not presented as exact. */
export function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length === 0) return 0;
  if (cleaned.length <= 3) return 1;
  const trimmed = cleaned
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fleschInterpretation(score: number): string {
  if (score >= 90) return 'Very easy (5th grade)';
  if (score >= 80) return 'Easy (6th grade)';
  if (score >= 70) return 'Fairly easy (7th grade)';
  if (score >= 60) return 'Plain English (8th–9th grade)';
  if (score >= 50) return 'Fairly difficult (10th–12th grade)';
  if (score >= 30) return 'Difficult (college)';
  return 'Very difficult (college graduate)';
}

export function wordCounter(text: string): WordCounterResult {
  if (typeof text !== 'string') throw invalidInput('Provide text to analyse.');
  const truncated = text.length > MAX_TEXT_CHARACTERS;
  const input = truncated ? text.slice(0, MAX_TEXT_CHARACTERS) : text;

  const characters = input.length;
  const charactersNoSpaces = input.replace(/\s/g, '').length;
  const wordList = input.match(/[\p{L}\p{N}'’_-]+/gu) ?? [];
  const words = wordList.length;
  const lowerWords = wordList.map((word) => word.toLowerCase());
  const uniqueWords = new Set(lowerWords).size;

  const sentenceParts = input.split(/[.!?…]+(?=\s|$)/).map((part) => part.trim()).filter((part) => part.length > 0);
  const sentences = sentenceParts.length;
  const paragraphs = input.split(/\n\s*\n/).map((part) => part.trim()).filter((part) => part.length > 0).length;
  const lines = input.split('\n').length;
  const syllables = wordList.reduce((sum, word) => sum + countSyllables(word), 0);

  const counts = new Map<string, number>();
  for (const word of lowerWords) counts.set(word, (counts.get(word) ?? 0) + 1);

  const keywordCounts = new Map<string, number>();
  for (const word of lowerWords) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    keywordCounts.set(word, (keywordCounts.get(word) ?? 0) + 1);
  }

  const characterCounts = new Map<string, number>();
  for (const character of input.toLowerCase()) {
    if (/\s/.test(character)) continue;
    characterCounts.set(character, (characterCounts.get(character) ?? 0) + 1);
  }

  const longest = wordList.reduce<{ word: string; length: number } | null>((best, word) => (best === null || word.length > best.length ? { word, length: word.length } : best), null);

  const sentencesSafe = Math.max(sentences, 1);
  const wordsSafe = Math.max(words, 1);
  const wordsPerSentence = round(words / sentencesSafe);
  const charactersPerWord = round(charactersNoSpaces / wordsSafe);
  const syllablesPerWord = round(syllables / wordsSafe, 3);

  const fleschReadingEase = round(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord);
  const fleschKincaidGrade = round(0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59);
  const complexWords = wordList.filter((word) => countSyllables(word) >= 3).length;
  const gunningFog = round(0.4 * (wordsPerSentence + 100 * (complexWords / wordsSafe)));
  const colemanLiau = round(0.0588 * ((charactersNoSpaces / wordsSafe) * 100) - 0.296 * ((sentences / wordsSafe) * 100) - 15.8);

  return {
    counts: { characters, charactersNoSpaces, words, uniqueWords, sentences, paragraphs, lines, syllables },
    timing: {
      readingMinutes: round(words / 200, 1),
      speakingMinutes: round(words / 130, 1),
      assumptions: 'Reading at 200 words per minute (average adult silent reading) and speaking at 130 words per minute (comfortable presentation pace).',
    },
    averages: { wordsPerSentence, charactersPerWord, syllablesPerWord },
    longestWord: longest,
    keywordDensity: [...keywordCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 25)
      .map(([word, count]) => ({ word, count, percent: round((count / wordsSafe) * 100) })),
    characterFrequency: [...characterCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([character, count]) => ({ character, count })),
    readability: {
      fleschReadingEase,
      fleschInterpretation: fleschInterpretation(fleschReadingEase),
      fleschKincaidGrade,
      gunningFog,
      colemanLiau,
      note:
        'Scores use the published formulas (Flesch 1948, Flesch–Kincaid, Gunning Fog, Coleman–Liau). Syllables are counted with a vowel-group heuristic, so treat the results as indicative; they assume sentences are delimited by . ! ? and do not understand abbreviations such as "e.g.".',
    },
    limits: { maxCharacters: MAX_TEXT_CHARACTERS, truncated },
  };
}

// ---------------------------------------------------------------------------------------------
// §52 Lorem ipsum
// ---------------------------------------------------------------------------------------------

const LOREM_WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'
).split(' ');

export interface LoremOptions {
  paragraphs?: number;
  sentencesPerParagraph?: number;
  wordsPerSentence?: number;
  startWithLorem?: boolean;
  format?: 'plain' | 'html';
  asList?: boolean;
}

export interface LoremResult {
  text: string;
  paragraphs: string[];
  counts: { paragraphs: number; sentences: number; words: number };
  notes: string[];
}

export function loremIpsum(options: LoremOptions = {}): LoremResult {
  const paragraphCount = Math.min(Math.max(options.paragraphs ?? 3, 1), 50);
  const sentencesPerParagraph = Math.min(Math.max(options.sentencesPerParagraph ?? 4, 1), 20);
  const wordsPerSentence = Math.min(Math.max(options.wordsPerSentence ?? 12, 3), 40);

  const paragraphs: string[] = [];
  for (let paragraphIndex = 0; paragraphIndex < paragraphCount; paragraphIndex += 1) {
    const sentences: string[] = [];
    for (let sentenceIndex = 0; sentenceIndex < sentencesPerParagraph; sentenceIndex += 1) {
      const words: string[] = [];
      if (paragraphIndex === 0 && sentenceIndex === 0 && options.startWithLorem !== false) {
        words.push('Lorem', 'ipsum', 'dolor', 'sit', 'amet');
      }
      while (words.length < wordsPerSentence) {
        words.push(LOREM_WORDS[Math.floor(Math.random() * LOREM_WORDS.length)] ?? 'lorem');
      }
      const sentence = words.join(' ');
      sentences.push(`${sentence[0]?.toUpperCase() ?? 'L'}${sentence.slice(1)}.`);
    }
    paragraphs.push(sentences.join(' '));
  }

  const html = options.format === 'html';
  const text = html
    ? paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n')
    : options.asList
      ? paragraphs.map((paragraph) => `- ${paragraph}`).join('\n')
      : paragraphs.join('\n\n');

  return {
    text,
    paragraphs,
    counts: { paragraphs: paragraphCount, sentences: paragraphCount * sentencesPerParagraph, words: paragraphs.join(' ').split(/\s+/).length },
    notes: [
      'This is filler text for layout work. It is generated locally from the classic Latin word list and is not cached.',
      html ? 'The HTML variant escapes nothing because it contains only letters, spaces and periods.' : 'Line breaks separate paragraphs; enable the HTML or list option for structured output.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// §52 Notepad transformations
// ---------------------------------------------------------------------------------------------

export type TextOperation =
  | 'trim-lines'
  | 'trim-text'
  | 'collapse-spaces'
  | 'remove-blank-lines'
  | 'remove-line-breaks'
  | 'sort-lines-asc'
  | 'sort-lines-desc'
  | 'dedupe-lines'
  | 'reverse-lines'
  | 'number-lines'
  | 'strip-line-numbers'
  | 'upper'
  | 'lower'
  | 'title'
  | 'sentence-case'
  | 'slug'
  | 'escape-html'
  | 'unescape-html'
  | 'escape-csv'
  | 'strip-html';

export interface NotepadInput {
  text: string;
  operations: TextOperation[];
  find?: string;
  replace?: string;
  caseSensitive?: boolean;
}

export interface NotepadResult {
  text: string;
  applied: string[];
  stats: { charactersBefore: number; charactersAfter: number; linesBefore: number; linesAfter: number };
}

function titleCase(value: string): string {
  return value.replace(/\p{L}[\p{L}'’-]*/gu, (word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1).toLowerCase()}`);
}

function sentenceCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (match) => match.toUpperCase());
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function notepadTransform(input: NotepadInput): NotepadResult {
  if (typeof input.text !== 'string') throw invalidInput('Provide text to transform.');
  if (input.text.length > 500_000) throw invalidInput('The notepad accepts up to 500,000 characters per request.');
  const operations = input.operations ?? [];
  if (operations.length === 0 && input.find === undefined) {
    throw invalidInput('Select at least one transformation or provide a find/replace pair.');
  }

  let text = input.text;
  const charactersBefore = input.text.length;
  const linesBefore = input.text.split('\n').length;
  const applied: string[] = [];

  const uniqueOperations = [...new Set(operations)];
  for (const operation of uniqueOperations) {
    switch (operation) {
      case 'trim-lines':
        text = text.split('\n').map((line) => line.trim()).join('\n');
        break;
      case 'trim-text':
        text = text.trim();
        break;
      case 'collapse-spaces':
        text = text.replace(/[ \t]+/g, ' ');
        break;
      case 'remove-blank-lines':
        text = text.split('\n').filter((line) => line.trim().length > 0).join('\n');
        break;
      case 'remove-line-breaks':
        text = text.replace(/\r?\n/g, ' ');
        break;
      case 'sort-lines-asc':
        text = text.split('\n').sort((a, b) => a.localeCompare(b)).join('\n');
        break;
      case 'sort-lines-desc':
        text = text.split('\n').sort((a, b) => b.localeCompare(a)).join('\n');
        break;
      case 'dedupe-lines': {
        const seen = new Set<string>();
        text = text.split('\n').filter((line) => (seen.has(line) ? false : (seen.add(line), true))).join('\n');
        break;
      }
      case 'reverse-lines':
        text = text.split('\n').reverse().join('\n');
        break;
      case 'number-lines':
        text = text.split('\n').map((line, index) => `${index + 1}. ${line}`).join('\n');
        break;
      case 'strip-line-numbers':
        text = text.split('\n').map((line) => line.replace(/^\s*\d+[.)]\s+/, '')).join('\n');
        break;
      case 'upper':
        text = text.toUpperCase();
        break;
      case 'lower':
        text = text.toLowerCase();
        break;
      case 'title':
        text = titleCase(text);
        break;
      case 'sentence-case':
        text = sentenceCase(text);
        break;
      case 'slug':
        text = text
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 200);
        break;
      case 'escape-html':
        text = escapeHtml(text);
        break;
      case 'unescape-html':
        text = unescapeHtml(text);
        break;
      case 'escape-csv':
        text = text.split('\n').map((line) => line.split(',').map(csvField).join(',')).join('\n');
        break;
      case 'strip-html':
        text = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        break;
      default:
        throw invalidInput(`"${operation}" is not a supported transformation.`);
    }
    applied.push(operation);
  }

  if (input.find !== undefined && input.find.length > 0) {
    if (input.find.length > 1000) throw invalidInput('The search text is limited to 1000 characters.');
    const flags = input.caseSensitive ? 'g' : 'gi';
    const escaped = input.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, flags), input.replace ?? '');
    applied.push(input.replace && input.replace.length > 0 ? 'replace' : 'remove-matches');
  }

  return {
    text,
    applied,
    stats: {
      charactersBefore,
      charactersAfter: text.length,
      linesBefore,
      linesAfter: text.split('\n').length,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// §52 Small text
// ---------------------------------------------------------------------------------------------

const SUPERSCRIPT: Record<string, string> = {
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ',
  o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', 0: '⁰', 1: '¹', 2: '²',
  3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
};

const SUBSCRIPT: Record<string, string> = {
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ',
  u: 'ᵤ', v: 'ᵥ', x: 'ₓ', 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
};

const WIDE_OFFSET = 0xfee0;
const MIRROR: Record<string, string> = {
  a: 'ɒ', b: 'd', c: 'ɔ', d: 'b', e: 'ɘ', f: 'Ꮈ', g: 'ǫ', h: 'ʜ', i: 'i', j: 'ꞁ', k: 'ʞ', l: 'l', m: 'm', n: 'n',
  o: 'o', p: 'q', q: 'p', r: 'ɿ', s: 'ƨ', t: 'ƚ', u: 'u', v: 'v', w: 'w', x: 'x', y: 'y', z: 'ƹ',
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '?': '¿', '!': '¡',
};

export type SmallTextStyle = 'superscript' | 'subscript' | 'small-caps' | 'wide' | 'mirror';

export interface SmallTextResult {
  input: string;
  style: SmallTextStyle;
  output: string;
  unmappedCharacters: string[];
  notes: string[];
}

export function smallText(input: { text: string; style: SmallTextStyle }): SmallTextResult {
  if (typeof input.text !== 'string' || input.text.length === 0) throw invalidInput('Enter the text to convert.');
  if (input.text.length > 5000) throw invalidInput('Small-text conversion is limited to 5000 characters.');
  const unmapped = new Set<string>();

  let output = '';
  switch (input.style) {
    case 'superscript':
    case 'subscript': {
      const table = input.style === 'superscript' ? SUPERSCRIPT : SUBSCRIPT;
      for (const character of input.text) {
        const lower = character.toLowerCase();
        const mapped = table[lower];
        if (mapped) output += mapped;
        else if (/\s/.test(character)) output += character;
        else {
          output += character;
          unmapped.add(character);
        }
      }
      break;
    }
    case 'small-caps':
      // There is no Unicode small-caps alphabet; the honest implementation is an upper-case
      // rendering with a note, rather than mapping to unrelated mathematical characters.
      output = input.text.toUpperCase();
      break;
    case 'wide':
      for (const character of input.text) {
        const code = character.codePointAt(0) ?? 0;
        if (code >= 33 && code <= 126) output += String.fromCodePoint(code + WIDE_OFFSET);
        else if (code === 32) output += '　';
        else {
          output += character;
          unmapped.add(character);
        }
      }
      break;
    case 'mirror': {
      const reversed = [...input.text.toLowerCase()].reverse().join('');
      for (const character of reversed) {
        const mapped = MIRROR[character];
        if (mapped) output += mapped;
        else if (/\s/.test(character)) output += character;
        else {
          output += character;
          unmapped.add(character);
        }
      }
      break;
    }
    default:
      throw invalidInput('Choose one of: superscript, subscript, small-caps, wide or mirror.');
  }

  return {
    input: input.text,
    style: input.style,
    output,
    unmappedCharacters: [...unmapped],
    notes: [
      'These characters are real Unicode codepoints, not styling. That means the result is copy-pasteable, but it is also a different string: a search for the original text will not match it, and some screen readers announce it poorly.',
      input.style === 'small-caps'
        ? 'Unicode has no small-caps alphabet. This tool therefore returns upper case and tells you so rather than substituting unrelated codepoints.'
        : 'Characters without an equivalent in the chosen style are left unchanged and listed above.',
      input.style === 'mirror' ? 'Mirroring reverses the character order as well; the output is a visual effect, not readable text.' : 'No meaning is changed — this is presentation only.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// §52 Invisible character inspector
// ---------------------------------------------------------------------------------------------

const INVISIBLE_NAMES: Array<{ codepoint: number; hex: string; name: string; note: string }> = [
  { codepoint: 0x200b, hex: 'U+200B', name: 'ZERO WIDTH SPACE', note: 'Invisible; used legitimately for line-break opportunities, abused to hide text.' },
  { codepoint: 0x200c, hex: 'U+200C', name: 'ZERO WIDTH NON-JOINER', note: 'Affects ligature and joining behaviour in Arabic and Indic scripts.' },
  { codepoint: 0x200d, hex: 'U+200D', name: 'ZERO WIDTH JOINER', note: 'Combines emoji sequences and joins characters in complex scripts.' },
  { codepoint: 0x2060, hex: 'U+2060', name: 'WORD JOINER', note: 'Prevents a line break at its position.' },
  { codepoint: 0xfeff, hex: 'U+FEFF', name: 'ZERO WIDTH NO-BREAK SPACE (BOM)', note: 'A byte-order mark that became text — common at the start of files.' },
  { codepoint: 0x00a0, hex: 'U+00A0', name: 'NO-BREAK SPACE', note: 'A space that will not be wrapped or collapsed by HTML.' },
  { codepoint: 0x00ad, hex: 'U+00AD', name: 'SOFT HYPHEN', note: 'A conditional hyphen that only appears when the word wraps.' },
  { codepoint: 0x2028, hex: 'U+2028', name: 'LINE SEPARATOR', note: 'A line break that is not \\n and breaks many parsers.' },
  { codepoint: 0x2029, hex: 'U+2029', name: 'PARAGRAPH SEPARATOR', note: 'A paragraph break that is not \\n\\n.' },
  { codepoint: 0x202a, hex: 'U+202A', name: 'LEFT-TO-RIGHT EMBEDDING', note: 'Bidirectional override; can reorder displayed text relative to its bytes.' },
  { codepoint: 0x202b, hex: 'U+202B', name: 'RIGHT-TO-LEFT EMBEDDING', note: 'Bidirectional override.' },
  { codepoint: 0x202c, hex: 'U+202C', name: 'POP DIRECTIONAL FORMATTING', note: 'Terminates a bidi override.' },
  { codepoint: 0x202d, hex: 'U+202D', name: 'LEFT-TO-RIGHT OVERRIDE', note: 'Forces the following characters to display left-to-right.' },
  { codepoint: 0x202e, hex: 'U+202E', name: 'RIGHT-TO-LEFT OVERRIDE', note: 'Forces the following characters to display right-to-left — the classic "filename spoof" character.' },
  { codepoint: 0x2066, hex: 'U+2066', name: 'LEFT-TO-RIGHT ISOLATE', note: 'Isolates a bidirectional run.' },
  { codepoint: 0x2067, hex: 'U+2067', name: 'RIGHT-TO-LEFT ISOLATE', note: 'Isolates a bidirectional run.' },
  { codepoint: 0x2068, hex: 'U+2068', name: 'FIRST STRONG ISOLATE', note: 'Isolates a bidirectional run with the direction of the first strong character.' },
  { codepoint: 0x2069, hex: 'U+2069', name: 'POP DIRECTIONAL ISOLATE', note: 'Terminates a bidi isolate.' },
  { codepoint: 0x180e, hex: 'U+180E', name: 'MONGOLIAN VOWEL SEPARATOR', note: 'Invisible or a space depending on the Unicode version.' },
  { codepoint: 0x115f, hex: 'U+115F', name: 'HANGUL CHOSEONG FILLER', note: 'Invisible filler used in Hangul composition.' },
];

const INVISIBLE_MAP = new Map(INVISIBLE_NAMES.map((entry) => [entry.codepoint, entry]));

export interface InvisibleCharacterFinding {
  index: number;
  line: number;
  column: number;
  hex: string;
  name: string;
  note: string;
}

export interface InvisibleCharacterResult {
  input: { characters: number; lines: number };
  findings: InvisibleCharacterFinding[];
  totals: Record<string, number>;
  mixedScripts: { scripts: string[]; suspicious: boolean; detail: string };
  cleanedText: string;
  notes: string[];
}

function scriptOf(codePoint: number): string | null {
  if (codePoint >= 0x41 && codePoint <= 0x7a) return 'Latin';
  if (codePoint >= 0x0400 && codePoint <= 0x04ff) return 'Cyrillic';
  if (codePoint >= 0x0370 && codePoint <= 0x03ff) return 'Greek';
  if (codePoint >= 0x0590 && codePoint <= 0x05ff) return 'Hebrew';
  if (codePoint >= 0x0600 && codePoint <= 0x06ff) return 'Arabic';
  if (codePoint >= 0x0900 && codePoint <= 0x097f) return 'Devanagari';
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return 'Han';
  if (codePoint >= 0x3040 && codePoint <= 0x30ff) return 'Japanese kana';
  if (codePoint >= 0xac00 && codePoint <= 0xd7af) return 'Hangul';
  return null;
}

export function invisibleCharacters(input: { text: string; clean?: boolean }): InvisibleCharacterResult {
  if (typeof input.text !== 'string' || input.text.length === 0) throw invalidInput('Paste the text to inspect.');
  if (input.text.length > 200_000) throw invalidInput('The inspector accepts up to 200,000 characters.');

  const findings: InvisibleCharacterFinding[] = [];
  const totals: Record<string, number> = {};
  const lines = input.text.split('\n');
  let index = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    for (let columnIndex = 0; columnIndex < line.length; columnIndex += 1) {
      const character = line[columnIndex] ?? '';
      const codePoint = character.codePointAt(0) ?? 0;
      const entry = INVISIBLE_MAP.get(codePoint);
      if (!entry) {
        index += 1;
        continue;
      }
      findings.push({ index, line: lineIndex + 1, column: columnIndex + 1, hex: entry.hex, name: entry.name, note: entry.note });
      totals[entry.name] = (totals[entry.name] ?? 0) + 1;
      index += 1;
    }
    index += 1; // account for the newline
  }

  const scripts = new Set<string>();
  for (const character of input.text) {
    const script = scriptOf(character.codePointAt(0) ?? 0);
    if (script) scripts.add(script);
  }
  const scriptList = [...scripts];
  const suspiciousScripts = scriptList.filter((script) => script !== 'Latin' && script !== 'Han' && script !== 'Japanese kana' && script !== 'Hangul' && script !== 'Devanagari');
  const suspicious = scriptList.includes('Latin') && suspiciousScripts.length > 0;

  return {
    input: { characters: input.text.length, lines: lines.length },
    findings,
    totals,
    mixedScripts: {
      scripts: scriptList,
      suspicious,
      detail: suspicious
        ? `The text mixes Latin with ${suspiciousScripts.join(', ')}. Characters from these scripts are used in homograph attacks because some look identical to Latin letters.`
        : 'No mixed-script combination that is commonly used for homograph spoofing was found.',
    },
    cleanedText: (input.clean ?? true) ? input.text.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').replace(/\u00a0/g, ' ') : input.text,
    notes: [
      'Legitimate text can contain these characters: emoji sequences use U+200D, Indic and Arabic scripts use U+200C/U+200D, and every UTF-8 file with a BOM starts with U+FEFF.',
      'Finding one is a reason to look closer, not proof of an attack. The right-to-left override characters (U+202D/U+202E) in a filename or a security warning are the classic abuse.',
      'Cleaning removes zero-width and bidirectional formatting characters and converts non-breaking spaces to ordinary spaces. It does not normalise the rest of your text.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// §52 Runic translator
// ---------------------------------------------------------------------------------------------

/**
 * Elder Futhark transliteration. This is a LETTER-FOR-LETTER mapping, not a translation: the runes
 * have names and meanings in Old Norse, and a phonetic transliteration is not one of them. Saying so
 * is the difference between a fun tool and a tool that lies.
 */
const RUNES: Record<string, string> = {
  a: 'ᚨ', b: 'ᛒ', c: 'ᚲ', d: 'ᛞ', e: 'ᛖ', f: 'ᚠ', g: 'ᚷ', h: 'ᚺ', i: 'ᛁ', j: 'ᛃ', k: 'ᚲ', l: 'ᛚ', m: 'ᛗ', n: 'ᚾ',
  o: 'ᛟ', p: 'ᛈ', q: 'ᚲ', r: 'ᚱ', s: 'ᛊ', t: 'ᛏ', u: 'ᚢ', v: 'ᚹ', w: 'ᚹ', x: 'ᚲᛊ', y: 'ᛃ', z: 'ᛉ',
  å: 'ᚨ', ä: 'ᚨ', æ: 'ᚨ', ö: 'ᛟ', ø: 'ᛟ', þ: 'ᚦ', ð: 'ᛞ', ' ': ' ', '.': '᛫', ',': '᛬', '-': '᛬', '?': '᛭',
  "'": '', '"': '', '!': '᛭',
};

export interface RunicResult {
  input: string;
  output: string;
  unmapped: string[];
  notes: string[];
}

export function runicTranslate(input: { text: string; direction?: 'to-runes' | 'to-latin' }): RunicResult {
  if (typeof input.text !== 'string' || input.text.trim().length === 0) throw invalidInput('Enter the text to transliterate.');
  if (input.text.length > 5000) throw invalidInput('The runic translator is limited to 5000 characters.');
  const direction = input.direction ?? 'to-runes';
  const unmapped = new Set<string>();

  if (direction === 'to-latin') {
    const reverse = new Map<string, string>();
    for (const [latin, rune] of Object.entries(RUNES)) {
      if (rune.length === 1 && !reverse.has(rune)) reverse.set(rune, latin);
    }
    let output = '';
    for (const character of input.text.toLowerCase()) {
      const mapped = reverse.get(character);
      if (mapped !== undefined) output += mapped;
      else if (/-/.test(character)) output += ' ';
      else if (character === '᛬') output += ', ';
      else if (character === '᛭') output += '.';
      else if (/\s/.test(character)) output += character;
      else {
        output += character;
        unmapped.add(character);
      }
    }
    return {
      input: input.text,
      output,
      unmapped: [...unmapped],
      notes: [
        'Rune-to-Latin is ambiguous: Eldar Futhark has no separate rune for c/k/q, no vowel distinction for a/ä/å, and the same rune could represent several sounds.',
        'The result is a best-effort transliteration, not a translation, and not a reconstruction of Old Norse grammar.',
      ],
    };
  }

  let output = '';
  for (const character of input.text.toLowerCase()) {
    const mapped = RUNES[character];
    if (mapped !== undefined) output += mapped;
    else if (/\s/.test(character)) output += character;
    else {
      output += character;
      unmapped.add(character);
    }
  }

  return {
    input: input.text,
    output,
    unmapped: [...unmapped],
    notes: [
      'This maps each Latin letter to the Elder Futhark rune conventionally used to represent its sound. It is a transliteration for decoration, not a translation.',
      'Letters without a rune equivalent are left unchanged and listed above. Runes are written left to right here; historical inscriptions sometimes ran right to left or in a boustrophedon pattern.',
      'Some fonts render the runic block inconsistently. If you see boxes, the font used to display this result lacks runic coverage.',
    ],
  };
}

export { invalidInput };
