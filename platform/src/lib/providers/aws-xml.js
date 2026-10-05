/**
 * A minimal, strict XML reader for AWS query-protocol responses.
 *
 * The EC2, CloudWatch and EC2 Instance Connect APIs answer with XML, and the platform has no XML
 * dependency — nor should it gain one for this: the parser below covers exactly what those responses
 * use (elements, attributes, self-closing tags, text, character entities, CDATA, comments and the
 * declaration) and throws on anything malformed instead of guessing.
 *
 * The AWS SDKs present these documents as typed objects. Nothing here imitates that: a caller walks
 * the document with the XML's own element names, so what a test asserts is what the provider sent.
 */
'use strict';

const ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match;
  });
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attributes;
}

/** Parses an XML document into `{ name, attributes, children, text }` nodes. */
function parseXml(source) {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error('XML document is empty');
  }
  const document = { name: '#document', attributes: {}, children: [], text: '' };
  const stack = [document];
  let index = 0;

  const appendText = (text) => {
    if (text.length > 0) stack[stack.length - 1].text += decodeEntities(text);
  };

  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open === -1) {
      appendText(source.slice(index));
      break;
    }
    if (open > index) appendText(source.slice(index, open));

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open);
      if (end === -1) throw new Error('unterminated XML comment');
      index = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open);
      if (end === -1) throw new Error('unterminated CDATA section');
      appendText(source.slice(open + 9, end));
      index = end + 3;
      continue;
    }
    if (source.startsWith('<?', open) || source.startsWith('<!', open)) {
      const end = source.indexOf('>', open);
      if (end === -1) throw new Error('unterminated XML declaration');
      index = end + 1;
      continue;
    }
    if (source.startsWith('</', open)) {
      const end = source.indexOf('>', open);
      if (end === -1) throw new Error('unterminated closing tag');
      const name = source.slice(open + 2, end).trim();
      const node = stack.pop();
      if (!node || node.name !== name) throw new Error(`mismatched closing tag </${name}>`);
      index = end + 1;
      continue;
    }

    // Opening (or self-closing) tag: scan to the '>' that is not inside an attribute value.
    let cursor = open + 1;
    let quote = null;
    while (cursor < source.length) {
      const character = source[cursor];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
      cursor += 1;
    }
    if (cursor >= source.length) throw new Error('unterminated XML tag');

    const raw = source.slice(open + 1, cursor);
    const selfClosing = raw.endsWith('/');
    const inner = selfClosing ? raw.slice(0, -1) : raw;
    const boundary = inner.search(/[\s/]/);
    const name = (boundary === -1 ? inner : inner.slice(0, boundary)).trim();
    if (name.length === 0) throw new Error('XML tag without a name');
    const node = {
      name,
      attributes: boundary === -1 ? {} : parseAttributes(inner.slice(boundary)),
      children: [],
      text: '',
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    index = cursor + 1;
  }

  if (stack.length !== 1) throw new Error(`unclosed element <${stack[stack.length - 1].name}>`);
  return document;
}

/** First child element named `name`. */
function child(node, name) {
  return (node?.children ?? []).find((entry) => entry.name === name) ?? null;
}

/** All child elements named `name`. */
function children(node, name) {
  return (node?.children ?? []).filter((entry) => entry.name === name);
}

/** Trimmed text of the first child element named `name`, or null when it is absent or empty. */
function childText(node, name) {
  const found = child(node, name);
  if (!found) return null;
  const value = found.text.trim();
  return value.length > 0 ? value : null;
}

/** Trimmed text of the node itself. */
function text(node) {
  const value = node?.text?.trim() ?? '';
  return value.length > 0 ? value : null;
}

/** The document's single root element. */
function root(document) {
  return (document?.children ?? [])[0] ?? null;
}

/** The `<item>` children of a wrapper element — the shape of every AWS list. */
function listItems(node) {
  return children(node, 'item');
}

/** The `<item>` children of `<root><wrapper><item…` — the common one-level list. */
function wrappedItems(node, wrapper) {
  return listItems(child(node, wrapper));
}

/** `[child, text]` for a child element, which is what a nullable text field usually needs. */
function childValue(node, name) {
  const found = child(node, name);
  return found ? text(found) : null;
}

/**
 * Case-insensitive lookups. AWS's own XML is inconsistent between services — EC2 lowercases member
 * names (`<instanceState>`, `<tagSet>`) because its model sets locationNames, while CloudWatch
 * capitalises them (`<Datapoints>`, `<Average>`) — so a reader that guesses one style is one
 * provider-side rename away from silently returning nothing.
 */
function childCI(node, name) {
  const wanted = name.toLowerCase();
  return (node?.children ?? []).find((entry) => entry.name.toLowerCase() === wanted) ?? null;
}

function childrenCI(node, name) {
  const wanted = name.toLowerCase();
  return (node?.children ?? []).filter((entry) => entry.name.toLowerCase() === wanted);
}

function childTextCI(node, name) {
  const found = childCI(node, name);
  if (!found) return null;
  const value = found.text.trim();
  return value.length > 0 ? value : null;
}

/** The `<item>` (or `<member>`) children of a wrapper element, matched case-insensitively. */
function wrappedItemsCI(node, wrapper, member = 'item') {
  return (childrenCI(node, wrapper) ?? []).flatMap((entry) => (entry.children ?? [])
    .filter((childNode) => childNode.name.toLowerCase() === member.toLowerCase()));
}

module.exports = {
  parseXml,
  child,
  childCI,
  childrenCI,
  childTextCI,
  wrappedItemsCI,
  children,
  childText,
  childValue,
  text,
  root,
  listItems,
  wrappedItems,
  decodeEntities,
};
