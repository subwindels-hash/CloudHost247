/**
 * Minimal, security-hardened XML reader for provider API responses — ported from
 * `cloudhost247-node/src/domain-services/providers/xml.ts`.
 *
 * Scope is deliberately narrow: Namecheap's XML API returns flat documents with elements,
 * attributes and text content, and this parser supports exactly that — declaration, comments,
 * CDATA, self-closing tags, the five predefined entities and numeric character references.
 *
 * **This parses untrusted third-party input, so two properties are structural rather than
 * best-effort:**
 *
 *   1. `<!DOCTYPE` and any other markup declaration is **rejected outright**. This parser never
 *      resolves a document-defined entity, so XXE (external entity expansion), entity-expansion
 *      bombs and parameter-entity tricks are impossible here rather than "handled safely". A
 *      registry or provider that sends a DOCTYPE gets `INVALID_PROVIDER_RESPONSE`, not a file read.
 *   2. Entity references are decoded exactly once and never re-scanned, so there is no recursive
 *      decoding to abuse. An unknown entity name is left as written rather than dropped, so it
 *      cannot silently become a different value.
 *
 * It is a reader, never a writer, and it never evaluates anything.
 */
'use strict';

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

class XmlParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XmlParseError';
  }
}

function decodeEntities(input) {
  return String(input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
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

function tokenize(xml) {
  const tokens = [];
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
      // See the header: refusing every markup declaration removes the whole entity-expansion class.
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

function parseTagInner(inner) {
  const nameMatch = /^[^\s/>]+/.exec(inner);
  if (!nameMatch || !nameMatch[0]) throw new XmlParseError('Malformed XML tag');
  const name = nameMatch[0];
  const attributes = {};

  const attributePattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attributePattern.exec(inner)) !== null) {
    const attributeName = match[1];
    if (attributeName) attributes[attributeName] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return { name, attributes };
}

/** Parse a provider XML document into a tree. The root's name is returned as written (namespace prefixes kept). */
function parseXml(xml) {
  const tokens = tokenize(String(xml));
  const stack = [];
  const roots = [];
  let textBuffer = '';

  const flushText = (node) => {
    if (textBuffer && node) node.text += textBuffer;
    textBuffer = '';
  };

  for (const token of tokens) {
    if (token.kind === 'text' || token.kind === 'cdata') {
      textBuffer += token.text ?? '';
      continue;
    }
    if (token.kind === 'comment' || token.kind === 'decl') continue;

    const top = stack[stack.length - 1];
    if (token.kind === 'element-open') {
      flushText(top);
      const node = { name: token.name, attributes: token.attributes ?? {}, children: [], text: '' };
      if (top) top.children.push(node); else roots.push(node);
      stack.push(node);
      continue;
    }
    if (token.kind === 'element-selfclose') {
      flushText(top);
      const node = { name: token.name, attributes: token.attributes ?? {}, children: [], text: '' };
      if (top) top.children.push(node); else roots.push(node);
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
  if (unclosed) throw new XmlParseError(`Unclosed XML element: <${unclosed.name}>`);
  const root = roots[0];
  if (roots.length !== 1 || !root) throw new XmlParseError(`Expected exactly one XML root element, found ${roots.length}`);
  return root;
}

function localName(name) {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}

/** First descendant (depth-first) with the given local name, ignoring any namespace prefix. */
function findFirst(node, wanted) {
  if (localName(node.name) === wanted) return node;
  for (const child of node.children) {
    const found = findFirst(child, wanted);
    if (found) return found;
  }
  return null;
}

/** Every descendant with the given local name, in document order. */
function findAll(node, wanted) {
  const results = [];
  const walk = (current) => {
    if (localName(current.name) === wanted) results.push(current);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return results;
}

module.exports = { XmlParseError, parseXml, findFirst, findAll, decodeEntities, localName };
