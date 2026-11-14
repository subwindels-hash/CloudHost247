/**
 * Community text handling.
 *
 * Community bodies are **Markdown**, never HTML. They are stored verbatim (after normalisation) and
 * rendered on the client by the existing `frontend/src/lib/markdown.tsx`, which builds React
 * elements rather than an HTML string — so there is no `dangerouslySetInnerHTML` in the community
 * path at all, and a `<script>` written into a post is displayed as the characters the author
 * typed. That removes the entire class of stored-XSS bugs instead of filtering for it.
 *
 * The server still needs a plain-text projection of every body: for search snippets, e-mail copies
 * of notifications, the AI knowledge document built from an accepted solution, and the moderation
 * queue preview. `stripMarkdown` produces that projection, and it is deliberately lossy.
 */

const MAX_BODY_LENGTH = 20_000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export interface NormalisedBody {
  /** Cleaned Markdown, ready to store. */
  body: string;
  /** Plain-text projection, never longer than `limit` characters. */
  preview: string;
  /** Number of words in the plain-text projection. */
  wordCount: number;
}

/** Removes a leading/trailing blank line noise without touching meaningful indentation. */
function trimBody(value: string): string {
  return value.replace(/^\s*\n/, '').replace(/\s+$/, '');
}

/**
 * Normalises a submitted body: strips NUL/control bytes (which PostgreSQL rejects in `text`),
 * normalises line endings and non-breaking spaces, collapses runs of three or more blank lines, and
 * enforces the length ceiling. Returns the plain-text projection alongside, so callers never need a
 * second pass over the raw Markdown.
 */
export function normaliseBody(input: string, limit = 240): NormalisedBody {
  const cleaned = trimBody(
    String(input ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(CONTROL_CHARACTERS, '')
      .replace(/\n{3,}/g, '\n\n')
  ).slice(0, MAX_BODY_LENGTH);
  const plain = stripMarkdown(cleaned);
  return { body: cleaned, preview: truncate(plain, limit), wordCount: countWords(plain) };
}

/** Plain-text projection of Markdown: drops fences, link targets, markup and block punctuation. */
export function stripMarkdown(markdown: string): string {
  let text = String(markdown ?? '').replace(/\r\n?/g, '\n');
  // Fenced code: keep the code itself (it is often the substance of an answer) but drop the fence.
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code: string) => `\n${code}\n`);
  // Inline code keeps its content, images are dropped entirely, links keep their label.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/`([^`]*)`/g, '$1');
  // Headings, blockquotes, list markers and rules.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  text = text.replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '');
  text = text.replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, '');
  // Emphasis and strikethrough markers.
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');
  // Table pipes become spaces so a row still reads as a sentence.
  text = text.replace(/\|/g, ' ');
  return text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

export function truncate(value: string, limit: number): string {
  const text = String(value ?? '').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, Math.max(0, limit - 1));
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

export function countWords(value: string): number {
  const text = String(value ?? '').trim();
  return text ? text.split(/\s+/).length : 0;
}

/**
 * Extracts `@username` mentions, ignoring anything inside a fenced code block — an answer that
 * quotes a shell command such as `ssh @host` must not notify a member named `host`.
 */
export function extractMentions(markdown: string): string[] {
  const withoutCode = String(markdown ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const found = new Set<string>();
  const pattern = /(^|[^\w@/])@([a-zA-Z0-9][a-zA-Z0-9_-]{2,31})/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutCode)) !== null) {
    found.add(match[2]!.toLowerCase());
    if (found.size >= 20) break;
  }
  return [...found];
}

/** UTF-8 byte length of a base64 payload, without decoding it into a Buffer twice. */
export function base64ByteLength(value: string): number {
  const clean = String(value ?? '').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) return -1;
  return Math.floor((clean.length * 3) / 4);
}

/**
 * Verifies that a decoded buffer really is the image type it claims to be. A MIME type is a client
 * assertion; magic bytes are not. Returns the detected type, or null when the bytes disagree.
 */
export function detectImageType(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  return null;
}

/** A filename that is safe to show and to put in a Content-Disposition header. */
export function safeFileName(value: string, fallback = 'attachment'): string {
  const base = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F"/\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || fallback;
}

/** Slugifies a discussion title; uniqueness is enforced by the caller with a short suffix. */
export function slugify(value: string, maxLength = 160): string {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'discussion';
}

/** Tags: lower-case, hyphenated, deduplicated, bounded — and never more than five. */
export function normaliseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const tags = new Set<string>();
  for (const entry of input.slice(0, 20)) {
    if (typeof entry !== 'string') continue;
    const tag = entry
      .toLowerCase()
      .replace(/[^a-z0-9+#.\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    if (tag.length >= 2) tags.add(tag);
    if (tags.size >= 5) break;
  }
  return [...tags];
}
