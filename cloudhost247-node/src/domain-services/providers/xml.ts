/**
 * Minimal, security-hardened XML reader for provider API responses.
 *
 * Scope is deliberately narrow: Namecheap's XML API returns flat documents with elements,
 * attributes and text content. This parser supports exactly that — declaration, comments, CDATA,
 * self-closing tags, the five predefined entities and numeric character references.
 *
 * Deliberate security properties (this is a parser for untrusted third-party input):
 *   - DOCTYPE / ENTITY declarations are rejected, so XXE and entity-expansion attacks are
 *     structurally impossible.
 *   - Attribute values are entity-decoded once; no evaluation of any kind happens.
 *   - Input size is capped by the caller (provider responses are bounded by providerFetch's read).
 */

export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlParseError';
  }
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITY_MAP[entity] ?? match;
  });
}

interface Token {
  kind: 'element-open' | 'element-close' | 'element-selfclose' | 'text' | 'cdata' | 'comment' | 'decl';
  name?: string;
  attributes?: Record<string, string>;
  text?: string;
}

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < xml.length) {
    const open = xml.indexOf('<', index);
    if (open === -1) {
      const rest = xml.slice(index);
      if (rest.trim()) tokens.push({ kind: 'text', text: decodeEntities(rest) });
      break;
    }
    if (open > index) {
      const text = xml.slice(index, open);
      if (text.trim()) tokens.push({ kind: 'text', text: decodeEntities(text) });
    }

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end === -1) throw new XmlParseError('Unterminated XML comment');
      tokens.push({ kind: 'comment' });
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9);
      if (end === -1) throw new XmlParseError('Unterminated CDATA section');
      tokens.push({ kind: 'cdata', text: xml.slice(open + 9, end) });
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2);
      if (end === -1) throw new XmlParseError('Unterminated XML declaration');
      tokens.push({ kind: 'decl' });
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', open)) {
      // DOCTYPE and any other markup declarations are refused: this parser never resolves
      // entities defined in a document, and rejecting them outright removes the entire
      // entity-expansion / XXE class of bugs rather than trying to handle it safely.
      throw new XmlParseError('XML DOCTYPE/entity declarations are not accepted');
    }

    const close = xml.indexOf('>', open);
    if (close === -1) throw new XmlParseError('Unterminated XML tag');

    const inner = xml.slice(open + 1, close);
    if (inner.endsWith('/')) {
      const { name, attributes } = parseTagInner(inner.slice(0, -1));
      tokens.push({ kind: 'element-selfclose', name, attributes });
      index = close + 1;
      continue;
    }
    if (inner.startsWith('/')) {
      tokens.push({ kind: 'element-close', name: inner.slice(1).trim() });
      index = close + 1;
      continue;
    }
    const { name, attributes } = parseTagInner(inner);
    tokens.push({ kind: 'element-open', name, attributes });
    index = close + 1;
  }

  return tokens;
}

function parseTagInner(inner: string): { name: string; attributes: Record<string, string> } {
  const nameMatch = /^[^\s/>]+/.exec(inner);
  if (!nameMatch || !nameMatch[0]) throw new XmlParseError('Malformed XML tag');
  const name = nameMatch[0];
  const attributes: Record<string, string> = {};

  const attributePattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(inner)) !== null) {
    const attributeName = match[1];
    if (attributeName) attributes[attributeName] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return { name, attributes };
}

/** Parses a provider XML document into a tree. The root's name is returned as-is (namespace prefixes are kept). */
export function parseXml(xml: string): XmlNode {
  const tokens = tokenize(xml);
  const stack: XmlNode[] = [];
  const roots: XmlNode[] = [];
  let textBuffer = '';

  const flushText = (node: XmlNode | undefined) => {
    if (textBuffer && node) node.text += textBuffer;
    textBuffer = '';
  };

  for (const token of tokens) {
    if (token.kind === 'text') {
      textBuffer += token.text ?? '';
      continue;
    }
    if (token.kind === 'comment' || token.kind === 'decl') {
      continue;
    }
    if (token.kind === 'cdata') {
      textBuffer += token.text ?? '';
      continue;
    }

    const top = stack[stack.length - 1];
    if (token.kind === 'element-open') {
      flushText(top);
      const node: XmlNode = { name: token.name as string, attributes: token.attributes ?? {}, children: [], text: '' };
      if (top) top.children.push(node);
      else roots.push(node);
      stack.push(node);
      continue;
    }
    if (token.kind === 'element-selfclose') {
      flushText(top);
      const node: XmlNode = { name: token.name as string, attributes: token.attributes ?? {}, children: [], text: '' };
      if (top) top.children.push(node);
      else roots.push(node);
      continue;
    }
    if (token.kind === 'element-close') {
      flushText(top);
      if (!top || top.name !== token.name) {
        throw new XmlParseError(`Mismatched XML close tag: expected </${top?.name ?? 'nothing'}>, got </${token.name}>`);
      }
      stack.pop();
    }
  }

  const unclosed = stack[stack.length - 1];
  if (unclosed) {
    throw new XmlParseError(`Unclosed XML element: <${unclosed.name}>`);
  }
  const root = roots[0];
  if (roots.length !== 1 || !root) {
    throw new XmlParseError(`Expected exactly one XML root element, found ${roots.length}`);
  }
  return root;
}

/** Finds the first descendant (depth-first) with the given local name (ignoring any namespace prefix). */
export function findFirst(node: XmlNode, localName: string): XmlNode | null {
  const localOf = (name: string) => (name.includes(':') ? name.slice(name.indexOf(':') + 1) : name);
  if (localOf(node.name) === localName) return node;
  for (const child of node.children) {
    const found = findFirst(child, localName);
    if (found) return found;
  }
  return null;
}

export function findAll(node: XmlNode, localName: string): XmlNode[] {
  const results: XmlNode[] = [];
  const localOf = (name: string) => (name.includes(':') ? name.slice(name.indexOf(':') + 1) : name);
  const walk = (current: XmlNode) => {
    if (localOf(current.name) === localName) results.push(current);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return results;
}
