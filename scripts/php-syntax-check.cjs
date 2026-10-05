#!/usr/bin/env node
/**
 * Lightweight PHP sanity checker (no PHP binary available in this sandbox).
 *
 * Tokenizes each file well enough to catch the realistic failure modes of
 * generated PHP: unbalanced (), [], {}; unterminated strings; broken
 * heredoc/nowdoc markers. It is NOT a parser — it will not catch semantic
 * errors — but combined with careful generation it gives strong confidence.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
let failures = 0;

function checkFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const stack = [];
  const errors = [];
  const OPEN = { '(': ')', '[': ']', '{': '}' };
  const CLOSE = { ')': '(', ']': '[', '}': '{' };

  let i = 0;
  let inPhp = false;
  let state = 'code'; // code | squote | dquote | line-comment | block-comment | heredoc
  let heredocTag = '';
  let line = 1;
  const lineOf = (pos) => src.slice(0, pos).split('\n').length;

  while (i < src.length) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);

    if (c === '\n') line += 1;

    if (!inPhp) {
      if (src.slice(i, i + 5) === '<?php' || src.slice(i, i + 2) === '<?') {
        inPhp = true;
        i += src.slice(i, i + 5) === '<?php' ? 5 : 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (state === 'code') {
      if (c2 === '//' || c === '#') { state = 'line-comment'; i += 2; continue; }
      if (c2 === '/*') { state = 'block-comment'; i += 2; continue; }
      if (c === "'") { state = 'squote'; i += 1; continue; }
      if (c === '"') { state = 'dquote'; i += 1; continue; }
      // heredoc/nowdoc: <<<TAG or <<<'TAG' or <<<"TAG"
      if (src.slice(i, i + 3) === '<<<') {
        const m = src.slice(i).match(/^<<<\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/);
        if (m) {
          state = 'heredoc';
          heredocTag = m[2];
          i += m[0].length;
          continue;
        }
      }
      if (OPEN[c]) { stack.push({ c, line }); i += 1; continue; }
      if (CLOSE[c]) {
        const top = stack.pop();
        if (!top || top.c !== CLOSE[c]) {
          errors.push(`line ${line}: unbalanced '${c}'`);
          break;
        }
        i += 1;
        continue;
      }
      if (src.slice(i, i + 2) === '?>') {
        if (stack.length > 0) errors.push(`line ${line}: '?>' with unclosed ${stack.map((s) => s.c).join(',')}`);
        inPhp = false;
        stack.length = 0;
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'line-comment') {
      if (c === '\n') state = 'code';
      i += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (c2 === '*/') { state = 'code'; i += 2; continue; }
      i += 1;
      continue;
    }

    if (state === 'squote') {
      if (c === '\\') { i += 2; continue; }
      if (c === "'") { state = 'code'; }
      i += 1;
      continue;
    }

    if (state === 'dquote') {
      if (c === '\\') { i += 2; continue; }
      if (c === '"') { state = 'code'; }
      i += 1;
      continue;
    }

    if (state === 'heredoc') {
      // closing marker: tag alone on a line (PHP 7.3+ allows indentation).
      const m = src.slice(i).match(new RegExp('^[ \\t]*' + heredocTag + '\\b[;,)\\]\\n]'));
      if (m && (i === 0 || src[i - 1] === '\n')) {
        state = 'code';
        i += m[0].length - 1; // leave the terminator char for the code state
        continue;
      }
      i += 1;
      continue;
    }
  }

  if (state === 'squote' || state === 'dquote') errors.push(`unterminated string (state=${state})`);
  if (state === 'block-comment') errors.push('unterminated block comment');
  if (state === 'heredoc') errors.push(`unterminated heredoc (${heredocTag})`);
  if (stack.length > 0) {
    errors.push(`unclosed ${stack.map((s) => `'${s.c}' @line ${s.line}`).join(', ')}`);
  }

  if (errors.length) {
    failures += 1;
    console.error(`FAIL ${file}`);
    for (const e of errors) console.error('   ', e);
  } else {
    console.log(`ok   ${file}`);
  }
}

for (const f of files) checkFile(f);
console.log(failures === 0 ? '\nALL OK' : `\n${failures} file(s) with problems`);
process.exit(failures === 0 ? 0 : 1);
