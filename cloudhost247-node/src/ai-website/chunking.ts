import { foldText, normaliseWhitespace, type ExtractedDocument } from './types';
import { SERVICE_ENTITIES } from './query-understanding';

/**
 * Chunking.
 *
 * A retrieved chunk is what the assistant is allowed to quote, so chunk boundaries matter more than
 * chunk size: a chunk that starts mid-sentence produces an answer that starts mid-sentence. This
 * chunker therefore splits on structure first (headings, list items, blank lines), packs whole
 * paragraphs up to a character budget, and only splits a single oversized paragraph on sentence
 * boundaries.
 *
 * Every chunk keeps the page title, URL and section, so an answer can always cite where it came
 * from even when the chunk itself is a single bullet point.
 */

export interface Chunk {
  index: number;
  title: string;
  section: string;
  content: string;
  keywords: string[];
  /** Approximate token count, used only for retrieval budgeting. */
  weight: number;
}

export interface ChunkOptions {
  /** Soft maximum characters per chunk. */
  maxChars?: number;
  /** Chunks below this are merged into the previous one instead of standing alone. */
  minChars?: number;
}

const DEFAULT_MAX = 1100;
const DEFAULT_MIN = 120;

/** Words too common to be a useful keyword for a chunk. */
const KEYWORD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'our', 'are', 'was', 'were',
  'will', 'can', 'not', 'but', 'all', 'any', 'how', 'what', 'when', 'where', 'which', 'who', 'why',
  'has', 'have', 'had', 'been', 'being', 'they', 'them', 'their', 'its', 'it', 'is', 'be', 'as',
  'at', 'by', 'in', 'on', 'of', 'to', 'or', 'if', 'so', 'we', 'us', 'me', 'my', 'he', 'she', 'his',
  'her', 'there', 'here', 'each', 'more', 'most', 'other', 'some', 'such', 'than', 'then', 'too',
  'very', 'just', 'also', 'into', 'over', 'under', 'about', 'after', 'before', 'between', 'through',
  'does', 'did', 'doing', 'done', 'get', 'got', 'make', 'made', 'use', 'used', 'using', 'one', 'two',
  'per', 'may', 'must', 'should', 'would', 'could', 'like', 'only', 'own', 'same', 'both', 'out',
]);

/**
 * Keywords for a chunk: the most frequent meaningful words plus every offering name the chunk
 * mentions. Offering names are worth double because they are what customers search for.
 */
export function deriveKeywords(text: string, limit = 14): string[] {
  const counts = new Map<string, number>();
  for (const raw of foldText(text).split(' ')) {
    if (raw.length < 3 || KEYWORD_STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  const scored: Array<{ word: string; score: number }> = [...counts.entries()].map(([word, count]) => {
    let score = count;
    for (const entity of SERVICE_ENTITIES) {
      if (entity.aliases.some((alias) => foldText(alias) === word)) {
        score += 5;
        break;
      }
    }
    // Longer words are usually the specific ones ("wordpress" over "host").
    return { word, score: score + Math.min(3, Math.floor(word.length / 4)) };
  });
  scored.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
  return scored.slice(0, limit).map((entry) => entry.word);
}

/** Splits a paragraph that is itself too large, preferring sentence boundaries. */
function splitParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+[.!?]*\s*/g) ?? [paragraph];
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length > 0 && current.length + sentence.length > maxChars) {
      out.push(current.trim());
      current = '';
    }
    if (sentence.length > maxChars) {
      // A single unbroken run (a table row, a long URL list): hard-wrap it.
      for (let offset = 0; offset < sentence.length; offset += maxChars) {
        out.push(sentence.slice(offset, offset + maxChars).trim());
      }
      continue;
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * Turns a document into chunks.
 *
 * Structure handling:
 *   • a short line that looks like a heading starts a new chunk and becomes its title;
 *   • a bullet list stays with the paragraph that introduces it where it fits;
 *   • FAQ entries are kept whole, because a half-answer is worse than no answer.
 */
export function chunkDocument(document: ExtractedDocument, options: ChunkOptions = {}): Chunk[] {
  const maxChars = Math.max(300, options.maxChars ?? DEFAULT_MAX);
  const minChars = Math.max(40, options.minChars ?? DEFAULT_MIN);

  const blocks: Array<{ title: string; section: string; text: string }> = [];
  let currentTitle = document.title;
  let buffer: string[] = [];
  let bufferLength = 0;

  const flush = () => {
    const text = normaliseWhitespace(buffer.join('\n'));
    buffer = [];
    bufferLength = 0;
    if (text) blocks.push({ title: currentTitle, section: currentTitle, text });
  };

  const paragraphs = normaliseWhitespace(document.body).split(/\n{2,}/);
  for (const rawParagraph of paragraphs) {
    for (const piece of splitParagraph(rawParagraph, maxChars)) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const isHeading = trimmed.length <= 90 && !trimmed.endsWith('.') && !trimmed.startsWith('•') && trimmed.split(' ').length <= 14;
      if (isHeading) {
        flush();
        currentTitle = trimmed;
        buffer.push(trimmed);
        bufferLength = trimmed.length;
        continue;
      }
      if (bufferLength > 0 && bufferLength + trimmed.length > maxChars) flush();
      buffer.push(trimmed);
      bufferLength += trimmed.length + 1;
    }
  }
  flush();

  // Merge a runt block forward into its neighbour: a 40-character chunk retrieves badly.
  const merged: typeof blocks = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (previous && block.text.length < minChars && previous.text.length + block.text.length <= maxChars) {
      previous.text = `${previous.text}\n${block.text}`;
      continue;
    }
    merged.push({ ...block });
  }

  const chunks: Chunk[] = merged.map((block, index) => ({
    index,
    title: block.title === document.title ? document.title : `${document.title} — ${block.title}`,
    section: block.section,
    content: block.text,
    keywords: deriveKeywords(`${block.title} ${block.text}`),
    weight: Math.max(1, Math.round(block.text.length / 4)),
  }));

  // A document with no body at all still gets one chunk, so its title/description are searchable.
  if (chunks.length === 0 && (document.title || document.description)) {
    const text = [document.title, document.description].filter(Boolean).join('\n');
    chunks.push({
      index: 0,
      title: document.title,
      section: document.title,
      content: text,
      keywords: deriveKeywords(text, 8),
      weight: 1,
    });
  }

  // Cap a single document's chunk count. A 60 kB policy is ~50 chunks; beyond this the tail is
  // summarised rather than dropped silently.
  const MAX_CHUNKS = 60;
  if (chunks.length > MAX_CHUNKS) {
    const kept = chunks.slice(0, MAX_CHUNKS - 1);
    kept.push({
      index: kept.length,
      title: `${document.title} — continued`,
      section: document.title,
      content: normaliseWhitespace(chunks.slice(MAX_CHUNKS - 1).map((chunk) => chunk.content).join('\n')).slice(0, maxChars),
      keywords: deriveKeywords(document.faqs.map((faq) => `${faq.question} ${faq.answer}`).join(' '), 10),
      weight: 2,
    });
    return kept;
  }

  return chunks;
}
