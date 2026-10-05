/**
 * A YAML subset parser — enough for the marketplace manifests (spec §10), with no dependency.
 *
 * The project allows exactly one production dependency (`pg`), so the original's `yaml` import is
 * not available here. This parser therefore supports precisely the constructs the manifest format
 * uses, and *rejects* everything else with a clear message rather than guessing: a manifest that
 * parses differently to what its author meant is worse than a manifest that does not parse.
 *
 * Supported: block mappings, block sequences (of scalars or of mappings, indented or indentless),
 * nesting by indentation, plain/single-quoted/double-quoted scalars including wrapped (folded)
 * values, integers and floats, booleans, null, comments, `---` document markers, and the empty flow
 * collections `[]` / `{}`.
 *
 * Not supported (rejected by name): anchors and aliases, merge keys, tags, block scalars (`|`, `>`),
 * non-empty flow collections, multi-document streams, complex keys.
 */
'use strict';

const NULLS = new Set(['', '~', 'null', 'Null', 'NULL']);
const TRUE_VALUES = new Set(['true', 'True', 'TRUE']);
const FALSE_VALUES = new Set(['false', 'False', 'FALSE']);

/** Removes a trailing `# comment` that is not inside quotes. */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") i += 1; // '' is an escaped quote
        else quote = null;
      }
      continue;
    }
    if (quote === '"') {
      if (ch === '\\') i += 1;
      else if (ch === '"') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).replace(/\s+$/, '');
  }
  return text.replace(/\s+$/, '');
}

function unescapeDouble(text) {
  return text.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (match, seq) => {
    switch (seq[0]) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '0': return '\0';
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'u':
      case 'x': return String.fromCodePoint(Number.parseInt(seq.slice(1), 16));
      default: return seq;
    }
  });
}

/** A quoted scalar, an empty flow collection, or a plain scalar. */
function parseScalar(raw, context) {
  const text = raw.trim();
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) throw new Error(`${context}: unterminated double-quoted string`);
    return unescapeDouble(text.slice(1, -1));
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) throw new Error(`${context}: unterminated single-quoted string`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('&') || text.startsWith('*')) {
    throw new Error(`${context}: anchors and aliases are not supported`);
  }
  if (text.startsWith('!')) throw new Error(`${context}: tags are not supported`);
  if (text.startsWith('|') || text.startsWith('>')) {
    throw new Error(`${context}: block scalars (| and >) are not supported; write the value on one line`);
  }
  if (text.startsWith('[') || text.startsWith('{')) {
    if (text === '[]') return [];
    if (text === '{}') return {};
    throw new Error(`${context}: only the empty flow collections [] and {} are supported`);
  }
  if (NULLS.has(text)) return null;
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  if (/^-?(0|[1-9]\d*)$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(text)) return Number.parseFloat(text);
  return text;
}

/**
 * Splits `key: value` at the first top-level colon. A colon only separates a key when it is
 * followed by whitespace or end-of-line, so `image: ghcr.io/foo:1.2` keeps its tag and
 * `http://x` is never mistaken for a mapping.
 */
function splitKey(text, context) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (quote === "'" && ch === "'") {
        if (text[i + 1] === "'") i += 1;
        else quote = null;
      } else if (quote === '"' && ch === '\\') i += 1;
      else if (quote === '"' && ch === '"') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
      const key = text.slice(0, i).trim();
      if (!key) throw new Error(`${context}: mapping key is empty`);
      if (key.startsWith('?') || key.includes('[') || key.includes('{')) {
        throw new Error(`${context}: complex mapping keys are not supported`);
      }
      return [key, text.slice(i + 1).trim()];
    }
  }
  return null;
}

function tokenize(text) {
  const tokens = [];
  const lines = text.split(/\r?\n/);
  for (let number = 0; number < lines.length; number += 1) {
    const raw = lines[number];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed === '---' || trimmed === '...') continue;
    if (trimmed.startsWith('%')) throw new Error(`line ${number + 1}: directives are not supported`);
    const indent = raw.length - raw.replace(/^[ ]+/, '').length;
    if (raw.slice(indent).startsWith('\t') || raw.slice(0, indent).includes('\t')) {
      throw new Error(`line ${number + 1}: tabs cannot be used for indentation`);
    }
    tokens.push({ indent, text: stripComment(raw.slice(indent)), number: number + 1 });
  }
  const documentStarts = text.split(/\r?\n/).filter((line) => line.trim() === '---').length;
  if (documentStarts > 1) throw new Error('multi-document streams are not supported');
  return tokens.filter((token) => token.text !== '');
}

function isSequenceItem(token) {
  return Boolean(token) && (token.text === '-' || token.text.startsWith('- '));
}

/**
 * YAML allows a sequence to be written at the same indentation as the key that owns it:
 *   supportedHostingTypes:
 *   - docker
 * The manifests use this everywhere, so a value block may start at the key's own column when the
 * next line is a sequence item.
 */
function parseValueBlock(tokens, cursor, indent) {
  const next = tokens[cursor.index];
  if (!next || next.indent < indent) return null;
  if (next.indent === indent && isSequenceItem(next)) return parseSequence(tokens, cursor, indent);
  if (next.indent > indent) return parseBlock(tokens, cursor, next.indent);
  return null;
}

/** True when a quote opened on this text is still open at its end. */
function quoteIsOpen(text, quote) {
  // The character at index 0 is the opening quote, so scanning starts after it — otherwise a
  // one-line quoted value would look "already closed" and a wrapped one would look closed after
  // its first line.
  for (let i = 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") i += 1;
        else return false;
      }
    } else if (ch === '\\') i += 1;
    else if (ch === '"') return false;
  }
  return true;
}

/**
 * Reads a scalar value, folding continuation lines. YAML lets a long value wrap:
 *   longDescription: 'Nextcloud is … mail,
 *     chat, and office editing in one place.'
 * and folds each line break into a single space. A continuation is any following line indented
 * deeper than the key that owns the scalar.
 */
function consumeScalar(tokens, cursor, keyIndent, inline, context) {
  const trimmed = inline.trim();
  const quote = trimmed.startsWith("'") ? "'" : trimmed.startsWith('"') ? '"' : null;
  const parts = [trimmed];
  while (cursor.index < tokens.length) {
    const next = tokens[cursor.index];
    if (next.indent <= keyIndent) break;
    if (quote) {
      // A quoted scalar continues until its closing quote appears.
      if (!quoteIsOpen(parts.join(' '), quote)) {
        throw new Error(`line ${next.number}: unexpected indentation after a value`);
      }
    } else if (isSequenceItem(next)) {
      throw new Error(`line ${next.number}: unexpected list item after a value`);
    }
    parts.push(next.text);
    cursor.index += 1;
  }
  if (quote && quoteIsOpen(parts.join(' '), quote)) throw new Error(`${context}: unterminated quoted string`);
  return parseScalar(parts.join(' '), context);
}

function parseBlock(tokens, cursor, indent) {
  const first = tokens[cursor.index];
  if (!first || first.indent < indent) return null;
  if (first.indent > indent) {
    throw new Error(`line ${first.number}: unexpected indentation (expected ${indent} spaces)`);
  }
  if (first.text === '-' || first.text.startsWith('- ')) return parseSequence(tokens, cursor, indent);
  return parseMapping(tokens, cursor, indent);
}

function parseSequence(tokens, cursor, indent) {
  const items = [];
  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    if (token.indent < indent) break;
    if (token.indent > indent) throw new Error(`line ${token.number}: unexpected indentation inside a list`);
    if (!isSequenceItem(token)) break;
    const rest = token.text === '-' ? '' : token.text.slice(2).trim();
    cursor.index += 1;

    if (rest === '') {
      items.push(parseValueBlock(tokens, cursor, indent));
      continue;
    }
    const entry = splitKey(rest, `line ${token.number}`);
    if (!entry) {
      items.push(rest.startsWith("'") || rest.startsWith('"')
        ? consumeScalar(tokens, cursor, indent, rest, `line ${token.number}`)
        : parseScalar(rest, `line ${token.number}`));
      continue;
    }
    // The item is a mapping whose first key sits on the dash line. Everything belonging to it is
    // indented past the dash, so the item's own mapping starts two columns in ("- key: value").
    const itemIndent = indent + 2;
    const item = {};
    let [key, value] = entry;
    if (value === '') {
      item[key] = parseValueBlock(tokens, cursor, itemIndent);
    } else {
      item[key] = consumeScalar(tokens, cursor, itemIndent, value, `line ${token.number}`);
    }
    // Remaining keys of this item, indented at least to the first key's column.
    while (cursor.index < tokens.length) {
      const follow = tokens[cursor.index];
      if (follow.indent < itemIndent) break;
      if (follow.indent > itemIndent) throw new Error(`line ${follow.number}: unexpected indentation in a list item`);
      if (follow.text === '-' || follow.text.startsWith('- ')) break;
      const nested = splitKey(follow.text, `line ${follow.number}`);
      if (!nested) throw new Error(`line ${follow.number}: expected "key: value"`);
      if (Object.prototype.hasOwnProperty.call(item, nested[0])) {
        throw new Error(`line ${follow.number}: duplicate key "${nested[0]}"`);
      }
      cursor.index += 1;
      if (nested[1] === '') {
        item[nested[0]] = parseValueBlock(tokens, cursor, itemIndent);
      } else {
        item[nested[0]] = consumeScalar(tokens, cursor, itemIndent, nested[1], `line ${follow.number}`);
      }
    }
    items.push(item);
  }
  return items;
}

function parseMapping(tokens, cursor, indent) {
  const result = {};
  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    if (token.indent < indent) break;
    if (token.indent > indent) throw new Error(`line ${token.number}: unexpected indentation in a mapping`);
    if (isSequenceItem(token)) break;
    const entry = splitKey(token.text, `line ${token.number}`);
    if (!entry) throw new Error(`line ${token.number}: expected "key: value"`);
    const [key, value] = entry;
    if (key === '<<') throw new Error(`line ${token.number}: merge keys are not supported`);
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`line ${token.number}: duplicate key "${key}"`);
    }
    cursor.index += 1;
    if (value === '') {
      result[key] = parseValueBlock(tokens, cursor, indent);
    } else {
      result[key] = consumeScalar(tokens, cursor, indent, value, `line ${token.number}`);
    }
  }
  return result;
}

/**
 * Parses a YAML document. Throws an Error whose message names the offending line — the caller
 * turns that into a validation error rather than a 500.
 */
function parseYaml(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  const cursor = { index: 0 };
  const value = parseBlock(tokens, cursor, tokens[0].indent);
  if (cursor.index < tokens.length) {
    throw new Error(`line ${tokens[cursor.index].number}: could not parse the rest of the document`);
  }
  return value;
}

module.exports = { parseYaml };
